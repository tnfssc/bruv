import { expect, test } from "bun:test";
import { LiveServerMessage } from "@google/genai";
import {
  generateNaturalFixture,
  naturalFixturePcm,
  pcmCounts,
  startupPhrase,
  startupWordCounts,
  trailingSilenceMs,
} from "../../scripts/live/startup-fixture";
import { startupSpeechFixturePlan } from "../../scripts/live/probe-startup-audio";
import type { LiveAdapter, LiveConnection, LiveParams } from "../../src/live/types";

test("natural fixture is supplied-key Google only, automatic VAD, at most four sessions", () => {
  expect(startupSpeechFixturePlan(["--fixture=gemini-natural", "--gemini-live-env"])).toEqual({
    fixture: "gemini-natural",
    modes: ["control", "paced", "burst"],
  });
  for (const extra of [[], ["--manual-activity"], ["--flush-after-pause"], ["--fixture-only"]]) {
    const args = extra.length ? ["--gemini-live-env", ...extra] : [];
    expect(() => startupSpeechFixturePlan(["--fixture=gemini-natural", ...args])).toThrow();
  }
  expect(() => startupSpeechFixturePlan(["--fixture=unknown"])).toThrow();
  expect(() => startupSpeechFixturePlan(["--mode=unknown"])).toThrow();
  expect(startupSpeechFixturePlan([])).toEqual({ fixture: "espeak", modes: ["control", "paced"] });
});

test("retention keeps exact ordered checks and diagnoses only the known numeric spelling", () => {
  for (const text of [startupPhrase, "Amber, river, SEVEN, lighthouse!"]) {
    expect(startupWordCounts(text)).toMatchObject({
      retainedWords: true,
      matchedWordCount: 4,
      expectedTokenFlags: [true, true, true, true],
      expectedTokenOrder: [true, true, true, true],
      numeric7: false,
      numeric7Order: false,
    });
  }
  expect(startupWordCounts("amber river 7 lighthouse")).toMatchObject({
    retainedWords: false,
    matchedWordCount: 3,
    expectedTokenFlags: [true, true, false, true],
    expectedTokenOrder: [true, true, false, true],
    numeric7: true,
    numeric7Order: true,
  });
});

test("numeric diagnosis does not accept missing, reordered or arbitrary recognition", () => {
  for (const text of [
    "amber river 7 lighthouse",
    "ambergris river seven lighthouse",
    "river amber seven lighthouse",
    "",
    "amber river 17 lighthouse",
    "amber river seventh lighthouse",
    "amber river 7 light house",
    "7 amber river lighthouse",
    "amber 7 river lighthouse",
  ])
    expect(startupWordCounts(text).retainedWords).toBe(false);
  expect(startupWordCounts("river amber seven lighthouse")).toMatchObject({
    matchedWordCount: 4,
    retainedWords: false,
    expectedTokenFlags: [true, true, true, true],
    expectedTokenOrder: [true, false, true, true],
  });
  expect(startupWordCounts("7 amber river lighthouse")).toMatchObject({ numeric7: true, numeric7Order: false });
  // Only fixed booleans/counts leave this boundary, never transcript tokens.
  for (const value of Object.values(startupWordCounts("private words amber river 7 lighthouse"))) {
    expect(
      ["boolean", "number"].includes(typeof value) ||
        (Array.isArray(value) && value.every((v) => typeof v === "boolean")),
    ).toBe(true);
  }
});

test("PCM24 to PCM16 conversion preserves duration and adds an exact silence tail in memory", async () => {
  const input = Buffer.alloc(48000);
  for (let i = 0; i < 24000; i++)
    input.writeInt16LE(Math.round(9000 * Math.sin((2 * Math.PI * 440 * i) / 24000)), i * 2);
  const output = await naturalFixturePcm(input);
  expect(output.length).toBe(32000 + 32 * trailingSilenceMs);
  expect(output.subarray(-32 * trailingSilenceMs).every((v) => v === 0)).toBe(true);
  const counts = pcmCounts(output, 16000);
  expect(counts.rate).toBe(16000);
  expect(counts.channels).toBe(1);
  expect(counts.peak).toBeGreaterThan(8000);
  expect(counts.clippedSamples).toBe(0);
  expect(counts.nonzeroSamples).toBeGreaterThan(15000);
  await expect(naturalFixturePcm(Buffer.alloc(3))).rejects.toThrow("fixture_invalid_pcm24");
  await expect(naturalFixturePcm(Buffer.alloc(480002))).rejects.toThrow("fixture_invalid_pcm24");
  await expect(naturalFixturePcm(Buffer.alloc(48000))).rejects.toThrow("fixture_invalid_pcm16");
});

for (const complete of [true, false]) {
  test(`generation ${complete ? "accepts" : "rejects"} bounded text-triggered provider response and closes`, async () => {
    let params!: LiveParams;
    let closed = 0;
    const audio = Buffer.alloc(4800, 1);
    const adapter: LiveAdapter = () => ({
      live: {
        connect: async (value) => {
          params = value;
          return {
            sendClientContent: (content: unknown) => {
              expect(content).toEqual({
                turns: [{ role: "user", parts: [{ text: startupPhrase }] }],
                turnComplete: true,
              });
              params.callbacks?.onmessage?.(
                Object.assign(new LiveServerMessage(), {
                  serverContent: {
                    outputTranscription: { text: complete ? startupPhrase : "unrelated response" },
                    modelTurn: {
                      parts: [{ inlineData: { data: audio.toString("base64"), mimeType: "audio/pcm;rate=24000" } }],
                    },
                    turnComplete: true,
                  },
                }),
              );
            },
            close: () => {
              closed++;
            },
          } as unknown as LiveConnection;
        },
      },
    });
    if (complete) {
      const result = await generateNaturalFixture("test-only", adapter);
      expect(result.pcm24).toEqual(audio);
      expect(result.matchedWordCount).toBe(4);
      expect(result.retainedWords).toBe(true);
      expect("transcript" in result).toBe(false);
    } else await expect(generateNaturalFixture("test-only", adapter)).rejects.toThrow("fixture_incomplete_response");
    expect(params.model).toBe("gemini-3.8-live");
    expect(params.config?.realtimeInputConfig?.automaticActivityDetection?.disabled).toBe(false);
    expect(closed).toBe(1);
  });
}
