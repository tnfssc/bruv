import { getModel } from "@earendil-works/pi-ai/compat";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type AssistantMessage,
  type TranscriptContext,
  type Tool,
  getCurrentSystemPrompt,
  getCurrentTools,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { GoalStore } from "./goals/store";
import { bruvSystemPrompt, type MainAgentMode } from "./prompts";
import asynchronousTasksExtension from "./agent/extension";

export const PREVIEW_ROLES = ["root", "fast", "normal", "orchestrator"] as const;
export type PreviewRole = (typeof PREVIEW_ROLES)[number];

export interface PromptPreviewOptions {
  /** Include project context only when a project directory is chosen. */
  project?: string;
  role?: PreviewRole;
  rootMode?: MainAgentMode;
  message?: string;
  /** Add a paused sample goal so the real context hook shows its injected message. */
  goal?: string;
}

export interface PromptPreview {
  preview: {
    context: "isolated" | "selected-project";
    label: string;
    cwd: string;
    transientSession: true;
    included: string[];
    excluded: string[];
    role: PreviewRole;
    rootMode?: MainAgentMode;
    networkRequests: 0;
  };
  model: { provider: string; id: string };
  systemPrompt: string;
  tools: Tool[];
  messages: TranscriptContext["messages"];
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Capture the exact Context at Pi's provider stream boundary. Replace the stream
 * before prompting so this cannot make a model request.
 */
export async function createPromptPreview(options: PromptPreviewOptions = {}): Promise<PromptPreview> {
  const role = options.role ?? "root";
  if (!PREVIEW_ROLES.includes(role)) throw new Error(`Invalid preview role: ${role}`);
  const rootMode = options.rootMode ?? "orchestrator";
  if (!["fast", "normal", "orchestrator"].includes(rootMode)) throw new Error(`Invalid root mode: ${rootMode}`);
  if (role !== "root" && options.rootMode !== undefined) throw new Error("rootMode applies only to the root role");

  const scratch = await mkdtemp(join(tmpdir(), "bruv-prompt-preview-"));
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    const selectedProject = options.project ? resolve(options.project) : undefined;
    const cwd = selectedProject ?? join(scratch, "project");
    if (!selectedProject) await Bun.write(join(cwd, ".keep"), "");
    else if (!(await exists(cwd))) throw new Error(`Selected project does not exist: ${cwd}`);
    const agentDir = join(scratch, "agent");
    await Bun.write(join(agentDir, ".keep"), "");

    const manager = SessionManager.inMemory(cwd);
    if (role === "root") {
      if (rootMode !== "orchestrator") manager.appendCustomEntry("bruv-instruction-mode", { mode: rootMode });
    } else manager.appendCustomEntry("bruv-agent", { type: role, depth: 1 });

    if (options.goal) {
      const goals = new GoalStore((type, data) => manager.appendCustomEntry(type, data));
      goals.set({
        objective: options.goal,
        criteria: ["Preview the injected goal state"],
        constraints: ["Offline preview only"],
      });
      goals.update({ status: "paused", reason: "Representative prompt preview" });
    }

    const projectSystemPath = join(cwd, ".bruv", "SYSTEM.md");
    const projectSystemSelected = !!selectedProject && (await exists(projectSystemPath));
    const selectedSystemPrompt = projectSystemSelected ? await readFile(projectSystemPath, "utf8") : bruvSystemPrompt();
    // Empty in-memory settings prevent project package resolution/configuration
    // from doing work during an otherwise read-only offline preview.
    const settingsManager = SettingsManager.inMemory({}, { projectTrusted: true });
    const appendPath = join(cwd, ".bruv", "APPEND_SYSTEM.md");
    const appendSelected = !!selectedProject && (await exists(appendPath));
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      noContextFiles: !selectedProject,
      appendSystemPrompt: appendSelected ? [appendPath] : [],
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      systemPrompt: selectedSystemPrompt,
      extensionFactories: [{ name: "bruv-tasks", factory: previewTasksExtension(role) }],
    });
    await loader.reload();

    const runtime = await ModelRuntime.create({
      authPath: join(scratch, "auth.json"),
      modelsPath: null,
      refreshOnCreate: false,
    });
    // Authentication preflight is local. The stream replacement below is the
    // hard network boundary and is installed before the first prompt.
    runtime.hasConfiguredAuth = () => true;
    const model = getModel("openai-codex", "gpt-5.6-luna");
    ({ session } = await createAgentSession({
      cwd,
      agentDir,
      resourceLoader: loader,
      settingsManager,
      modelRuntime: runtime,
      model,
      sessionManager: manager,
      tools: ["execute"],
    }));

    const context = await captureOfflineTurn(
      session,
      options.message ?? "Preview this request without sending it to a model.",
    );
    const projectLabel = selectedProject
      ? `Selected external project context: ${cwd}`
      : "Isolated temporary context (default): external project context is excluded";
    return {
      preview: {
        context: selectedProject ? "selected-project" : "isolated",
        label: projectLabel,
        cwd,
        transientSession: true,
        included: [
          projectSystemSelected ? projectSystemPath : "Bruv production system prompt",
          "Pi production system-prompt assembly",
          "Bruv production prompt/context extension hooks",
          ...(selectedProject ? ["project/ancestor AGENTS.md files discovered by Pi"] : []),
          ...(appendSelected ? [appendPath] : []),
          ...(options.goal ? ["representative paused goal state"] : []),
        ],
        excluded: [
          "network/model calls",
          "persistent session state",
          "global and project settings/packages",
          "global agent configuration",
          "saved conversation history and live running jobs",
          "completion/attention events, tool-result handoffs, and compaction requests",
          "project extensions, skills, prompt templates, and themes",
          ...(!selectedProject ? ["all external project files and guidance"] : []),
        ],
        role,
        ...(role === "root" ? { rootMode } : {}),
        networkRequests: 0,
      },
      model: { provider: model.provider, id: model.id },
      systemPrompt: getCurrentSystemPrompt(context.messages),
      tools: getCurrentTools(context.messages),
      messages: context.messages,
    };
  } finally {
    session?.dispose();
    await rm(scratch, { recursive: true, force: true });
  }
}

function previewTasksExtension(role: PreviewRole): typeof asynchronousTasksExtension {
  // The preview role is explicit and must not inherit the caller's own child
  // environment (for example when this script is launched from execute). The
  // production extension reads identity synchronously when its factory runs.
  return (pi, extensionOptions) => {
    const priorDepth = process.env.BRUV_SUBAGENT_DEPTH;
    const priorType = process.env.BRUV_SUBAGENT_TYPE;
    process.env.BRUV_SUBAGENT_DEPTH = role === "root" ? "0" : "1";
    if (role === "root") delete process.env.BRUV_SUBAGENT_TYPE;
    else process.env.BRUV_SUBAGENT_TYPE = role;
    try {
      asynchronousTasksExtension(pi, extensionOptions);
    } finally {
      if (priorDepth === undefined) delete process.env.BRUV_SUBAGENT_DEPTH;
      else process.env.BRUV_SUBAGENT_DEPTH = priorDepth;
      if (priorType === undefined) delete process.env.BRUV_SUBAGENT_TYPE;
      else process.env.BRUV_SUBAGENT_TYPE = priorType;
    }
  };
}

/** Install the network boundary, run production assembly, and require one captured request. */
async function captureOfflineTurn(session: AgentSession, message: string): Promise<TranscriptContext> {
  let captured: TranscriptContext | undefined;
  let streamCalls = 0;
  session.agent.streamFunction = (_model, context) => {
    streamCalls++;
    captured = context;
    const message: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "offline prompt preview captured" }],
      api: "openai-codex-responses",
      provider: "openai-codex",
      model: "gpt-5.6-luna",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "start", partial: message });
    stream.push({ type: "done", reason: "stop", message });
    return stream;
  };

  await session.prompt(message);
  if (!captured || streamCalls !== 1) throw new Error("Prompt preview did not capture exactly one provider context");
  return captured;
}
