import { expect, test } from "bun:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { type CompatFrame, createClaudeCompatFrontend } from "../src/claude-compat/frontend";

function assistant(stopReason: AssistantMessage["stopReason"], errorMessage?: string): AssistantMessage {
  return {
    role: "assistant",
    api: "anthropic-messages",
    provider: "anthropic",
    model: "offline-fixture",
    content:
      stopReason === "toolUse"
        ? [{ type: "toolCall", id: "recovered-tool", name: "read", arguments: { path: "fixture.txt" } }]
        : [{ type: "text", text: "fixture answer" }],
    timestamp: 0,
    usage: {
      input: 2,
      output: 3,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 5,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
  };
}

function fixture() {
  const frames: CompatFrame[] = [];
  const frontend = createClaudeCompatFrontend({
    emit: (frame) => {
      frames.push(frame);
    },
    sessionId: () => "retry-session",
    model: () => "offline-fixture",
  });
  const message = (stopReason: AssistantMessage["stopReason"], errorMessage?: string) => {
    const m = assistant(stopReason, errorMessage);
    frontend.onEvent({ type: "message_start", message: m });
    frontend.onEvent({ type: "message_end", message: m });
  };
  frontend.onEvent({ type: "agent_start" });
  return { frames, frontend, message };
}

async function settle({ frontend, frames }: ReturnType<typeof fixture>) {
  frontend.onEvent({ type: "agent_settled" });
  await frontend.flush();
  expect(frames.filter((frame) => frame.type === "result")).toHaveLength(1);
  return frames.find((frame) => frame.type === "result")!;
}

test("authoritative retry success clears a provider error after a recovered tool call", async () => {
  const f = fixture();
  f.message("error", "socket error");
  expect(f.frontend.error()).toBe("socket error");
  f.frontend.onEvent({ type: "agent_end", messages: [], willRetry: true });
  f.frontend.onEvent({
    type: "auto_retry_start",
    attempt: 1,
    maxAttempts: 3,
    delayMs: 0,
    errorMessage: "socket error",
  });
  f.frontend.onEvent({ type: "agent_start" });
  f.message("toolUse");
  // A successful assistant message alone is not the recovery authority.
  expect(f.frontend.error()).toBe("socket error");
  f.frontend.onEvent({ type: "auto_retry_end", success: true, attempt: 1 });
  expect(f.frontend.error()).toBeUndefined();
  await f.frontend.flush();
  expect(f.frames.some((frame) => frame.type === "result")).toBe(false);
  f.frontend.onEvent({
    type: "message_end",
    message: {
      role: "toolResult",
      toolCallId: "recovered-tool",
      toolName: "read",
      content: [{ type: "text", text: "fixture contents" }],
      isError: false,
      timestamp: 0,
    },
  });
  f.message("stop");
  const result = await settle(f);
  expect(result).toMatchObject({
    subtype: "success",
    is_error: false,
    result: "fixture answer",
    num_turns: 3,
    usage: { input_tokens: 6, output_tokens: 9 },
  });
  expect(result).not.toHaveProperty("errors");
  expect(f.frontend.result()).not.toHaveProperty("errors");
});

test("an exhausted retry keeps the provider error", async () => {
  const f = fixture();
  f.message("error", "socket error");
  f.frontend.onEvent({ type: "auto_retry_end", success: false, attempt: 3, finalError: "socket error" });
  expect(f.frontend.error()).toBe("socket error");
  expect(await settle(f)).toMatchObject({
    subtype: "error_during_execution",
    is_error: true,
    errors: ["socket error"],
  });
});

test("a later successful message without retry confirmation does not erase an error", async () => {
  const f = fixture();
  f.message("error", "socket error");
  f.message("stop");
  expect(f.frontend.error()).toBe("socket error");
  expect(await settle(f)).toMatchObject({ is_error: true, errors: ["socket error"] });
});

test("Pi retry success for an aborted assistant does not turn an abort into success", async () => {
  const f = fixture();
  f.message("error", "socket error");
  f.message("aborted");
  // Pi's success condition is stopReason !== error, which includes aborted.
  f.frontend.onEvent({ type: "auto_retry_end", success: true, attempt: 1 });
  expect(f.frontend.error()).toBe("aborted");
  expect(await settle(f)).toMatchObject({ subtype: "error_during_execution", is_error: true, errors: ["aborted"] });
});

test("interruption wins over provider error and survives retry success", async () => {
  const f = fixture();
  f.frontend.interrupt();
  f.message("error", "socket error");
  f.message("stop");
  f.frontend.onEvent({ type: "auto_retry_end", success: true, attempt: 1 });
  expect(f.frontend.error()).toBe("Interrupted");
  expect(await settle(f)).toMatchObject({ is_error: true, errors: ["Interrupted"] });
});

test("terminal runtime failure wins over provider error and survives retry success", async () => {
  const f = fixture();
  f.frontend.fail(new Error("teardown failed"));
  f.message("error", "socket error");
  f.message("stop");
  f.frontend.onEvent({ type: "auto_retry_end", success: true, attempt: 1 });
  expect(f.frontend.error()).toBe("teardown failed");
  expect(await settle(f)).toMatchObject({ is_error: true, errors: ["teardown failed"] });
});

test("a new root run resets both provider and terminal failures", async () => {
  const f = fixture();
  f.message("error", "socket error");
  f.frontend.fail("runtime failed");
  await settle(f);
  f.frontend.onEvent({ type: "agent_start" });
  expect(f.frontend.error()).toBeUndefined();
  f.message("stop");
  f.frontend.onEvent({ type: "agent_settled" });
  await f.frontend.flush();
  expect(f.frames.filter((frame) => frame.type === "result")).toHaveLength(2);
  expect(f.frames.filter((frame) => frame.type === "result").at(-1)).toMatchObject({
    is_error: false,
    subtype: "success",
  });
});

test("retry success cannot revive a failed output stream", async () => {
  const deliveryError = new Error("delivery failed");
  const frames: CompatFrame[] = [];
  const failures: unknown[] = [];
  const frontend = createClaudeCompatFrontend({
    emit: (frame) => {
      frames.push(frame);
      throw deliveryError;
    },
    onOutputError: (error) => {
      failures.push(error);
    },
    sessionId: () => "delivery-session",
    model: () => "offline-fixture",
  });
  frontend.onEvent({ type: "agent_start" });
  await expect(frontend.flush()).rejects.toBe(deliveryError);
  frontend.onEvent({ type: "message_end", message: assistant("error", "socket error") });
  frontend.onEvent({ type: "message_end", message: assistant("stop") });
  frontend.onEvent({ type: "auto_retry_end", success: true, attempt: 1 });
  frontend.fail(deliveryError);
  frontend.onEvent({ type: "agent_settled" });
  await expect(frontend.flush()).rejects.toBe(deliveryError);
  expect(failures).toEqual([deliveryError]);
  expect(frames).toHaveLength(1);
  expect(frames.some((frame) => frame.type === "result")).toBe(false);
});
