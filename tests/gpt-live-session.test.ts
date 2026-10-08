import { describe, expect, test } from "bun:test";
import { type GPTLiveCallbacks, GPTLiveSession, type LiveSocket } from "../src/live/gpt-live-session";
import gptLiveInstruction from "../src/prompts/gpt-live.md" with { type: "text" };

class Socket implements LiveSocket {
  bufferedAmount = 0;
  sent: any[] = [];
  handlers = new Map<string, ((event: any) => void)[]>();
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.fire("close");
  }
  addEventListener(type: "open" | "message" | "error" | "close", handler: (event: any) => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }
  fire(type: string, event: any = {}) {
    for (const handler of this.handlers.get(type) ?? []) handler(event);
  }
  event(body: object) {
    this.fire("message", { data: JSON.stringify(body) });
  }
  ready() {
    this.fire("open");
    this.event({
      type: "session.started",
      session: { id: "live_1", model: "gpt-live-1", delegation: { type: "client" } },
    });
  }
}
function fixture(callbacks: GPTLiveCallbacks = {}, timeouts?: { connectMs: number; closeMs: number }) {
  const socket = new Socket();
  const endpoints: any[] = [];
  const session = new GPTLiveSession(
    callbacks,
    (url, headers) => {
      endpoints.push({ url, headers });
      return socket;
    },
    timeouts,
  );
  return { socket, session, endpoints };
}

// Use only when admission itself is not under test. Terminal events stay explicit in each scenario.
async function connectedFixture(callbacks: GPTLiveCallbacks = {}, timeouts?: { connectMs: number; closeMs: number }) {
  const f = fixture(callbacks, timeouts);
  const connecting = f.session.connect("fake");
  f.socket.ready();
  await connecting;
  return f;
}

describe("Admission and microphone transport", () => {
  test("official primary Live handshake and continuous microphone resampling; no Realtime commands", async () => {
    const ready: string[] = [];
    const { socket, session, endpoints } = fixture({ onReady: (id) => ready.push(id) });
    const pending = session.connect("test-key-not-real");
    expect(endpoints).toEqual([
      { url: "wss://api.openai.com/v1/live/sessions", headers: { Authorization: "Bearer test-key-not-real" } },
    ]);
    expect(session.appendMicrophone(new Uint8Array(640))).toBe(false);
    socket.fire("open");
    expect(socket.sent).toEqual([
      {
        type: "session.start",
        event_id: "live_start",
        session: {
          model: "gpt-live-1",
          instructions: gptLiveInstruction.trimEnd(),
          audio: { format: { type: "audio/pcm", rate: 24000 }, output: { voice: "marin" } },
          delegation: { type: "client" },
        },
      },
    ]);
    socket.event({
      type: "session.started",
      session: { id: "live_1", model: "gpt-live-1", delegation: { type: "client" } },
    });
    await pending;
    expect(ready).toEqual(["live_1"]);
    for (let i = 0; i < 50; i++) expect(session.appendMicrophone(new Uint8Array(640))).toBe(true);
    expect(socket.sent.slice(1).every((event) => event.type === "session.input_audio.append")).toBe(true);
    expect(socket.sent.slice(1).reduce((n, event) => n + Buffer.from(event.audio, "base64").length, 0)).toBe(47_998);
    expect(() => session.appendMicrophone(new Uint8Array(3))).toThrow();
    const done = session.close();
    expect(socket.sent.at(-1)).toEqual({ type: "session.close" });
    socket.event({ type: "session.closed", usage: { seconds: 2 } });
    await done;
    expect(session.state).toBe("closed");
  });

  test("rejects a different resolved model before audio can flow", async () => {
    const errors: string[] = [];
    const { socket, session } = fixture({ onError: (e) => errors.push(e) });
    const start = session.connect("fake");
    socket.fire("open");
    socket.event({
      type: "session.started",
      session: { id: "live_1", model: "gpt-realtime-2.1", delegation: { type: "client" } },
    });
    await start;
    expect(errors).toEqual(["Invalid Live session.started"]);
    expect(session.appendMicrophone(new Uint8Array(640))).toBe(false);
  });

  test("early API key rejection is sanitized and cannot finalize usage", async () => {
    const errors: string[] = [];
    const closed: unknown[] = [];
    const { session, socket } = fixture({
      onError: (e) => errors.push(e),
      onClosed: (finalized, usage) => closed.push({ finalized, usage }),
    });
    const start = session.connect("fake");
    socket.fire("open");
    socket.event({ type: "error", error: { message: "SECRET key", code: "invalid_api_key" } });
    await start;
    expect(errors).toEqual(["OpenAI rejected the API key for gpt-live-1. Use /login to configure an OpenAI API key."]);
    expect(closed).toEqual([{ finalized: false, usage: undefined }]);
  });

  for (const code of ["insufficient_quota", "model_not_found", "rate_limit_exceeded", "invalid_api_key"]) {
    test(`${code} is classified without leaking raw content or retrying another endpoint`, async () => {
      const errors: string[] = [];
      const f = fixture({ onError: (e) => errors.push(e) });
      const connect = f.session.connect("fake");
      f.socket.event({ type: "error", error: { code, message: "SECRET" } });
      await connect;
      expect(errors[0]).toContain("gpt-live-1");
      expect(errors[0]).not.toContain("SECRET");
      expect(f.endpoints).toHaveLength(1);
    });
  }

  test("handshake timeout fences stale socket callbacks", async () => {
    const errors: string[] = [];
    let audio = 0;
    const { socket, session } = fixture(
      {
        onError: (e) => errors.push(e),
        onAudio: () => {
          audio++;
        },
      },
      { connectMs: 5, closeMs: 5 },
    );
    const pending = session.connect("fake");
    await Bun.sleep(10);
    await pending;
    expect(session.state).toBe("closed");
    expect(errors).toEqual(["Live session start timed out"]);
    socket.ready();
    socket.event({ type: "session.output_audio.delta", delta: Buffer.alloc(960).toString("base64") });
    expect(audio).toBe(0);
    expect(socket.sent).toEqual([]);
  });

  test("explicit close settles a pending handshake and ignores a late admission", async () => {
    const { session, socket } = fixture();
    const connect = session.connect("fake");
    await session.close();
    await connect;
    socket.ready();
    expect(session.state).toBe("closed");
    expect(socket.sent).toEqual([]);
  });
});

describe("Provisional transcript and client delegation", () => {
  test("interleaved provisional transcripts and offset-only client delegation, dedupe, scoped updates", async () => {
    const input: any[] = [],
      output: any[] = [],
      delegates: any[] = [],
      pcm: Uint8Array[] = [];
    const { socket, session } = await connectedFixture({
      onInputTranscript: (x) => input.push(x),
      onOutputTranscript: (x) => output.push(x),
      onDelegation: (x) => delegates.push(x),
      onAudio: (x) => pcm.push(x),
    });
    const fragment = (delta: string, start_ms: number, end_ms: number) =>
      socket.event({ type: "session.input_transcript.delta", delta, start_ms, end_ms });
    fragment("Thursday", 100, 400);
    socket.event({ type: "session.output_transcript.delta", delta: "Checking", start_ms: 410, end_ms: 700 });
    const delegate = {
      type: "session.delegation.created",
      offset_ms: 400,
      delegation: { id: "item_1", type: "delegation", target: "client" },
    };
    socket.event(delegate);
    socket.event(delegate);
    fragment(", not Friday", 250, 500); // late correction: offset does not confer transcript finality
    expect(input).toEqual([
      { delta: "Thursday", startMs: 100, endMs: 400 },
      { delta: ", not Friday", startMs: 250, endMs: 500 },
    ]);
    expect(output).toEqual([{ delta: "Checking", startMs: 410, endMs: 700 }]);
    expect(delegates).toEqual([{ id: "item_1", target: "client", offsetMs: 400 }]);
    expect(session.commentary("unknown", "done")).toBe(false);
    expect(session.thinking("item_1", "Checking, nothing changed yet")).toBe(true);
    expect(session.commentary("item_1", "Confirmed for Thursday")).toBe(true);
    expect(socket.sent.slice(-2)).toEqual([
      {
        type: "session.thinking.append",
        event_id: "live_context_1",
        delegation_id: "item_1",
        content: "Checking, nothing changed yet",
      },
      {
        type: "session.commentary.append",
        event_id: "live_context_2",
        delegation_id: "item_1",
        content: "Confirmed for Thursday",
      },
    ]);
    socket.event({ type: "session.output_audio.delta", delta: Buffer.alloc(19_200).toString("base64") });
    expect(pcm.map((x) => x.length)).toEqual([9_600, 9_600]);
    socket.event({
      type: "session.delegation.created",
      offset_ms: 800,
      delegation: { id: "responses_1", target: "responses" },
    });
    expect(delegates).toHaveLength(1);
    const closing = session.close();
    socket.event({ type: "session.closed" });
    await closing;
  });
});

describe("Typed context and timeline delivery", () => {
  test("general host observations use nullable delegation and enforce conservative text token budget", async () => {
    const { session, socket } = await connectedFixture();
    expect(session.observation("Quoted untrusted host data", true)).toBe(true);
    expect(socket.sent.at(-1)).toEqual({
      type: "session.commentary.append",
      event_id: "live_context_1",
      delegation_id: null,
      content: "Quoted untrusted host data",
    });
    expect(() => session.observation("💬".repeat(121))).toThrow();
    socket.event({ type: "session.closed" });
  });

  test("typed context stays distinct; append acknowledgments mark timeline delivery, not task or speech completion", async () => {
    const acknowledged: any[] = [];
    const { socket, session } = await connectedFixture({ onContextAppended: (ack) => acknowledged.push(ack) });
    expect(session.instructions("Speak briefly and ask for confirmation.")).toBe(true);
    expect(session.observation("The job is still running.")).toBe(true);
    expect(socket.sent.slice(-2)).toEqual([
      {
        type: "session.instructions.append",
        event_id: "live_context_1",
        delegation_id: null,
        content: "Speak briefly and ask for confirmation.",
      },
      {
        type: "session.thinking.append",
        event_id: "live_context_2",
        delegation_id: null,
        content: "The job is still running.",
      },
    ]);
    socket.event({ type: "session.instructions.appended", client_event_id: "unknown", start_ms: 10, end_ms: 20 });
    socket.event({ type: "session.commentary.appended", client_event_id: "live_context_1", start_ms: 10, end_ms: 20 });
    expect(acknowledged).toEqual([]);
    socket.event({
      type: "session.instructions.appended",
      client_event_id: "live_context_1",
      start_ms: 10,
      end_ms: 20,
    });
    socket.event({
      type: "session.instructions.appended",
      client_event_id: "live_context_1",
      start_ms: 10,
      end_ms: 20,
    });
    expect(acknowledged).toEqual([{ eventId: "live_context_1", type: "instructions", startMs: 10, endMs: 20 }]);
    const close = session.close();
    socket.event({ type: "session.closed" });
    await close;
  });

  test("unacknowledged context is bounded and a matched acknowledgment restores capacity", async () => {
    const { socket, session } = await connectedFixture();
    for (let i = 0; i < 256; i++) expect(session.observation("Bounded host context")).toBe(true);
    const count = socket.sent.length;
    expect(session.observation("Capacity exceeded")).toBe(false);
    expect(socket.sent.length).toBe(count);
    socket.event({ type: "session.thinking.appended", client_event_id: "live_context_1", start_ms: 0, end_ms: 1 });
    expect(session.observation("Capacity restored")).toBe(true);
    const close = session.close();
    socket.event({ type: "session.closed" });
    await close;
    expect(session.observation("No updates after closure")).toBe(false);
  });
});

describe("Transport closure and usage", () => {
  test("send queue overflow closes without final usage, even if a terminal event arrives later", async () => {
    const errors: string[] = [];
    const closed: boolean[] = [];
    const { socket, session } = await connectedFixture({
      onError: (e) => errors.push(e),
      onClosed: (final) => closed.push(final),
    });
    socket.bufferedAmount = 192_000;
    expect(session.appendMicrophone(new Uint8Array(640))).toBe(false);
    expect(errors).toEqual(["Live send queue exceeded limit"]);
    expect(closed).toEqual([false]);
    expect(session.state).toBe("closed");
    socket.event({ type: "session.closed" });
    expect(closed).toEqual([false]);
  });

  test("malformed output PCM fails the session", async () => {
    const errors: string[] = [];
    const { socket } = await connectedFixture({ onError: (e) => errors.push(e) });
    socket.event({ type: "session.output_audio.delta", delta: Buffer.alloc(3).toString("base64") });
    expect(errors).toEqual(["Invalid Live audio"]);
  });

  test("abrupt transport disconnect leaves final usage unknown", async () => {
    const closed: boolean[] = [];
    const { socket } = await connectedFixture({ onClosed: (final) => closed.push(final) });
    socket.fire("close");
    expect(closed).toEqual([false]);
  });

  test("GPT-Live cumulative usage and final billing event reach cost callback", async () => {
    const updates: unknown[] = [],
      closes: unknown[] = [];
    const { socket } = await connectedFixture({
      onUsage: (u) => updates.push(u),
      onClosed: (ok, u) => closes.push([ok, u]),
    });
    socket.event({ type: "session.usage.updated", usage: { seconds: 12 } });
    socket.event({ type: "session.closed", usage: { seconds: 15 } });
    expect(updates).toEqual([{ seconds: 12 }]);
    expect(closes).toEqual([[true, { seconds: 15 }]]);
  });

  test("requested close finalizes usage only on session.closed and rejects late commentary", async () => {
    const closed: unknown[] = [];
    const { session, socket } = await connectedFixture({
      onClosed: (finalized, usage) => closed.push({ finalized, usage }),
    });
    const ending = session.close();
    socket.event({ type: "session.closed", reason: "close_requested", usage: { total_audio_seconds: 4 } });
    await ending;
    expect(closed).toEqual([{ finalized: true, usage: { total_audio_seconds: 4 } }]);
    expect(session.commentary("anything", "late")).toBe(false);
  });

  test("concurrent close callers wait for one transport closure, not context delivery", async () => {
    const finalized: unknown[] = [];
    const usage: unknown[] = [];
    const acknowledgments: unknown[] = [];
    const { socket, session } = await connectedFixture({
      onClosed: (ok, finalUsage) => finalized.push([ok, finalUsage]),
      onUsage: (update) => usage.push(update),
      onContextAppended: (ack) => acknowledgments.push(ack),
    });
    session.observation("Still working");
    let settled = 0;
    const waiters = [session.close(), session.close(), session.close()].map((closing) => closing.then(() => settled++));
    expect(socket.sent.filter((event) => event.type === "session.close")).toHaveLength(1);
    socket.event({ type: "session.thinking.appended", client_event_id: "live_context_1", start_ms: 0, end_ms: 1 });
    socket.event({ type: "session.usage.updated", usage: { seconds: 2 } });
    await Promise.resolve();
    expect(settled).toBe(0);
    expect(acknowledgments).toEqual([]);
    expect(usage).toEqual([{ seconds: 2 }]);
    socket.event({ type: "session.closed", usage: { seconds: 3 } });
    await Promise.all(waiters);
    await session.close();
    socket.ready();
    socket.event({ type: "session.usage.updated", usage: { seconds: 4 } });
    socket.event({ type: "session.closed", usage: { seconds: 5 } });
    expect(settled).toBe(3);
    expect(finalized).toEqual([[true, { seconds: 3 }]]);
    expect(usage).toEqual([{ seconds: 2 }]);
    expect(session.closeError).toBeUndefined();
    await expect(session.connect("fake")).rejects.toThrow("Live session is single-use");
  });

  test("close deadline reports unknown final usage and no queued PCM survives closure", async () => {
    const finalized: boolean[] = [];
    const errors: string[] = [];
    const { socket, session } = await connectedFixture(
      { onClosed: (f) => finalized.push(f), onError: (e) => errors.push(e) },
      { connectMs: 50, closeMs: 5 },
    );
    const closing = session.close();
    const alsoClosing = session.close();
    expect(session.appendMicrophone(Buffer.alloc(640))).toBe(false);
    await Bun.sleep(10);
    await Promise.all([closing, alsoClosing]);
    expect(socket.sent.filter((event) => event.type === "session.close")).toHaveLength(1);
    expect(finalized).toEqual([false]);
    expect(errors).toEqual(["Live session.close timed out; final usage unknown"]);
    expect(session.closeError).toBe("Live session.close timed out; final usage unknown");
  });
});
