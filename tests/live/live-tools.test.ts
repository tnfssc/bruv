import type { Content } from "@google/genai";
import { describe, expect, test } from "bun:test";
import { VoiceSession } from "../../src/live/session.js";
import type { LiveAdapter, LiveConnection, LiveParams, VoiceOrchestration } from "../../src/live/types.js";

// Advance the microtask-only dispatch and result checkpoints; no timers or sockets are involved.
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function fixture(execute: VoiceOrchestration["execute"] = async () => undefined) {
  let params!: LiveParams;
  const calls: Parameters<VoiceOrchestration["execute"]>[0][] = [];
  const audio: unknown[] = [];
  const responses: unknown[] = [];
  const contexts: Parameters<LiveConnection["sendClientContent"]>[0][] = [];
  const played: string[] = [];
  const connection = {
    sendRealtimeInput: (v: unknown) => audio.push(v),
    sendToolResponse: (v: unknown) => responses.push(v),
    sendClientContent: (v: Parameters<LiveConnection["sendClientContent"]>[0]) => contexts.push(v),
    close: () => {},
  } as unknown as LiveConnection;
  const adapter: LiveAdapter = () => ({
    live: {
      connect: async (v) => {
        params = v;
        return connection;
      },
    },
  });
  const session = new VoiceSession({ onAudio: (data) => played.push(data) }, adapter, {
    tools: [{ name: "work", description: "do work" }],
    execute: (call) => {
      calls.push(call);
      return execute(call);
    },
  });
  const send = (v: object) => params.callbacks.onmessage(v as Parameters<LiveParams["callbacks"]["onmessage"]>[0]);
  return {
    session,
    send,
    calls,
    audio,
    played,
    responses,
    contexts,
    get params() {
      return params;
    },
  };
}

describe("dispatch authority and replay", () => {
  test("advertises NON_BLOCKING and processes audio while agent work is pending; duplicate and cancellation do not restart/stop work", async () => {
    const work = Promise.withResolvers<unknown>();
    const h = fixture(() => work.promise);
    await h.session.connect("key");
    expect(h.params.config?.tools).toMatchObject([
      { functionDeclarations: [{ name: "work", behavior: "NON_BLOCKING" }] },
    ]);
    h.send({ toolCall: { functionCalls: [{ id: "1", name: "work", args: { task: "a" } }] } });
    await flush(); // Already dispatched work survives advisory cancellation.
    h.send({ toolCallCancellation: { ids: ["1"] }, serverContent: { interrupted: true } });
    h.send({ toolCall: { functionCalls: [{ id: "1", name: "work" }] } });
    h.session.sendAudio("AAAAAA==");
    h.send({
      serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAAAAA==", mimeType: "audio/pcm;rate=24000" } }] } },
    });
    expect(h.audio).toHaveLength(1);
    expect(h.played).toEqual(["AAAAAA=="]);
    await flush();
    expect(h.calls).toEqual([{ id: "1", name: "work", args: { task: "a" } }]);
    work.resolve({ done: true });
    await flush();
    expect(h.responses).toEqual([
      { functionResponses: { scheduling: "WHEN_IDLE", id: "1", name: "work", response: { output: { done: true } } } },
    ]);
    h.session.sendContext("Job 1 completed", { triggerResponse: false });
    expect(h.contexts).toEqual([
      { turns: [{ role: "user", parts: [{ text: "Job 1 completed" }] }], turnComplete: false },
    ]);
    h.session.close();
  });

  test("an undispatched tool request is revoked on disconnect, and new messages cannot dispatch", async () => {
    const h = fixture(async () => {
      return { queued: true };
    });
    await h.session.connect("fake");
    h.send({ toolCall: { functionCalls: [{ id: "admitted", name: "work" }] } });
    h.session.close();
    h.send({ toolCall: { functionCalls: [{ id: "too-late", name: "work" }] } });
    await flush();
    expect(h.calls).toHaveLength(0);
    expect(h.responses).toHaveLength(0);
  });

  test("disconnect after dispatch leaves host work running but suppresses its response", async () => {
    const work = Promise.withResolvers<unknown>();
    const h = fixture(() => work.promise);
    await h.session.connect("key");
    h.send({ toolCall: { functionCalls: [{ id: "disconnect", name: "work" }] } });
    await flush();
    expect(h.calls).toEqual([{ id: "disconnect", name: "work" }]);
    h.session.close();
    work.resolve("done");
    await flush();
    expect(h.calls).toHaveLength(1);
    expect(h.responses).toEqual([]);
  });

  test("duplicate SDK IDs replay completed bounded response without re-execution", async () => {
    const work = Promise.withResolvers<unknown>();
    const h = fixture(() => work.promise);
    await h.session.connect("fake");
    h.send({
      toolCall: {
        functionCalls: [
          { id: "same", name: "work" },
          { id: "same", name: "work" },
        ],
      },
    });
    await flush();
    expect(h.calls).toHaveLength(1);
    work.resolve("ok");
    await flush();
    h.send({ toolCall: { functionCalls: [{ id: "same", name: "work", args: { different: true } }] } });
    expect(h.calls).toHaveLength(1);
    expect(h.responses).toEqual(
      Array(2).fill({
        functionResponses: {
          id: "same",
          name: "work",
          response: { output: "ok" },
          scheduling: "WHEN_IDLE",
        },
      }),
    );
    h.session.close();
  });

  test("queued cancellation is replayable and cannot reacquire dispatch authority", async () => {
    const h = fixture(async () => "done");
    await h.session.connect("key");
    const request = { toolCall: { functionCalls: [{ id: "queued", name: "work" }] } };
    h.send(request);
    h.send({ toolCallCancellation: { ids: ["queued"] } });
    h.send(request); // Still awaiting the dispatch checkpoint: no response to replay yet.
    expect(h.responses).toEqual([]);
    await flush();
    expect(h.calls).toHaveLength(0);
    const rejection = {
      functionResponses: {
        id: "queued",
        name: "work",
        response: { error: "Tool execution failed" },
        scheduling: "WHEN_IDLE",
      },
    };
    expect(h.responses).toEqual([rejection]);
    h.send({ toolCallCancellation: { ids: ["queued"] } });
    h.send(request);
    expect(h.responses).toEqual([rejection, rejection]);
    expect(h.calls).toHaveLength(0);
    h.session.close();
  });

  test("queued calls reserve capacity until revoked calls settle, then new calls can dispatch", async () => {
    const h = fixture(async () => "done");
    await h.session.connect("key");
    const ids = Array.from({ length: 16 }, (_, i) => String(i));
    h.send({ toolCall: { functionCalls: ids.map((id) => ({ id, name: "work" })) } });
    h.send({ toolCallCancellation: { ids } });
    h.send({ toolCall: { functionCalls: [{ id: "before-settlement", name: "work" }] } });
    expect(h.responses).toEqual([
      {
        functionResponses: {
          id: "before-settlement",
          name: "work",
          response: { error: "Tool request rejected" },
          scheduling: "WHEN_IDLE",
        },
      },
    ]);
    await flush();
    expect(h.calls).toHaveLength(0);
    h.send({ toolCall: { functionCalls: [{ id: "after-settlement", name: "work" }] } });
    await flush();
    expect(h.calls).toHaveLength(1);
    expect(h.responses.at(-1)).toEqual({
      functionResponses: {
        id: "after-settlement",
        name: "work",
        response: { output: "done" },
        scheduling: "WHEN_IDLE",
      },
    });
    h.session.close();
  });

  test("pending calls occupy 16 slots without blocking microphone", async () => {
    const h = fixture(async () => {
      return new Promise(() => {});
    });
    await h.session.connect("fake");
    h.send({ toolCall: { functionCalls: Array.from({ length: 17 }, (_, i) => ({ id: String(i), name: "work" })) } });
    await flush();
    h.session.sendAudio("AAAAAA==");
    expect(h.calls).toHaveLength(16);
    expect(h.audio).toHaveLength(1);
    expect(h.responses).toContainEqual({
      functionResponses: {
        id: "16",
        name: "work",
        response: { error: "Tool request rejected" },
        scheduling: "WHEN_IDLE",
      },
    });
    h.session.close();
  });

  test("rejected calls retain their original name and response when retransmitted with a valid tool", async () => {
    const h = fixture();
    await h.session.connect("key");
    h.send({ toolCall: { functionCalls: [{ id: "rejected", name: "undeclared" }] } });
    h.send({ toolCall: { functionCalls: [{ id: "rejected", name: "work" }] } });
    await flush();
    expect(h.calls).toHaveLength(0);
    expect(h.responses).toEqual(
      Array(2).fill({
        functionResponses: {
          id: "rejected",
          name: "undeclared",
          response: { error: "Tool request rejected" },
          scheduling: "WHEN_IDLE",
        },
      }),
    );
    h.session.close();
  });
});

describe("admission and tool results", () => {
  test("oversized arguments and undeclared tools are rejected before host execution", async () => {
    const h = fixture(async () => "done");
    await h.session.connect("key");
    h.send({
      toolCall: {
        functionCalls: [
          { id: "large", name: "work", args: { data: "x".repeat(1_048_576) } },
          { id: "unknown", name: "missing" },
          { id: "ok", name: "work" },
        ],
      },
    });
    await flush();
    expect(h.calls).toEqual([{ id: "ok", name: "work" }]);
    expect(h.responses).toContainEqual({
      functionResponses: {
        scheduling: "WHEN_IDLE",
        id: "large",
        name: "work",
        response: { error: "Tool request rejected" },
      },
    });
    expect(h.responses).toContainEqual({
      functionResponses: {
        scheduling: "WHEN_IDLE",
        id: "unknown",
        name: "missing",
        response: { error: "Tool request rejected" },
      },
    });
    h.session.close();
  });

  test("tool failures never expose exception messages or custom codes", async () => {
    const h = fixture(async (call) => {
      const failure = new Error("secret exception detail");
      if (call.id === "unknown-code") Object.assign(failure, { code: "secret_code" });
      if (call.id === "transcript-code") Object.assign(failure, { code: "transcript_unavailable" });
      throw failure;
    });
    await h.session.connect("fake");
    h.send({
      toolCall: {
        functionCalls: [
          { id: "typed", name: "work" },
          { id: "unknown-code", name: "work" },
          { id: "transcript-code", name: "work" },
        ],
      },
    });
    await flush();
    expect(h.calls).toEqual([
      { id: "typed", name: "work" },
      { id: "unknown-code", name: "work" },
      { id: "transcript-code", name: "work" },
    ]);
    expect(h.responses).toContainEqual({
      functionResponses: {
        scheduling: "WHEN_IDLE",
        id: "typed",
        name: "work",
        response: { error: "Tool execution failed" },
      },
    });
    expect(h.responses).toContainEqual({
      functionResponses: {
        scheduling: "WHEN_IDLE",
        id: "unknown-code",
        name: "work",
        response: { error: "Tool execution failed" },
      },
    });
    expect(h.responses).toContainEqual({
      functionResponses: {
        scheduling: "WHEN_IDLE",
        id: "transcript-code",
        name: "work",
        response: { error: "Tool execution failed" },
      },
    });
    expect(JSON.stringify(h.responses)).not.toContain("secret");
    h.session.close();
  });

  test("normal tool results retain the complete output", async () => {
    const work = Promise.withResolvers<unknown>();
    const h = fixture(() => work.promise);
    await h.session.connect("key");
    h.send({ toolCall: { functionCalls: [{ id: "ok", name: "work" }] } });
    await flush();
    expect(h.calls).toEqual([{ id: "ok", name: "work" }]);
    expect(h.responses).toEqual([]);
    work.resolve("x".repeat(20000));
    await flush();
    expect(h.responses).toEqual([
      {
        functionResponses: {
          scheduling: "WHEN_IDLE",
          id: "ok",
          name: "work",
          response: { output: "x".repeat(20000) },
        },
      },
    ]);
    h.session.close();
  });
});

describe("host observations", () => {
  test("main context preserves complete updates and keeps audio live after 65k cumulative", async () => {
    const h = fixture();
    await h.session.connect("fake");
    for (let i = 0; i < 18; i++) {
      h.session.sendContext(`update ${i} ` + "x".repeat(4000));
      h.session.sendAudio("AAAAAA==");
    }
    h.session.sendContext("large verified " + "x".repeat(4096));
    h.session.sendContext("latest verified status");
    expect(h.contexts).toHaveLength(20);
    expect(h.audio).toHaveLength(18);
    const lastText = (h.contexts.at(-1)!.turns as Content[])[0]!.parts![0]!.text;
    expect(lastText).toContain("latest verified status");
    expect((h.contexts.at(-2)!.turns as Content[])[0]!.parts![0]!.text).toBe("large verified " + "x".repeat(4096));
    h.session.sendAudio("AAAAAA==");
    expect(h.audio).toHaveLength(19);
    expect(h.session.state).toBe("ready");
    expect(h.calls).toHaveLength(0);
    h.session.close();
  });

  test("main context preserves each observation and sends nothing after close", async () => {
    const h = fixture();
    await h.session.connect("fake");
    h.session.sendContext("first update", { triggerResponse: false });
    h.session.sendContext("second update");
    expect(h.contexts).toEqual([
      { turns: [{ role: "user", parts: [{ text: "first update" }] }], turnComplete: false },
      { turns: [{ role: "user", parts: [{ text: "second update" }] }], turnComplete: true },
    ]);
    h.session.close();
    h.session.sendContext("not sent after close");
    expect(h.contexts).toHaveLength(2);
  });

  test("observation bursts preserve complete data while audio continues", async () => {
    const h = fixture();
    await h.session.connect("fake");
    for (let i = 0; i < 1000; i++) {
      h.session.sendContext(`verified-${i} ` + "x".repeat(100), { triggerResponse: false });
      h.session.sendAudio("AAAAAA==");
    }
    expect(h.contexts).toHaveLength(1000);
    expect((h.contexts.at(-1)!.turns as Content[])[0]!.parts![0]!.text).toBe("verified-999 " + "x".repeat(100));
    expect(h.audio).toHaveLength(1000);
    expect(h.session.state).toBe("ready");
    h.session.close();
  });
});
