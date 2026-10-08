import { expect, test } from "bun:test";
import type { AssistantMessage, AssistantMessageEvent, ToolCall } from "@earendil-works/pi-ai";
import { type CompatFrame, createClaudeCompatFrontend } from "../src/claude-compat/frontend";

function assistant(text: string): AssistantMessage {
  return {
    role: "assistant",
    api: "anthropic-messages",
    provider: "anthropic",
    model: "offline-fixture",
    content: [{ type: "text", text }],
    timestamp: 0,
    usage: {
      input: 2,
      output: 3,
      cacheRead: 4,
      cacheWrite: 5,
      totalTokens: 14,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.25 },
    },
    stopReason: "stop",
  };
}

function fixture(options: { auxiliary?: boolean; omitThinking?: boolean } = {}) {
  const frames: CompatFrame[] = [];
  const frontend = createClaudeCompatFrontend({
    emit: (frame) => {
      frames.push(frame);
    },
    sessionId: () => "frontend-session",
    model: () => "offline-fixture",
    ...options,
  });
  const reply = (text: string) => {
    const message = assistant(text);
    frontend.onEvent({ type: "message_start", message });
    frontend.onEvent({ type: "message_end", message });
  };
  return { frontend, frames, reply };
}

const emptyUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

test("settlement retains one run's accounting, while a new run replaces it and retains session cost", async () => {
  const { frontend, frames, reply } = fixture();
  frontend.consumeUser("first-human");
  frontend.denied("write", { path: "fixture" }, "denied-write");
  reply("first");
  reply("last");
  frontend.notice("command notice");
  frontend.onEvent({ type: "agent_end", messages: [], willRetry: false });
  await frontend.flush();
  expect(frames.filter((frame) => frame.type === "result")).toHaveLength(0);
  expect(frontend.cost()).toBe(0);
  frontend.onEvent({ type: "agent_settled", aborted: false });
  frontend.onEvent({ type: "agent_settled", aborted: false });
  await frontend.flush();
  const first = frames.find((frame) => frame.type === "result")!;
  expect(first).toMatchObject({
    origin: { kind: "human" },
    user_message_uuid: "first-human",
    num_turns: 2,
    result: "last\ncommand notice",
    total_cost_usd: 0.5,
    usage: { input_tokens: 4, output_tokens: 6, cache_read_input_tokens: 8, cache_creation_input_tokens: 10 },
    permission_denials: [{ tool_name: "write", tool_input: { path: "fixture" }, tool_use_id: "denied-write" }],
  });
  expect(frontend.text()).toBe("last\ncommand notice");
  expect(frontend.cost()).toBe(0.5);
  const usageCopy = frontend.usage();
  usageCopy.input_tokens = 999;
  expect(frontend.usage().input_tokens).toBe(4);

  frontend.onEvent({ type: "agent_start" });
  expect(frontend.result()).toMatchObject({
    origin: { kind: "unclassified" },
    num_turns: 0,
    result: "",
    total_cost_usd: 0,
    usage: emptyUsage,
    permission_denials: [],
    is_error: false,
  });
  expect(frontend.result()).not.toHaveProperty("user_message_uuid");
  reply("new run");
  frontend.onEvent({ type: "agent_settled", aborted: false });
  await frontend.flush();
  expect(frontend.cost()).toBe(0.75);
  expect(frames.filter((frame) => frame.type === "result")).toHaveLength(2);
  expect(first).toMatchObject({ result: "last\ncommand notice", total_cost_usd: 0.5, usage: { input_tokens: 4 } });
  expect(frontend.result()).toMatchObject({
    result: "new run",
    num_turns: 1,
    total_cost_usd: 0.25,
    permission_denials: [],
  });
});

test("auxiliary results collect real accounting without publishing root lifecycle or message frames", async () => {
  const { frontend, frames, reply } = fixture({ auxiliary: true });
  expect(frontend.result()).toMatchObject({ duration_ms: 0, usage: emptyUsage, num_turns: 0 });
  reply('{"answer":42}');
  frontend.onEvent({ type: "agent_settled", aborted: false });
  await frontend.flush();
  expect(frames).toEqual([]);
  expect(frontend.result({ answer: 42 })).toMatchObject({
    structured_output: { answer: 42 },
    result: '{"answer":42}',
    num_turns: 1,
    total_cost_usd: 0.25,
    usage: { input_tokens: 2, output_tokens: 3, cache_read_input_tokens: 4, cache_creation_input_tokens: 5 },
  });
  expect(frontend.checkpoint()).toBe(1);
  expect(frontend.cost()).toBe(0.25);
});

for (const omitThinking of [false, true]) {
  test(`stream and assembled reply preserve tool calls and thinking policy (omitThinking=${omitThinking})`, async () => {
    const { frontend, frames } = fixture({ omitThinking });
    frontend.consumeUser("consumed-human");
    const message = assistant("visible");
    message.stopReason = "toolUse";
    const toolCall: ToolCall = { type: "toolCall", id: "tool-id", name: "read", arguments: { path: "fixture" } };
    message.content = [
      { type: "thinking", thinking: "reason", thinkingSignature: "signature" },
      { type: "text", text: "visible" },
      toolCall,
    ];
    const updates: AssistantMessageEvent[] = [
      { type: "thinking_start", contentIndex: 0, partial: message },
      { type: "thinking_delta", contentIndex: 0, delta: "reason", partial: message },
      { type: "thinking_end", contentIndex: 0, content: "reason", partial: message },
      { type: "text_start", contentIndex: 1, partial: message },
      { type: "text_delta", contentIndex: 1, delta: "visible", partial: message },
      { type: "text_end", contentIndex: 1, content: "visible", partial: message },
      { type: "toolcall_start", contentIndex: 2, partial: message },
      { type: "toolcall_delta", contentIndex: 2, delta: '{"path":"fixture"}', partial: message },
      { type: "toolcall_end", contentIndex: 2, toolCall, partial: message },
    ];
    frontend.onEvent({ type: "message_start", message });
    for (const assistantMessageEvent of updates)
      frontend.onEvent({ type: "message_update", message, assistantMessageEvent });
    frontend.onEvent({ type: "message_end", message });
    await frontend.flush();
    const streams = frames.filter((frame) => frame.type === "stream_event");
    expect(streams[0]).toMatchObject({ user_message_uuid: "consumed-human", user_message_uuids: ["consumed-human"] });
    expect(streams.slice(1).every((frame) => !Object.hasOwn(frame, "user_message_uuid"))).toBe(true);
    expect(streams.slice(1).map((frame) => frame.event)).toEqual([
      ...(!omitThinking
        ? [
            { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
            { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "reason" } },
            { type: "content_block_stop", index: 0 },
          ]
        : []),
      { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "visible" } },
      { type: "content_block_stop", index: 1 },
      {
        type: "content_block_start",
        index: 2,
        content_block: { type: "tool_use", id: "tool-id", name: "read", input: {} },
      },
      {
        type: "content_block_delta",
        index: 2,
        delta: { type: "input_json_delta", partial_json: '{"path":"fixture"}' },
      },
      { type: "content_block_stop", index: 2 },
      { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: frontend.usage() },
      { type: "message_stop" },
    ]);
    expect(frames.find((frame) => frame.type === "assistant")).toMatchObject({
      user_message_uuid: "consumed-human",
      message: {
        id: (streams[0].event as { message: { id: string } }).message.id,
        content: [
          ...(!omitThinking ? [{ type: "thinking", thinking: "reason", signature: "signature" }] : []),
          { type: "text", text: "visible" },
          { type: "tool_use", id: "tool-id", name: "read", input: { path: "fixture" } },
        ],
        stop_reason: "tool_use",
        usage: frontend.usage(),
      },
    });
    expect(frames.some((frame) => frame.type === "result")).toBe(false);
  });
}
