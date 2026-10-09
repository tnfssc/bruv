import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { COLLISION, disposeModeSessions, sdk } from "./helpers/main-agent-mode-sdk";

// Process-wide identity changes are confined to the isolated SDK child.
beforeEach(() => {
  process.env.BRUV_SUBAGENT_DEPTH = "0";
  delete process.env.BRUV_SUBAGENT_TYPE;
});
afterEach(disposeModeSessions);
afterAll(() => console.log("main-agent-mode-sdk: complete"));

test("real SDK defaults main frame to orchestrator and switches to a prose-free fast mode without model/thinking mutation", async () => {
  const f = await sdk();
  await f.session.prompt("first");
  expect(f.requests[0]).toContain("Shared work is simpler in one place. Extra worktrees bring extra care.");
  expect(f.requests[0]).not.toContain("Available tools:");
  expect(f.requests[0]).not.toContain("In addition to the tools above");
  expect(f.requests[0]).toContain("shell 3 seconds");
  expect(f.requests[0]).toContain("<cwd>\n" + f.manager.getCwd() + "\n</cwd>");
  expect(f.requests[0]).toContain(`Project wisdom lives in ${join(f.manager.getCwd(), "wisdom")}/.`);
  expect(f.requests[0]).toContain(`Values live in ${join(f.manager.getCwd(), "wisdom", "values.md")}.`);
  expect(f.requests[0]).toContain("Before big work ends or changes hands");
  expect(f.requests[0]).not.toContain("Pi documentation (read only");
  expect(f.requests[0]).toContain("FRAME_BEFORE");
  expect(f.requests[0]).toContain("FRAME_AFTER");
  const model = f.session.model,
    thinking = f.session.thinkingLevel;
  await f.session.prompt("/mode fast");
  expect(f.requests).toHaveLength(1);
  expect(f.session.model).toBe(model);
  expect(f.session.thinkingLevel).toBe(thinking);
  await f.session.sendCustomMessage(
    { customType: "test-notification", content: "automatic", display: true },
    { triggerTurn: true },
  );
  expect(f.requests).toHaveLength(2);
  expect(f.requests[1]).not.toContain("main agent in fast instruction mode");
  expect(f.requests[1]).not.toContain("You build and fix code.");
  expect(f.requests[1]).not.toContain("Shared work is simpler in one place. Extra worktrees bring extra care.");
  expect(f.requests[1]).toContain("FRAME_BEFORE");
  expect(f.requests[1]).toContain("FRAME_AFTER");
  expect(f.requests[1].split("MARKER_EXAMPLE")).toHaveLength(3);
  expect(f.frameCalls()).toBe(1);
});

test("real SDK preserves an explicit custom prompt containing marker examples across /mode", async () => {
  const f = await sdk({ customPrompt: "EXPLICIT_CUSTOM_SYSTEM\n" + COLLISION });
  await f.session.prompt("custom");
  await f.session.prompt("/mode fast");
  await f.session.sendCustomMessage(
    { customType: "test-notification", content: "automatic", display: true },
    { triggerTurn: true },
  );
  expect(f.requests).toHaveLength(2);
  for (const request of f.requests) {
    expect(request).toContain("EXPLICIT_CUSTOM_SYSTEM");
    expect(request).toContain("MARKER_EXAMPLE");
    expect(request).not.toContain("main agent in");
    expect(request).not.toContain("Working together");
  }
});

test("real SDK restores root instruction mode from durable session history", async () => {
  const f = await sdk({ entries: [["bruv-instruction-mode", { mode: "normal" }]] });
  await f.session.prompt("resumed");
  expect(f.requests[0]).not.toContain("You build and fix code.");
  expect(f.requests[0]).not.toContain("Shared work is simpler in one place. Extra worktrees bring extra care.");
});

test("real SDK child identity and delegation depth ignore inherited root mode", async () => {
  const f = await sdk({
    entries: [
      ["bruv-instruction-mode", { mode: "fast" }],
      ["bruv-agent", { type: "normal", depth: 2 }],
    ],
  });
  await f.session.prompt("child");
  expect(f.requests[0]).toContain("You are a normal sub-agent");
  expect(f.requests[0]).not.toContain("Delegation is disabled at this role/depth");
  expect(f.requests[0]).not.toContain("main agent in fast instruction mode");
  await f.session.prompt("/mode fast");
  expect(f.requests).toHaveLength(1);
});

test("/mode before the first ordinary SDK request controls its startup frame", async () => {
  const f = await sdk();
  await f.session.prompt("/mode normal");
  expect(f.requests).toHaveLength(0);
  await f.session.prompt("first ordinary request");
  expect(f.requests).toHaveLength(1);
  expect(f.requests[0]).not.toContain("You build and fix code.");
  expect(f.requests[0]).not.toContain("Shared work is simpler in one place. Extra worktrees bring extra care.");
});

test("project marker examples and later hook framing survive mode replacement", async () => {
  const f = await sdk({ projectMarker: true });
  await f.session.prompt("first");
  await f.session.prompt("/mode fast");
  await f.session.sendCustomMessage(
    { customType: "test-notification", content: "automatic", display: true },
    { triggerTurn: true },
  );
  expect(f.requests[1]).toContain("PROJECT_MARKER");
  expect(f.requests[1]).toContain("FRAME_AFTER");
  expect(f.requests[1].split("MARKER_EXAMPLE").length).toBeGreaterThanOrEqual(3);
  expect(f.requests[1]).not.toContain("main agent in fast instruction mode");
});

test("/mode before the first request overrides a mode restored by a real resume", async () => {
  const f = await sdk({ entries: [["bruv-instruction-mode", { mode: "normal" }]] });
  await f.session.prompt("/mode fast");
  expect(f.requests).toHaveLength(0);
  await f.session.prompt("first resumed request");
  expect(f.requests[0]).not.toContain("main agent in fast instruction mode");
  expect(f.requests[0]).not.toContain("You build and fix code.");
  expect(f.requests[0]).not.toContain("Shared work is simpler in one place. Extra worktrees bring extra care.");
});

test("real SDK injects the project's configured wisdom and values paths", async () => {
  const f = await sdk({ wisdomDir: "docs/agent-notes" });
  await f.session.prompt("configured wisdom");
  const directory = join(f.manager.getCwd(), "docs", "agent-notes");
  expect(f.requests[0]).toContain(`Project wisdom lives in ${directory}/.`);
  expect(f.requests[0]).toContain(`Values live in ${join(directory, "values.md")}.`);
  expect(f.requests[0]).not.toContain("{{wisdomDir}}");
});
