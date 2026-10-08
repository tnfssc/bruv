import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { validateToolArguments } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  type ClassicSession,
  getInstructionContinuitySession,
  setCurrentInstructionFrame,
} from "../agent/instruction-continuity";
import { terminalTranscriptText } from "./transcript-text";
import type { VoiceOrchestration } from "./types";

/** This Pi release has no public external-agent tool seam. Own the same pinned
 * ClassicSession that ordinary turns use, Direct providers own tool turns; paired GPT-Live admits ordinary session.prompt turns. */
type OwnerSession = ClassicSession & {
  _toolRegistry: Map<string, any>;
  sendCustomMessage(
    message: { customType: string; content: { type: "text"; text: string }[]; display: boolean; details?: unknown },
    options: { triggerTurn: boolean },
  ): Promise<void>;
  _isAgentRunActive?: boolean;
  _extensionRunner: NonNullable<ClassicSession["_extensionRunner"]>;
  sessionManager: ExtensionContext["sessionManager"] & {
    appendMessage(message: AgentMessage): string;
    appendCustomMessageEntry(type: string, content: any, display: boolean, details?: unknown): string;
  };
};
export type MainOwner = {
  orchestration: VoiceOrchestration;
  beginInput?(): void;
  inputTranscript(text: string, final?: boolean): void;
  typedInput(text: string): void | Promise<void>;
  /** Idempotent selected-model turn on this same classic session. onAdmitted is synchronous; the promise is completion. */
  delegate?(id: string, snapshotPrompt: string, provenance?: unknown, onAdmitted?: () => void): Promise<void>;
  delegatedVoice?: boolean;
  outputTranscript(text: string, final?: boolean): void;
  sendContext(text: string, metadata?: { customType: string; details?: unknown }): void;
  /** Passive presentation/audit only: never inject context or authorize a response. */
  saveTranscript?(text: string, details: unknown, display: boolean): void;
  interrupt(): void;
  turnComplete(): void;
  /** Immediately stops admitting calls; does not wait for a calling execute to finish. */
  close(): void;
  /** Wait before admitting an ordinary text turn after close. */
  readonly released: Promise<void>;
  /** Request foreground execute cancellation without aborting background jobs. */
  stopForeground(): void;
  captureStopWorkReport?(report: unknown): void;
};
const delegatedAdmission = new AsyncLocalStorage<object>();
export function runDelegatedMainTurn<T>(manager: object, run: () => Promise<T>): Promise<T> {
  return delegatedAdmission.run(manager, run);
}
function isDelegated(manager: object): boolean {
  return delegatedAdmission.getStore() === manager;
}
const owners = new WeakMap<object, MainOwner & { identity: string; accepting: boolean }>();
const pending = new WeakMap<object, Promise<void>>();
const drainingOwners = new WeakMap<object, MainOwner & { identity: string; accepting: boolean }>();
const acquiring = new WeakSet<object>();
const textTurns = new WeakSet<object>();
function identity(manager: ExtensionContext["sessionManager"]): string {
  return manager.getSessionId() + ":" + manager.getLeafId();
}
/** Normal appends (including billing entries) advance the leaf without switching branches. */
function sameBranch(owner: { identity: string }, manager: ExtensionContext["sessionManager"]): boolean {
  const prefix = manager.getSessionId() + ":";
  if (!owner.identity.startsWith(prefix)) return false;
  const leaf = owner.identity.slice(prefix.length);
  const now = identity(manager);
  if (owner.identity === now) return true;
  if (leaf === "null" || leaf === "undefined" || manager.getBranch?.().some((entry) => entry.id === leaf)) {
    owner.identity = now;
    return true;
  }
  return false;
}
export function currentMainOwner(manager: object): MainOwner | undefined {
  const owner = owners.get(manager);
  if (!owner) return;
  if (!sameBranch(owner, manager as ExtensionContext["sessionManager"])) {
    owner.stopForeground();
    owner.close();
    return;
  }
  return owner;
}
/** Explicit stop-work must still find its admitted execute after live.stop closed transport. */
export function currentMainToolOwner(manager: object): MainOwner | undefined {
  const active = currentMainOwner(manager);
  if (active) return active;
  const draining = drainingOwners.get(manager);
  return draining && sameBranch(draining, manager as ExtensionContext["sessionManager"]) ? draining : undefined;
}
/** Installed at the already-pinned instruction-continuity seam. */
export async function beforeOrdinaryPrompt(manager: object): Promise<void> {
  const owner = currentMainOwner(manager);
  if (isDelegated(manager)) return;
  if (owner || acquiring.has(manager))
    throw new Error("Ordinary text model runs are unavailable while Live owns this session");
  await pending.get(manager);
  if (currentMainOwner(manager) || acquiring.has(manager))
    throw new Error("Ordinary text model runs are unavailable while Live owns this session");
}
/** Keep the admission check and the text-run reservation in the same synchronous step. */
export async function withOrdinaryMainTurn<T>(manager: object, run: () => Promise<T>): Promise<T> {
  if (isDelegated(manager)) return run();
  const draining = pending.get(manager);
  if (draining) await draining;
  if (currentMainOwner(manager) || acquiring.has(manager))
    throw new Error("Ordinary text model runs are unavailable while Live owns this session");
  textTurns.add(manager);
  try {
    return await run();
  } finally {
    textTurns.delete(manager);
  }
}
function record(session: OwnerSession, message: AgentMessage, onMessage?: (message: AgentMessage) => void): void {
  if (message.role === "custom")
    session.sessionManager.appendCustomMessageEntry(
      message.customType,
      message.content,
      message.display,
      message.details,
    );
  else session.sessionManager.appendMessage(message);
  session.agent.state.messages.push(message);
  const owner = owners.get(session.sessionManager);
  if (owner) owner.identity = identity(session.sessionManager);
  // Presentation follows the durable commit, never authorizes a model run.
  try {
    onMessage?.(message);
  } catch {
    // A synchronous terminal failure must not roll back or re-admit a committed turn.
  }
}
/** Pi's external Live owner appends history directly, so its ordinary agent event
 * stream never fires. Feed only the terminal subscriber path (not extension hooks
 * or agent execution) for the already-admitted tool pair. This is the pinned
 * Pi 0.87 private UI seam; replace when Pi exposes external tool events. */
function showLiveTool(session: OwnerSession, event: unknown): void {
  try {
    (session as OwnerSession & { _emit?: (event: any) => void })._emit?.(event);
  } catch {
    // Only synchronous dispatch failures are isolated; _emit does not await listeners.
  }
}
/** Canonical history cannot interleave an observation between a tool call and its
 * result. Reservations serialize pairs; observations flush at each pair boundary. */
class LiveHistory {
  private tail: Promise<void> = Promise.resolve();
  private active = false;
  private reservations = 0;
  private deferred: AgentMessage[] = [];

  constructor(
    private session: OwnerSession,
    private onMessage: ((message: AgentMessage) => void) | undefined,
    private onBranch: () => boolean,
  ) {}

  get settled(): Promise<void> {
    return this.tail;
  }

  append(message: AgentMessage): void {
    if (this.active) this.deferred.push(message);
    else record(this.session, message, this.onMessage);
  }

  reserveToolPair(): (() => void) | Promise<() => void> {
    const previous = this.tail;
    const immediate = this.reservations++ === 0;
    let unlock!: () => void;
    this.tail = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const release = () => {
      this.active = false;
      for (const message of this.deferred.splice(0)) if (this.onBranch()) record(this.session, message, this.onMessage);
      this.reservations--;
      unlock();
    };
    if (immediate) {
      this.active = true;
      return release;
    }
    return previous.then(() => {
      this.active = true;
      return release;
    });
  }
}

/** The pinned Pi external-tool seam: canonical call, permission hook, registered
 * execution, host cancellation evidence, result hook, canonical result, UI events.
 * Admission and lifetime are owned by the caller, not by this protocol operation. */
async function executeRegisteredLiveTool(
  session: OwnerSession,
  tool: any,
  call: Parameters<VoiceOrchestration["execute"]>[0] & { id: string },
  controller: AbortController,
  valid: () => boolean,
  canCommit: () => boolean,
  getStopWorkReport: () => unknown,
): Promise<{ result: any; isError: boolean }> {
  const id = call.id;
  const toolCall = { type: "toolCall" as const, id, name: "execute", arguments: (call.args ?? {}) as any };
  let args: any = call.args ?? {};
  let result: any;
  let isError = false;
  let acceptingUpdates = true;
  try {
    if (!valid() || call.name !== "execute") throw new Error("Unavailable Live tool");
    const assistantMessage = {
      role: "assistant",
      content: [toolCall],
      api: "live",
      provider: "live",
      model: "live",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "toolUse",
      timestamp: Date.now(),
    } as Extract<AgentMessage, { role: "assistant" }>;
    record(session, assistantMessage);
    showLiveTool(session, {
      type: "tool_execution_start",
      toolCallId: id,
      toolName: "execute",
      args: toolCall.arguments,
    });
    args = validateToolArguments(tool, toolCall);
    const decision = await session.agent.beforeToolCall?.({
      assistantMessage,
      toolCall,
      args,
      context: session.agent.state,
    });
    if (!valid()) throw new Error("Live owner closed before tool admission");
    if (decision?.block) throw new Error(decision.reason ?? "Tool call blocked");
    const actualCall = { ...toolCall, arguments: args };
    // Wrapper supplies the extension runner's real context; no separate evaluator.
    result = await tool.execute(actualCall.id, args, controller.signal, (update: unknown) => {
      if (!acceptingUpdates) return;
      showLiveTool(session, {
        type: "tool_execution_update",
        toolCallId: id,
        toolName: "execute",
        args: toolCall.arguments,
        partialResult: update,
      });
    });
  } catch (error) {
    isError = true;
    result = { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
  }
  acceptingUpdates = false;
  const stopReport = getStopWorkReport();
  if (stopReport !== undefined)
    result = {
      ...result,
      content: [
        ...(result.content ?? []),
        {
          type: "text",
          text: "jobs.stopWork host report (captured before foreground cancellation):\n" + JSON.stringify(stopReport),
        },
      ],
    };
  const assistantMessage = [...session.agent.state.messages]
    .reverse()
    .find((m) => m.role === "assistant" && m.content.some((c) => c.type === "toolCall" && c.id === toolCall.id)) as
    | Extract<AgentMessage, { role: "assistant" }>
    | undefined;
  try {
    const after = assistantMessage
      ? await session.agent.afterToolCall?.({
          assistantMessage,
          toolCall,
          args,
          result,
          isError,
          context: session.agent.state,
        })
      : undefined;
    if (after) {
      result = { ...result, ...after };
      isError = after.isError ?? isError;
    }
  } catch (error) {
    isError = true;
    result = { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
  }
  if (canCommit())
    record(session, {
      role: "toolResult",
      toolCallId: toolCall.id,
      toolName: "execute",
      content: result.content,
      details: result.details,
      isError,
      timestamp: Date.now(),
    } as AgentMessage);
  showLiveTool(session, {
    type: "tool_execution_end",
    toolCallId: id,
    toolName: "execute",
    result,
    isError,
  });
  return { result, isError };
}

async function acquire(
  _pi: ExtensionAPI,
  ctx: ExtensionContext,
  callbacks: {
    onContext?: (text: string, options?: { triggerResponse?: boolean }) => void;
    onInput?: (text: string) => void;
    /** Already-persisted canonical records, including records deferred behind a tool pair. */
    onMessage?: (message: AgentMessage) => void;
    signal?: AbortSignal;
    onError?: (message: string) => void;
  } = {},
): Promise<MainOwner> {
  const manager = ctx.sessionManager;
  if (currentMainOwner(manager) || pending.has(manager)) throw new Error("A main owner is already active");
  const session = getInstructionContinuitySession(manager) as OwnerSession | undefined;
  if (
    !session?._extensionRunner ||
    !session._toolRegistry ||
    session._isAgentRunActive ||
    !ctx.isIdle() ||
    !session.agent.transformContext ||
    !session.agent.beforeToolCall ||
    !session.agent.afterToolCall
  )
    throw new Error("Cannot acquire Live while the main text agent is active or Pi's classic session is unavailable");
  const key = identity(manager);
  const valid = () => {
    if (owners.get(manager) !== owner || !owner.accepting) return false;
    if (sameBranch(owner, manager)) return true;
    owner.stopForeground();
    owner.close();
    return false;
  };
  const runner = session._extensionRunner;
  const selectedBefore = [...session._baseSystemPromptOptions.selectedTools];
  const prepared = await runner.emitBeforeAgentStart("", undefined, session._baseSystemPromptOptions);
  callbacks.signal?.throwIfAborted();
  if (key !== identity(manager) || session._isAgentRunActive || !ctx.isIdle())
    throw new Error("Session changed during Live acquisition");
  const selectedAfter = prepared.systemPromptOptions.selectedTools;
  const edited =
    selectedAfter.length !== selectedBefore.length ||
    selectedAfter.some((name, index) => name !== selectedBefore[index]);
  if (!edited) prepared.systemPromptOptions.selectedTools = session.getActiveToolNames();
  if (!prepared.systemPromptOptions.selectedTools.includes("execute"))
    throw new Error("The ordinary tool policy disabled execute");
  if (prepared.systemPromptOptions.selectedTools.join() !== "execute")
    throw new Error(
      "Main Live requires the ordinary execute-only tool loadout; continue in text for other direct tools",
    );
  const previousRunOptions = session._runSystemPromptOptions;
  const patch = session._preparePromptAndToolLoadout(prepared.systemPromptOptions);
  const tool = session._toolRegistry.get("execute");
  if (!tool) throw new Error("The registered execute tool is unavailable");
  const instruction = prepared.systemPromptOptions.forceSystemPrompt ?? session.systemPrompt;
  if (!instruction) throw new Error("Effective root instructions are unavailable");
  let inFlight = 0;
  const delegated = new Map<string, { text: string; operation: Promise<void> }>();
  let delegatedTail: Promise<void> = Promise.resolve();
  const admittedNotifications = new Set<string>();
  let backendRunning = false;
  let backendEpoch = 0;
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let inputDraft = "";
  let outputDraft = "";
  let counter = 0;
  let retainedToolBytes = 0;
  let turnPreparation: Promise<void> = Promise.resolve();
  // A revoked ASR turn must not authorize a waiting execute (or poison the next turn).
  let pendingTranscript: { result: Promise<boolean>; settle: (final: boolean) => void } | undefined;
  const settleTranscript = (final: boolean) => {
    pendingTranscript?.settle(final);
    pendingTranscript = undefined;
  };
  const history = new LiveHistory(session, callbacks.onMessage, () => sameBranch(owner, manager));
  const calls = new Map<string, { signature: string; result: Promise<unknown> }>();
  const controllers = new Set<AbortController>();
  const stopWorkReports = new Map<AbortController, unknown>();
  const checkRelease = () => {
    if (!owner.accepting && !inFlight) {
      pending.delete(manager);
      if (drainingOwners.get(manager) === owner) drainingOwners.delete(manager);
      session._runSystemPromptOptions = previousRunOptions;
      calls.clear();
      release();
    }
  };
  const provisional = (kind: string, text: string) => {
    if (!text.trim() || !sameBranch(owner, manager)) return;
    history.append({
      role: "custom",
      customType: "live-provisional",
      content: [{ type: "text", text: kind + ": " + text }],
      display: true,
      details: { final: false, kind },
      timestamp: Date.now(),
    });
    owner.identity = identity(manager);
  };
  const appendText = (role: "user" | "assistant", text: string) => {
    if (!valid() || !text.trim()) return;
    const safe = terminalTranscriptText(text);
    if (safe !== text) {
      // Retain the exact source as hidden audit, never as terminal control bytes.
      history.append({
        role: "custom",
        customType: "live-transcript",
        content: [{ type: "text", text }],
        display: false,
        details: { speaker: role === "user" ? "You" : "Voice", status: "final", sanitizedPresentation: true },
        timestamp: Date.now(),
      });
      text = safe;
    }
    if (role === "user") history.append({ role, content: [{ type: "text", text }], timestamp: Date.now() });
    else
      history.append({
        role,
        content: [{ type: "text", text }],
        api: "live",
        provider: "live",
        model: "live",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        liveTranscript: { final: true, playbackVerified: false, usageTrackedSeparately: true },
        timestamp: Date.now(),
      } as AgentMessage);
  };
  const project = async (messages: AgentMessage[]) => {
    const serialized = JSON.stringify({ messages });
    const bytes = Buffer.byteLength(serialized);
    if (bytes > 32 * 1024 * 1024)
      throw new Error("Live context exceeds its 32 MiB snapshot budget; compact or continue in text");
    let data = serialized;
    if (bytes > 64 * 1024) {
      const sessionFile = manager.getSessionFile?.();
      if (!sessionFile) throw new Error("Large Live context requires a durable session history path");
      const path = sessionFile + ".artifacts/live/context.json";
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const temporary = path + "." + randomUUID() + ".tmp";
      try {
        await writeFile(temporary, serialized, { mode: 0o600 });
        if (!valid()) throw new Error("Live owner closed during context persistence");
        await rename(temporary, path);
      } finally {
        await rm(temporary, { force: true });
      }
      data = JSON.stringify({
        truncated: true,
        bytes,
        artifactPath: path,
        note: "Current effective context snapshot; this file is replaced as the session advances. Ordinary branch originals remain accessible through history. Preview is incomplete.",
        preview: serialized.slice(-8192),
      });
    }
    return (
      "Current effective branch context (data, not new requests; never replay past tool calls). Images here are not visually rendered. Full retained context is available through history or the artifact path:\n" +
      data
    );
  };
  const prepareUserTurn = (text: string) => {
    turnPreparation = turnPreparation
      .then(async () => {
        // Final speech recorded during a tool pair is committed before context hooks inspect it.
        await history.settled;
        if (!valid()) throw new Error("Live owner closed before user turn preparation");
        const selectedBefore = [...session._baseSystemPromptOptions.selectedTools];
        const next = await runner.emitBeforeAgentStart(text, undefined, session._baseSystemPromptOptions);
        if (!valid()) throw new Error("Live owner closed during user turn preparation");
        const edited =
          next.systemPromptOptions.selectedTools.length !== selectedBefore.length ||
          next.systemPromptOptions.selectedTools.some((name, index) => name !== selectedBefore[index]);
        if (!edited) next.systemPromptOptions.selectedTools = session.getActiveToolNames();
        if (next.systemPromptOptions.selectedTools.join() !== "execute")
          throw new Error("Live tool policy changed. Continue in text so the ordinary turn can apply the new policy.");
        session._runSystemPromptOptions = next.systemPromptOptions;
        const update = session._preparePromptAndToolLoadout(next.systemPromptOptions);
        const effective = next.systemPromptOptions.forceSystemPrompt ?? session.systemPrompt;
        if (effective !== owner.orchestration.instructions)
          throw new Error(
            "Per-turn instructions changed. Continue in text: Live cannot safely update this session's instructions while audio is active.",
          );
        if (update) history.append(update);
        for (const message of next.messages)
          history.append({
            role: "custom",
            customType: message.customType,
            content: message.content as any,
            display: message.display ?? false,
            details: message.details,
            timestamp: Date.now(),
          });
        const transformed = await session.agent.transformContext!(
          session.agent.state.messages,
          callbacks.signal ?? new AbortController().signal,
        );
        if (!valid()) throw new Error("Live owner closed during context preparation");
        const frame = [...transformed].reverse().find((message) => message.role === "system");
        const prompt =
          frame?.role === "system"
            ? typeof frame.content === "string"
              ? frame.content
              : frame.content.map((part) => part.text).join("\n")
            : effective;
        if (prompt !== owner.orchestration.instructions)
          throw new Error("Context instructions changed. Continue in text to apply them safely.");
        const context = await project(transformed.filter((message) => message.role !== "system"));
        if (valid()) callbacks.onContext?.(context, { triggerResponse: false });
      })
      .catch((error) => {
        owner.close();
        callbacks.onError?.(
          error instanceof Error &&
            /^(Per-turn instructions changed|Live tool policy changed|Context instructions changed)/.test(error.message)
            ? error.message
            : "Live turn preparation failed. Continue in text; no new tool was admitted.",
        );
        throw error;
      });
    // Provider callbacks cannot await ASR delivery; execute admission awaits this same promise.
    void turnPreparation.catch(() => {});
  };
  const queueBackendTurn = (
    admitted: () => boolean,
    run: () => Promise<void>,
    onError?: (error: unknown) => void,
  ): Promise<void> => {
    const operation = delegatedTail
      .catch(() => {})
      .then(async () => {
        if (!admitted()) return;
        backendRunning = true;
        const start = session.agent.state.messages.length;
        // Each ordinary turn rebuilds its own tool and instruction frame.
        session._runSystemPromptOptions = undefined;
        try {
          await runDelegatedMainTurn(manager, run);
          const reply = session.agent.state.messages
            .slice(start)
            .filter((m) => m.role === "assistant")
            .flatMap((m) => m.content.filter((p) => p.type === "text").map((p) => p.text))
            .join("\n")
            .trim();
          if (reply && sameBranch(owner, manager)) callbacks.onContext?.(reply, { triggerResponse: true });
        } finally {
          backendRunning = false;
        }
      });
    return (onError ? operation.catch(onError) : operation).finally(() => {
      inFlight--;
      checkRelease();
    });
  };
  const owner: MainOwner & { identity: string; accepting: boolean } = {
    identity: key,
    accepting: true,
    released,
    beginInput() {
      if (!valid() || pendingTranscript) return;
      let settle!: (final: boolean) => void;
      const result = new Promise<boolean>((resolve) => {
        settle = resolve;
      });
      pendingTranscript = { result, settle };
    },
    inputTranscript(text, final = true) {
      if (!valid()) return;
      owner.beginInput?.();
      inputDraft = text;
      if (final) {
        const finalText = inputDraft;
        if (!owner.delegatedVoice) {
          appendText("user", finalText);
          prepareUserTurn(finalText);
        }
        inputDraft = "";
        settleTranscript(true);
      }
    },
    async typedInput(text) {
      if (owner.delegatedVoice) {
        await owner.delegate!("typed-" + ++counter, text);
        return;
      }
      if (!valid()) return;
      appendText("user", text);
      prepareUserTurn(text);
      await turnPreparation;
      if (valid()) callbacks.onInput?.(text);
    },
    delegate(id, text, provenance, onAdmitted) {
      if (!owner.delegatedVoice || !valid()) return Promise.reject(new Error("Paired Live owner unavailable"));
      if (!id || id.length > 256 || !text.trim() || text.length > 16_384)
        return Promise.reject(new Error("Invalid delegation"));
      const prior = delegated.get(id);
      if (prior)
        return prior.text === text
          ? prior.operation
          : Promise.reject(new Error("Delegation ID reused with different context"));
      if (delegated.size >= 256) return Promise.reject(new Error("Live delegation capacity reached"));
      // Spoken requests have a source snapshot; typed requests use this queue without one.
      // Keep raw speech in that existing hidden audit, not in another transcript record.
      const requestText = provenance === undefined ? text : terminalTranscriptText(text);
      inFlight++;
      const admittedEpoch = backendEpoch;
      const operation = queueBackendTurn(
        () => {
          // Closing voice preserves admission; explicit stop-work and branch changes do not.
          if (admittedEpoch !== backendEpoch) throw new Error("Delegated backend stopped explicitly");
          if (!sameBranch(owner, manager)) throw new Error("Session branch changed before delegation");
          if (provenance !== undefined) {
            session.sessionManager.appendCustomMessageEntry(
              "gpt-live-delegation-snapshot",
              [{ type: "text", text: JSON.stringify(provenance) }],
              false,
              { requestText },
            );
          }
          return true;
        },
        () => session.prompt(requestText, { expandPromptTemplates: false, source: "extension" }),
      );
      delegated.set(id, { text, operation });
      delegatedTail = operation;
      onAdmitted?.();
      return operation;
    },
    outputTranscript(text, final = true) {
      if (!valid()) return;
      outputDraft = text;
      if (final) {
        appendText("assistant", outputDraft);
        outputDraft = "";
      }
    },
    sendContext(text, metadata) {
      if (!valid()) return;
      const customType = metadata?.customType ?? "task-complete";
      if (owner.delegatedVoice && (customType === "task-complete" || customType === "task-attention")) {
        // Only completed/attention batches authorize a coding continuation. Provisional
        // Live transcript snapshots are observations, not requests for another turn.
        const key = JSON.stringify([customType, text, metadata?.details]);
        if (admittedNotifications.has(key)) return;
        if (admittedNotifications.size >= 256) {
          callbacks.onError?.("Paired Live notification capacity reached; continue in text to inspect jobs.");
          return;
        }
        admittedNotifications.add(key);
        inFlight++;
        const admittedEpoch = backendEpoch;
        const operation = queueBackendTurn(
          () => admittedEpoch === backendEpoch && sameBranch(owner, manager),
          () =>
            session.sendCustomMessage(
              { customType, content: [{ type: "text", text }], display: true, details: metadata?.details },
              { triggerTurn: true },
            ),
          (error) => callbacks.onError?.(error instanceof Error ? error.message : String(error)),
        );
        delegatedTail = operation;
        callbacks.onContext?.(text);
        return;
      }
      if (owner.delegatedVoice) {
        // Pi defers passive records until the active tool pair/turn is complete.
        // Appending directly here can split a tool call from its result on replay.
        void session
          .sendCustomMessage(
            {
              customType,
              content: [{ type: "text", text }],
              // Provisional GPT fragments are canonical passive history, not one TUI bubble per delta.
              // saveTranscript persists a separate presentation boundary for those same source fragments.
              display: customType !== "live-transcript",
              details: metadata?.details,
            },
            { triggerTurn: false },
          )
          .catch(() => callbacks.onError?.("Could not persist paired Live context"));
        if (customType !== "live-transcript") callbacks.onContext?.(text);
        return;
      }
      history.append({
        role: "custom",
        customType,
        details: metadata?.details,
        content: [{ type: "text", text }],
        display: true,
        timestamp: Date.now(),
      });
      owner.identity = identity(manager);
      callbacks.onContext?.(text);
    },
    saveTranscript(text, details, display) {
      if (!valid()) return;
      if (owner.delegatedVoice) {
        // Use Pi's passive queue so a group never splits the active coding tool pair.
        void session
          .sendCustomMessage(
            { customType: "live-transcript", content: [{ type: "text", text }], details, display },
            { triggerTurn: false },
          )
          .catch(() => callbacks.onError?.("Could not persist paired Live transcript"));
      } else {
        history.append({
          role: "custom",
          customType: "live-transcript",
          content: [{ type: "text", text }],
          details,
          display,
          timestamp: Date.now(),
        });
      }
    },
    interrupt() {
      settleTranscript(false);
      provisional("interrupted user transcript", inputDraft);
      inputDraft = "";
      provisional("interrupted assistant transcript", outputDraft);
      outputDraft = "";
    },
    turnComplete() {
      settleTranscript(false);
      provisional("unfinished user transcript at turn boundary", inputDraft);
      provisional("unfinished assistant transcript at turn boundary", outputDraft);
      inputDraft = outputDraft = "";
    },
    captureStopWorkReport(report) {
      for (const controller of controllers) stopWorkReports.set(controller, report);
    },
    stopForeground() {
      backendEpoch++;
      for (const controller of controllers) controller.abort("stop-work");
      if (backendRunning) void session.abort();
    },
    close() {
      if (!owner.accepting) return;
      provisional("unfinished user transcript", inputDraft);
      provisional("unfinished assistant transcript", outputDraft);
      owner.accepting = false;
      settleTranscript(false);
      inputDraft = "";
      outputDraft = "";
      if (owners.get(manager) === owner) owners.delete(manager);
      if (inFlight) drainingOwners.set(manager, owner);
      pending.set(manager, released);
      checkRelease();
    },
    orchestration: {
      instructions: instruction,
      artifactDirectory: manager.getSessionFile?.() ? manager.getSessionFile() + ".artifacts/live" : undefined,
      tools: [
        { name: "execute", description: tool.description, parametersJsonSchema: tool.parameters },
      ] as VoiceOrchestration["tools"],
      async execute(call) {
        const transcript = pendingTranscript;
        if (transcript && !(await transcript.result)) throw new Error("Live input ended without a final transcript");
        await turnPreparation;
        if (!valid()) throw new Error("Live owner is no longer active");
        const callId = call.id || "live-" + ++counter;
        const signature = JSON.stringify([call.name, call.args]);
        const previous = calls.get(callId);
        if (previous) {
          if (previous.signature !== signature) throw new Error("Tool call ID reused with different arguments");
          return previous.result;
        }
        if (calls.size >= 256 || inFlight >= 16) throw new Error("Live tool capacity reached; stop and resume in text");
        const operation = (async () => {
          inFlight++;
          const slot = history.reserveToolPair();
          const releasePair = typeof slot === "function" ? slot : await slot;
          if (!valid()) {
            releasePair();
            inFlight--;
            checkRelease();
            throw new Error("Live owner closed before tool admission");
          }
          const controller = new AbortController();
          controllers.add(controller);
          try {
            const { result, isError } = await executeRegisteredLiveTool(
              session,
              tool,
              { ...call, id: callId },
              controller,
              valid,
              () => sameBranch(owner, manager),
              () => stopWorkReports.get(controller),
            );
            retainedToolBytes += Buffer.byteLength(JSON.stringify(result));
            if (retainedToolBytes > 32 * 1024 * 1024) {
              owner.close();
              callbacks.onError?.(
                "Live tool output budget reached. Continue in text; complete outputs remain in this branch history.",
              );
            }
            return { ...result, isError };
          } finally {
            controllers.delete(controller);
            stopWorkReports.delete(controller);
            inFlight--;
            releasePair();
            checkRelease();
          }
        })();
        calls.set(callId, { signature, result: operation });
        return operation;
      },
    } as VoiceOrchestration,
  };
  owners.set(manager, owner);
  session._runSystemPromptOptions = prepared.systemPromptOptions;
  if (patch) history.append(patch);
  for (const message of prepared.messages)
    history.append({
      role: "custom",
      customType: message.customType,
      content: message.content as any,
      display: message.display ?? false,
      details: message.details,
      timestamp: Date.now(),
    });
  try {
    const transformed = await session.agent.transformContext!(
      session.agent.state.messages,
      callbacks.signal ?? new AbortController().signal,
    );
    if (!prepared.systemPromptOptions.forceSystemPrompt) {
      const system = [...transformed].reverse().find((message) => message.role === "system");
      if (system?.role === "system" && system.content)
        (owner.orchestration as VoiceOrchestration & { instructions: string }).instructions =
          typeof system.content === "string" ? system.content : system.content.map((part) => part.text).join("\n");
    }
    callbacks.signal?.throwIfAborted();
    if (!valid()) throw new Error("Session changed while preparing Live context");
    setCurrentInstructionFrame(manager, owner.orchestration.instructions!);
    const history = transformed.filter((message) => message.role !== "system");
    if (history.length) {
      const context = await project(history);
      if (!valid()) throw new Error("Live owner closed during context preparation");
      callbacks.onContext?.(context, { triggerResponse: false });
    }
    return owner;
  } catch (error) {
    owner.close();
    throw error;
  }
}

/** Reserve ownership before running any asynchronous project/context hooks. */
export async function acquireMainOwner(...args: Parameters<typeof acquire>): Promise<MainOwner> {
  const manager = args[1].sessionManager;
  if (acquiring.has(manager) || textTurns.has(manager) || currentMainOwner(manager) || pending.has(manager))
    throw new Error("A main owner is already active");
  acquiring.add(manager);
  const signal = args[2]?.signal;
  let abort: (() => void) | undefined;
  try {
    signal?.throwIfAborted();
    const acquisition = acquire(...args);
    if (!signal) return await acquisition;
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => {
        currentMainOwner(manager)?.close();
        reject(new Error("Live acquisition cancelled"));
      };
      signal.addEventListener("abort", abort, { once: true });
    });
    return await Promise.race([acquisition, cancelled]);
  } finally {
    if (signal && abort) signal.removeEventListener("abort", abort);
    acquiring.delete(manager);
  }
}
