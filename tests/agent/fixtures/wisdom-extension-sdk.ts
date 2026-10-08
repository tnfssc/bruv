import { getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream, getModel, type AssistantMessage } from "@earendil-works/pi-ai/compat";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import tasks from "../../../src/agent/extension";
import { bruvSystemPrompt } from "../../../src/prompts";

const [cwd, firstEffect] = process.argv.slice(2);
if (!cwd || (firstEffect !== "prompt" && firstEffect !== "command"))
  throw new Error("Expected project directory and first effect");
const agentDir = process.env.PI_CODING_AGENT_DIR;
if (!agentDir) throw new Error("Expected owned SDK directory");

// Use the shipped factory and SDK dispatch, not a fixture that overwrites each
// hook's result: SDK prompt contributions accumulate in registration order.
const loader = new DefaultResourceLoader({
  cwd,
  agentDir,
  noExtensions: true,
  noSkills: true,
  noThemes: true,
  noPromptTemplates: true,
  systemPrompt: bruvSystemPrompt(),
  extensionFactories: [{ name: "bruv-tools", factory: tasks }],
});
await loader.reload();
const runtime = await ModelRuntime.create({
  authPath: join(agentDir, "auth.json"),
  modelsPath: null,
  refreshOnCreate: false,
});
runtime.hasConfiguredAuth = () => true;
const sessionManager = SessionManager.inMemory(cwd);
const { session } = await createAgentSession({
  cwd,
  agentDir,
  resourceLoader: loader,
  modelRuntime: runtime,
  model: getModel("openai-codex", "gpt-5.6-luna"),
  sessionManager,
  tools: ["execute"],
});
const prompts: string[] = [];
const notices: Array<{ message: string; severity?: string }> = [];
session.agent.streamFunction = (_model, context) => {
  prompts.push(getCurrentSystemPrompt(context.messages));
  const message: AssistantMessage = {
    role: "assistant",
    api: "openai-codex-responses",
    provider: "openai-codex",
    model: "gpt-5.6-luna",
    timestamp: Date.now(),
    stopReason: "stop",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    content: [{ type: "text", text: "done" }],
  };
  const stream = createAssistantMessageEventStream();
  stream.push({ type: "done", reason: "stop", message });
  stream.end(message);
  return stream;
};
try {
  await session.bindExtensions({
    mode: "print",
    uiContext: {
      ...session.extensionRunner.createContext().ui,
      notify: (message, severity) => {
        notices.push({ message, severity });
      },
    },
  });
  // session_start saw root; resumed identity is attached before the first effect.
  sessionManager.appendCustomEntry("bruv-agent", { type: "normal", depth: 1 });
  if (firstEffect === "command") await session.prompt("/wisdom");
  const commandPromptCount = prompts.length;
  await session.prompt("first child turn");
  await session.prompt("second child turn");
  console.log("WISDOM_SDK_RESULT " + JSON.stringify({ prompts, notices, commandPromptCount }));
} finally {
  try {
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
  } finally {
    session.dispose();
  }
}
