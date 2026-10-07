/** Voice billing is separate from Pi/agent usage. Only provider usage events move totals. */
export const VOICE_COST_ENTRY = "bruv-live-cost";
const number = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
const tokenCount = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : undefined;
const record = (v: unknown): Record<string, any> | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : undefined;

// Cache detail has two spellings in the SDK. Only absent or explicitly zero
// cache usage is priceable: we have no verified cached rate for this model.
function hasUnpriceableGeminiCache(usage: Record<string, any>): boolean {
  const count = usage.cachedContentTokenCount;
  if (count !== undefined && tokenCount(count) !== 0) return true;
  for (const details of [usage.cachedTokensDetails, usage.cacheTokensDetails]) {
    if (details === undefined) continue;
    if (!Array.isArray(details)) return true;
    if (details.some((part) => typeof part?.modality !== "string" || tokenCount(part?.tokenCount) !== 0)) return true;
  }
  return false;
}

function modalityCost(parts: unknown, rates: Record<string, number>): number | undefined {
  if (!Array.isArray(parts)) return;
  let sum = 0;
  for (const part of parts) {
    const modality = part?.modality?.toUpperCase?.();
    const count = tokenCount(part?.tokenCount);
    if (count === undefined || rates[modality] === undefined) return;
    sum += (count * rates[modality]) / 1e6;
  }
  return sum;
}

function geminiCost(usage: Record<string, any>): number | undefined {
  if (hasUnpriceableGeminiCache(usage)) return;
  for (const key of ["promptTokenCount", "candidatesTokenCount", "thoughtsTokenCount", "totalTokenCount"]) {
    if (usage[key] !== undefined && tokenCount(usage[key]) === undefined) return;
  }
  // Totals alone do not reveal modality. Thinking also lacks a known modality;
  // neither missing detail nor thinking tokens may be silently priced at zero.
  if (usage.thoughtsTokenCount > 0) return;
  const input = modalityCost(usage.promptTokensDetails, { TEXT: 0.75, AUDIO: 3, IMAGE: 1, VIDEO: 1 });
  const output = modalityCost(usage.candidatesTokensDetails, { TEXT: 4.5, AUDIO: 12 });
  if (input === undefined || output === undefined) return;
  return input + output;
}

type RealtimeRates = { audioInput: number; audioOutput: number; textInput: number; textOutput: number };
function realtimeCost(usage: Record<string, any>, rates: RealtimeRates): number | undefined {
  const input = number(usage.input_tokens);
  const output = number(usage.output_tokens);
  const audioInput = number(usage.input_token_details?.audio_tokens);
  const audioOutput = number(usage.output_token_details?.audio_tokens);
  if (
    input === undefined ||
    output === undefined ||
    audioInput === undefined ||
    audioOutput === undefined ||
    audioInput > input ||
    audioOutput > output
  )
    return;
  // Cached input needs separate modality details/rate; don't silently price it at full rate.
  if (number(usage.input_token_details?.cached_tokens) && usage.input_token_details.cached_tokens > 0) return;
  return (
    (audioInput * rates.audioInput +
      audioOutput * rates.audioOutput +
      (input - audioInput) * rates.textInput +
      (output - audioOutput) * rates.textOutput) /
    1e6
  );
}

export function voiceCost(provider: "google" | "openai", model: string, usage: unknown): number | undefined {
  const u = record(usage);
  if (!u) return;
  switch (model) {
    case "gpt-live-1": {
      const seconds = number(u.seconds);
      return seconds === undefined ? undefined : (seconds * 0.05) / 60;
    }
    case "gemini-3.8-live":
    case "gemini-3.8-live-extended-thinking":
      return geminiCost(u);
    case "gpt-realtime-2.1":
      return realtimeCost(u, { audioInput: 32, audioOutput: 64, textInput: 4, textOutput: 24 });
    case "gpt-realtime-2.1-mini":
      return realtimeCost(u, { audioInput: 10, audioOutput: 20, textInput: 0.6, textOutput: 2.4 });
  }
}

/** One tracker per transport. Callers supply usage, not accounting modes:
 * GPT-Live snapshots span the session, Gemini snapshots span a model turn,
 * and Realtime reports independent responses. Persist only new charges. */
export class VoiceCostTracker {
  private reportedCost = 0;
  private readonly seenResponses = new Set<string>();
  private unknown = false;
  private closed = false;
  private received = false;
  constructor(
    private readonly provider: "google" | "openai",
    private readonly model: string,
    private readonly persist: (entry: { cost: number; unknown?: boolean }) => void,
  ) {}
  get incomplete() {
    // GPT-Live backend charges and Realtime's separate ASR usage are unavailable,
    // even when their known portion was finalized successfully.
    return this.unknown || !this.received || this.model === "gpt-live-1" || this.provider === "openai";
  }
  usage(value: unknown, id?: string) {
    if (id && this.seenResponses.has(id)) return;
    if (id) this.seenResponses.add(id);
    this.received = true;
    const cost = voiceCost(this.provider, this.model, value);
    if (cost === undefined) {
      this.markUnknown();
      return;
    }
    if (this.model === "gpt-live-1" || this.provider === "google") {
      // Duplicate or older snapshots cannot undo an already persisted charge.
      if (cost > this.reportedCost) this.persist({ cost: cost - this.reportedCost });
      this.reportedCost = Math.max(this.reportedCost, cost);
    } else {
      this.persist({ cost });
    }
  }
  turnComplete() {
    // Only Gemini's watermark belongs to a turn. GPT-Live duration keeps growing.
    if (this.provider === "google" && this.model !== "gpt-live-1") this.reportedCost = 0;
  }
  close(finalized = true) {
    if (this.closed) return;
    this.closed = true;
    if (!finalized || this.incomplete) this.markUnknown();
  }
  private markUnknown() {
    if (this.unknown) return;
    this.unknown = true;
    this.persist({ cost: 0, unknown: true });
  }
}
