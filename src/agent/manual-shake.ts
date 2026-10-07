import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import {
  AgentSession,
  type ExtensionAPI,
  type ExtensionContext,
  estimateTokens,
  type SessionEntry,
  sessionEntryToContextMessages,
} from "@earendil-works/pi-coding-agent";
import { recordDiagnostic } from "../diagnostics.js";
import { getDiskBackedShakeLeafId, getLatestDiskBackedCustomEntry } from "../history/session-manager";
import {
  InvalidShakeRecordError,
  isRecord,
  isShakeRecord,
  MANUAL_SHAKE_ENTRY,
  MANUAL_SHAKE_VERSION,
  MAX_IDS_PER_KIND,
  MAX_RECORD_BYTES,
  type ShakeRecord,
  serializedBytes,
  validId,
} from "../history/shake-record";
import { restoreLeaf } from "../session/restore-leaf";
import { getInstructionContinuitySession } from "./instruction-continuity";
import {
  adaptNativeCompactionMessages,
  isNativeCodexCompactionDetails,
  withReadOnlyCompactionContext,
} from "./native-compaction";

/** Keep a durable manual context projection per branch. Session JSONL stays append-only. */
export const SHAKE_REFUSED_ACTIVE_WORK = "request_blocked";
export const SHAKE_REFUSED_OPAQUE_CHECKPOINT = "opaque_checkpoint";
export const SHAKE_REFUSED_CONTEXT_FAILURE = "preparation_failed";
export const SHAKE_REFUSED_STALE = "identity_stale";
export const SHAKE_REFUSED_STORAGE_LIMIT = "capacity_insufficient";
export const SHAKE_REFUSED_AMBIGUOUS_TOOL = "protocol_invalid";
export const SHAKE_NOOP = "shake_noop";
export const SHAKE_CHECKPOINT_PERSIST_FAILED = "state_write_failed";
export const SHAKE_SUCCEEDED = "shake_applied";
export const SHAKE_CARRY_FORWARD_PERSIST_FAILED = "state_write_failed";
export const SHAKE_CARRY_FORWARD_SUCCEEDED = "shake_applied";
export const SHAKE_INVALID_CHECKPOINT = "state_invalid";

const projectionFailures = new WeakMap<object, { sessionId: string; error: Error }>();
// Successful compaction-time shakes observed by the AgentSession lifecycle adapter.
const compactionShakeApplications = new WeakMap<object, number>();
type ShakeGuardController = { context?: ExtensionContext };
type ShakeRuntimeSeam = { prepareRequest: (model: unknown, options?: Record<string, any>) => Promise<unknown> };
type ShakeRuntimePatch = {
  original: ShakeRuntimeSeam["prepareRequest"];
  wrapper: ShakeRuntimeSeam["prepareRequest"];
  controllers: Set<ShakeGuardController>;
  ownDescriptor?: PropertyDescriptor;
};
const shakeRuntimePatches = new WeakMap<object, ShakeRuntimePatch>();
function activeProjectionFailure(controller: ShakeGuardController, requestedSessionId: unknown): Error | undefined {
  const ctx = controller.context;
  if (!ctx || requestedSessionId !== ctx.sessionManager.getSessionId()) return;
  const failure = projectionFailures.get(ctx.sessionManager as object);
  return failure?.sessionId === requestedSessionId ? failure.error : undefined;
}
function attachShakeRequestGuard(runtime: unknown, controller: ShakeGuardController): void {
  if (!runtime || typeof runtime !== "object") return;
  const seam = runtime as ShakeRuntimeSeam;
  if (typeof seam.prepareRequest !== "function") return;
  const existing = shakeRuntimePatches.get(runtime);
  if (existing) {
    if (seam.prepareRequest === existing.wrapper) existing.controllers.add(controller);
    return;
  }
  const original = seam.prepareRequest;
  const patch: ShakeRuntimePatch = {
    original,
    wrapper: original,
    controllers: new Set([controller]),
    ownDescriptor: Object.getOwnPropertyDescriptor(runtime, "prepareRequest"),
  };
  patch.wrapper = async function (this: ShakeRuntimeSeam, model, options) {
    const failure = [...patch.controllers]
      .map((candidate) => activeProjectionFailure(candidate, options?.sessionId))
      .find((value) => value !== undefined);
    if (failure) throw failure;
    return original.call(this, model, options);
  };
  try {
    seam.prepareRequest = patch.wrapper;
    if (seam.prepareRequest === patch.wrapper) shakeRuntimePatches.set(runtime, patch);
  } catch {}
}
function detachShakeRequestGuard(runtime: object, controller: ShakeGuardController): void {
  const patch = shakeRuntimePatches.get(runtime);
  if (!patch) return;
  patch.controllers.delete(controller);
  if (patch.controllers.size) return;
  const seam = runtime as ShakeRuntimeSeam;
  if (seam.prepareRequest === patch.wrapper) {
    if (patch.ownDescriptor) Object.defineProperty(runtime, "prepareRequest", patch.ownDescriptor);
    else delete (runtime as { prepareRequest?: unknown }).prepareRequest;
  }
  shakeRuntimePatches.delete(runtime);
}

function shakeDiagnostic(
  ctx: ExtensionContext,
  code: string,
  outcome: "success" | "failed" | "fallback" | "blocked" | "cancelled" | "noop",
  operationId?: `${string}-${string}-${string}-${string}-${string}`,
  count?: number,
): void {
  const priorLeaf = ctx.sessionManager.getLeafId();
  try {
    recordDiagnostic(ctx.sessionManager, {
      component: "shake",
      code,
      outcome,
      ...(operationId ? { operationId } : {}),
      dispatch: "none",
      ...(count === undefined ? {} : { count }),
    });
  } catch {
    // Diagnostics are observational and must never alter shake safety decisions.
  } finally {
    restoreLeaf(ctx.sessionManager, priorLeaf);
  }
}

export type ShakePlan = {
  record: ShakeRecord;
  removedAssistantBlocks: number;
  removedToolResults: number;
  unresolvedToolCallIds: string[];
  orphanToolResultIds: string[];
  storageError?: string;
};

/** The newest marker wins. Forked JSONL copies inherit its projection, but the
 * effective record is rebased to the fork's session identity. */
export function latestShakeRecord(entries: readonly SessionEntry[], sessionId: string): ShakeRecord | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (!entry) continue;
    if (entry.type !== "custom" || entry.customType !== MANUAL_SHAKE_ENTRY) continue;
    if (!isShakeRecord(entry.data)) throw new InvalidShakeRecordError();
    return entry.data.sessionId === sessionId ? entry.data : { ...entry.data, sessionId };
  }
}
function toolCalls(message: AgentMessage): Array<{ id: string }> {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return [];
  return message.content.flatMap((part) =>
    isRecord(part) && part.type === "toolCall" && validId(part.id) ? [{ id: part.id }] : [],
  );
}
function toolResultId(message: AgentMessage): string | undefined {
  if (message.role !== "toolResult") return;
  const id = (message as AgentMessage & { toolCallId?: unknown }).toolCallId;
  return validId(id) ? id : undefined;
}
// The transport shim is a checkpoint, never ordinary assistant reasoning.
function isNativeShim(message: AgentMessage): boolean {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return false;
  return message.content.some((part) => {
    if (!isRecord(part) || part.type !== "thinking" || typeof part.thinkingSignature !== "string") return false;
    try {
      return JSON.parse(part.thinkingSignature)?.type === "compaction";
    } catch {
      return false;
    }
  });
}

// SDK active entries contain the newest checkpoint at index zero, its kept
// tail, then post-checkpoint entries. Retained older compactions emit nothing.
function activeShakeEntries(entries: readonly SessionEntry[]): SessionEntry[] {
  return entries.filter(
    (entry, index) =>
      !(entry.type === "compaction" && index > 0) && !(entry.type === "message" && isNativeShim(entry.message)),
  );
}
function removableAssistantBlockCount(message: AgentMessage): number {
  if (isNativeShim(message)) return 0;
  if (message.role !== "assistant" || !Array.isArray(message.content)) return 0;
  return message.content.filter((part) => isRecord(part) && (part.type === "thinking" || part.type === "toolCall"))
    .length;
}

/** Build a deterministic protocol-paired plan from active context entries. */
export function buildShakePlan(
  entries: readonly SessionEntry[],
  sessionId: string,
  prior = latestShakeRecord(entries, sessionId),
): ShakePlan {
  entries = activeShakeEntries(entries);
  const activeEntryIds = new Set(entries.map((entry) => entry.id));
  // Compaction removes old entries from active context. Do not carry their IDs forever.
  const assistantIds = new Set((prior?.assistantEntryIds ?? []).filter((id) => activeEntryIds.has(id)));
  const resultIds = new Set((prior?.toolResultEntryIds ?? []).filter((id) => activeEntryIds.has(id)));
  const calls = new Map<string, { entryId: string; index: number }>();
  const results = new Map<string, { entryId: string; index: number }>();
  const duplicateCalls = new Set<string>();
  const duplicateResults = new Set<string>();
  entries.forEach((entry, index) => {
    if (entry.type !== "message") return;
    if (
      entry.message.role === "assistant" &&
      Array.isArray(entry.message.content) &&
      entry.message.content.some((part) => isRecord(part) && part.type === "toolCall" && !validId(part.id))
    )
      duplicateCalls.add("<invalid-tool-call-id>");
    if (entry.message.role === "toolResult" && !toolResultId(entry.message))
      duplicateResults.add("<invalid-tool-result-id>");
    for (const call of toolCalls(entry.message)) {
      if (calls.has(call.id)) duplicateCalls.add(call.id);
      else calls.set(call.id, { entryId: entry.id, index });
    }
    const resultId = toolResultId(entry.message);
    if (resultId) {
      if (results.has(resultId)) duplicateResults.add(resultId);
      else results.set(resultId, { entryId: entry.id, index });
    }
  });
  const unresolvedToolCallIds = [...calls].flatMap(([id, call]) => {
    const result = results.get(id);
    return !result || result.index <= call.index ? [id] : [];
  });
  const orphanToolResultIds = [...results].flatMap(([id, result]) => {
    const call = calls.get(id);
    return !call || result.index <= call.index ? [id] : [];
  });
  unresolvedToolCallIds.push(...duplicateCalls);
  orphanToolResultIds.push(...duplicateResults);
  let removedAssistantBlocks = 0;
  let removedToolResults = 0;
  if (!unresolvedToolCallIds.length && !orphanToolResultIds.length) {
    for (const entry of entries) {
      if (entry.type !== "message") continue;
      const count = removableAssistantBlockCount(entry.message);
      if (count && !assistantIds.has(entry.id)) {
        assistantIds.add(entry.id);
        removedAssistantBlocks += count;
      }
      const resultId = toolResultId(entry.message);
      if (resultId && calls.has(resultId) && !resultIds.has(entry.id)) {
        resultIds.add(entry.id);
        removedToolResults++;
      }
    }
  }
  const record: ShakeRecord = {
    version: MANUAL_SHAKE_VERSION,
    sessionId,
    assistantEntryIds: [...assistantIds],
    toolResultEntryIds: [...resultIds],
    shakenAt: Date.now(),
  };
  const tooMany = assistantIds.size > MAX_IDS_PER_KIND || resultIds.size > MAX_IDS_PER_KIND;
  const tooLarge = serializedBytes(record) > MAX_RECORD_BYTES;
  const invalidRecord = !isShakeRecord(record);
  return {
    record,
    removedAssistantBlocks,
    removedToolResults,
    unresolvedToolCallIds: [...new Set(unresolvedToolCallIds)],
    orphanToolResultIds: [...new Set(orphanToolResultIds)],
    ...(tooMany || tooLarge || invalidRecord
      ? {
          storageError:
            "Shake cannot store a bounded projection for this active window. Compact or branch away old active history, then retry /shake.",
        }
      : {}),
  };
}

type SourceMessage = { entry: SessionEntry; message: AgentMessage; json: string };

/** Match only clear, unchanged incoming copies. Never restore raw session content
 * because of a redaction or rewrite. */
function exactOccurrenceMatches(
  incoming: readonly AgentMessage[],
  source: readonly SourceMessage[],
): Map<number, number> {
  const sourceByJson = new Map<string, number[]>();
  const incomingByJson = new Map<string, number[]>();
  source.forEach((item, index) => {
    const indexes = sourceByJson.get(item.json) ?? [];
    indexes.push(index);
    sourceByJson.set(item.json, indexes);
  });
  incoming.forEach((message, index) => {
    const json = JSON.stringify(message);
    const indexes = incomingByJson.get(json) ?? [];
    indexes.push(index);
    incomingByJson.set(json, indexes);
  });
  const matches = new Map<number, number>();
  for (const [json, sourceIndexes] of sourceByJson) {
    const incomingIndexes = incomingByJson.get(json);
    // Unequal duplicate counts are chronology-ambiguous after an upstream exclusion.
    if (!incomingIndexes || incomingIndexes.length !== sourceIndexes.length) continue;
    sourceIndexes.forEach((sourceIndex, index) => {
      const incomingIndex = incomingIndexes[index];
      if (incomingIndex !== undefined) matches.set(sourceIndex, incomingIndex);
    });
  }
  let previous = -1;
  for (const [, incomingIndex] of [...matches].sort((a, b) => a[0] - b[0])) {
    if (incomingIndex <= previous) return new Map(); // reordered input: preserve everything
    previous = incomingIndex;
  }
  return matches;
}

function projection(
  incoming: readonly AgentMessage[],
  entries: readonly SessionEntry[],
  record: ShakeRecord,
): {
  messages: AgentMessage[];
  byIncoming: AgentMessage[][];
  removedAssistantBlocks: number;
  removedToolResults: number;
  assistantEntryIds: string[];
  toolResultEntryIds: string[];
} {
  entries = activeShakeEntries(entries);
  const source: SourceMessage[] = entries.flatMap((entry) =>
    sessionEntryToContextMessages(entry).map((message) => ({ entry, message, json: JSON.stringify(message) })),
  );
  const matches = exactOccurrenceMatches(incoming, source);
  for (const [sourceIndex, incomingIndex] of matches) {
    if (isNativeShim(incoming[incomingIndex]!)) matches.delete(sourceIndex);
  }
  const incomingToSource = new Map([...matches].map(([sourceIndex, incomingIndex]) => [incomingIndex, sourceIndex]));
  const selectedAssistants = new Set(record.assistantEntryIds);
  const selectedResults = new Set(record.toolResultEntryIds);
  const callEntryById = new Map<string, string>();
  const resultEntryById = new Map<string, string>();
  for (const item of source) {
    for (const call of toolCalls(item.message)) callEntryById.set(call.id, item.entry.id);
    const resultId = toolResultId(item.message);
    if (resultId) resultEntryById.set(resultId, item.entry.id);
  }
  const groups = new Map<string, Set<string>>();
  const assistantByResultEntry = new Map<string, string>();
  for (const [id, assistantEntryId] of callEntryById) {
    const resultEntryId = resultEntryById.get(id);
    if (!resultEntryId) continue;
    const group = groups.get(assistantEntryId) ?? new Set([assistantEntryId]);
    group.add(resultEntryId);
    groups.set(assistantEntryId, group);
    assistantByResultEntry.set(resultEntryId, assistantEntryId);
  }
  const sourceIndexesByEntry = new Map<string, number[]>();
  source.forEach((item, index) => {
    const indexes = sourceIndexesByEntry.get(item.entry.id) ?? [];
    indexes.push(index);
    sourceIndexesByEntry.set(item.entry.id, indexes);
  });
  const exactEntry = (entryId: string) =>
    (sourceIndexesByEntry.get(entryId) ?? []).every((index) => matches.has(index));
  // Validate each protocol group, not the whole window: an unrelated pending
  // or archived orphan must not prevent projection of a complete shaken group.
  const plan = buildShakePlan(entries, record.sessionId, record);
  const invalidProtocolIds = new Set([...plan.unresolvedToolCallIds, ...plan.orphanToolResultIds]);
  const unsafeAssistants = new Set(
    source.flatMap(({ entry, message }) =>
      message.role === "assistant" &&
      message.content.some(
        (part) => isRecord(part) && part.type === "toolCall" && (!validId(part.id) || invalidProtocolIds.has(part.id)),
      )
        ? [entry.id]
        : [],
    ),
  );
  const eligibleEntries = new Set<string>();
  for (const assistantEntryId of selectedAssistants) {
    if (unsafeAssistants.has(assistantEntryId)) continue;
    const group = groups.get(assistantEntryId) ?? new Set([assistantEntryId]);
    // A marker is atomic at the protocol-group level. In particular, never
    // remove selected tool calls unless every associated result was also
    // explicitly selected by the durable record.
    const fullySelected = [...group].every((entryId) => entryId === assistantEntryId || selectedResults.has(entryId));
    if (fullySelected && [...group].every(exactEntry)) for (const entryId of group) eligibleEntries.add(entryId);
  }
  // A result is removable only through its exact call/result group.
  for (const resultEntryId of selectedResults) {
    if (!assistantByResultEntry.has(resultEntryId)) eligibleEntries.delete(resultEntryId);
  }

  let removedAssistantBlocks = 0;
  let removedToolResults = 0;
  const byIncoming = incoming.map((message, incomingIndex): AgentMessage[] => {
    const sourceIndex = incomingToSource.get(incomingIndex);
    if (sourceIndex === undefined) return [message];
    const sourceMessage = source[sourceIndex];
    if (!sourceMessage) return [message];
    const entryId = sourceMessage.entry.id;
    if (selectedResults.has(entryId) && eligibleEntries.has(entryId)) {
      removedToolResults++;
      return [];
    }
    if (message.role !== "assistant" || !selectedAssistants.has(entryId) || !eligibleEntries.has(entryId))
      return [message];
    const content = message.content.filter((part) => {
      const remove = isRecord(part) && (part.type === "thinking" || part.type === "toolCall");
      if (remove) removedAssistantBlocks++;
      return !remove;
    });
    return content.length ? [{ ...message, content } as AgentMessage] : [];
  });
  return {
    messages: byIncoming.flat(),
    byIncoming,
    removedAssistantBlocks,
    removedToolResults,
    assistantEntryIds: [...selectedAssistants].filter((id) => eligibleEntries.has(id)),
    toolResultEntryIds: [...selectedResults].filter((id) => eligibleEntries.has(id)),
  };
}

/** Project the transformed messages that arrived. Keep unclear protocol batches
 * whole rather than risk an orphan call or result. */
export function projectShakenContext(
  incoming: readonly AgentMessage[],
  entries: readonly SessionEntry[],
  record: ShakeRecord,
): AgentMessage[] {
  return projection(incoming, entries, record).messages;
}
/** Use the full active window as pairing evidence, then select the SDK's
 * discarded slice. A split turn may keep a result whose call is discarded.
 * Unmatched/ambiguous required copies remain required, never silently dropped. */
export function projectShakenRequiredMessages(
  required: readonly AgentMessage[],
  entries: readonly SessionEntry[],
  record: ShakeRecord,
): AgentMessage[] {
  const source: SourceMessage[] = activeShakeEntries(entries).flatMap((entry) =>
    sessionEntryToContextMessages(entry).map((message) => ({ entry, message, json: JSON.stringify(message) })),
  );
  const matches = exactOccurrenceMatches(required, source);
  const requiredToSource = new Map([...matches].map(([sourceIndex, requiredIndex]) => [requiredIndex, sourceIndex]));
  const projected = projection(
    source.map((item) => item.message),
    entries,
    record,
  );
  return required.flatMap((message, index) => {
    const sourceIndex = requiredToSource.get(index);
    return sourceIndex === undefined ? [message] : (projected.byIncoming[sourceIndex] ?? [message]);
  });
}
export function contextCharacters(messages: readonly AgentMessage[]): number {
  // Compare the exact same deterministic representation on both sides. This is
  // deliberately a character policy, not a provider-token estimate.
  return JSON.stringify(messages).length;
}
export function shouldShakeBeforeCompaction(before: readonly AgentMessage[], after: readonly AgentMessage[]): boolean {
  return contextCharacters(after) * 4 <= contextCharacters(before);
}
export function estimateContext(messages: readonly AgentMessage[]): number {
  return messages.reduce((total, message) => total + estimateTokens(message), 0);
}
function hasActiveNativeCheckpoint(entries: readonly SessionEntry[]): boolean {
  const entry = entries[0];
  return entry?.type === "compaction" && isRecord(entry.details) && entry.details.strategy === "codex-native";
}

/** Validate the checkpoint boundary before a local preview or durable change.
 * Either the SDK summary or the exact native shim plus runtime-state survives. */
function assertNativeShakeContext(
  entries: readonly SessionEntry[],
  ctx: ExtensionContext,
  incoming?: readonly AgentMessage[],
): void {
  const checkpoint = entries[0];
  if (
    checkpoint?.type !== "compaction" ||
    !isRecord(checkpoint.details) ||
    checkpoint.details.strategy !== "codex-native"
  )
    return;
  const d = checkpoint.details;
  if (!isNativeCodexCompactionDetails(d) || ctx.model?.api !== d.api || ctx.model?.provider !== d.provider) {
    throw new Error(
      "Shake refused: unsupported or damaged opaque native checkpoint, or incompatible API/provider; no context was changed.",
    );
  }
  if (!incoming) return;
  const summary = sessionEntryToContextMessages(checkpoint).filter((message) => message.role === "compactionSummary");
  const adapted = adaptNativeCompactionMessages(summary, ctx);
  const count = (message: AgentMessage) => incoming.filter((m) => JSON.stringify(m) === JSON.stringify(message)).length;
  const rawIntact = summary.every((m) => count(m) === 1);
  const shimIntact = adapted.every((m) => count(m) === 1);
  // Mixed or duplicated representations are ambiguous; don't save a marker.
  if (
    rawIntact === shimIntact ||
    incoming.filter(isNativeShim).length !== (rawIntact ? 0 : 1) ||
    (rawIntact ? adapted : summary).some((m) => count(m) !== 0)
  ) {
    throw new Error(
      "Shake refused: native checkpoint or runtime state changed or became ambiguous in context hooks; no context was changed.",
    );
  }
}

function matchedShakeRecord(
  entries: readonly SessionEntry[],
  sessionId: string,
  record: ShakeRecord,
  projected: { assistantEntryIds: string[]; toolResultEntryIds: string[] },
): ShakeRecord {
  const prior = latestShakeRecord(entries, sessionId);
  const active = new Set(activeShakeEntries(entries).map((entry) => entry.id));
  return {
    ...record,
    assistantEntryIds: [
      ...new Set([...(prior?.assistantEntryIds ?? []).filter((id) => active.has(id)), ...projected.assistantEntryIds]),
    ],
    toolResultEntryIds: [
      ...new Set([
        ...(prior?.toolResultEntryIds ?? []).filter((id) => active.has(id)),
        ...projected.toolResultEntryIds,
      ]),
    ],
  };
}

async function currentTransformedContext(
  ctx: ExtensionContext,
  entries: readonly SessionEntry[],
): Promise<AgentMessage[]> {
  // Use the SDK canonical projection (including context edits), not a flattened
  // journal or older retained compaction summaries.
  const raw = ctx.sessionManager.buildSessionProjection().messages;
  const session = getInstructionContinuitySession(ctx.sessionManager as object);
  const agent = session?.agent;
  const transform = agent?.transformContext;
  if (typeof transform === "function") {
    const signal = ctx.signal ?? new AbortController().signal;
    return await withReadOnlyCompactionContext(() => transform.call(agent, structuredClone(raw), signal));
  }
  const prior = latestShakeRecord(entries, ctx.sessionManager.getSessionId());
  return prior ? projectShakenContext(raw, entries, prior) : raw;
}

let accountingAdapterInstalled = false;
/** Pi's pre-prompt check trusts the last provider usage. A shake makes it stale,
 * so skip it until a response follows the marker. The separate pre-provider
 * estimate still sees the transformed message list. */
export function installShakeAccountingAdapter(): void {
  if (accountingAdapterInstalled) return;
  const prototype = AgentSession.prototype as unknown as {
    _checkCompaction?: (
      message: AgentMessage,
      skipAbortedCheck?: boolean,
      toolResults?: ToolResultMessage[],
    ) => Promise<boolean>;
    getContextUsage?: () => { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
    sessionManager?: {
      buildContextEntries(): SessionEntry[];
      getBranch(): SessionEntry[];
      getSessionId(): string;
      getLeafId?(): string | null;
    };
  };
  const originalCheck = prototype._checkCompaction;
  const originalUsage = prototype.getContextUsage;
  if (typeof originalCheck !== "function" || typeof originalUsage !== "function")
    throw new Error(
      "bruv manual shake is unsupported by this Pi runtime: required AgentSession accounting seams are unavailable",
    );
  // This predicate also runs from every footer context-usage read. Keep only its
  // boolean result, not the fully materialized history or a periodically expiring cache.
  const freshnessCache = new WeakMap<
    object,
    {
      sessionId: string;
      leafId: string | null | undefined;
      entries: WeakRef<object>;
      entryCount: number | undefined;
      value: boolean;
    }
  >();
  const lacksFreshUsage = (owner: typeof prototype): boolean => {
    const manager = owner.sessionManager;
    if (!manager) return false;
    const entries = (manager as unknown as { fileEntries?: unknown }).fileEntries;
    const cacheable = Array.isArray(entries) && typeof manager.getLeafId === "function";
    const sessionId = manager.getSessionId();
    const contextLeaf = getDiskBackedShakeLeafId(manager);
    const leafId = contextLeaf === undefined ? manager.getLeafId?.() : contextLeaf;
    const entryCount = cacheable && contextLeaf === undefined ? entries.length : undefined;
    const cached = cacheable ? freshnessCache.get(manager) : undefined;
    if (
      cacheable &&
      cached &&
      cached.sessionId === sessionId &&
      cached.leafId === leafId &&
      cached.entries.deref() === entries &&
      cached.entryCount === entryCount
    )
      return cached.value;
    const branch = manager.buildContextEntries();
    let marker = -1;
    for (let index = branch.length - 1; index >= 0; index--) {
      const entry = branch[index];
      if (entry?.type !== "custom" || entry.customType !== MANUAL_SHAKE_ENTRY) continue;
      if (!isShakeRecord(entry.data)) throw new InvalidShakeRecordError();
      marker = index;
      break;
    }
    const value =
      marker >= 0 &&
      !branch
        .slice(marker + 1)
        .some(
          (entry) =>
            entry.type === "message" &&
            entry.message.role === "assistant" &&
            entry.message.stopReason !== "error" &&
            entry.message.stopReason !== "aborted" &&
            entry.message.usage.input + entry.message.usage.cacheRead + entry.message.usage.cacheWrite > 0,
        );
    if (cacheable)
      freshnessCache.set(manager, {
        sessionId,
        leafId,
        entries: new WeakRef(entries),
        entryCount,
        value,
      });
    return value;
  };
  accountingAdapterInstalled = true;
  prototype._checkCompaction = async function (message, skipAbortedCheck, toolResults) {
    // Only suppress Pi's stale last-response threshold check before a new
    // prompt. A response that just came back may itself report overflow (often
    // as an error with no usage), and must retain Pi's compact-and-retry path.
    if (skipAbortedCheck === false && lacksFreshUsage(this)) return false;
    const manager = this.sessionManager as object | undefined;
    const applicationsBefore = manager ? (compactionShakeApplications.get(manager) ?? 0) : 0;
    const shouldContinue = await originalCheck.call(this, message, skipAbortedCheck, toolResults);
    const shakeApplied = manager && (compactionShakeApplications.get(manager) ?? 0) > applicationsBefore;
    // The hook cancels to short-circuit both compaction handlers. Preserve Pi's
    // compact-and-retry continuation for an interrupted response.
    return (
      Boolean(
        shakeApplied && skipAbortedCheck !== false && message.role === "assistant" && message.stopReason !== "stop",
      ) || shouldContinue
    );
  };
  prototype.getContextUsage = function () {
    const usage = originalUsage.call(this);
    return usage && lacksFreshUsage(this) ? { ...usage, tokens: null, percent: null } : usage;
  };
}

export function registerManualShake(pi: ExtensionAPI, invalidateProviderSnapshot: () => void = () => {}): void {
  installShakeAccountingAdapter();
  const guardController: ShakeGuardController = {};
  let boundRuntime: object | undefined;
  const bindGuard = (ctx: ExtensionContext) => {
    guardController.context = ctx;
    const runtime = (ctx.modelRegistry as unknown as { runtime?: object } | undefined)?.runtime;
    if (boundRuntime && boundRuntime !== runtime) detachShakeRequestGuard(boundRuntime, guardController);
    boundRuntime = runtime;
    attachShakeRequestGuard(runtime, guardController);
  };
  pi.on("context", (event, ctx) => {
    bindGuard(ctx);
    const carryFailure = projectionFailures.get(ctx.sessionManager as object);
    if (carryFailure?.sessionId === ctx.sessionManager.getSessionId()) {
      ctx.abort?.();
      throw carryFailure.error;
    }
    if (carryFailure) projectionFailures.delete(ctx.sessionManager as object);
    const entries = ctx.sessionManager.buildContextEntries();
    try {
      const record = latestShakeRecord(entries, ctx.sessionManager.getSessionId());
      return record ? { messages: projectShakenContext(event.messages, entries, record) } : undefined;
    } catch (error) {
      shakeDiagnostic(ctx, SHAKE_INVALID_CHECKPOINT, "blocked");
      throw error;
    }
  });
  pi.on("session_start", (_event, ctx) => {
    projectionFailures.delete(ctx.sessionManager as object);
    bindGuard(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    projectionFailures.delete(ctx.sessionManager as object);
    if (boundRuntime) detachShakeRequestGuard(boundRuntime, guardController);
    boundRuntime = undefined;
    guardController.context = undefined;
  });
  // This handler is registered before native-Codex and normal compaction. A
  // qualifying projection is persisted before cancellation short-circuits both.
  pi.on("session_before_compact", async (event, ctx) => {
    const snapshot = {
      manager: ctx.sessionManager,
      sessionId: ctx.sessionManager.getSessionId(),
      leafId: ctx.sessionManager.getLeafId(),
      model: ctx.model,
      signal: ctx.signal,
    };
    const entries = snapshot.manager.buildContextEntries();
    if (hasActiveNativeCheckpoint(entries) || event.signal?.aborted) return;
    let plan: ShakePlan;
    let beforeMessages: AgentMessage[];
    try {
      plan = buildShakePlan(entries, snapshot.sessionId);
      beforeMessages = await currentTransformedContext(ctx, entries);
    } catch {
      return; // Existing compaction/fallback handlers retain ownership.
    }
    const stale =
      ctx.sessionManager !== snapshot.manager ||
      ctx.sessionManager.getSessionId() !== snapshot.sessionId ||
      ctx.sessionManager.getLeafId() !== snapshot.leafId ||
      ctx.model !== snapshot.model ||
      ctx.signal !== snapshot.signal ||
      snapshot.signal?.aborted === true ||
      event.signal?.aborted === true;
    if (stale || plan.storageError || plan.unresolvedToolCallIds.length || plan.orphanToolResultIds.length) return;
    const projected = projection(beforeMessages, entries, plan.record);
    if (!projected.removedAssistantBlocks && !projected.removedToolResults) return;
    const beforeChars = contextCharacters(beforeMessages);
    const afterChars = contextCharacters(projected.messages);
    if (!shouldShakeBeforeCompaction(beforeMessages, projected.messages)) return;
    const priorLeaf = ctx.sessionManager.getLeafId();
    try {
      pi.appendEntry(MANUAL_SHAKE_ENTRY, matchedShakeRecord(entries, snapshot.sessionId, plan.record, projected));
    } catch {
      restoreLeaf(ctx.sessionManager, priorLeaf);
      return;
    }
    projectionFailures.delete(ctx.sessionManager as object);
    compactionShakeApplications.set(
      ctx.sessionManager as object,
      (compactionShakeApplications.get(ctx.sessionManager as object) ?? 0) + 1,
    );
    try {
      invalidateProviderSnapshot();
    } catch {
      // Persistence already committed the projection; cancellation must still
      // prevent either compactor from running against the changed context.
    }
    try {
      ctx.ui.notify(
        "Shake replaced compaction: " +
          beforeChars.toLocaleString() +
          " → " +
          afterChars.toLocaleString() +
          " active-context characters (at least 75% reduction).",
        "info",
      );
    } catch {
      // UI is observational after the durable decision.
    }
    return { cancel: true };
  });
  // Compaction may hide the old marker while retaining some of its tail. Carry
  // only still-active IDs; an empty projection needs no marker after the summary.
  pi.on("session_compact", (_event, ctx) => {
    const operationId = crypto.randomUUID();
    const sessionId = ctx.sessionManager.getSessionId();
    const indexed = getLatestDiskBackedCustomEntry(ctx.sessionManager, MANUAL_SHAKE_ENTRY);
    const prior = latestShakeRecord(
      indexed === undefined ? ctx.sessionManager.getBranch() : indexed ? [indexed] : [],
      sessionId,
    );
    if (!prior) return;
    const activeEntries = ctx.sessionManager.buildContextEntries();
    const active = new Set(activeShakeEntries(activeEntries).map((entry) => entry.id));
    const record: ShakeRecord = {
      ...prior,
      sessionId,
      assistantEntryIds: prior.assistantEntryIds.filter((id) => active.has(id)),
      toolResultEntryIds: prior.toolResultEntryIds.filter((id) => active.has(id)),
      shakenAt: Date.now(),
    };
    if (!record.assistantEntryIds.length && !record.toolResultEntryIds.length) {
      projectionFailures.delete(ctx.sessionManager as object);
      return;
    }
    const priorLeaf = ctx.sessionManager.getLeafId();
    try {
      pi.appendEntry(MANUAL_SHAKE_ENTRY, record);
      projectionFailures.delete(ctx.sessionManager as object);
      shakeDiagnostic(
        ctx,
        SHAKE_CARRY_FORWARD_SUCCEEDED,
        "success",
        operationId,
        record.assistantEntryIds.length + record.toolResultEntryIds.length,
      );
    } catch {
      restoreLeaf(ctx.sessionManager, priorLeaf);
      const failure = new Error(
        "Manual-shake checkpoint could not be carried forward after compaction. Refusing to expose context until the session is reloaded or a checkpoint is persisted.",
      );
      projectionFailures.set(ctx.sessionManager as object, { sessionId, error: failure });
      shakeDiagnostic(ctx, SHAKE_CARRY_FORWARD_PERSIST_FAILED, "failed", operationId);
      ctx.ui.notify(failure.message, "error");
    }
  });
  pi.registerCommand("shake", {
    description: "Prune completed execution traces from active model context",
    handler: async (args, ctx) => {
      const operationId = crypto.randomUUID();
      if (args.trim()) {
        ctx.ui.notify("Usage: /shake", "error");
        return;
      }
      const snapshot = {
        manager: ctx.sessionManager,
        sessionId: ctx.sessionManager.getSessionId(),
        leafId: ctx.sessionManager.getLeafId(),
        model: ctx.model,
        idle: ctx.isIdle(),
        pending: ctx.hasPendingMessages(),
        signal: ctx.signal,
      };
      if (!snapshot.idle || snapshot.pending) {
        shakeDiagnostic(ctx, SHAKE_REFUSED_ACTIVE_WORK, "blocked", operationId);
        ctx.ui.notify("Shake refused: wait until the active turn and queued message batch are settled.", "warning");
        return;
      }
      const entries = snapshot.manager.buildContextEntries();
      let plan: ShakePlan;
      let beforeMessages: AgentMessage[];
      try {
        plan = buildShakePlan(entries, snapshot.sessionId);
        assertNativeShakeContext(entries, ctx);
        beforeMessages = await currentTransformedContext(ctx, entries);
        assertNativeShakeContext(entries, ctx, beforeMessages);
      } catch (error) {
        shakeDiagnostic(
          ctx,
          hasActiveNativeCheckpoint(entries) ? SHAKE_REFUSED_OPAQUE_CHECKPOINT : SHAKE_REFUSED_CONTEXT_FAILURE,
          "failed",
          operationId,
        );
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
        return;
      }
      const stale =
        ctx.sessionManager !== snapshot.manager ||
        ctx.sessionManager.getSessionId() !== snapshot.sessionId ||
        ctx.sessionManager.getLeafId() !== snapshot.leafId ||
        ctx.model !== snapshot.model ||
        ctx.isIdle() !== snapshot.idle ||
        ctx.hasPendingMessages() !== snapshot.pending ||
        ctx.signal !== snapshot.signal ||
        snapshot.signal?.aborted === true;
      if (stale) {
        shakeDiagnostic(ctx, SHAKE_REFUSED_STALE, "blocked", operationId);
        ctx.ui.notify(
          "Shake refused: session, branch, model, or work state changed while context hooks were running; no context was changed.",
          "warning",
        );
        return;
      }
      if (plan.storageError) {
        shakeDiagnostic(ctx, SHAKE_REFUSED_STORAGE_LIMIT, "blocked", operationId);
        ctx.ui.notify(plan.storageError, "error");
        return;
      }
      if (plan.unresolvedToolCallIds.length || plan.orphanToolResultIds.length) {
        shakeDiagnostic(
          ctx,
          SHAKE_REFUSED_AMBIGUOUS_TOOL,
          "blocked",
          operationId,
          plan.unresolvedToolCallIds.length + plan.orphanToolResultIds.length,
        );
        ctx.ui.notify(
          "Shake refused: the active branch has an unresolved or ambiguous tool batch; no context was changed.",
          "warning",
        );
        return;
      }
      const projected = projection(beforeMessages, entries, plan.record);
      if (!projected.removedAssistantBlocks && !projected.removedToolResults) {
        shakeDiagnostic(ctx, SHAKE_NOOP, "noop", operationId, 0);
        ctx.ui.notify(
          "Shake made no changes: active transformed context has no unambiguous newly eligible completed execution trace." +
            (hasActiveNativeCheckpoint(entries) ? " Native checkpoint remains unchanged." : ""),
          "info",
        );
        return;
      }
      const before = estimateContext(beforeMessages);
      const after = estimateContext(projected.messages);
      const priorLeaf = ctx.sessionManager.getLeafId();
      try {
        // Only persist newly proven matches, never IDs of excluded hook output.
        pi.appendEntry(MANUAL_SHAKE_ENTRY, matchedShakeRecord(entries, snapshot.sessionId, plan.record, projected));
      } catch {
        restoreLeaf(ctx.sessionManager, priorLeaf);
        shakeDiagnostic(ctx, SHAKE_CHECKPOINT_PERSIST_FAILED, "failed", operationId);
        ctx.ui.notify(
          "Shake refused: the projection checkpoint could not be persisted; no context was changed.",
          "error",
        );
        return;
      }
      projectionFailures.delete(ctx.sessionManager as object);
      invalidateProviderSnapshot();
      shakeDiagnostic(
        ctx,
        SHAKE_SUCCEEDED,
        "success",
        operationId,
        projected.removedAssistantBlocks + projected.removedToolResults,
      );
      ctx.ui.notify(
        "Shake complete (local estimates, no provider request): ~" +
          before +
          " → ~" +
          after +
          " active-context tokens; removed " +
          projected.removedAssistantBlocks +
          " assistant thinking/tool block(s) and " +
          projected.removedToolResults +
          " tool result message(s). Original transcript and usage/cost entries remain intact in append-only JSONL history. Removing an old prefix may invalidate provider prompt caches; no cost savings are guaranteed.",
        "info",
      );
    },
  });
}
