import { Agent } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import fs from "node:fs";
const evidence = [];
const record = (event, data = {}) => evidence.push({ event, ...data });
let n = 0;
let agent;
const model = {
  id: "research-mock",
  name: "Research mock",
  api: "openai-completions",
  provider: "research",
  baseUrl: "http://invalid.local",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 10000,
  maxTokens: 1000,
};
const streamFunction = (m, context, options) => {
  n++;
  const texts = context.messages
    .filter((x) => x.role === "user")
    .map((x) =>
      x.content
        .filter((y) => y.type === "text")
        .map((y) => y.text)
        .join(""),
    );
  record("model_request", { n, texts, signalAborted: options?.signal?.aborted ?? false });
  const message = {
    role: "assistant",
    content:
      n === 1
        ? [
            { type: "toolCall", id: "t1", name: "longWork", arguments: {} },
            { type: "toolCall", id: "t2", name: "secondWork", arguments: {} },
          ]
        : [{ type: "text", text: "research complete " + n }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: n === 1 ? "toolUse" : "stop",
    timestamp: Date.now(),
  };
  const s = createAssistantMessageEventStream();
  queueMicrotask(() => s.push({ type: "done", reason: message.stopReason, message }));
  return s;
};
const params = { type: "object", properties: {} };
const tools = [
  {
    name: "longWork",
    label: "Long mock",
    description: "Mock long work",
    parameters: params,
    execute: async (id, args, signal) => {
      record("tool_start", { id });
      signal?.addEventListener("abort", () => record("tool_aborted", { id }));
      agent.steer({
        role: "user",
        content: [{ type: "text", text: "NATIVE_STEER_CORRECTION" }],
        timestamp: Date.now(),
      });
      agent.followUp({
        role: "user",
        content: [{ type: "text", text: "NATIVE_FOLLOWUP_RETAINED" }],
        timestamp: Date.now(),
      });
      record("steer_queued_while_tool_running");
      await new Promise((r) => setTimeout(r, 25));
      record("tool_end", { id, signalAborted: signal?.aborted ?? false });
      return { content: [{ type: "text", text: "mock completed" }], details: {} };
    },
  },
  {
    name: "secondWork",
    label: "Second mock",
    description: "Mock second work",
    parameters: params,
    execute: async (id, args, signal) => {
      record("tool_start", { id });
      record("tool_end", { id, signalAborted: signal?.aborted ?? false });
      return { content: [{ type: "text", text: "second mock completed" }], details: {} };
    },
  },
];
agent = new Agent({ initialState: { model, tools }, streamFn: streamFunction });
await agent.prompt("NATIVE_ORIGINAL");
fs.writeFileSync(
  new URL("./native-boundary.json", import.meta.url),
  JSON.stringify(
    {
      agentCoreVersion: "1.0.0",
      mockOnly: true,
      evidence,
      remainingMessages: agent.state.messages.map((x) => ({
        role: x.role,
        text: Array.isArray(x.content) ? x.content.filter((y) => y.type === "text").map((y) => y.text) : x.content,
      })),
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(evidence, null, 2));
