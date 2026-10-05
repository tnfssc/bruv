import { describe, expect, test } from "bun:test";
import { VoiceSession } from "../src/live/session";
import { OpenAIRealtimeSession, type RealtimeSocket } from "../src/live/openai-session";
import { GPTLiveSession, type LiveSocket } from "../src/live/gpt-live-session";
import { InputResampler } from "../src/live/openai-resample";
import type { LiveAdapter, LiveConnection } from "../src/live/types";
import { StartupAudioQueue } from "./helpers/live-startup-audio-queue";

// Real session classes; fake SDK connection/socket. NOT remote VAD/timing evidence.
class Socket implements RealtimeSocket, LiveSocket {
  readyState = 1;
  bufferedAmount = 0;
  sent: any[] = [];
  listeners = new Map<string, ((event: any) => void)[]>();
  onSend?: () => void;
  send(data: string) {
    this.sent.push(JSON.parse(data));
    this.onSend?.();
  }
  close() {
    this.readyState = 3;
    this.fire("close", {});
  }
  addEventListener(type: string, fn: (event: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  fire(type: string, event: any) {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }
  event(value: unknown) {
    this.fire("message", { data: JSON.stringify(value) });
  }
}
type Kind = "gemini" | "openai-realtime" | "gpt-live";
function fixture(kind: Kind) {
  const socket = new Socket();
  let queue!: StartupAudioQueue;
  let resolve!: (value: LiveConnection) => void;
  let reject!: (error: Error) => void;
  const adapter: LiveAdapter = () => ({
    live: {
      connect: () =>
        new Promise<LiveConnection>((r, j) => {
          resolve = r;
          reject = j;
        }),
    },
  });
  const callbacks = {
    onState: (state: string) => {
      if (state === "closed" || state === "error") queue.stop();
    },
    onError: () => queue.stop(),
    onClosed: () => queue.stop(),
  };
  const session =
    kind === "gemini"
      ? new VoiceSession(callbacks, adapter)
      : kind === "openai-realtime"
        ? new OpenAIRealtimeSession(callbacks, () => socket)
        : new GPTLiveSession(callbacks, () => socket);
  const send = (pcm: Buffer) => {
    if (session instanceof GPTLiveSession) session.appendMicrophone(pcm);
    else session.sendAudio(pcm.toString("base64"));
  };
  queue = new StartupAudioQueue(send, () => session.state === "ready");
  return {
    session,
    socket,
    queue,
    send,
    open: () => {
      if (kind !== "gemini") socket.fire("open", {});
    },
    ready: () => {
      if (kind === "gemini")
        resolve({
          sendRealtimeInput: (data: any) => {
            socket.sent.push(data);
            socket.onSend?.();
          },
          close: () => {},
        } as unknown as LiveConnection);
      else
        socket.event(
          kind === "openai-realtime"
            ? { type: "session.updated" }
            : {
                type: "session.started",
                session: { id: "startup_probe", model: "gpt-live-1", delegation: { type: "client" } },
              },
        );
    },
    fail: () => {
      if (kind === "gemini") reject(new Error("fake startup failure"));
      else socket.fire("error", {});
    },
    audio: () =>
      Buffer.concat(
        socket.sent.flatMap((e) => {
          const b64 = e.audio?.data ?? (typeof e.audio === "string" ? e.audio : undefined);
          return b64 ? [Buffer.from(b64, "base64")] : [];
        }),
      ),
    close: async () => {
      queue.stop();
      const closing = session.close();
      if (kind === "gpt-live") socket.event({ type: "session.closed" });
      await closing;
    },
  };
}
function chunk(value: number) {
  const out = Buffer.alloc(640);
  for (let i = 0; i < out.length; i += 2) out.writeInt16LE(value, i);
  return out;
}
function expected(kind: Kind, chunks: Buffer[]) {
  const input = Buffer.concat(chunks);
  if (kind === "gemini") return input;
  const resampler = new InputResampler();
  return Buffer.from(resampler.push(input)); // adapters share streaming 16->24k, with one held sample
}
for (const kind of ["gemini", "openai-realtime", "gpt-live"] as const)
  describe(kind, () => {
    for (const paceMs of [0, 1])
      test("startup FIFO waits for ready, preserves buffered and fresh PCM (pace=" + paceMs + ")", async () => {
        const f = fixture(kind);
        const connecting = f.session.connect("test-only-not-a-key");
        const chunks = [chunk(1100), chunk(2200), chunk(3300), chunk(4400), chunk(5500)];
        f.send(chunks[0]); // existing adapters discard audio before ready: queue is necessary
        const reused = Buffer.from(chunks[0]);
        f.queue.push(reused);
        reused.fill(0);
        f.open(); // transport open is NOT provider ready
        f.queue.push(chunks[1]);
        await f.queue.ready(paceMs);
        await Bun.sleep(5); // delayed handshake while synthetic capture continues
        f.queue.push(chunks[2]);
        expect(f.session.state).toBe("connecting");
        expect(f.audio().length).toBe(0);
        expect(f.queue.queuedBytes).toBe(1920);
        f.ready();
        await connecting;
        expect(f.audio().length).toBe(0);
        let appended = false;
        f.socket.onSend = () => {
          if (!appended) {
            appended = true;
            f.queue.push(chunks[3]);
          }
        };
        await f.queue.ready(paceMs); // fresh capture DURING replay joins the tail, never overtakes
        f.queue.push(chunks[4]); // fresh capture AFTER replay
        expect(f.audio()).toEqual(expected(kind, chunks));
        expect(f.queue.queuedBytes).toBe(0);
        await f.close();
      });
    test("stopped startup discards PCM, including a late ready result", async () => {
      const f = fixture(kind);
      const connecting = f.session.connect("test-only");
      f.queue.push(chunk(1100));
      await f.session.close(); // lifecycle callback discards startup audio
      f.ready();
      await connecting;
      await f.queue.ready();
      f.queue.push(chunk(2200));
      expect(f.session.state).toBe("closed");
      expect(f.queue.queuedBytes).toBe(0);
      expect(f.audio().length).toBe(0);
    });
    test("failed startup discards PCM and never replays it", async () => {
      const f = fixture(kind);
      const connecting = f.session.connect("test-only");
      f.queue.push(chunk(1100));
      f.fail();
      await connecting;
      f.ready();
      await f.queue.ready();
      f.queue.push(chunk(2200));
      expect(f.queue.queuedBytes).toBe(0);
      expect(f.audio().length).toBe(0);
      await f.close();
    });
  });

test("test FIFO fails explicitly at its bound and discards the backlog", async () => {
  const sends: Buffer[] = [];
  const queue = new StartupAudioQueue(
    (pcm) => sends.push(pcm),
    () => true,
    640,
  );
  queue.push(chunk(1100));
  expect(() => queue.push(chunk(2200))).toThrow("Startup probe queue exceeded byte limit");
  await queue.ready();
  expect(queue.queuedBytes).toBe(0);
  expect(sends).toEqual([]);
});
