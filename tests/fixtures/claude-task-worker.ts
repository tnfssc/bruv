// Real subprocess + Pi AgentSession/journal; only model transport is deterministic.

import { dirname, join } from "node:path";
import { type AssistantMessage, createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { disposeDiskBackedSessionManager, installDiskBackedSessionManager } from "../../src/history/session-manager";

const [sessionFile, prompt] = process.argv.slice(2);
installDiskBackedSessionManager();
const manager = SessionManager.open(sessionFile);
const agentDir = dirname(sessionFile);
const models = await ModelRuntime.create({
  authPath: join(agentDir, "auth.json"),
  modelsPath: null,
  refreshOnCreate: false,
});
const model = models.getModel("anthropic", "claude-sonnet-4-5")!;
const settings = SettingsManager.inMemory({ cacheWarming: "off" }, { projectTrusted: false });
const loader = new DefaultResourceLoader({
  cwd: process.cwd(),
  agentDir,
  settingsManager: settings,
  noExtensions: true,
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
  noContextFiles: true,
});
await loader.reload();
const { session } = await createAgentSession({
  cwd: process.cwd(),
  agentDir,
  modelRuntime: models,
  model,
  sessionManager: manager,
  settingsManager: settings,
  resourceLoader: loader,
  tools: [],
});
models.streamSimple = () => {
  const stream = createAssistantMessageEventStream();
  setTimeout(() => {
    const message: AssistantMessage = {
      role: "assistant",
      api: "anthropic-messages",
      provider: "anthropic",
      model: model.id,
      content: [{ type: "text", text: "actual worker answer: " + prompt }],
      timestamp: Date.now(),
      usage: {
        input: 11,
        output: 7,
        cacheRead: 3,
        cacheWrite: 2,
        totalTokens: 23,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
    };
    stream.push({ type: "start", partial: message });
    stream.push({ type: "text_start", contentIndex: 0, partial: message });
    stream.push({
      type: "text_delta",
      contentIndex: 0,
      delta: message.content[0].type === "text" ? message.content[0].text : "",
      partial: message,
    });
    stream.push({ type: "text_end", contentIndex: 0, content: "actual worker answer: " + prompt, partial: message });
    stream.push({ type: "done", reason: "stop", message });
  }, 40);
  return stream;
};
// Fail if any path attempts real provider access in this offline fixture.
globalThis.fetch = (() => {
  throw new Error("Offline worker fixture attempted network access");
}) as unknown as typeof fetch;
session.subscribe((event) => console.log(JSON.stringify(event)));
await session.prompt(prompt);
disposeDiskBackedSessionManager(manager);
await session.dispose();
