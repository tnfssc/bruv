import { expect, test } from "bun:test";
import type { Api, Message, Model } from "@earendil-works/pi-ai";
import { convertToLlm, SessionManager } from "@earendil-works/pi-coding-agent";
import { pinReasoning, registerReasoning } from "../src/reasoning";
import { sdk } from "./sdk";

type Payload = { model: string; reasoning: { effort: string; summary: string }; input: unknown[] };
const levels = { off: "none", minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" };
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 };
const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
const isUpdate = (item: unknown) => (item as { type?: string }).type === "configuration_update";
const efforts = (input: unknown[]) =>
  input.flatMap((item, index) =>
    isUpdate(item) ? [[index, (item as { reasoning: { effort: string } }).reasoning.effort]] : [],
  );
// The items the Codex provider sends for each message, in Pi's order (openai-responses-shared.js).
const items = (message: Message): unknown[] => {
  if (message.role === "toolResult")
    return [{ type: "function_call_output", call_id: message.toolCallId.split("|")[0], output: "result" }];
  if (message.role === "user")
    return [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(message.content) }] }];
  if (message.role !== "assistant") return [];
  return message.content.flatMap((block) => {
    if (block.type === "thinking") return block.thinkingSignature ? [JSON.parse(block.thinkingSignature)] : [];
    if (block.type !== "toolCall") return [];
    const [call, id] = block.id.split("|");
    return [{ type: "function_call", id, call_id: call, name: block.name, arguments: "{}" }];
  });
};

async function setup() {
  const app = await sdk([registerReasoning]);
  const model: Model<Api> = {
    ...app.faux.getModel(),
    api: "openai-codex-responses",
    id: "gpt-6-sol",
    reasoning: true,
    thinkingLevelMap: levels,
  };
  await app.session.setModel(model);
  app.session.setThinkingLevel("low");
  const sessions = app.session.sessionManager;
  let replies = 0;
  const payload = (manager = sessions, using = app.session.model ?? model): Payload => ({
    model: using.id,
    reasoning: { effort: levels[app.session.thinkingLevel], summary: "auto" },
    input: convertToLlm(manager.buildSessionContext().messages).flatMap(items),
  });
  const send = async (body = payload()) =>
    (await app.session.extensionRunner.emitBeforeProviderRequest(structuredClone(body))) as Payload;
  const reply = (started = Date.now(), using = app.session.model ?? model) => {
    replies++;
    const call = `call_${replies}|fc_${replies}`;
    const reasoning = { type: "reasoning", id: `rs_${replies}`, summary: [], encrypted_content: `saved-${replies}` };
    sessions.appendMessage({
      role: "assistant",
      api: using.api,
      provider: using.provider,
      model: using.id,
      content: [
        { type: "thinking", thinking: "", thinkingSignature: JSON.stringify(reasoning) },
        { type: "toolCall", id: call, name: "codemode", arguments: {} },
      ],
      usage: { ...usage, cost },
      stopReason: "toolUse",
      timestamp: started,
    });
    sessions.appendMessage({
      role: "toolResult",
      toolCallId: call,
      toolName: "codemode",
      content: [{ type: "text", text: `result-${replies}` }],
      isError: false,
      timestamp: Date.now(),
    });
  };
  sessions.appendMessage({ role: "user", content: "task-9", timestamp: Date.now() });
  return { ...app, model, sessions, payload, send, reply };
}

test("keeps the first effort and adds each change where it happened, request after request", async () => {
  const app = await setup();
  try {
    let previous = await app.send();
    expect(previous).toEqual(app.payload());
    const check = async () => {
      const sent = await app.send();
      expect(sent.reasoning).toEqual({ effort: "low", summary: "auto" });
      // The new request starts with everything the previous one sent.
      expect(sent.input.slice(0, previous.input.length)).toEqual(previous.input);
      previous = sent;
    };
    app.reply();
    app.session.setThinkingLevel("high");
    await check();
    app.reply();
    await check();
    // Chosen while the reply was streaming: it applies from the next request.
    app.session.setThinkingLevel("medium");
    app.reply(Date.now() - 1000);
    await check();
    app.reply();
    // Two choices before one request count once.
    app.session.setThinkingLevel("xhigh");
    app.session.setThinkingLevel("low");
    await check();
    app.reply();
    await check();
    // Each reply adds reasoning, a call and its result after the task.
    expect(efforts(previous.input)).toEqual([
      [4, "high"],
      [11, "medium"],
      [15, "low"],
    ]);
    expect(previous.input.filter((item) => !isUpdate(item))).toEqual(app.payload().input);
    // A resumed session builds the same request from what Pi saved.
    const file = app.sessions.getSessionFile();
    if (!file) throw new Error("Missing session file");
    const resumed = SessionManager.open(file);
    const again = app.payload(resumed);
    pinReasoning(again, resumed.getBranch(), app.model);
    expect(again).toEqual(previous);
  } finally {
    await app.close();
  }
});

test("restarts after a compaction and on a model switch, and leaves other requests alone", async () => {
  const app = await setup();
  try {
    app.reply();
    app.session.setThinkingLevel("high");
    app.reply();
    app.session.setThinkingLevel("medium");
    app.reply();
    const first = app.sessions
      .getBranch()
      .find((entry) => entry.type === "message" && entry.message.role === "assistant");
    if (!first) throw new Error("Missing test entries");
    app.sessions.appendCompaction("summary-9", first.id, 100);
    // The first request after a compaction is sent as it is.
    expect(await app.send()).toEqual(app.payload());
    app.reply();
    app.session.setThinkingLevel("max");
    const sent = await app.send();
    expect(sent.reasoning.effort).toBe("medium");
    expect(efforts(sent.input)).toEqual([[sent.input.length - 1, "max"]]);

    expect(await app.send({ ...app.payload(), truncation: "auto" } as Payload)).toEqual({
      ...app.payload(),
      truncation: "auto",
    } as Payload);
    await app.session.setModel({ ...app.model, id: "gpt-6-luna" });
    app.reply();
    app.session.setThinkingLevel("low");
    const switched = await app.send();
    expect(switched.reasoning.effort).toBe("max");
    expect(efforts(switched.input)).toEqual([[switched.input.length - 1, "low"]]);
    for (const id of ["gpt-5.5", "gpt-6-luna"]) {
      const other = { ...app.model, id, api: id === "gpt-5.5" ? "openai-codex-responses" : "openai-responses" };
      await app.session.setModel(other);
      app.reply();
      app.session.setThinkingLevel("high");
      const body = app.payload();
      expect(await app.send(body)).toEqual(body);
    }
  } finally {
    await app.close();
  }
});
