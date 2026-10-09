/** GPT-Live client delegation. This is deliberately not the Realtime exact-transcript tool bridge. */
export interface LiveFragment {
  /** Milliseconds on the Live session timeline, not arrival time. */
  startMs: number;
  endMs: number;
  text: string;
}
export interface LiveDelegation {
  id: string;
  offsetMs: number;
  target: "client";
}
export interface DelegationSnapshot {
  delegationId: string;
  offsetMs: number;
  revision: number;
  /** Not final ASR, and not an authoritative command. */
  fragments: readonly LiveFragment[];
  omittedFragments: number;
  /** Timing watermark only, not an ASR finalization/replacement rule. */
  priorSpeechEndMs?: number;
  uncertain: true;
  /** Data-only, bounded serialization of the current configured agent's context. */
  hostContext: string;
  /** Local continuous-capture clock: approximate alignment, never server-verified. */
  hostContextOffsetMs: number;
  contextClock: "local-capture-approximate";
}
export interface ContextualDelegationHost {
  context(): unknown;
  /** MUST use the existing current-session agent, permission prompts, and authorization scope.
   * The structured snapshot is provisional evidence for that agent to interpret; do not
   * label it as final user speech. Ambiguous/irreversible actions require clarification.
   * Returns only verified dispatch status, never untrusted job output or agent reasoning.
   */
  submitContextual(
    requestId: string,
    snapshot: DelegationSnapshot,
  ): Promise<{ queued: true } | { clarification: true }>;
}
export type DelegationResult =
  | { kind: "queued" | "clarification"; id: string; revision: number; commentary: string }
  | { kind: "stale" | "duplicate" | "unavailable"; id: string };

function boundedData(value: unknown, max = 3800): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? "null";
  } catch {
    serialized = '"unavailable"';
  }
  return serialized.length <= max
    ? serialized
    : JSON.stringify({ truncated: true, preview: serialized.slice(0, 1600) });
}
// Bound retained serialized UTF-8 evidence, not tiny provider delta count.
export const GPT_LIVE_FRAGMENT_BYTES = 64 * 1024;
const fragmentBytes = (fragment: LiveFragment) => Buffer.byteLength(JSON.stringify(fragment), "utf8") + 1;

interface SpeechEntry {
  fragment: LiveFragment;
  use: "available" | "pending" | "consumed";
  retained: boolean;
}
interface SpeechAdmission {
  entries: SpeechEntry[];
  fragments: LiveFragment[];
  priorSpeechEndMs?: number;
}
type SpeechPreparation =
  | { kind: "ready"; admission: SpeechAdmission }
  | { kind: "pending-loss" }
  | { kind: "future-loss" }
  | { kind: "incomplete" };

/** Retains provisional evidence until admission, not until the coding agent finishes. */
class ProvisionalSpeech {
  private entries: SpeechEntry[] = [];
  private retainedBytes = 2;
  private omittedFragments = 0;
  private omittedThroughMs = -1;
  private pendingEvictions = 0;
  private admittedThroughMs = -1;

  add(fragment: LiveFragment): void {
    // Corrections remain separate evidence in arrival order, with their original timeline.
    const entry: SpeechEntry = { fragment: { ...fragment }, use: "available", retained: true };
    this.entries.push(entry);
    this.retainedBytes += fragmentBytes(entry.fragment);
    while (this.retainedBytes > GPT_LIVE_FRAGMENT_BYTES) {
      const removed = this.entries.shift();
      if (!removed) throw new Error("Live fragment byte count has no retained entry");
      this.retainedBytes -= fragmentBytes(removed.fragment);
      removed.retained = false;
      if (removed.use === "pending") this.pendingEvictions++;
      else if (removed.use === "available") this.recordOmission(removed.fragment);
    }
  }

  prepareAdmission(offsetMs: number): SpeechPreparation {
    // Only admission can decide whether evicted pending evidence is missing.
    if (this.pendingEvictions) return { kind: "pending-loss" };
    const selected = this.entries.filter((entry) => entry.use === "available" && entry.fragment.endMs <= offsetMs);
    if (this.omittedFragments > 0) {
      // An old delegation cannot acknowledge newer loss and unlock its suffix.
      if (
        offsetMs < this.omittedThroughMs ||
        this.entries.some((entry) => entry.use !== "consumed" && entry.fragment.endMs > offsetMs)
      )
        return { kind: "future-loss" };
      // Retire the incomplete attempt without admission. A fresh repeat can recover.
      for (const entry of selected) entry.use = "consumed";
      this.omittedFragments = 0;
      this.omittedThroughMs = -1;
      return { kind: "incomplete" };
    }
    for (const entry of selected) entry.use = "pending";
    return {
      kind: "ready",
      admission: {
        entries: selected,
        fragments: selected.map((entry) => ({ ...entry.fragment })),
        ...(this.admittedThroughMs >= 0 ? { priorSpeechEndMs: this.admittedThroughMs } : {}),
      },
    };
  }

  settleAdmission(admission: SpeechAdmission, admitted: boolean): void {
    for (const entry of admission.entries) {
      entry.use = admitted ? "consumed" : "available";
      if (admitted) this.admittedThroughMs = Math.max(this.admittedThroughMs, entry.fragment.endMs);
      if (!entry.retained) {
        this.pendingEvictions--;
        // Accepted evidence already lives in ordinary agent history; only rejection loses it.
        if (!admitted) this.recordOmission(entry.fragment);
      }
    }
  }

  private recordOmission(fragment: LiveFragment): void {
    this.omittedFragments++;
    this.omittedThroughMs = Math.max(this.omittedThroughMs, fragment.endMs);
  }
}

/** One instance per Live connection. Closing invalidates results but never cancels backend work. */
export class GptLiveDelegationBridge {
  private readonly speech = new ProvisionalSpeech();
  private revision = 0;
  private epoch = 0;
  private closed = false;
  private readonly attempted = new Set<string>();
  private contexts: { offsetMs: number; data: string }[] = [];
  constructor(private readonly host: ContextualDelegationHost) {
    this.saveContext(0);
  }

  /** Save context when observed, not later when an old delegation finally arrives. */
  saveContext(offsetMs: number): void {
    if (this.closed || !Number.isSafeInteger(offsetMs) || offsetMs < 0) return;
    let data: string;
    try {
      data = boundedData(this.host.context());
    } catch {
      return;
    }
    const last = this.contexts.at(-1);
    if (last && (last.data === data || offsetMs < last.offsetMs)) return;
    if (last) this.revision++;
    this.contexts.push({ offsetMs, data });
    if (this.contexts.length > 16) this.contexts.shift();
  }

  addFragment(fragment: LiveFragment): void {
    if (
      this.closed ||
      !Number.isFinite(fragment.startMs) ||
      !Number.isFinite(fragment.endMs) ||
      fragment.startMs < 0 ||
      fragment.endMs < fragment.startMs ||
      typeof fragment.text !== "string" ||
      !fragment.text.length
    )
      return;
    this.speech.add(fragment);
    this.revision++;
  }

  /** Barge-in only invalidates spoken results. It does not stop the host agent or its jobs. */
  interrupt(): void {
    this.epoch++;
  }
  close(): void {
    this.closed = true;
    this.epoch++;
  }

  async handleCreated(event: LiveDelegation): Promise<DelegationResult> {
    if (
      typeof event.id !== "string" ||
      !event.id.trim() ||
      event.id.length > 256 ||
      event.target !== "client" ||
      !Number.isFinite(event.offsetMs) ||
      event.offsetMs < 0 ||
      !Number.isSafeInteger(event.offsetMs)
    )
      return { kind: "unavailable", id: "invalid" };
    const id = event.id;
    if (this.attempted.has(id)) return { kind: "duplicate", id };
    // Never evict IDs in a session: a replay must not acquire a different snapshot.
    if (this.closed || this.attempted.size >= 256) return { kind: "unavailable", id };
    this.attempted.add(id); // before any async operation, including rejected requests
    const epoch = this.epoch;
    const revision = this.revision;
    const context = [...this.contexts].reverse().find((entry) => entry.offsetMs <= event.offsetMs);
    if (!context) return { kind: "unavailable", id };
    const prepared = this.speech.prepareAdmission(event.offsetMs);
    if (prepared.kind === "pending-loss")
      return {
        kind: "clarification",
        id,
        revision,
        commentary: "I'm still checking whether the earlier request was accepted. Please try again in a moment.",
      };
    if (prepared.kind === "future-loss") return { kind: "unavailable", id };
    if (prepared.kind === "incomplete")
      return {
        kind: "clarification",
        id,
        revision,
        commentary: "I couldn't retain the whole request. Please repeat it.",
      };
    const { admission } = prepared;
    const snapshot: DelegationSnapshot = {
      delegationId: id,
      offsetMs: event.offsetMs,
      revision,
      ...(admission.priorSpeechEndMs !== undefined ? { priorSpeechEndMs: admission.priorSpeechEndMs } : {}),
      fragments: admission.fragments,
      omittedFragments: 0,
      uncertain: true,
      hostContext: context.data,
      hostContextOffsetMs: context.offsetMs,
      contextClock: "local-capture-approximate",
    };
    let admitted = false;
    try {
      // No synthetic tool names, task text, cancellation, or exact speech check.
      const result = await this.host.submitContextual(id, snapshot);
      admitted = !!(result && "queued" in result && result.queued === true);
      if (this.closed || this.epoch !== epoch || this.revision !== revision) return { kind: "stale", id };
      if (admitted) return { kind: "queued", id, revision, commentary: "Passed your request to the current agent." };
      if (result && "clarification" in result && result.clarification === true)
        return { kind: "clarification", id, revision, commentary: "Could you clarify your request?" };
      return { kind: "unavailable", id };
    } catch {
      // Rejection is just as stale as success after correction/interruption/closure.
      if (this.closed || this.epoch !== epoch || this.revision !== revision) return { kind: "stale", id };
      // Do not expose raw errors or untrusted backend output as speech.
      return { kind: "unavailable", id };
    } finally {
      // Settle real admission even when correction, barge-in or closure silenced its result.
      this.speech.settleAdmission(admission, admitted);
    }
  }
}
