import { expect, test } from "bun:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { type CompatFrame, createClaudeCompatFrontend } from "../../src/claude-compat/frontend";
import type { GoalState } from "../../src/goals/types";

/**
 * Independently written protocol oracle, not copied upstream implementation.
 * Observed in unmodified T3 0.0.46-nightly.20261005.2702, source commit
 * cfa4f765ec05950a032b6c1cf9cdfff0c2391545:
 * apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts,
 * nextClaudeGoal, trackClaudeGoal, terminalStatusFromResult, finalizeActiveTurn.
 * The installed t3 bundle retains these source-region names. This models only
 * root goal frames with no background-task roster or authentication failure.
 * Actual host acceptance remains a separate integration test.
 */
function hostGoalProjection() {
  let goal: { objective: string; status: "active" | "complete"; checks: number } | null = null;
  let modelWorked = false;
  const failingReasons = new Set([
    "aborted_tools",
    "aborted_streaming",
    "api_error",
    "malformed_tool_use_exhausted",
    "budget_exhausted",
    "structured_output_retry_exhausted",
    "tool_deferred_unavailable",
    "turn_setup_failed",
    "blocking_limit",
    "rapid_refill_breaker",
    "prompt_too_long",
    "image_error",
    "model_error",
  ]);
  return {
    get: () => (goal ? { ...goal } : null),
    consume(frame: CompatFrame) {
      if (frame.type === "assistant" && frame.parent_tool_use_id === null) {
        const message = frame.message as { model: string; content: { type: string; text?: string }[] };
        if (message.model !== "<synthetic>") {
          if (goal?.status === "active") modelWorked = true;
          return;
        }
        const text = message.content
          .flatMap((part) => (part.type === "text" ? [part.text ?? ""] : []))
          .join("")
          .trim();
        if (text.startsWith("Goal set: ") && text.slice(10).trim()) {
          goal = { objective: text.slice(10).trim(), status: "active", checks: 0 };
        } else if (text.startsWith("Goal cleared: ") || text.startsWith("No goal set")) {
          goal = null;
        } else {
          const active = /^Goal active: ([\s\S]+?) \((?:not yet evaluated|(\d+) turns?)\)/u.exec(text);
          if (active) goal = { objective: active[1], status: "active", checks: Number(active[2] ?? 0) };
        }
      }
      if (frame.type === "result") {
        const completedTurn =
          frame.subtype === "success" &&
          frame.api_error_status !== 429 &&
          frame.api_error_status !== 529 &&
          !failingReasons.has(String(frame.terminal_reason));
        if (
          goal?.status === "active" &&
          modelWorked &&
          completedTurn &&
          (frame.terminal_reason === undefined || frame.terminal_reason === "completed")
        ) {
          goal = { ...goal, status: "complete" };
        }
        modelWorked = false;
      }
    },
  };
}

function savedGoal(status: GoalState["status"] = "active"): GoalState {
  return {
    id: "persistent-goal",
    revision: 1,
    objective: "Finish the verified objective",
    criteria: ["The requested checks pass"],
    constraints: [],
    status,
    tokensUsed: 0,
    createdAt: "2026-10-10T00:00:00.000Z",
    updatedAt: "2026-10-10T00:00:00.000Z",
  };
}

function assistant(text: string, error = false): AssistantMessage {
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
    stopReason: error ? "error" : "stop",
    ...(error ? { errorMessage: "Provider unavailable" } : {}),
  };
}

function fixture(initial: GoalState | undefined = savedGoal()) {
  let state: GoalState | undefined = initial;
  let pendingContinuation = false;
  const frames: CompatFrame[] = [];
  const host = hostGoalProjection();
  const frontend = createClaudeCompatFrontend({
    emit(frame) {
      frames.push(frame);
      host.consume(frame);
    },
    sessionId: () => "goal-wire-session",
    model: () => "offline-fixture",
    goal: () => state,
    continueGoal: () => pendingContinuation,
    initialization: () => ({ model: "offline-fixture", tools: ["execute"] }),
  });
  const reply = (text: string, error = false) => {
    const message = assistant(text, error);
    frontend.onEvent({ type: "message_start", message });
    frontend.onEvent({ type: "message_end", message });
  };
  const settle = async () => {
    frontend.onEvent({ type: "agent_settled", aborted: false });
    await frontend.flush();
  };
  const command = async (text: string, notice: string, change: () => void = () => {}) => {
    frontend.startCommand({ uuid: text, message: { role: "user", content: text } });
    const checkpoint = frontend.checkpoint();
    change();
    frontend.notice(notice);
    frontend.commandHandled(checkpoint);
    await frontend.flush();
  };
  return {
    frames,
    frontend,
    host,
    reply,
    settle,
    command,
    setGoal: (next: GoalState | undefined) => {
      state = next;
    },
    continueGoal: (pending: boolean) => {
      pendingContinuation = pending;
    },
    results: () => frames.filter((frame) => frame.type === "result"),
  };
}

function seedHostGoal(host: ReturnType<typeof hostGoalProjection>, completed: boolean) {
  host.consume({
    type: "assistant",
    parent_tool_use_id: null,
    message: { model: "<synthetic>", content: [{ type: "text", text: `Goal set: ${savedGoal().objective}` }] },
  });
  if (completed) {
    host.consume({
      type: "assistant",
      parent_tool_use_id: null,
      message: { model: "offline-fixture", content: [{ type: "text", text: "Previously completed" }] },
    });
    host.consume({ type: "result", subtype: "success" });
  }
}

test("host goal detection accepts only root synthetic commands and requires real model work to complete", () => {
  const host = hostGoalProjection();
  const marker = (model: string, parent_tool_use_id: string | null = null): CompatFrame => ({
    type: "assistant",
    parent_tool_use_id,
    message: { model, content: [{ type: "text", text: "Goal set: Finish the objective" }] },
  });
  host.consume(marker("real-model"));
  host.consume(marker("<synthetic>", "child-tool"));
  expect(host.get()).toBeNull();
  host.consume(marker("<synthetic>"));
  host.consume({ type: "result", subtype: "success" });
  expect(host.get()).toMatchObject({ status: "active" });
  host.consume(marker("real-model"));
  host.consume({ type: "result", subtype: "success", terminal_reason: "hook_stopped" });
  expect(host.get()).toMatchObject({ status: "active" });
  host.consume(marker("real-model"));
  host.consume({ type: "result", subtype: "success" });
  expect(host.get()).toMatchObject({ status: "complete" });
});

test("a suspended active goal retains native state across unrelated settled responses", async () => {
  const h = fixture();
  for (let turn = 0; turn < 3; turn++) {
    h.frontend.onEvent({ type: "agent_start" });
    h.reply(`Checked work ${turn}; more remains`);
    await h.settle();
    expect(h.host.get()).toMatchObject({ objective: savedGoal().objective, status: "active" });
    expect(h.results().at(-1)).toMatchObject({
      subtype: "success",
      is_error: false,
      terminal_reason: "stop_hook_prevented",
      num_turns: 1,
      total_cost_usd: 0.25,
      usage: { input_tokens: 2, output_tokens: 3, cache_read_input_tokens: 4, cache_creation_input_tokens: 5 },
    });
  }
  const markers = h.frames.filter(
    (frame) => frame.type === "assistant" && (frame.message as { model: string }).model === "<synthetic>",
  );
  expect(markers).toHaveLength(1);
  expect(markers[0]).toMatchObject({
    parent_tool_use_id: null,
    message: { content: [{ type: "text", text: `Goal set: ${savedGoal().objective}` }] },
  });
});

for (const status of ["completed", "paused", "budget_exceeded"] as const) {
  test(`queued goal continuations hold one native run until ${status} with exact aggregate usage`, async () => {
    const h = fixture();
    h.frontend.consumeUser("goal-request");
    for (let turn = 0; turn < 3; turn++) {
      h.frontend.onEvent({ type: "agent_start" });
      h.reply(`Verified work ${turn + 1}`);
      if (turn < 2) {
        h.continueGoal(true);
      } else {
        h.continueGoal(false);
        h.setGoal({ ...savedGoal(status), tokensUsed: 42 });
      }
      await h.settle();
      if (turn < 2) {
        expect(h.frontend.isRunning()).toBe(true);
        expect(h.results()).toHaveLength(0);
        expect(h.frames.filter((frame) => frame.type === "system" && frame.state === "idle")).toHaveLength(0);
        expect(h.host.get()).toMatchObject({ status: "active" });

        const checkpoint = h.frontend.checkpoint();
        const response = h.frontend.commandResponse({
          uuid: `inspect-${turn}`,
          message: { role: "user", content: "/goal status" },
        });
        response.notice("Goal remains active with more work queued");
        response.complete();
        await h.frontend.flush();
        expect(h.frontend.isRunning()).toBe(true);
        expect(h.frontend.checkpoint()).toBe(checkpoint);
        expect(h.results()).toHaveLength(0);
        expect(h.frames.at(-1)).toMatchObject({
          type: "command_lifecycle",
          command_uuid: `inspect-${turn}`,
          state: "completed",
        });
      }
    }
    expect(h.frontend.isRunning()).toBe(false);
    expect(h.results()).toHaveLength(1);
    expect(h.results()[0]).toMatchObject({
      subtype: "success",
      is_error: false,
      num_turns: 3,
      result: "Verified work 3",
      total_cost_usd: 0.75,
      usage: { input_tokens: 6, output_tokens: 9, cache_read_input_tokens: 12, cache_creation_input_tokens: 15 },
      user_message_uuid: "goal-request",
      origin: { kind: "human" },
    });
    expect(h.results()[0].terminal_reason).toBe(status === "completed" ? undefined : "hook_stopped");
    expect(h.frontend.cost()).toBe(0.75);
    expect(h.host.get()).toMatchObject({ status: status === "completed" ? "complete" : "active" });
    expect(h.frames.filter((frame) => frame.type === "system" && frame.subtype === "init")).toHaveLength(1);
    expect(h.frames.filter((frame) => frame.type === "system" && frame.state === "running")).toHaveLength(1);
    expect(h.frames.filter((frame) => frame.type === "system" && frame.state === "idle")).toHaveLength(1);
    const modelReplies = h.frames.filter(
      (frame) => frame.type === "assistant" && (frame.message as { model: string }).model === "offline-fixture",
    );
    expect(modelReplies).toHaveLength(3);
    h.frontend.settle();
    await h.frontend.flush();
    expect(h.results()).toHaveLength(1);
  });
}

test("the initial goal command stays owned until its queued model work actually settles", async () => {
  const h = fixture();
  h.setGoal(undefined);
  h.frontend.startCommand({ uuid: "set-goal", message: { role: "user", content: "/goal Verify the objective" } });
  const checkpoint = h.frontend.checkpoint();
  h.setGoal(savedGoal());
  h.continueGoal(true);
  h.frontend.notice("Goal set and pursuit queued");
  h.frontend.commandHandled(checkpoint);
  await h.frontend.flush();
  expect(h.frontend.isRunning()).toBe(true);
  expect(h.results()).toHaveLength(0);
  expect(h.host.get()).toMatchObject({ status: "active" });
  expect(h.frames.filter((frame) => frame.type === "command_lifecycle" && frame.state === "completed")).toHaveLength(0);

  h.frontend.onEvent({ type: "agent_start" });
  h.reply("Completed the requested verification");
  h.setGoal({ ...savedGoal("completed"), evidence: "Verification passed" });
  h.continueGoal(false);
  await h.settle();
  expect(h.host.get()).toMatchObject({ status: "complete" });
  expect(h.results()).toHaveLength(1);
  expect(h.results()[0]).toMatchObject({ user_message_uuid: "set-goal", num_turns: 1, total_cost_usd: 0.25 });
  expect(h.frames.filter((frame) => frame.type === "system" && frame.subtype === "init")).toHaveLength(1);
  expect(h.frames.filter((frame) => frame.type === "command_lifecycle" && frame.state === "completed")).toMatchObject([
    { command_uuid: "set-goal" },
  ]);
});

test("Stop during the gap between goal requests settles the held native run exactly once", async () => {
  const h = fixture();
  h.reply("First check finished; next check is queued");
  h.continueGoal(true);
  await h.settle();
  expect(h.frontend.isRunning()).toBe(true);
  h.continueGoal(false);
  h.setGoal(savedGoal("paused"));
  h.frontend.interrupt();
  h.frontend.settle();
  h.frontend.settle();
  await h.frontend.flush();
  expect(h.frontend.isRunning()).toBe(false);
  expect(h.results()).toHaveLength(1);
  expect(h.results()[0]).toMatchObject({
    subtype: "error_during_execution",
    is_error: true,
    errors: ["Interrupted"],
    num_turns: 1,
    total_cost_usd: 0.25,
  });
  expect(h.host.get()).toMatchObject({ status: "active" });
  expect(h.frames.filter((frame) => frame.type === "system" && frame.state === "idle")).toHaveLength(1);
});

test("a goal created by execute is projected before the following completion reply", async () => {
  const h = fixture();
  h.setGoal(undefined);
  h.reply("I will create the explicitly requested persistent goal");
  h.setGoal(savedGoal());
  h.frontend.onEvent({
    type: "message_end",
    message: {
      role: "toolResult",
      toolCallId: "create-goal",
      toolName: "execute",
      content: [{ type: "text", text: "Goal created" }],
      isError: false,
      timestamp: 1,
    },
  });
  await h.frontend.flush();
  expect(h.host.get()).toMatchObject({ status: "active" });
  h.setGoal({ ...savedGoal("completed"), evidence: "Verified the objective" });
  h.reply("The objective is now complete");
  await h.settle();
  expect(h.host.get()).toMatchObject({ status: "complete" });
});

test("queued result delivery uses goal state at settlement rather than a later goal mutation", async () => {
  const h = fixture();
  h.reply("More work remains after this turn");
  h.frontend.onEvent({ type: "agent_settled", aborted: false });
  h.setGoal({ ...savedGoal("completed"), evidence: "Verified during the later turn" });
  await h.frontend.flush();
  expect(h.results().at(-1)).toMatchObject({ terminal_reason: "stop_hook_prevented" });
  expect(h.host.get()).toMatchObject({ status: "active" });
  h.reply("The later turn finished the objective");
  await h.settle();
  expect(h.results().at(-1)?.terminal_reason).toBeUndefined();
  expect(h.host.get()).toMatchObject({ status: "complete" });
});

test("pause survives an unrelated answer, then resume allows only verified completion", async () => {
  const h = fixture();
  h.reply("Working on the objective");
  await h.settle();
  h.setGoal(savedGoal("paused"));
  await h.command("/goal pause", "Goal paused by the user");
  expect(h.results().at(-1)).toMatchObject({ terminal_reason: "hook_stopped" });
  h.frontend.consumeUser("unrelated-question");
  h.reply("The answer to the unrelated question");
  await h.settle();
  expect(h.results().at(-1)).toMatchObject({ terminal_reason: "hook_stopped" });
  expect(h.host.get()).toMatchObject({ status: "active" });

  h.setGoal(savedGoal());
  await h.command("/goal resume", "Goal pursuit resumed");
  expect(h.results().at(-1)).toMatchObject({ terminal_reason: "stop_hook_prevented" });
  h.setGoal({ ...savedGoal("completed"), evidence: "All requested checks passed" });
  h.reply("Verified the result and completed the objective");
  await h.settle();
  expect(h.results().at(-1)).toMatchObject({ subtype: "success", is_error: false });
  expect(h.results().at(-1)?.terminal_reason).toBeUndefined();
  expect(h.host.get()).toMatchObject({ status: "complete" });
  await h.command("/goal status", "Goal completed; all checks passed");
  expect(h.host.get()).toMatchObject({ status: "complete" });
});

for (const status of ["waiting", "blocked", "budget_exceeded"] as const) {
  test(`${status} stops pursuit without falsely completing the native goal`, async () => {
    const h = fixture();
    h.reply("Work remains");
    h.setGoal(savedGoal(status));
    await h.settle();
    expect(h.results().at(-1)).toMatchObject({ terminal_reason: "hook_stopped", is_error: false });
    expect(h.host.get()).toMatchObject({ status: "active" });
  });
}

test("real provider failures remain errors while an unfinished goal is projected", async () => {
  const h = fixture();
  h.reply("", true);
  await h.settle();
  expect(h.results().at(-1)).toMatchObject({
    subtype: "error_during_execution",
    is_error: true,
    errors: ["Provider unavailable"],
  });
  expect(h.results().at(-1)?.terminal_reason).toBeUndefined();
  expect(h.host.get()).toMatchObject({ status: "active" });
});

test("explicit clear removes the native indicator and later status never recreates it", async () => {
  const h = fixture();
  await h.command("/goal status", "Goal is set");
  expect(h.host.get()).toMatchObject({ status: "active" });
  h.setGoal(undefined);
  await h.command("/goal clear", "No goal is set.");
  expect(h.host.get()).toBeNull();
  await h.command("/goal status", "No goal is set.");
  expect(h.host.get()).toBeNull();
  expect(
    h.frames.filter(
      (frame) =>
        frame.type === "assistant" &&
        (frame.message as { content: { text: string }[] }).content[0]?.text.startsWith("Goal cleared: "),
    ),
  ).toHaveLength(1);
});

test("restored completed goals and synthetic command responses never reactivate goal pursuit", async () => {
  const h = fixture({ ...savedGoal("completed"), evidence: "Previously verified" });
  await h.command("/goal status", "Goal completed previously");
  expect(h.host.get()).toBeNull();
  const response = h.frontend.commandResponse({ uuid: "busy-status", message: { role: "user", content: "/status" } });
  response.notice("Saved goal completed");
  response.complete();
  await h.frontend.flush();
  expect(h.host.get()).toBeNull();
  const notices = h.frames.filter((frame) => frame.type === "assistant");
  expect(notices.length).toBeGreaterThan(0);
  for (const notice of notices) expect(notice.message).toMatchObject({ model: "<synthetic>" });
});

test("resuming a completed goal with the same ID reactivates its existing native indicator", async () => {
  const h = fixture();
  h.reply("Verified all completion criteria");
  h.setGoal({ ...savedGoal("completed"), evidence: "Verified completion" });
  await h.settle();
  expect(h.host.get()).toMatchObject({ status: "complete" });

  await h.command("/goal resume", "Goal resumed by user", () => h.setGoal(savedGoal()));
  expect(h.host.get()).toMatchObject({ objective: savedGoal().objective, status: "active" });
  expect(h.results().at(-1)).toMatchObject({ terminal_reason: "stop_hook_prevented" });
  h.reply("Completed the additional requested checks");
  h.setGoal({ ...savedGoal("completed"), evidence: "Additional checks verified" });
  await h.settle();
  expect(h.host.get()).toMatchObject({ status: "complete" });
});

for (const status of ["paused", "completed"] as const) {
  test(`the first clear command after restart removes a previously projected ${status} goal`, async () => {
    const h = fixture(savedGoal(status));
    seedHostGoal(h.host, status === "completed");
    expect(h.host.get()).not.toBeNull();
    await h.command("/goal clear", "No goal is set.", () => h.setGoal(undefined));
    expect(h.host.get()).toBeNull();
    const clearIndex = h.frames.findIndex(
      (frame) =>
        frame.type === "assistant" &&
        (frame.message as { content: { text: string }[] }).content[0]?.text.startsWith("Goal cleared: "),
    );
    const echoIndex = h.frames.findIndex((frame) => frame.type === "user" && frame.uuid === "/goal clear");
    expect(echoIndex).toBeGreaterThanOrEqual(0);
    expect(clearIndex).toBeGreaterThan(echoIndex);
    expect(h.results().at(-1)?.terminal_reason).toBeUndefined();
  });
}

test("restored completed status inspection preserves completion before a later explicit clear", async () => {
  const h = fixture({ ...savedGoal("completed"), evidence: "Previously verified" });
  seedHostGoal(h.host, true);
  await h.command("/goal status", "Goal completed previously");
  expect(h.host.get()).toMatchObject({ status: "complete" });
  expect(
    h.frames.some(
      (frame) =>
        frame.type === "assistant" &&
        (frame.message as { content: { text: string }[] }).content[0]?.text.startsWith("Goal set: "),
    ),
  ).toBe(false);
  await h.command("/goal clear", "No goal is set.", () => h.setGoal(undefined));
  expect(h.host.get()).toBeNull();
});
