import { expect, test } from "bun:test";
import { InputResampler } from "../../src/live/openai-resample";

function pcm(samples: number[]) {
  const bytes = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => {
    bytes.writeInt16LE(sample, index * 2);
  });
  return bytes;
}

/** Offline reference: 24k output times are 2/3 of a 16k sample apart; hold the final endpoint. */
function reference(samples: number[]) {
  const output = Array.from({ length: Math.ceil((samples.length * 3) / 2) }, (_, index) => {
    const thirds = index * 2;
    const left = Math.floor(thirds / 3);
    if (left >= samples.length - 1) return samples[samples.length - 1];
    const rightWeight = thirds % 3;
    // Integer weights, not the streaming implementation's floating-point phase/delta calculation.
    return Math.round((samples[left] * (3 - rightWeight) + samples[left + 1] * rightWeight) / 3);
  });
  return pcm(output);
}

function complete(input: Buffer) {
  const resampler = new InputResampler();
  return Buffer.concat([resampler.push(input), resampler.flush()]);
}

// Literal expectations anchor both the resampler and the offline oracle, including signed rounding.
for (const { name, input, emitted, held } of [
  { name: "empty input", input: [], emitted: [], held: [] },
  { name: "one maximum sample", input: [32767], emitted: [32767], held: [32767] },
  { name: "two signed endpoints", input: [-32768, 32767], emitted: [-32768, 10922], held: [32767] },
  {
    name: "three signed endpoints",
    input: [-32768, 32767, -32768],
    emitted: [-32768, 10922, 10922, -32768],
    held: [-32768],
  },
  { name: "small signed samples", input: [1, -1, 2, -2, 0], emitted: [1, 0, 0, 2, -1, -1, 0], held: [0] },
  {
    name: "all interpolation phases",
    input: [0, 3000, -3000, 6000],
    emitted: [0, 2000, 1000, -3000, 3000],
    held: [6000],
  },
]) {
  test("literal 16k to 24k conversion: " + name, () => {
    const resampler = new InputResampler();
    expect(Buffer.from(resampler.push(pcm(input)))).toEqual(pcm(emitted));
    expect(Buffer.from(resampler.flush())).toEqual(pcm(held));
    expect(resampler.flush()).toHaveLength(0);
    expect(reference(input)).toEqual(pcm([...emitted, ...held]));
  });
}

test("irregular capture chunks match an independent full-waveform reference byte for byte", () => {
  const samples = Array.from({ length: 16000 }, (_, i) =>
    Math.round(10000 * Math.sin((2 * Math.PI * 437 * i) / 16000)),
  );
  const input = pcm(samples);
  const resampler = new InputResampler();
  const blocks: Uint8Array[] = [];
  const chunkSamples = [1, 319, 2, 320, 47, 800];
  let offset = 0;
  let chunk = 0;
  while (offset < input.length) {
    const end = Math.min(input.length, offset + chunkSamples[chunk++ % chunkSamples.length] * 2);
    blocks.push(resampler.push(input.subarray(offset, end)));
    offset = end;
  }
  const streaming = Buffer.concat(blocks);
  const expected = reference(samples);
  expect(streaming).toEqual(expected.subarray(0, -2));
  expect(Buffer.concat([streaming, resampler.flush()])).toEqual(expected);
  expect(complete(input)).toEqual(expected);
  expect(expected).toHaveLength(48000);
});

test("a single-sample chunk carries the prior endpoint and phase, not a chunk-local restart", () => {
  const resampler = new InputResampler();
  expect(Buffer.from(resampler.push(pcm([100])))).toEqual(pcm([100]));
  expect(resampler.push(new Uint8Array())).toHaveLength(0);
  expect(Buffer.from(resampler.push(pcm([400])))).toEqual(pcm([300]));
  expect(Buffer.from(resampler.push(pcm([700])))).toEqual(pcm([500, 700]));
  expect(Buffer.from(resampler.flush())).toEqual(pcm([700]));
  // Flush ends the stream: the next input starts at phase zero.
  expect(Buffer.from(resampler.push(pcm([-200])))).toEqual(pcm([-200]));
  expect(Buffer.from(resampler.flush())).toEqual(pcm([-200]));
});

test("odd PCM rejection leaves the current stream endpoint and phase intact", () => {
  const resampler = new InputResampler();
  resampler.push(pcm([100, 400]));
  expect(() => resampler.push(new Uint8Array([0]))).toThrow("Odd PCM byte count");
  expect(Buffer.from(resampler.push(pcm([700])))).toEqual(pcm([500, 700]));
  expect(Buffer.from(resampler.flush())).toEqual(pcm([700]));
});

test("reset discards the held endpoint and starts the next stream at phase zero", () => {
  const resampler = new InputResampler();
  resampler.push(pcm([100, 400, 700]));
  resampler.reset();
  expect(resampler.flush()).toHaveLength(0);
  expect(Buffer.from(resampler.push(pcm([-300, 300])))).toEqual(pcm([-300, 100]));
  expect(Buffer.from(resampler.flush())).toEqual(pcm([300]));
});
