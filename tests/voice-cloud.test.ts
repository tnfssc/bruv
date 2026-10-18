import { expect, test } from "bun:test";
import { Level, startCloudSpeech } from "../src/voice/cloud";
import { resample } from "../src/voice/local";
import { withoutDirections } from "../src/voice/text";

/** A response whose body is sent in `pieces`, each after `wait`. */
function audio(pieces: number[][], wait: Promise<void> = Promise.resolve()) {
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      await wait;
      for (const piece of pieces) controller.enqueue(new Uint8Array(piece));
      controller.close();
    },
  });
  return new Response(body, { headers: { "content-type": "audio/pcm;rate=44100;channels=1" } });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("sentences play in order even when a later one arrives first", async () => {
  let release: () => void = () => {};
  const slow = new Promise<void>((resolve) => {
    release = resolve;
  });
  const played: [number, number[], number][] = [];
  const speech = startCloudSpeech({
    model: "m",
    key: async () => "k",
    audio: (pcm, rate, part) => played.push([part, [...pcm], rate]),
    failed: () => {},
    fetch: (async (_url: string, init: RequestInit) => {
      const { input } = JSON.parse(String(init.body));
      // Little-endian samples, the first split across two pieces.
      return input === "one" ? audio([[1], [0, 2, 0]], slow) : audio([[3, 0]]);
    }) as unknown as typeof fetch,
  });
  speech.speak("one", 1);
  speech.speak("two", 2);
  await settle();
  expect(played).toEqual([]);
  release();
  await settle();
  // A sample split between two pieces of the stream is put back together.
  const samples = (part: number) => played.filter(([at]) => at === part).flatMap(([, pcm]) => pcm);
  const parts = played.map(([part]) => part);
  expect(parts).toEqual([...parts].sort());
  expect(new Set(played.map(([, , rate]) => rate))).toEqual(new Set([44_100]));
  expect(samples(1)).toEqual([1, 2]);
  expect(samples(2)).toEqual([3]);
});

test("a failed sentence and the ones after it are handed back in order", async () => {
  const handed: { rest: { text: string; part: number }[]; stop: boolean }[] = [];
  const played: number[] = [];
  const speech = startCloudSpeech({
    model: "m",
    key: async () => "k",
    audio: (_pcm, _rate, part) => played.push(part),
    failed: (rest, _message, stop) => handed.push({ rest, stop }),
    fetch: (async (_url: string, init: RequestInit) => {
      const { input } = JSON.parse(String(init.body));
      if (input === "two") return new Response("no credit", { status: 402 });
      return audio([[1, 0]], new Promise((resolve) => setTimeout(resolve, input === "one" ? 50 : 0)));
    }) as unknown as typeof fetch,
  });
  speech.speak("one", 1);
  speech.speak("two", 2);
  speech.speak("three", 3);
  await settle();
  // "one" is still coming, so nothing is handed back yet, and what comes next joins the handback.
  expect(handed).toEqual([]);
  speech.speak("four", 4);
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(played).toEqual([1]);
  expect(handed).toEqual([
    {
      rest: [
        { text: "two", part: 2 },
        { text: "three", part: 3 },
        { text: "four", part: 4 },
      ],
      stop: true,
    },
  ]);
});

test("a hush drops what is still coming", async () => {
  const played: number[] = [];
  let release: () => void = () => {};
  const slow = new Promise<void>((resolve) => {
    release = resolve;
  });
  const speech = startCloudSpeech({
    model: "m",
    key: async () => "k",
    audio: (_pcm, _rate, part) => played.push(part),
    failed: () => {},
    fetch: (async () => audio([[1, 0]], slow)) as unknown as typeof fetch,
  });
  speech.speak("one", 1);
  await settle();
  speech.hush();
  release();
  await settle();
  expect(played).toEqual([]);
});

test("mood directions are taken out of what is shown and checked for echo", () => {
  expect(withoutDirections("[a little sheepish] Uh, wait. Actually, no.")).toBe("Uh, wait. Actually, no.");
  expect(withoutDirections("[pleased]")).toBe("");
});

test("when several fail, all of them are handed back once, in order", async () => {
  const handed: number[][] = [];
  const speech = startCloudSpeech({
    model: "m",
    key: async () => "k",
    audio: () => {},
    failed: (rest) => handed.push(rest.map(({ part }) => part)),
    fetch: (async (_url: string, init: RequestInit) => {
      const { input } = JSON.parse(String(init.body));
      // Later sentences fail sooner.
      await new Promise((resolve) => setTimeout(resolve, 40 - Number(input) * 10));
      return new Response("bad key", { status: 401 });
    }) as unknown as typeof fetch,
  });
  speech.speak("1", 1);
  speech.speak("2", 2);
  speech.speak("3", 3);
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(handed).toEqual([[1, 2, 3]]);
});

test("audio converted to another rate keeps its length in time and its shape", () => {
  const pcm = new Int16Array([0, 100, 200, 300]);
  const out = resample(pcm, 24_000, 48_000);
  expect(out.length).toBe(8);
  expect([...out.slice(0, 4)]).toEqual([0, 50, 100, 150]);
});

test("loud and quiet sentences come out at the same level", () => {
  const tone = (amplitude: number) =>
    Int16Array.from({ length: 44_100 }, (_, i) => Math.round(amplitude * Math.sin(i / 10)));
  const rms = (chunks: Int16Array[]) => {
    const all = chunks.flatMap((pcm) => [...pcm]);
    return Math.sqrt(all.reduce((sum, x) => sum + x * x, 0) / all.length);
  };
  const loud = new Level(44_100);
  const quiet = new Level(44_100);
  const a = [...loud.push(tone(12_000)), ...loud.end()];
  const b = [...quiet.push(tone(2_000)), ...quiet.end()];
  expect(Math.abs(rms(a) - rms(b))).toBeLessThan(rms(a) * 0.05);
});
