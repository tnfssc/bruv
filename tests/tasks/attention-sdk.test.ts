import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createAssistantMessageEventStream, getModel, type AssistantMessage } from "@earendil-works/pi-ai/compat";
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import tasks from "../../src/agent/extension";
import { TaskManager } from "../../src/tasks/task-manager";

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function observeTaskManagerWaits() {
  const originalSubscribe = TaskManager.prototype.subscribe;
  const originalWait = TaskManager.prototype.wait;
  const counts = { activeSubscriptions: 0, maxSubscriptions: 0, subscriptionCalls: 0, waitCalls: 0 };
  TaskManager.prototype.subscribe = function (listener) {
    counts.subscriptionCalls++;
    counts.activeSubscriptions++;
    counts.maxSubscriptions = Math.max(counts.maxSubscriptions, counts.activeSubscriptions);
    const unsubscribe = originalSubscribe.call(this, listener);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      counts.activeSubscriptions--;
      unsubscribe();
    };
  };
  TaskManager.prototype.wait = function (id) {
    counts.waitCalls++;
    return originalWait.call(this, id);
  };
  return {
    counts,
    restore() {
      TaskManager.prototype.subscribe = originalSubscribe;
      TaskManager.prototype.wait = originalWait;
    },
  };
}

function assistantReply(content: AssistantMessage["content"]) {
  const stream = createAssistantMessageEventStream();
  const stopReason = content.some((part) => part.type === "toolCall") ? "toolUse" : "stop";
  const message: AssistantMessage = {
    role: "assistant",
    content,
    api: "openai-chat-completions",
    provider: "openai",
    model: "gpt-4o",
    usage,
    stopReason,
    timestamp: Date.now(),
  };
  stream.push({ type: "start", partial: message });
  stream.push({ type: "done", reason: stopReason, message });
  stream.end(message);
  return stream;
}

test("real SDK print session keeps repeated attention boundaries subscription-bounded", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-attention-sdk-"));
  let session: AgentSession | undefined;
  const observation = observeTaskManagerWaits();
  try {
    const runtime = await ModelRuntime.create({
      authPath: join(dir, "auth.json"),
      modelsPath: null,
      refreshOnCreate: false,
    });
    runtime.hasConfiguredAuth = () => true;
    const loader = new DefaultResourceLoader({
      cwd: dir,
      agentDir: dir,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      extensionFactories: [
        {
          name: "bruv-tasks",
          factory: (pi) =>
            tasks(pi, {
              attention: { quietMs: 5, reviewMs: 10 },
              executablePath: join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "bruv"),
            }),
        },
      ],
    });
    await loader.reload();
    ({ session } = await createAgentSession({
      cwd: dir,
      agentDir: dir,
      resourceLoader: loader,
      model: getModel("openai", "gpt-4o"),
      modelRuntime: runtime,
      sessionManager: SessionManager.inMemory(dir),
      tools: ["execute"],
    }));
    await session.bindExtensions({ mode: "print" });
    let calls = 0;
    session.agent.streamFunction = () => {
      calls++;
      if (calls === 1) {
        return assistantReply([
          {
            type: "toolCall",
            id: "spawn_idle",
            name: "execute",
            arguments: {
              code: 'const job=await shell("read value",{waitSeconds:0,closeInput:false}); console.log(job);',
            },
          },
        ]);
      }
      if (calls === 7) {
        return assistantReply([
          {
            type: "toolCall",
            id: "stop_idle",
            name: "execute",
            arguments: {
              code: "const list=await jobs.list(); for(const job of list.jobs) await jobs.stop(job.id);",
            },
          },
        ]);
      }
      return assistantReply([{ type: "text", text: "attention received" }]);
    };
    const started = Date.now();
    await session.prompt("start one background job");
    expect(Date.now() - started).toBeGreaterThanOrEqual(10);
    expect(calls).toBeGreaterThanOrEqual(8);
    expect(JSON.stringify(session.messages)).toContain("attention checkpoint");
    const { subscriptionCalls, maxSubscriptions, activeSubscriptions, waitCalls } = observation.counts;
    // Permanent scheduler and lifecycle-index subscriptions, plus one disposable agent_end wait.
    expect(subscriptionCalls).toBeGreaterThanOrEqual(6);
    expect(maxSubscriptions).toBe(3);
    expect(activeSubscriptions).toBe(2);
    expect(waitCalls).toBe(0);
  } finally {
    session?.dispose();
    observation.restore();
    await rm(dir, { recursive: true, force: true });
  }
}, 10_000);
