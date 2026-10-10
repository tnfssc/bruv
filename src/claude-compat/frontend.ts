import { randomUUID } from "node:crypto";
import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-ai";
import type {
  AgentSessionEvent,
  ExtensionContext,
  ExtensionFactory,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import type { SessionHost } from "../session/host";
import { getSessionHost } from "../session/host-access";
import type { GoalState } from "../goals/types";

export type CompatFrame = { type: string; [key: string]: unknown };
export interface ClaudeCompatFrontendOptions {
  emit(frame: CompatFrame): void | Promise<void>;
  /** Fatal delivery failure, including autonomous runs without a flush waiter. */
  onOutputError?(error: unknown): void;
  sessionId(): string;
  messageUuid?(message: object): string;
  omitThinking?: boolean;
  model(): string;
  /** Canonical Bruv state; native goal projection never parses display text. */
  goal?(): GoalState | undefined;
  /** Pi has actually queued the next authorized goal turn. */
  continueGoal?(): boolean;
  /** Auxiliary mode collects actual results without publishing streaming frames. */
  auxiliary?: boolean;
  initialization?(): Record<string, unknown>;
  diagnostic?(notice: unknown): void;
}

/** Derived native view only: the Pi session remains the canonical message and job owner. */
export function createClaudeCompatFrontend(options: ClaudeCompatFrontendOptions) {
  let context: ExtensionContext | undefined;
  let host: SessionHost | undefined;
  let tail = Promise.resolve();
  let outputError: unknown;
  let active = false;
  let results = 0;
  let run = new RunResult();
  let messageId = "";
  let commandUuid: string | undefined;
  let cumulativeCost = 0;
  let consumedUserUuids: string[] = [];
  let echoPending = false;
  let consumedHuman = false;
  let consumedTaskNotification = false;
  let projectedGoal: Pick<GoalState, "id" | "objective" | "status"> | undefined;
  const promptEcho = () =>
    consumedUserUuids.length
      ? { user_message_uuid: consumedUserUuids.at(-1), user_message_uuids: [...consumedUserUuids] }
      : {};
  const send = (frame: CompatFrame) => {
    tail = tail
      .then(() => {
        // Once delivery fails, later result/lifecycle frames cannot claim success.
        if (!outputError) return options.emit(frame);
      })
      .catch((error) => {
        outputError ??= error;
        options.onOutputError?.(error);
      });
  };
  const base = () => ({
    uuid: randomUUID(),
    session_id: options.sessionId(),
    ...(commandUuid ? { user_message_uuid: commandUuid } : {}),
  });
  const syncGoal = () => {
    if (options.auxiliary || !options.goal) return;
    const goal = options.goal();
    let text: string | undefined;
    if (!goal && projectedGoal) {
      text = `Goal cleared: ${projectedGoal.objective}`;
      projectedGoal = undefined;
    } else if (goal) {
      if (
        goal.status !== "completed" &&
        (goal.id !== projectedGoal?.id ||
          goal.objective !== projectedGoal.objective ||
          projectedGoal.status === "completed")
      ) {
        text = `Goal set: ${goal.objective}`;
      }
      // Remember restored completed goals without restarting them. A later
      // explicit resume or clear must update the native host's saved indicator.
      projectedGoal = { id: goal.id, objective: goal.objective, status: goal.status };
    }
    if (text !== undefined)
      send({
        type: "assistant",
        ...base(),
        parent_tool_use_id: null,
        message: {
          id: randomUUID(),
          type: "message",
          role: "assistant",
          model: "<synthetic>",
          content: [{ type: "text", text }],
          stop_reason: "end_turn",
          usage: { input_tokens: 0, output_tokens: 0 },
        },
        bruv: { goal_status: true },
      });
  };
  const stream = (event: Record<string, unknown>) => {
    if (!options.auxiliary) {
      send({ type: "stream_event", ...base(), ...(echoPending ? promptEcho() : {}), parent_tool_use_id: null, event });
      echoPending = false;
    }
  };
  const begin = () => {
    if (active) return;
    // The pinned adapter uses each root init as the native turn-start boundary,
    // including an autonomous task wake. Pi alone decides when this run begins.
    if (!options.auxiliary && options.initialization) {
      send({ type: "system", subtype: "init", ...base(), ...options.initialization() });
    }
    active = true;
    if (!options.auxiliary) send({ type: "system", subtype: "session_state_changed", ...base(), state: "running" });
    consumedUserUuids = [];
    consumedHuman = false;
    consumedTaskNotification = false;
    echoPending = false;

    commandUuid = undefined;
    run = new RunResult(Date.now());
  };
  const result = (structuredOutput?: unknown) => {
    // Snapshot before asynchronous output delivery: another Pi run can change
    // the goal while this result waits for its MCP leases/history to flush.
    const goal = options.auxiliary ? undefined : options.goal?.();
    return {
      type: "result",
      ...base(),
      ...promptEcho(),
      // SDK 0.3.276 has no auto-continuation origin. Attribute real task wakes
      // only when Pi consumes their custom message, never from a job lifecycle frame.
      origin: { kind: consumedHuman ? "human" : consumedTaskNotification ? "task-notification" : "unclassified" },
      ...run.resultFields(),
      // The native Claude adapter otherwise interprets any successful turn as
      // goal completion. Bruv's goal policy must retain unfinished work through
      // automatic continuations and later chat while the goal is suspended.
      ...(!run.error && goal && goal.status !== "completed"
        ? { terminal_reason: goal.status === "active" ? "stop_hook_prevented" : "hook_stopped" }
        : {}),
      ...(structuredOutput === undefined ? {} : { structured_output: structuredOutput }),
    };
  };
  const completeCommand = (state = "completed") => {
    if (commandUuid && !options.auxiliary)
      send({ type: "command_lifecycle", ...base(), command_uuid: commandUuid, state });
    commandUuid = undefined;
  };
  const end = () => {
    if (!active) return;
    syncGoal();
    active = false;
    results++;
    cumulativeCost += run.cost;
    if (!options.auxiliary) {
      send(result());
      completeCommand(run.error === "Interrupted" ? "cancelled" : "completed");
      // SDK 0.3.276 separates the result from the authoritative turn-over frame.
      // Only Pi agent_settled (or a handled command) ends the actual root run.
      send({ type: "system", subtype: "session_state_changed", ...base(), state: "idle" });
    }
    commandUuid = undefined;
  };
  const factory: ExtensionFactory = (pi) => {
    pi.on("session_start", (_event, ctx) => {
      context = ctx;
    });
    pi.on("session_shutdown", () => {
      context = undefined;
      host = undefined;
    });
    // Resolve lazily: getting the host starts the actual task manager, which init need not do.
    hostAccess = () => {
      if (!context) return undefined;
      host ??= getSessionHost(pi, context);
      return host;
    };
  };
  let hostAccess: () => SessionHost | undefined = () => undefined;

  function onEvent(event: AgentSessionEvent) {
    switch (event.type) {
      case "auto_retry_end":
        if (event.success) run.retrySucceeded();
        return;
      case "agent_start":
        begin();
        syncGoal();
        return;
      case "agent_settled":
        // Claude's result closes the native turn. Keep a continuous goal run
        // open through Pi's internal turns so the host retains Stop/steering
        // ownership while the next request starts, including before its first token.
        if (!options.continueGoal?.()) end();
        return;
      case "message_start":
        if (event.message.role === "custom" && ["task-complete", "task-attention"].includes(event.message.customType)) {
          begin();
          consumedTaskNotification = true;
        } else if (event.message.role === "assistant") {
          begin();
          syncGoal();
          messageId = randomUUID();
          stream({
            type: "message_start",
            message: {
              id: messageId,
              type: "message",
              role: "assistant",
              model: options.model(),
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 0, output_tokens: 0 },
            },
          });
        }
        return;
      case "message_update":
        streamAssistantUpdate(event.assistantMessageEvent);
        return;
      case "message_end": {
        syncGoal();
        const m = event.message;
        if (m.role === "custom" && m.customType === "bruv-goal-status" && typeof m.content === "string") {
          send({
            type: "assistant",
            ...base(),
            parent_tool_use_id: null,
            message: {
              id: randomUUID(),
              type: "message",
              role: "assistant",
              model: "<synthetic>",
              content: [{ type: "text", text: m.content }],
              stop_reason: "end_turn",
              usage: { input_tokens: 0, output_tokens: 0 },
            },
            bruv: { goal_status: true },
          });
        } else if (m.role === "assistant") {
          run.recordAssistant(m);
          publishAssistant(m);
        } else if (m.role === "toolResult" && !options.auxiliary) {
          send({
            type: "user",
            ...base(),
            uuid: options.messageUuid?.(m) ?? randomUUID(),
            parent_tool_use_id: null,
            message: {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: m.toolCallId,
                  content: m.content,
                  is_error: m.isError,
                },
              ],
            },
          });
        }
        return;
      }
    }
  }

  function streamAssistantUpdate(e: AssistantMessageEvent) {
    if (options.omitThinking && e.type.startsWith("thinking_")) return;
    switch (e.type) {
      case "text_start":
        stream({ type: "content_block_start", index: e.contentIndex, content_block: { type: "text", text: "" } });
        break;
      case "text_delta":
        stream({ type: "content_block_delta", index: e.contentIndex, delta: { type: "text_delta", text: e.delta } });
        break;
      case "thinking_start":
        stream({
          type: "content_block_start",
          index: e.contentIndex,
          content_block: { type: "thinking", thinking: "" },
        });
        break;
      case "thinking_delta":
        stream({
          type: "content_block_delta",
          index: e.contentIndex,
          delta: { type: "thinking_delta", thinking: e.delta },
        });
        break;
      case "toolcall_start": {
        const block = e.partial.content[e.contentIndex];
        if (block?.type === "toolCall")
          stream({
            type: "content_block_start",
            index: e.contentIndex,
            content_block: { type: "tool_use", id: block.id, name: block.name, input: {} },
          });
        break;
      }
      case "toolcall_delta":
        stream({
          type: "content_block_delta",
          index: e.contentIndex,
          delta: { type: "input_json_delta", partial_json: e.delta },
        });
        break;
      case "text_end":
      case "thinking_end":
      case "toolcall_end":
        stream({ type: "content_block_stop", index: e.contentIndex });
        break;
    }
  }

  function publishAssistant(assistant: AssistantMessage) {
    const stopReason =
      assistant.stopReason === "toolUse" ? "tool_use" : assistant.stopReason === "length" ? "max_tokens" : "end_turn";
    const nativeUsage = {
      input_tokens: assistant.usage.input,
      output_tokens: assistant.usage.output,
      cache_read_input_tokens: assistant.usage.cacheRead,
      cache_creation_input_tokens: assistant.usage.cacheWrite,
    };
    stream({ type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: nativeUsage });
    stream({ type: "message_stop" });
    if (!options.auxiliary)
      send({
        type: "assistant",
        ...base(),
        ...promptEcho(),
        uuid: options.messageUuid?.(assistant) ?? randomUUID(),
        parent_tool_use_id: null,
        message: {
          id: messageId,
          type: "message",
          role: "assistant",
          model: options.model(),
          content: assistant.content
            .filter((p) => !options.omitThinking || p.type !== "thinking")
            .map((p) =>
              p.type === "toolCall"
                ? { type: "tool_use", id: p.id, name: p.name, input: p.arguments }
                : p.type === "thinking"
                  ? {
                      type: "thinking",
                      thinking: p.thinking,
                      ...(p.thinkingSignature ? { signature: p.thinkingSignature } : {}),
                    }
                  : p,
            ),
          stop_reason: stopReason,
          stop_sequence: null,
          usage: nativeUsage,
        },
      });
  }

  // Controls can answer during a run without replacing its owner or publishing
  // a result/idle frame. One command can produce several ordered notices.
  const commandResponse = (message: { uuid?: string; message: unknown }) => {
    const metadata = { session_id: options.sessionId(), user_message_uuid: message.uuid };
    if (message.uuid)
      send({
        type: "command_lifecycle",
        ...metadata,
        uuid: randomUUID(),
        command_uuid: message.uuid,
        state: "started",
      });
    send({
      type: "user",
      ...metadata,
      uuid: message.uuid ?? randomUUID(),
      parent_tool_use_id: null,
      message: message.message,
    });
    const notice = (text: string, level = "info") => {
      syncGoal();
      send({
        type: "assistant",
        ...metadata,
        uuid: randomUUID(),
        parent_tool_use_id: null,
        message: {
          id: randomUUID(),
          type: "message",
          role: "assistant",
          model: "<synthetic>",
          content: [{ type: "text", text }],
          stop_reason: "end_turn",
          usage: { input_tokens: 0, output_tokens: 0 },
        },
        bruv: { human_command: true, level },
      });
    };
    let completed = false;
    const complete = () => {
      if (completed) return;
      completed = true;
      if (message.uuid)
        send({
          type: "command_lifecycle",
          ...metadata,
          uuid: randomUUID(),
          command_uuid: message.uuid,
          state: "completed",
        });
    };
    return { notice, complete };
  };

  return {
    factory,
    commandResponse,
    commandNotice(message: { uuid?: string; message: unknown }, text: string, level = "info") {
      const response = commandResponse(message);
      response.notice(text, level);
      response.complete();
    },
    consumeUser(uuid?: string) {
      begin();
      consumedHuman = true;
      if (uuid) {
        if (!consumedUserUuids.includes(uuid)) consumedUserUuids.push(uuid);
        echoPending = true;
      }
    },
    notice(text: string, level: "info" | "warning" | "error" = "info") {
      begin();
      syncGoal();
      run.notice(text);
      send({
        type: "assistant",
        ...base(),
        parent_tool_use_id: null,
        message: {
          id: randomUUID(),
          type: "message",
          role: "assistant",
          model: "<synthetic>",
          content: [{ type: "text", text }],
          stop_reason: "end_turn",
          usage: { input_tokens: 0, output_tokens: 0 },
        },
        bruv: { human_command: true, level },
      });
    },
    denied(toolName: string, input: Record<string, unknown>, id: string) {
      run.deny(toolName, input, id);
    },
    onEvent,
    sessionHost: () => hostAccess(),
    context: () => context,
    async flush() {
      await tail;
      if (outputError) throw outputError;
    },
    fail(error: unknown) {
      // A delivery failure is terminal, not a second synthetic model result.
      if (outputError) return;
      const running = active;
      begin();
      run.fail(error instanceof Error ? error.message : String(error));
      if (!running) end();
    },
    headlessUI(base: ExtensionUIContext): ExtensionUIContext {
      const unavailable = async () => {
        throw new Error("This connector does not yet support interactive CLI dialogs");
      };
      return {
        ...base,
        select: unavailable,
        confirm: unavailable,
        input: unavailable,
        custom: unavailable,
        editor: unavailable,
        notify: (message, type) => {
          // Human command results are projected by the command admission seam.
          options.diagnostic?.({ type: type ?? "info", message });
        },
      };
    },
    startCommand(message: { uuid?: string; message: unknown }) {
      begin();
      commandUuid = message.uuid;
      consumedHuman = true;
      consumedUserUuids = message.uuid ? [message.uuid] : [];
      echoPending = Boolean(message.uuid);
      // This received command is admitted here, not a queued model prompt.
      // Native lifecycle states describe its dispatch/fate, never model work.
      if (commandUuid && !options.auxiliary)
        send({ type: "command_lifecycle", ...base(), command_uuid: commandUuid, state: "started" });
      send({
        type: "user",
        ...base(),
        uuid: message.uuid ?? randomUUID(),
        parent_tool_use_id: null,
        message: message.message,
      });
      // Capture restored state before a command mutates it, including a clear
      // that is the first command received after the connector restarts.
      syncGoal();
    },
    checkpoint: () => results,
    completeCommand,
    isRunning: () => active,
    commandHandled(checkpoint: number) {
      if (active && options.continueGoal?.()) return;
      if (active) end();
      else if (results === checkpoint) {
        begin();
        end();
      }
    },
    result,
    text: () => run.text,
    error: () => run.error,
    usage: () => run.usageSnapshot(),
    cost: () => cumulativeCost,
    interrupt() {
      if (active) run.fail("Interrupted");
    },
    /** Stop can arrive after Pi settled, with no further lifecycle event. */
    settle: end,
  };
}

/** Accounting and failures last for one root run; settlement leaves its result readable. */
class RunResult {
  private turns = 0;
  private lastText = "";
  private providerFailure: string | undefined;
  private terminalFailure: string | undefined;
  private usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  private denials: Record<string, unknown>[] = [];
  private totalCost = 0;

  constructor(private readonly started = 0) {}

  get text() {
    return this.lastText;
  }

  get error() {
    return this.terminalFailure ?? this.providerFailure;
  }

  get cost() {
    return this.totalCost;
  }

  recordAssistant(message: AssistantMessage) {
    this.turns++;
    this.lastText = message.content
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n");
    this.usage.input_tokens += message.usage.input;
    this.usage.output_tokens += message.usage.output;
    this.usage.cache_read_input_tokens += message.usage.cacheRead;
    this.usage.cache_creation_input_tokens += message.usage.cacheWrite;
    this.totalCost += message.usage.cost.total;
    if (message.stopReason === "error") this.providerFailure = message.errorMessage ?? message.stopReason;
    if (message.stopReason === "aborted") this.terminalFailure ??= message.errorMessage ?? message.stopReason;
  }

  retrySucceeded() {
    // Pi's retry success includes aborted responses. Only provider failures recover.
    this.providerFailure = undefined;
  }

  fail(error: string) {
    this.terminalFailure = error;
  }

  notice(text: string) {
    this.lastText = this.lastText ? `${this.lastText}\n${text}` : text;
  }

  deny(toolName: string, input: Record<string, unknown>, id: string) {
    this.denials.push({ tool_name: toolName, tool_input: input, tool_use_id: id });
  }

  usageSnapshot() {
    return { ...this.usage };
  }

  resultFields() {
    const failure = this.error;
    return {
      subtype: failure ? "error_during_execution" : "success",
      is_error: Boolean(failure),
      duration_ms: this.started ? Date.now() - this.started : 0,
      // Provider API latency is not measured separately; do not invent duration_api_ms.
      num_turns: this.turns,
      result: this.lastText,
      total_cost_usd: this.totalCost,
      usage: this.usage,
      permission_denials: this.denials,
      ...(failure ? { errors: [failure] } : {}),
    };
  }
}
