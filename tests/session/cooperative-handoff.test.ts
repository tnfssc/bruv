import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAssistantMessageEventStream, getModel, type AssistantMessage } from "@earendil-works/pi-ai/compat";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  type ToolDefinition,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { registerExecuteTool } from "../../src/typescript/extension";

// Keep provider wire details out of the batch-policy scenario.
function assistantReply(content: AssistantMessage["content"], stopReason: "toolUse" | "stop") {
  const message: AssistantMessage = {
    role: "assistant",
    api: "openai-codex-responses",
    provider: "openai-codex",
    model: "gpt-5.6-luna",
    timestamp: Date.now(),
    stopReason,
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
  const stream = createAssistantMessageEventStream();
  stream.push({ type: "start", partial: message });
  stream.push({ type: "done", reason: stopReason, message });
  return stream;
}

for (const { name, handoffCalls, expectedRequests } of [
  { name: "unanimous handoff stops", handoffCalls: ["one", "two"], expectedRequests: 1 },
  { name: "mixed batch continues", handoffCalls: ["one"], expectedRequests: 2 },
])
  test("Pi cooperative batch termination: " + name, async () => {
    const dir = await mkdtemp(join(tmpdir(), "bruv-handoff-batch-"));
    let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
    try {
      let tool!: ToolDefinition;
      registerExecuteTool({
        registerTool(value: ToolDefinition) {
          tool = value;
        },
        on() {},
      } as unknown as ExtensionAPI);
      const executed: string[] = [];
      tool.execute = async (_id, args) => {
        const { code } = args as { code: string };
        executed.push(code);
        return {
          content: [{ type: "text", text: "Progress" }],
          details: { handoff: "Progress" },
          terminate: handoffCalls.includes(code),
        };
      };
      const loader = new DefaultResourceLoader({
        cwd: dir,
        agentDir: dir,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
      });
      await loader.reload();
      const modelRuntime = await ModelRuntime.create({
        authPath: join(dir, "auth.json"),
        modelsPath: null,
        refreshOnCreate: false,
      });
      modelRuntime.hasConfiguredAuth = () => true;
      ({ session } = await createAgentSession({
        cwd: dir,
        agentDir: dir,
        resourceLoader: loader,
        modelRuntime,
        model: getModel("openai-codex", "gpt-5.6-luna"),
        sessionManager: SessionManager.inMemory(dir),
        customTools: [tool],
        tools: ["execute"],
      }));
      let requests = 0;
      session.agent.streamFunction = () => {
        requests++;
        if (requests === 1) {
          return assistantReply(
            [
              { type: "toolCall", id: "one", name: "execute", arguments: { code: "one" } },
              { type: "toolCall", id: "two", name: "execute", arguments: { code: "two" } },
            ],
            "toolUse",
          );
        }
        return assistantReply([{ type: "text", text: "done" }], "stop");
      };
      await session.prompt("Exercise the batch boundary");
      expect(executed).toEqual(["one", "two"]);
      expect(requests).toBe(expectedRequests);
      expect(
        session.agent.state.messages
          .filter((message) => message.role === "toolResult")
          .map((message) => ({ toolCallId: message.toolCallId, content: message.content })),
      ).toEqual([
        { toolCallId: "one", content: [{ type: "text", text: "Progress" }] },
        { toolCallId: "two", content: [{ type: "text", text: "Progress" }] },
      ]);
      expect(session.isStreaming).toBe(false);
    } finally {
      session?.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  });
