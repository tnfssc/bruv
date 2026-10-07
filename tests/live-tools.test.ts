import { describe, expect, test } from "bun:test";
import { VoiceSession } from "../src/live/session.js";
import type { LiveAdapter, LiveConnection, LiveParams } from "../src/live/types.js";

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function fixture(execute: (call: { id?: string; name?: string; args?: Record<string, unknown> }) => Promise<unknown>) {
  let params!: LiveParams;
  const audio: unknown[] = [];
  const responses: unknown[] = [];
  const contexts: unknown[] = [];
  const played: unknown[] = [];
  const connection = {
    sendRealtimeInput: (v: unknown) => audio.push(v),
    sendToolResponse: (v: unknown) => responses.push(v),
    sendClientContent: (v: unknown) => contexts.push(v),
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
    execute,
  });
  const send = (v: object) => params.callbacks.onmessage(v as Parameters<LiveParams["callbacks"]["onmessage"]>[0]);
  return {
    session,
    send,
    audio,
    played,
    responses,
    contexts,
    get params() {
      return params;
    },
  };
}

describe("SDK orchestration seam", () => {
  test("advertises NON_BLOCKING and processes audio while agent work is pending; duplicate and cancellation do not restart/stop work", async () => {
    let finish!: (v: unknown) => void;
    const calls: unknown[] = [];
    const h = fixture((call) => {
      calls.push(call);
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
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
    expect(calls).toEqual([{ id: "1", name: "work", args: { task: "a" } }]);
    finish({ done: true });
    await flush();
    expect(h.responses).toEqual([
      { functionResponses: { scheduling: "WHEN_IDLE", id: "1", name: "work", response: { output: { done: true } } } },
    ]);
    h.session.sendContext("Job 1 completed", { triggerResponse: false });
    expect(h.contexts).toEqual([
      { turns: [{ role: "user", parts: [{ text: "Job 1 completed" }] }], turnComplete: false },
    ]);
  });
  test("failures sanitized, oversized args rejected, normal results retained, and disconnect never cancels execution", async () => {
    let finish!: (v: unknown) => void;
    let count = 0;
    const h = fixture(async (call) => {
      count++;
      if (call.id === "bad") throw Object.assign(Error("secret"), { code: "transcript_unavailable" });
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    await h.session.connect("key");
    h.send({
      toolCall: {
        functionCalls: [
          { id: "bad", name: "work" },
          { id: "large", name: "work", args: { data: "x".repeat(1_048_576) } },
          { id: "unknown", name: "missing" },
          { id: "ok", name: "work" },
        ],
      },
    });
    await flush();
    expect(count).toBe(2);
    expect(h.responses).toContainEqual({
      functionResponses: {
        scheduling: "WHEN_IDLE",
        id: "bad",
        name: "work",
        response: { error: "Tool execution failed" },
      },
    });
    expect(h.responses).toContainEqual({
      functionResponses: {
        scheduling: "WHEN_IDLE",
        id: "large",
        name: "work",
        response: { error: "Tool request rejected" },
      },
    });
    finish("x".repeat(20000));
    await flush();
    expect(h.responses).toContainEqual({
      functionResponses: {
        scheduling: "WHEN_IDLE",
        id: "ok",
        name: "work",
        response: { output: "x".repeat(20000) },
      },
    });
    let resolve!: (v: unknown) => void;
    const later = fixture(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await later.session.connect("key");
    later.send({ toolCall: { functionCalls: [{ id: "disconnect", name: "work" }] } });
    await flush();
    later.session.close();
    resolve("done");
    await flush();
    expect(later.responses).toEqual([]);
  });
});

test("main context preserves complete updates and keeps audio live after 65k cumulative", async () => {
  let calls = 0;
  const h = fixture(async () => {
    calls++;
  });
  await h.session.connect("fake");
  for (let i = 0; i < 18; i++) {
    h.session.sendContext(`update ${i} ` + "x".repeat(4000));
    h.session.sendAudio("AAAAAA==");
  }
  h.session.sendContext("large verified " + "x".repeat(4096));
  h.session.sendContext("latest verified status");
  expect(h.contexts).toHaveLength(20);
  expect(h.audio).toHaveLength(18);
  const lastText = (h.contexts.at(-1) as { turns: { parts: { text: string }[] }[] }).turns[0]!.parts[0]!.text;
  expect(lastText).toContain("latest verified status");
  expect((h.contexts.at(-2) as any).turns[0].parts[0].text).toBe("large verified " + "x".repeat(4096));
  h.session.sendAudio("AAAAAA==");
  expect(h.audio).toHaveLength(19);
  expect(h.session.state).toBe("ready");
  expect(calls).toBe(0);
});

test("tool concurrency is bounded without blocking microphone and cancellation does not call host stop", async () => {
  let calls = 0;
  const h = fixture(async () => {
    calls++;
    return new Promise(() => {});
  });
  await h.session.connect("fake");
  h.send({ toolCall: { functionCalls: Array.from({ length: 17 }, (_, i) => ({ id: String(i), name: "work" })) } });
  await flush();
  h.session.sendAudio("AAAAAA==");
  expect(calls).toBe(16);
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

test("an undispatched tool request is revoked on disconnect, and new messages cannot dispatch", async () => {
  let calls = 0;
  const h = fixture(async () => {
    calls++;
    return { queued: true };
  });
  await h.session.connect("fake");
  h.send({ toolCall: { functionCalls: [{ id: "admitted", name: "work" }] } });
  h.session.close();
  h.send({ toolCall: { functionCalls: [{ id: "too-late", name: "work" }] } });
  await flush();
  expect(calls).toBe(0);
  expect(h.responses).toHaveLength(0);
});

test("duplicate SDK IDs replay completed bounded response without re-execution", async () => {
  let calls = 0;
  let finish!: (v: unknown) => void;
  const h = fixture(() => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
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
  expect(calls).toBe(1);
  finish("ok");
  await flush();
  h.send({ toolCall: { functionCalls: [{ id: "same", name: "work", args: { different: true } }] } });
  expect(calls).toBe(1);
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
});

test("main context preserves each observation and sends nothing after close", async () => {
  const h = fixture(async () => null);
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
  const h = fixture(async () => null);
  await h.session.connect("fake");
  for (let i = 0; i < 1000; i++) {
    h.session.sendContext(`verified-${i} ` + "x".repeat(100), { triggerResponse: false });
    h.session.sendAudio("AAAAAA==");
  }
  expect(h.contexts).toHaveLength(1000);
  expect((h.contexts.at(-1) as any).turns[0].parts[0].text).toBe("verified-999 " + "x".repeat(100));
  expect(h.audio).toHaveLength(1000);
  expect(h.session.state).toBe("ready");
  h.session.close();
});

test("Session tool failures never expose exception messages or custom codes", async () => {
  const h = fixture(async (call) => {
    const failure = new Error("secret exception detail");
    failure.message = "secret exception detail";
    if (call.id === "unknown-code") (failure as any).code = "secret_code";
    throw failure;
  });
  await h.session.connect("fake");
  h.send({
    toolCall: {
      functionCalls: [
        { id: "typed", name: "work" },
        { id: "unknown-code", name: "work" },
      ],
    },
  });
  await flush();
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
  expect(JSON.stringify(h.responses)).not.toContain("secret");
  h.session.close();
});

test("queued cancellation is replayable and cannot reacquire dispatch authority", async () => {
  let calls = 0;
  const h = fixture(async () => {
    calls++;
    return "done";
  });
  await h.session.connect("key");
  const request = { toolCall: { functionCalls: [{ id: "queued", name: "work" }] } };
  h.send(request);
  h.send({ toolCallCancellation: { ids: ["queued"] } });
  h.send(request); // Still awaiting the dispatch checkpoint: no response to replay yet.
  expect(h.responses).toEqual([]);
  await flush();
  expect(calls).toBe(0);
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
  expect(calls).toBe(0);
  h.session.close();
});

test("queued calls reserve capacity until revoked calls settle, then new calls can dispatch", async () => {
  let calls = 0;
  const h = fixture(async () => {
    calls++;
    return "done";
  });
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
  expect(calls).toBe(0);
  h.send({ toolCall: { functionCalls: [{ id: "after-settlement", name: "work" }] } });
  await flush();
  expect(calls).toBe(1);
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

test("rejected calls retain their original name and response when retransmitted with a valid tool", async () => {
  let calls = 0;
  const h = fixture(async () => {
    calls++;
  });
  await h.session.connect("key");
  h.send({ toolCall: { functionCalls: [{ id: "rejected", name: "undeclared" }] } });
  h.send({ toolCall: { functionCalls: [{ id: "rejected", name: "work" }] } });
  await flush();
  expect(calls).toBe(0);
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
