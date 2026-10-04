import { randomUUID } from "node:crypto";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  AgentSessionEvent,
  ExtensionContext,
  ExtensionFactory,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import type { SessionHost } from "../session/host";
import { getSessionHost } from "../session/host-access";

export type CompatFrame = { type: string; [key: string]: unknown };
export interface ClaudeCompatFrontendOptions {
  emit(frame: CompatFrame): void | Promise<void>;
  sessionId(): string;
  messageUuid?(message: object): string;
  omitThinking?: boolean;
  model(): string;
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
  let started = 0;
  let active = false;
  let turns = 0;
  let results = 0;
  let lastText = "";
  let failure: string | undefined;
  let messageId = "";
  let commandUuid: string | undefined;
  let usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  let cost = 0;
  let cumulativeCost = 0;
  let denials: Record<string, unknown>[] = [];
  let consumedUserUuids: string[] = [];
  let echoPending = false;
  let consumedHuman = false;
  let consumedTaskNotification = false;
  const promptEcho = () =>
    consumedUserUuids.length
      ? { user_message_uuid: consumedUserUuids.at(-1), user_message_uuids: [...consumedUserUuids] }
      : {};
  const send = (frame: CompatFrame) => {
    tail = tail
      .then(() => options.emit(frame))
      .catch((error) => {
        outputError ??= error;
      });
  };
  const base = () => ({
    uuid: randomUUID(),
    session_id: options.sessionId(),
    ...(commandUuid ? { user_message_uuid: commandUuid } : {}),
  });
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
    started = Date.now();
    turns = 0;
    lastText = "";
    failure = undefined;
    cost = 0;
    denials = [];
    usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  };
  const result = (structuredOutput?: unknown) => ({
    type: "result",
    ...base(),
    ...promptEcho(),
    // SDK 0.3.276 has no auto-continuation origin. Attribute real task wakes
    // only when Pi consumes their custom message, never from a job lifecycle frame.
    origin: { kind: consumedHuman ? "human" : consumedTaskNotification ? "task-notification" : "unclassified" },
    subtype: failure ? "error_during_execution" : "success",
    is_error: Boolean(failure),
    duration_ms: started ? Date.now() - started : 0,
    // Provider API latency is not measured separately; do not invent duration_api_ms.
    num_turns: turns,
    result: lastText,
    total_cost_usd: cost,
    usage,
    permission_denials: denials,
    ...(failure ? { errors: [failure] } : {}),
    ...(structuredOutput === undefined ? {} : { structured_output: structuredOutput }),
  });
  const end = () => {
    if (!active) return;
    active = false;
    results++;
    cumulativeCost += cost;
    if (!options.auxiliary) {
      send(result());
      if (commandUuid)
        send({
          type: "command_lifecycle",
          ...base(),
          command_uuid: commandUuid,
          state: failure === "Interrupted" ? "cancelled" : "completed",
        });
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
    hostAccess = () => (context ? (host ??= getSessionHost(pi, context)) : undefined);
  };
  let hostAccess: () => SessionHost | undefined = () => undefined;

  function onEvent(event: AgentSessionEvent) {
    if (event.type === "agent_start") {
      begin();
      return;
    }
    if (event.type === "agent_settled") {
      end();
      return;
    }
    if (
      event.type === "message_start" &&
      event.message.role === "custom" &&
      ["task-complete", "task-attention"].includes(event.message.customType)
    ) {
      begin();
      consumedTaskNotification = true;
    }
    if (event.type === "message_start" && event.message.role === "assistant") {
      begin();
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
    if (event.type === "message_update") {
      const e = event.assistantMessageEvent;
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
    if (event.type !== "message_end") return;
    const m = event.message;
    if (m.role === "assistant") {
      const assistant = m as AssistantMessage;
      turns++;
      lastText = assistant.content
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n");
      usage.input_tokens += assistant.usage.input;
      usage.output_tokens += assistant.usage.output;
      usage.cache_read_input_tokens += assistant.usage.cacheRead;
      usage.cache_creation_input_tokens += assistant.usage.cacheWrite;
      cost += assistant.usage.cost.total;
      if (assistant.stopReason === "error" || assistant.stopReason === "aborted")
        failure = assistant.errorMessage ?? assistant.stopReason;
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
          uuid: options.messageUuid?.(m) ?? randomUUID(),
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
  }
  return {
    factory,
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
      lastText = lastText ? lastText + "\n" + text : text;
      send({
        type: "assistant",
        ...base(),
        parent_tool_use_id: null,
        message: {
          id: randomUUID(),
          type: "message",
          role: "assistant",
          model: options.model(),
          content: [{ type: "text", text }],
          stop_reason: "end_turn",
          usage: { input_tokens: 0, output_tokens: 0 },
        },
        bruv: { human_command: true, level },
      });
    },
    denied(toolName: string, input: Record<string, unknown>, id: string) {
      denials.push({ tool_name: toolName, tool_input: input, tool_use_id: id });
    },
    onEvent,
    sessionHost: () => hostAccess(),
    context: () => context,
    async flush() {
      await tail;
      if (outputError) throw outputError;
    },
    fail(error: unknown) {
      const running = active;
      begin();
      failure = error instanceof Error ? error.message : String(error);
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
    },
    checkpoint: () => results,
    commandHandled(checkpoint: number) {
      if (active) end();
      else if (results === checkpoint) {
        begin();
        end();
      }
    },
    result,
    text: () => lastText,
    error: () => failure,
    usage: () => ({ ...usage }),
    cost: () => cumulativeCost,
    interrupt() {
      if (active) failure = "Interrupted";
    },
  };
}
