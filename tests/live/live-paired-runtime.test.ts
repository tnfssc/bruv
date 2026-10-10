import { test, expect } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  type ExtensionAPI,
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { type AssistantMessage, createAssistantMessageEventStream, getModel } from "@earendil-works/pi-ai/compat";
import { installCurrentConversationAdapter } from "../../src/agent/instruction-continuity";
import { acquireMainOwner } from "../../src/live/main-owner";
import { bruvSystemPrompt } from "../../src/prompts";
import { registerExecuteTool } from "../../src/typescript/extension";

// Retained fixture roots are allocated by these tests, never inherited user directories.
async function createPairedDirectory(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await Promise.all(["home", "config", "sdk", "tmp"].map((name) => mkdir(join(dir, name))));
  return dir;
}

async function createPairedSession(dir: string, factory: (pi: ExtensionAPI) => void) {
  const loader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: dir,
    noExtensions: true,
    noSkills: true,
    noThemes: true,
    noPromptTemplates: true,
    systemPrompt: bruvSystemPrompt(),
    extensionFactories: [{ name: "paired-test", factory }],
  });
  await loader.reload();
  const runtime = await ModelRuntime.create({
    authPath: join(dir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  runtime.hasConfiguredAuth = () => true;
  const { session } = await createAgentSession({
    cwd: dir,
    agentDir: dir,
    resourceLoader: loader,
    modelRuntime: runtime,
    model: getModel("openai-codex", "gpt-5.6-luna"),
    sessionManager: SessionManager.inMemory(dir),
    tools: ["execute"],
  });
  try {
    await session.bindExtensions({});
    return session;
  } catch (error) {
    await session.dispose();
    throw error;
  }
}

async function runPairedFixtureProcess(dir: string): Promise<string> {
  const child = spawn(process.execPath, ["-e", 'setTimeout(() => process.stdout.write("PAIRED_ASYNC_DONE"), 150)'], {
    cwd: dir,
    env: {
      HOME: join(dir, "home"),
      XDG_CONFIG_HOME: join(dir, "config"),
      XDG_DATA_HOME: join(dir, "sdk"),
      BRUV_CODING_AGENT_DIR: join(dir, "sdk"),
      TMPDIR: join(dir, "tmp"),
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error("Paired fixture process failed"))));
  });
  let output = "";
  for await (const chunk of child.stdout!) output += chunk.toString();
  await exited;
  return output;
}

// The scenarios choose turns; this helper supplies only the provider message envelope.
function completedAssistantTurn(model: ReturnType<typeof getModel>, content: AssistantMessage["content"]) {
  const stream = createAssistantMessageEventStream();
  const message: AssistantMessage = {
    role: "assistant",
    api: model.api,
    provider: model.provider,
    model: model.id,
    timestamp: Date.now(),
    stopReason: content.some((part) => part.type === "toolCall") ? "toolUse" : "stop",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    content,
  };
  stream.push({ type: "done", reason: "stop", message });
  return stream;
}

test("paired owner delegates a real Pi prompt, tool execution and completion to the selected backend", async () => {
  installCurrentConversationAdapter();
  const dir = await createPairedDirectory("paired-runtime-");
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  let owner: Awaited<ReturnType<typeof acquireMainOwner>> | undefined;
  try {
    const hooks: string[] = [];
    const feedback: string[] = [];
    session = await createPairedSession(dir, (pi) => {
      registerExecuteTool(pi, undefined, undefined, () => 0);
      pi.on("before_agent_start", (event) => {
        hooks.push("start:" + event.prompt);
        return { systemPrompt: event.systemPrompt + "\nPAIRED_HOOK" };
      });
      pi.on("tool_call", (event) => {
        hooks.push("call:" + event.toolName);
      });
      pi.on("tool_result", (event) => {
        hooks.push("result:" + event.toolName);
      });
    });
    owner = await acquireMainOwner(
      {} as any,
      { sessionManager: session.sessionManager, isIdle: () => !session!.isStreaming } as any,
      { onContext: (text) => feedback.push(text) },
    );
    owner.delegatedVoice = true;
    let streams = 0;
    session.agent.streamFunction = ((model: any, context: any) => {
      const call = streams++ === 0;
      expect(model.id).toBe("gpt-5.6-luna");
      expect(JSON.stringify(context.messages)).toContain("PAIRED_HOOK");
      return completedAssistantTurn(
        model,
        call
          ? [
              {
                type: "toolCall",
                id: "paired-call",
                name: "execute",
                arguments: { code: 'console.log("PAIRED_REAL_EXECUTE")' },
              },
            ]
          : [{ type: "text", text: "Paired work completed." }],
      );
    }) as any;
    const run = owner.delegate!("voice-1", "User asks to execute code");
    expect(owner.delegate!("voice-1", "User asks to execute code")).toBe(run);
    owner.interrupt(); // playback interruption must not abort or replay admitted coding work
    owner.close();
    await run;
    await owner.released;
    expect(streams).toBe(2);
    expect(hooks).toContain("start:User asks to execute code");
    expect(hooks).toContain("call:execute");
    expect(hooks).toContain("result:execute");
    expect(JSON.stringify(session.sessionManager.buildSessionContext())).toContain("PAIRED_REAL_EXECUTE");
    expect(feedback.join(" ")).toContain("Paired work completed.");
  } finally {
    owner?.close();
    await session?.dispose();
  }
});

test("paired Pi wakes its canonical backend on an async job completion without a synthetic user turn", async () => {
  installCurrentConversationAdapter();
  const dir = await createPairedDirectory("paired-async-");
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  let owner: Awaited<ReturnType<typeof acquireMainOwner>> | undefined;
  try {
    const feedback: string[] = [];
    const errors: string[] = [];
    const contexts: AgentMessage[][] = [];
    const requests: { modelId: string; messages: unknown[] }[] = [];
    const hooks: string[] = [];
    let jobFinished: Promise<void> | undefined;
    session = await createPairedSession(dir, (pi) => {
      pi.registerTool({
        name: "execute",
        label: "Execute",
        description: "Launch a background shell job",
        parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
        execute: async () => {
          jobFinished = (async () => {
            const output = await runPairedFixtureProcess(dir);
            owner!.sendContext("Task complete: " + output, {
              customType: "task-complete",
              details: { id: "paired-job-1" },
            });
            owner!.sendContext("Task complete: " + output, {
              customType: "task-complete",
              details: { id: "paired-job-1" },
            });
            owner!.close();
          })();
          return { content: [{ type: "text", text: "Background job paired-job-1 running" }], details: {} };
        },
      });
      pi.on("before_agent_start", (event) => {
        hooks.push(event.prompt);
      });
      pi.on("context", (event) => {
        contexts.push(structuredClone(event.messages));
      });
      pi.on("tool_call", (event) => {
        hooks.push("tool:" + event.toolName);
      });
    });
    owner = await acquireMainOwner(
      {} as any,
      { sessionManager: session.sessionManager, isIdle: () => !session!.isStreaming } as any,
      { onContext: (text) => feedback.push(text), onError: (text) => errors.push(text) },
    );
    owner.delegatedVoice = true;
    let streams = 0;
    session.agent.streamFunction = ((model: any, context: any) => {
      requests.push({ modelId: model.id, messages: structuredClone(context.messages) });
      const turn = streams++;
      const content: AssistantMessage["content"] =
        turn === 0
          ? [
              {
                type: "toolCall",
                id: "async-launch",
                name: "execute",
                arguments: {
                  code: 'const job=await shell("sleep 0.15; printf PAIRED_ASYNC_DONE",{waitSeconds:0}); console.log(job.id)',
                },
              },
            ]
          : [
              {
                type: "text",
                text: turn === 1 ? "Job launched, waiting." : "Async completion inspected by paired coder.",
              },
            ];
      return completedAssistantTurn(model, content);
    }) as any;
    await owner.delegate!("voice-launch", "Launch asynchronous shell job");
    owner.sendContext("provisional", { customType: "live-transcript" });
    await jobFinished;
    await owner.released;
    expect(errors).toEqual([]);
    expect(
      session.agent.state.messages.filter((message) => message.role === "assistant" && message.stopReason === "error"),
    ).toEqual([]);
    expect(feedback.join(" ")).toContain("PAIRED_ASYNC_DONE");
    expect(feedback.join(" ")).toContain("Async completion inspected by paired coder.");
    expect(streams).toBe(3);
    expect(requests.map((request) => request.modelId)).toEqual(Array(3).fill("gpt-5.6-luna"));
    // Pi keeps custom metadata in history, then maps its content to a provider user message.
    const continuation = contexts.at(-1)!;
    expect(continuation.filter((message) => message.role === "user")).toHaveLength(1);
    expect(
      continuation.filter((message) => message.role === "custom" && message.customType === "task-complete"),
    ).toHaveLength(1);
    expect(requests[2]!.messages).toContainEqual(
      expect.objectContaining({ role: "user", content: [{ type: "text", text: "Task complete: PAIRED_ASYNC_DONE" }] }),
    );
    expect(hooks).toContain("tool:execute");
    expect(hooks).toContain("Launch asynchronous shell job");
    const history = session.sessionManager.buildSessionContext().messages;
    expect(history.filter((message) => message.role === "user")).toHaveLength(1);
    const custom = history.filter((message) => message.role === "custom" && message.customType === "task-complete");
    expect(custom).toHaveLength(1);
    expect(feedback.filter((text) => text.includes("Task complete: PAIRED_ASYNC_DONE"))).toHaveLength(1);
  } finally {
    owner?.close();
    await session?.dispose();
  }
}, 15_000);
