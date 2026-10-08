import { describe, expect, test } from "bun:test";
import { VoiceCostTracker, voiceCost } from "../../src/live/cost";

const realtimeUsage = {
  input_tokens: 300,
  output_tokens: 150,
  input_token_details: { audio_tokens: 200 },
  output_token_details: { audio_tokens: 100 },
};

const geminiUsage = {
  promptTokensDetails: [{ modality: "AUDIO", tokenCount: 100 }],
  candidatesTokensDetails: [{ modality: "TEXT", tokenCount: 20 }],
};

// Pricing answers whether one provider report has a known dollar value.
// Tracker tests below cover what gets persisted across reports and close.
describe("provider usage pricing", () => {
  test("Realtime prices audio and text independently", () => {
    expect(voiceCost("openai", "gpt-realtime-2.1-mini", realtimeUsage)).toBe(
      (200 * 10 + 100 * 20 + 100 * 0.6 + 50 * 2.4) / 1e6,
    );
  });

  test("Realtime cached input without modality pricing is unknown", () => {
    expect(
      voiceCost("openai", "gpt-realtime-2.1", {
        ...realtimeUsage,
        input_token_details: { audio_tokens: 200, cached_tokens: 50 },
      }),
    ).toBeUndefined();
  });

  test("Gemini prices modality details equally for both live models", () => {
    const usage = {
      promptTokensDetails: [
        { modality: "AUDIO", tokenCount: 100 },
        { modality: "TEXT", tokenCount: 10 },
      ],
      candidatesTokensDetails: [{ modality: "AUDIO", tokenCount: 20 }],
    };
    const expected = (100 * 3 + 10 * 0.75 + 20 * 12) / 1e6;
    expect(voiceCost("google", "gemini-3.8-live", usage)).toBeCloseTo(expected);
    expect(voiceCost("google", "gemini-3.8-live-extended-thinking", usage)).toBeCloseTo(expected);
    expect(
      voiceCost("google", "gemini-3.8-live-extended-thinking", { ...usage, thoughtsTokenCount: 3 }),
    ).toBeUndefined();
  });

  test("Gemini totals without modality details are unknown", () => {
    expect(voiceCost("google", "gemini-3.8-live", { promptTokenCount: 100, candidatesTokenCount: 20 })).toBeUndefined();
  });

  test("Gemini cached counts and both SDK detail spellings are unknown, not full-rate", () => {
    for (const cached of [
      { cachedContentTokenCount: 25 },
      { cachedTokensDetails: [{ modality: "AUDIO", tokenCount: 25 }] },
      { cacheTokensDetails: [{ modality: "TEXT", tokenCount: 25 }] },
      { cachedContentTokenCount: -1 },
      { cachedContentTokenCount: 1.5 },
      { cachedTokensDetails: [{ modality: "AUDIO", tokenCount: -1 }] },
      { cacheTokensDetails: [{ modality: "TEXT", tokenCount: "12" }] },
    ])
      expect(voiceCost("google", "gemini-3.8-live", { ...geminiUsage, ...cached })).toBeUndefined();
    expect(voiceCost("google", "gemini-3.8-live", { ...geminiUsage, cachedContentTokenCount: 0 })).toBeCloseTo(
      (100 * 3 + 20 * 4.5) / 1e6,
    );
  });

  test("Gemini invalid modality counts are unknown", () => {
    for (const invalid of [
      { promptTokensDetails: [{ modality: "TEXT", tokenCount: NaN }] },
      { candidatesTokensDetails: [{ modality: "AUDIO", tokenCount: 1.2 }] },
    ])
      expect(voiceCost("google", "gemini-3.8-live", { ...geminiUsage, ...invalid })).toBeUndefined();
  });

  test("GPT-Live missing duration is unknown", () => {
    expect(voiceCost("openai", "gpt-live-1", {})).toBeUndefined();
  });
});

describe("provider-reported CLI voice accounting", () => {
  test("GPT-Live watermark spans the session; duplicates and older snapshots cannot undo charges", () => {
    const entries: { cost: number; unknown?: boolean }[] = [];
    const tracker = new VoiceCostTracker("openai", "gpt-live-1", (e) => entries.push(e));
    tracker.usage({ seconds: 12 });
    tracker.usage({ seconds: 15 });
    tracker.usage({ seconds: 15 });
    tracker.usage({ seconds: 13 });
    tracker.turnComplete();
    tracker.usage({ seconds: 18 });
    expect(entries.map((e) => Number(e.cost.toFixed(8)))).toEqual([0.01, 0.0025, 0.0025]);

    tracker.close();
    expect(entries.map((e) => [Number(e.cost.toFixed(8)), e.unknown])).toEqual([
      [0.01, undefined],
      [0.0025, undefined],
      [0.0025, undefined],
      [0, true], // Backend cost remains unavailable even after finalized duration.
    ]);
    expect(tracker.incomplete).toBe(true);
  });

  test("Realtime deduplicates response IDs, not identical usage from distinct responses", () => {
    const entries: { cost: number; unknown?: boolean }[] = [];
    const tracker = new VoiceCostTracker("openai", "gpt-realtime-2.1-mini", (e) => entries.push(e));
    const responseCost = (200 * 10 + 100 * 20 + 100 * 0.6 + 50 * 2.4) / 1e6;
    tracker.usage(realtimeUsage, "resp1");
    tracker.usage(realtimeUsage, "resp1");
    expect(entries).toEqual([{ cost: responseCost }]);
    tracker.usage(realtimeUsage, "resp2");
    expect(entries).toEqual([{ cost: responseCost }, { cost: responseCost }]);

    tracker.close();
    expect(entries).toEqual([{ cost: responseCost }, { cost: responseCost }, { cost: 0, unknown: true }]);
    expect(tracker.incomplete).toBe(true); // Separate ASR usage is unavailable.
  });

  test("Gemini watermark resets at turn completion, not at duplicate snapshots", () => {
    const entries: { cost: number; unknown?: boolean }[] = [];
    const tracker = new VoiceCostTracker("google", "gemini-3.8-live", (e) => entries.push(e));
    const usage = (n: number) => ({
      promptTokensDetails: [
        { modality: "AUDIO", tokenCount: n },
        { modality: "TEXT", tokenCount: 10 },
      ],
      candidatesTokensDetails: [{ modality: "AUDIO", tokenCount: 20 }],
    });
    tracker.usage(usage(100));
    tracker.usage(usage(100));
    tracker.usage(usage(120));
    tracker.turnComplete();
    tracker.usage(usage(100));
    tracker.close();
    expect(entries).toHaveLength(3);
    expect(entries.reduce((sum, e) => sum + e.cost, 0)).toBeCloseTo(
      ((100 + 120) * 3 + 20 * 12 * 2 + 10 * 0.75 * 2) / 1e6,
      10,
    );
  });

  test("Gemini unpriceable cache preserves the known bill and records unknown once", () => {
    const entries: { cost: number; unknown?: boolean }[] = [];
    const tracker = new VoiceCostTracker("google", "gemini-3.8-live", (entry) => entries.push(entry));
    tracker.usage(geminiUsage);
    tracker.usage({ ...geminiUsage, cachedContentTokenCount: 25 });
    expect(entries).toEqual([{ cost: (100 * 3 + 20 * 4.5) / 1e6 }, { cost: 0, unknown: true }]);
    tracker.close();
    expect(entries).toHaveLength(2);
  });

  test("unknown pricing is persisted as unknown, never as a known zero", () => {
    const entries: { cost: number; unknown?: boolean }[] = [];
    const tracker = new VoiceCostTracker("google", "unpriced", (e) => entries.push(e));
    tracker.usage({ promptTokensDetails: [] });
    tracker.close();
    expect(entries).toEqual([{ cost: 0, unknown: true }]);
  });

  test("unknown snapshots retain known increments and survive successful finalization", () => {
    const entries: { cost: number; unknown?: boolean }[] = [];
    const tracker = new VoiceCostTracker("google", "gemini-3.8-live", (entry) => entries.push(entry));
    const usage = (count: number) => ({
      promptTokensDetails: [{ modality: "AUDIO", tokenCount: count }],
      candidatesTokensDetails: [],
    });
    tracker.usage(usage(100));
    tracker.usage({ promptTokenCount: 120 });
    tracker.usage(usage(120));
    tracker.usage(usage(110));
    tracker.turnComplete();
    tracker.usage(usage(100));
    tracker.close(true);
    tracker.close(false);
    expect(entries).toEqual([
      { cost: (100 * 3) / 1e6 },
      { cost: 0, unknown: true },
      { cost: (120 * 3) / 1e6 - (100 * 3) / 1e6 },
      { cost: (100 * 3) / 1e6 },
    ]);
    expect(tracker.incomplete).toBe(true);
  });

  test("finalized explicit zero usage is complete without a charge", () => {
    const entries: { cost: number; unknown?: boolean }[] = [];
    const tracker = new VoiceCostTracker("google", "gemini-3.8-live", (entry) => entries.push(entry));
    tracker.usage({ promptTokensDetails: [], candidatesTokensDetails: [] });
    tracker.close();
    expect(tracker.incomplete).toBe(false);
    expect(entries).toEqual([]);
  });

  test("unfinalized explicit zero usage still records unknown", () => {
    const entries: { cost: number; unknown?: boolean }[] = [];
    const tracker = new VoiceCostTracker("google", "gemini-3.8-live", (entry) => entries.push(entry));
    tracker.usage({ promptTokensDetails: [], candidatesTokensDetails: [] });
    tracker.close(false);
    expect(entries).toEqual([{ cost: 0, unknown: true }]);
  });

  test("closing without any usage records unknown, not zero", () => {
    const entries: { cost: number; unknown?: boolean }[] = [];
    const tracker = new VoiceCostTracker("google", "gemini-3.8-live", (entry) => entries.push(entry));
    tracker.close();
    expect(entries).toEqual([{ cost: 0, unknown: true }]);
  });
});
