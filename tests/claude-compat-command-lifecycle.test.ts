import { expect, test } from "bun:test";
import { createClaudeCompatFrontend, type CompatFrame } from "../src/claude-compat/frontend";

function fixture() {
  const frames: CompatFrame[] = [];
  const frontend = createClaudeCompatFrontend({
    emit: (frame) => {
      frames.push(frame);
    },
    sessionId: () => "native-session",
    model: () => "offline-fixture",
  });
  return { frames, frontend };
}

test("command completion is exactly once, after real session settlement when a command resumes Pi", async () => {
  const { frames, frontend } = fixture();
  frontend.startCommand({
    uuid: "resume-command",
    message: { role: "user", content: "/bruv questions resume fixture" },
  });
  const checkpoint = frontend.checkpoint();
  frontend.onEvent({ type: "agent_start" });
  await frontend.flush();
  expect(frames.filter((f) => f.type === "command_lifecycle").map((f) => f.state)).toEqual(["started"]);
  expect(frames.filter((f) => f.type === "result")).toHaveLength(0);
  frontend.onEvent({ type: "agent_settled" });
  frontend.commandHandled(checkpoint);
  await frontend.flush();
  expect(frames.filter((f) => f.type === "result")).toHaveLength(1);
  expect(frames.filter((f) => f.type === "command_lifecycle")).toMatchObject([
    { command_uuid: "resume-command", state: "started" },
    { command_uuid: "resume-command", state: "completed" },
  ]);
  // A later autonomous epoch has no command admission metadata.
  frontend.onEvent({ type: "agent_start" });
  frontend.onEvent({ type: "agent_settled" });
  await frontend.flush();
  expect(frames.filter((f) => f.type === "command_lifecycle")).toHaveLength(2);
  expect(frames.filter((f) => f.type === "result").at(-1)).toMatchObject({ origin: { kind: "auto-continuation" } });
});

test("a stopped dispatched human command has cancelled fate without inventing model work", async () => {
  const { frames, frontend } = fixture();
  frontend.startCommand({ uuid: "open-question", message: { role: "user", content: "/bruv questions open fixture" } });
  frontend.interrupt();
  frontend.commandHandled(frontend.checkpoint());
  await frontend.flush();
  expect(frames.filter((f) => f.type === "command_lifecycle").map((f) => f.state)).toEqual(["started", "cancelled"]);
  expect(frames.find((f) => f.type === "result")).toMatchObject({
    user_message_uuid: "open-question",
    origin: { kind: "human" },
    is_error: true,
    num_turns: 0,
    total_cost_usd: 0,
    usage: { input_tokens: 0, output_tokens: 0 },
  });
});
