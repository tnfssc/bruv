import { getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AssistantMessage, createAssistantMessageEventStream, getModel } from "@earendil-works/pi-ai/compat";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { bruvSystemPrompt } from "../src/prompts";
import tasks from "../src/agent/extension";

const COLLISION = "<!-- bruv:main-agent-mode:start -->\nMARKER_EXAMPLE\n<!-- bruv:main-agent-mode:end -->";
const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const cleanup: Array<() => void | Promise<void>> = [];
const originalDepth = process.env.BRUV_SUBAGENT_DEPTH,
  originalType = process.env.BRUV_SUBAGENT_TYPE;
beforeEach(() => {
  process.env.BRUV_SUBAGENT_DEPTH = "0";
  delete process.env.BRUV_SUBAGENT_TYPE;
});
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
  if (originalDepth === undefined) delete process.env.BRUV_SUBAGENT_DEPTH;
  else process.env.BRUV_SUBAGENT_DEPTH = originalDepth;
  if (originalType === undefined) delete process.env.BRUV_SUBAGENT_TYPE;
  else process.env.BRUV_SUBAGENT_TYPE = originalType;
});

async function sdk(
  options: {
    customPrompt?: string;
    projectMarker?: boolean;
    entries?: Array<[string, unknown]>;
    wisdomDir?: string;
  } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), "bruv-main-mode-sdk-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  // This fixture is its own project even when TMPDIR sits inside a checkout.
  await mkdir(join(dir, ".bruv"));
  await writeFile(join(dir, ".bruv", "settings.json"), JSON.stringify({ wisdomDir: options.wisdomDir }));
  if (options.projectMarker) await writeFile(join(dir, "AGENTS.md"), "PROJECT_MARKER\n" + COLLISION);
  let manager = options.entries?.length
    ? SessionManager.create(dir, join(dir, "sessions"))
    : SessionManager.inMemory(dir);
  if (options.entries?.length) {
    await writeFile(manager.getSessionFile()!, JSON.stringify(manager.getHeader()) + "\n", { flag: "wx" });
    manager = SessionManager.open(manager.getSessionFile()!);
    for (const [type, data] of options.entries) manager.appendCustomEntry(type, data);
    manager = SessionManager.open(manager.getSessionFile()!);
  }
  let frameCalls = 0;
  const loader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: dir,
    noExtensions: true,
    noSkills: true,
    noThemes: true,
    noPromptTemplates: true,
    systemPrompt: options.customPrompt ?? bruvSystemPrompt(),
    extensionFactories: [
      {
        name: "frame-before",
        factory: (pi) =>
          pi.on("before_agent_start", (event) => {
            frameCalls++;
            return { systemPrompt: event.systemPrompt + "\nFRAME_BEFORE\n" + COLLISION };
          }),
      },
      { name: "bruv-tasks", factory: tasks },
      {
        name: "frame-after",
        factory: (pi) =>
          pi.on("before_agent_start", (event) => ({
            systemPrompt: event.systemPrompt + "\nFRAME_AFTER\n" + COLLISION,
          })),
      },
    ],
  });
  await loader.reload();
  const runtime = await ModelRuntime.create({
    authPath: join(dir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  runtime.hasConfiguredAuth = () => true;
  const created = await createAgentSession({
    cwd: dir,
    agentDir: dir,
    resourceLoader: loader,
    modelRuntime: runtime,
    model: getModel("openai-codex", "gpt-5.6-luna"),
    sessionManager: manager,
    tools: ["execute"],
  });
  const session = created.session;
  cleanup.push(() => session.dispose());
  const requests: string[] = [];
  session.agent.streamFunction = (_model, context) => {
    requests.push(getCurrentSystemPrompt(context.messages));
    const message: AssistantMessage = {
      role: "assistant",
      api: "openai-codex-responses",
      provider: "openai-codex",
      model: "gpt-5.6-luna",
      timestamp: Date.now(),
      stopReason: "stop",
      usage,
      content: [{ type: "text", text: "done" }],
    };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "start", partial: message });
    stream.push({ type: "done", reason: "stop", message });
    return stream;
  };
  return { session, requests, frameCalls: () => frameCalls, manager };
}

test("real SDK defaults main frame to orchestrator and switches to a prose-free fast mode without model/thinking mutation", async () => {
  const f = await sdk();
  await f.session.prompt("first");
  expect(f.requests[0]).toContain("Delegating independent code or PR work? Give it a worktree.");
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
  expect(f.requests[1]).not.toContain("Delegating independent code or PR work? Give it a worktree.");
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
  expect(f.requests[0]).not.toContain("Delegating independent code or PR work? Give it a worktree.");
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
  expect(f.requests[0]).not.toContain("Delegating independent code or PR work? Give it a worktree.");
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
  expect(f.requests[0]).not.toContain("Delegating independent code or PR work? Give it a worktree.");
});

test("real SDK injects the project's configured wisdom and values paths", async () => {
  const f = await sdk({ wisdomDir: "docs/agent-notes" });
  await f.session.prompt("configured wisdom");
  const directory = join(f.manager.getCwd(), "docs", "agent-notes");
  expect(f.requests[0]).toContain(`Project wisdom lives in ${directory}/.`);
  expect(f.requests[0]).toContain(`Values live in ${join(directory, "values.md")}.`);
  expect(f.requests[0]).not.toContain("{{wisdomDir}}");
});
