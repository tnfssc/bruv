import { getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AssistantMessage, createAssistantMessageEventStream, getModel } from "@earendil-works/pi-ai/compat";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { bruvSystemPrompt } from "../../../src/prompts";
import tasks from "../../../src/agent/extension";

export const COLLISION = "<!-- bruv:main-agent-mode:start -->\nMARKER_EXAMPLE\n<!-- bruv:main-agent-mode:end -->";
const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
// Sessions are closed after each scenario; owned fixture files remain for inspection.
const sessions: Array<{ dispose(): void | Promise<void> }> = [];
export async function disposeModeSessions() {
  while (sessions.length) await sessions.pop()!.dispose();
}

// Reopen twice so startup hooks observe durable entries, not just appended in-memory state.
async function sessionHistory(dir: string, entries?: Array<[string, unknown]>) {
  let manager = entries?.length ? SessionManager.create(dir, join(dir, "sessions")) : SessionManager.inMemory(dir);
  if (entries?.length) {
    await writeFile(manager.getSessionFile()!, JSON.stringify(manager.getHeader()) + "\n", { flag: "wx" });
    manager = SessionManager.open(manager.getSessionFile()!);
    for (const [type, data] of entries) manager.appendCustomEntry(type, data);
    manager = SessionManager.open(manager.getSessionFile()!);
  }
  return manager;
}

export async function sdk(
  options: {
    customPrompt?: string;
    projectMarker?: boolean;
    entries?: Array<[string, unknown]>;
    wisdomDir?: string;
  } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), "bruv-main-mode-sdk-"));
  // This fixture is its own project even when TMPDIR sits inside a checkout.
  await mkdir(join(dir, ".bruv"));
  await writeFile(join(dir, ".bruv", "settings.json"), JSON.stringify({ wisdomDir: options.wisdomDir }));
  if (options.projectMarker) await writeFile(join(dir, "AGENTS.md"), "PROJECT_MARKER\n" + COLLISION);
  const manager = await sessionHistory(dir, options.entries);
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
  sessions.push(session);
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
