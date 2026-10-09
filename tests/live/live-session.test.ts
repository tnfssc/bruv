import { expectExecuteOnce } from "../prompts/combined-request";
import { setupProbeOrchestration } from "../../src/live/setup-probe";
import { ThinkingLevel } from "@google/genai";
import { describe, expect, test } from "bun:test";
import { VoiceSession } from "../../src/live/session.js";
import { bruvSystemPrompt } from "../../src/prompts";
import type { LiveAdapter, LiveParams, LiveConnection } from "../../src/live/types.js";

function harness() {
  let params!: LiveParams;
  let resolve!: (connection: LiveConnection) => void;
  let reject!: (error: Error) => void;
  const sends: unknown[] = [];
  let closes = 0;
  let onSend: (() => void) | undefined;
  const adapter: LiveAdapter = () =>
    ({
      live: {
        connect: (p: LiveParams) => {
          params = p;
          return new Promise<LiveConnection>((r, j) => {
            resolve = r;
            reject = j;
          });
        },
      },
    }) as ReturnType<LiveAdapter>;
  const connection = {
    sendClientContent: (data: unknown) => {
      sends.push(data);
    },
    sendToolResponse: (data: unknown) => {
      sends.push(data);
    },
    sendRealtimeInput: (data: unknown) => {
      sends.push(data);
      onSend?.();
    },
    close: () => {
      closes++;
    },
  } as unknown as LiveConnection;
  return {
    adapter,
    sends,
    get params() {
      return params;
    },
    get closes() {
      return closes;
    },
    ready: () => resolve(connection),
    reject: () => reject(new Error("secret")),
    setOnSend: (f: () => void) => {
      onSend = f;
    },
  };
}
const msg = (content: object) => content as Parameters<LiveParams["callbacks"]["onmessage"]>[0];
const audio = (data = "AAAAAA==", mimeType = "audio/pcm;rate=24000") => ({
  modelTurn: { parts: [{ inlineData: { mimeType, data } }] },
});

describe("voice-only SDK session", () => {
  test("setup sends execute help once across Gemini instructions and declarations", async () => {
    const h = harness();
    const s = new VoiceSession({}, h.adapter, setupProbeOrchestration());
    const connecting = s.connect("offline");
    const config = h.params.config!;
    expectExecuteOnce(
      config.systemInstruction as string,
      (config.tools![0]! as { functionDeclarations: any[] }).functionDeclarations,
    );
    h.ready();
    await connecting;
    s.close();
  });

  test("direct main agent uses external instructions and dispatches execute once", async () => {
    const h = harness();
    const calls: unknown[] = [];
    const s = new VoiceSession({}, h.adapter, {
      instructions: "ordinary root prompt",
      tools: [{ name: "execute", parametersJsonSchema: { type: "object", properties: { code: { type: "string" } } } }],
      execute: async (call) => {
        calls.push(call);
        return { content: [{ type: "text", text: "done" }] };
      },
    });
    const connecting = s.connect("fake");
    expect(h.params.config?.systemInstruction).toBe("ordinary root prompt");
    expect(h.params.config?.thinkingConfig).toBeUndefined();
    expect(h.params.config?.tools).toMatchObject([{ functionDeclarations: [{ name: "execute" }] }]);
    h.ready();
    await connecting;
    const call = msg({ toolCall: { functionCalls: [{ id: "c1", name: "execute", args: { code: "1+1" } }] } });
    h.params.callbacks.onmessage(call);
    h.params.callbacks.onmessage(call);
    await Bun.sleep(0);
    expect(calls).toEqual([{ id: "c1", name: "execute", args: { code: "1+1" } }]);
    expect(h.sends).toEqual([
      expect.objectContaining({
        functionResponses: expect.objectContaining({
          id: "c1",
          response: { output: { content: [{ type: "text", text: "done" }] } },
        }),
      }),
    ]);
    s.close();
  });
  test("Gemini SDK usageMetadata reaches billing without audio render", async () => {
    const h = harness();
    const usage: unknown[] = [];
    const s = new VoiceSession({ onUsage: (u) => usage.push(u) }, h.adapter);
    const pending = s.connect("fake");
    h.ready();
    await pending;
    h.params.callbacks.onmessage(
      msg({ usageMetadata: { promptTokensDetails: [{ modality: "AUDIO", tokenCount: 100 }] } }),
    );
    expect(usage).toEqual([{ promptTokensDetails: [{ modality: "AUDIO", tokenCount: 100 }] }]);
    s.close();
  });
  test("extended-thinking selected endpoint retains direct owner setup and transcription finality", async () => {
    const h = harness();
    const heard: unknown[] = [];
    const statuses: string[] = [];
    const s = new VoiceSession(
      { onInputTranscript: (t) => heard.push(t), onInteractionStatus: (status) => statuses.push(status) },
      h.adapter,
      {
        instructions: "root",
        tools: [{ name: "execute", parametersJsonSchema: { type: "object" } }],
        execute: async () => ({ content: [] }),
      },
      "gemini-3.8-live-extended-thinking",
    );
    const pending = s.connect("fake");
    expect(h.params.model).toBe("gemini-3.8-live-extended-thinking");
    expect(h.params.config?.thinkingConfig?.thinkingLevel).toBe(ThinkingLevel.LOW);
    expect(h.params.config).toMatchObject({
      systemInstruction: "root",
      responseModalities: ["AUDIO"],
      tools: [{ functionDeclarations: [{ name: "execute" }] }],
    });
    h.ready();
    await pending;
    h.params.callbacks.onmessage(msg({ serverContent: { inputTranscription: { text: "hello" } } }));
    expect(heard).toEqual([
      expect.objectContaining({ text: "hello", finished: true, finalitySource: "model_contract" }),
    ]);
    h.params.callbacks.onmessage(
      msg({ toolCall: { functionCalls: [{ id: "extended-1", name: "execute", args: {} }] } }),
    );
    await Bun.sleep(0);
    expect(h.sends).toContainEqual({
      functionResponses: { id: "extended-1", name: "execute", response: expect.any(Object) },
    });
    expect(JSON.stringify(h.sends)).not.toContain("WHEN_IDLE");
    h.params.callbacks.onmessage(msg({ serverContent: { interactionStatus: "IN_PROGRESS", turnComplete: true } }));
    expect(statuses).toEqual(["IN_PROGRESS"]);
    h.params.callbacks.onmessage(msg({ serverContent: { interactionStatus: "IDLE", turnComplete: true } }));
    expect(statuses).toEqual(["IN_PROGRESS", "IDLE"]);
    s.close();
  });
  test("ready only after SDK setup-accepted promise, VAD, mic and end idempotence", async () => {
    const h = harness();
    const events: string[] = [];
    const s = new VoiceSession({ onReady: () => events.push("ready"), onState: (v) => events.push(v) }, h.adapter);
    s.sendAudio("AAAAAA==");
    const pending = s.connect("key");
    expect(h.params.model).toBe("gemini-3.8-live");
    expect(h.params.config).toMatchObject({
      responseModalities: ["AUDIO"],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      realtimeInputConfig: { automaticActivityDetection: { disabled: false } },
    });
    expect(h.params.config?.tools).toBeUndefined();
    expect(h.params.config?.systemInstruction).toBe(bruvSystemPrompt());
    h.params.callbacks.onmessage(msg({ setupComplete: {} }));
    expect(s.state).toBe("connecting");
    expect(h.sends).toHaveLength(0);
    h.ready();
    await pending;
    s.sendAudio("AAAAAA==");
    s.sendAudio("not base64");
    s.endAudio();
    s.endAudio();
    expect(h.sends).toEqual([
      { audio: { data: "AAAAAA==", mimeType: "audio/pcm;rate=16000" } },
      { audioStreamEnd: true },
    ]);
    expect(events).toEqual(["connecting", "ready", "ready"]);
    s.close();
    s.close();
    expect(h.closes).toBe(1);
    expect(() => s.connect("again")).toThrow();
  });
  test("interrupted packet audio discarded; only interruption flushes, transcript metadata retained", async () => {
    const h = harness();
    const out: unknown[] = [];
    const s = new VoiceSession(
      {
        onAudio: (a, g) => out.push(["audio", a, g]),
        onInputTranscript: (t) => out.push(["input", t]),
        onOutputTranscript: (t, g) => out.push(["output", t, g]),
        onInterrupted: (g) => out.push(["flush", g]),
        onTurnComplete: (t) => out.push(["done", t]),
      },
      h.adapter,
    );
    const pending = s.connect("key");
    h.ready();
    await pending;
    h.params.callbacks.onmessage(
      msg({
        serverContent: {
          ...audio(),
          inputTranscription: { text: "heard", finished: true, languageCode: "en" },
          outputTranscription: { text: "said", finished: false },
          turnComplete: true,
        },
      }),
    );
    h.params.callbacks.onmessage(
      msg({
        serverContent: {
          interrupted: true,
          ...audio(),
          outputTranscription: { text: "", finished: true },
          turnComplete: true,
        },
      }),
    );
    h.params.callbacks.onmessage(msg({ serverContent: { ...audio(), turnComplete: true } }));
    expect(out).toEqual([
      ["audio", "AAAAAA==", 0],
      ["input", { text: "heard", finished: true, rawFinished: true, finalitySource: "provider", languageCode: "en" }],
      ["output", { text: "said", finished: false }, 0],
      ["done", 0],
      ["flush", 1],
      ["output", { text: "", finished: true, interrupted: true }, 1],
      ["done", 1],
      ["audio", "AAAAAA==", 1],
      ["done", 2],
    ]);
    expect(s.generation).toBe(1);
    expect(s.turn).toBe(3);
    expect(s.diagnostics).toMatchObject({ serverInterruptions: 1, turnCompletions: 3 });
    expect(s.diagnostics.lastInterruptedAtMs).toBeGreaterThan(0);
  });
  test("normal completion and local transport failure never count as provider interruption", async () => {
    const h = harness();
    const s = new VoiceSession({}, h.adapter);
    const connecting = s.connect("key");
    h.ready();
    await connecting;
    h.params.callbacks.onmessage(msg({ serverContent: { turnComplete: true } }));
    expect(s.diagnostics).toEqual({ serverInterruptions: 0, turnCompletions: 1, lastInterruptedAtMs: undefined });
    h.params.callbacks.onerror?.({} as ErrorEvent);
    expect(s.state).toBe("closed");
    expect(s.diagnostics.serverInterruptions).toBe(0);
  });
  test("invalid output mime/rate, alignment, base64 and packet size fail safely once", async () => {
    for (const [content, expected] of [
      [audio("AAAAAA==", "audio/pcm;rate=240000"), "Invalid output audio chunk"],
      [audio("AAAAAA==".repeat(32001)), "Invalid output audio chunk"],
      [audio(Buffer.alloc(96002).toString("base64")), "Invalid output audio chunk"],
      [audio(Buffer.alloc(3).toString("base64")), "Invalid output audio chunk"],
    ] as const) {
      const h = harness();
      const errors: unknown[] = [];
      const s = new VoiceSession({ onError: (e) => errors.push(e) }, h.adapter);
      const pending = s.connect("key");
      h.ready();
      await pending;
      h.params.callbacks.onmessage(msg({ serverContent: content }));
      expect(errors).toEqual([{ code: "invalid_audio", message: expected }]);
      expect(s.state).toBe("closed");
      h.params.callbacks.onerror?.({} as ErrorEvent);
      expect(h.closes).toBe(1);
    }
  });
  test("aggregate transcript limit gives explicit terminal error", async () => {
    const h = harness();
    const out: unknown[] = [];
    const s = new VoiceSession({ onError: (e) => out.push(e) }, h.adapter);
    const p = s.connect("key");
    h.ready();
    await p;
    h.params.callbacks.onmessage(msg({ serverContent: { inputTranscription: { text: "x".repeat(4096) } } }));
    h.params.callbacks.onmessage(msg({ serverContent: { inputTranscription: { text: "x" } } }));
    expect(out).toEqual([{ code: "transcript_limit", message: "Voice transcription limit exceeded" }]);
    expect(s.state).toBe("closed");
  });
  test("close during pending connect cancels immediately and closes a late connection without callbacks", async () => {
    const h = harness();
    const out: unknown[] = [];
    const s = new VoiceSession({ onReady: () => out.push("ready"), onError: (e) => out.push(e) }, h.adapter);
    const pending = s.connect("private");
    s.close();
    await pending;
    h.ready();
    await Promise.resolve();
    h.params.callbacks.onmessage(msg({ serverContent: { inputTranscription: { text: "secret" } } }));
    expect(out).toEqual([]);
    expect(h.closes).toBe(1);
  });
  test("close during pending connect consumes a late SDK rejection", async () => {
    const h = harness();
    const s = new VoiceSession({}, h.adapter);
    const pending = s.connect("key");
    s.close();
    await pending;
    h.reject();
    await Promise.resolve();
  });
  test("SDK close followed by error reports one failure even when terminal callbacks throw", async () => {
    const h = harness();
    const out: unknown[] = [];
    const s = new VoiceSession(
      {
        onError: (e) => {
          out.push(e);
          throw Error("user");
        },
        onState: (v) => {
          out.push(v);
          if (v === "closed") throw Error("user");
        },
      },
      h.adapter,
    );
    const p = s.connect("key");
    h.ready();
    await p;
    h.params.callbacks.onclose?.({} as CloseEvent);
    h.params.callbacks.onerror?.({} as ErrorEvent);
    expect(out).toEqual([
      "connecting",
      "ready",
      "closed",
      { code: "disconnected", message: "Voice connection closed" },
    ]);
    expect(h.closes).toBe(1);
  });
  test("throwing audio callback becomes a sanitized transport failure without escaping the SDK", async () => {
    const h = harness();
    const errors: unknown[] = [];
    const s = new VoiceSession(
      {
        onAudio: () => {
          throw Error("secret");
        },
        onError: (e) => errors.push(e),
      },
      h.adapter,
    );
    const pending = s.connect("key");
    h.ready();
    await pending;
    expect(() => h.params.callbacks.onmessage(msg({ serverContent: audio() }))).not.toThrow();
    expect(errors).toEqual([{ code: "transport_error", message: "Voice callback failed" }]);
  });
  test("onReady can close the newly accepted connection reentrantly", async () => {
    const h = harness();
    const s = new VoiceSession({ onReady: () => s.close() }, h.adapter);
    const pending = s.connect("key");
    h.ready();
    await pending;
    expect(s.state).toBe("closed");
    expect(h.closes).toBe(1);
  });
  test("provider goAway reports sanitized session expiry", async () => {
    const h = harness();
    const expiry: unknown[] = [];
    const s = new VoiceSession({ onError: (e) => expiry.push(e) }, h.adapter);
    const pending = s.connect("key");
    h.ready();
    await pending;
    h.params.callbacks.onmessage(msg({ goAway: { timeLeft: "3s" } }));
    expect(expiry).toEqual([{ code: "expiring", message: "Voice session expiring; start a new session" }]);
  });
  test("setup never completes: bounded timeout, no late mic or duplicate failure", async () => {
    const h = harness();
    const out: unknown[] = [];
    const original = globalThis.setTimeout;
    let trigger: (() => void) | undefined;
    globalThis.setTimeout = ((fn: () => void, ms: number) => {
      expect(ms).toBe(15000);
      trigger = fn;
      return original(() => {}, 60000);
    }) as typeof setTimeout;
    try {
      const s = new VoiceSession({ onReady: () => out.push("ready"), onError: (e) => out.push(e) }, h.adapter);
      const p = s.connect("key");
      trigger?.();
      await p;
      h.ready();
      await Promise.resolve();
      s.sendAudio("AAAAAA==");
      h.params.callbacks.onclose?.({} as CloseEvent);
      expect(h.closes).toBe(1);
      expect(h.sends).toHaveLength(0);
      expect(out).toEqual([{ code: "connect_failed", message: "Voice connection timed out" }]);
    } finally {
      globalThis.setTimeout = original;
    }
  });
  test("onState connecting can close before SDK connection or mic input", async () => {
    const h = harness();
    const s = new VoiceSession(
      {
        onState: (v) => {
          if (v === "connecting") s.close();
        },
      },
      h.adapter,
    );
    await s.connect("key");
    expect(s.state).toBe("closed");
    expect(h.sends).toEqual([]);
  });
  test("reentrant close during audio send closes the connection once", async () => {
    const h = harness();
    const s = new VoiceSession({}, h.adapter);
    const pending = s.connect("key");
    h.ready();
    await pending;
    h.setOnSend(() => s.close());
    s.sendAudio("AAAAAA==");
    expect(s.state).toBe("closed");
    expect(h.closes).toBe(1);
  });
});

test("main Gemini context retains large history and completion explicitly triggers voice", async () => {
  const h = harness();
  const s = new VoiceSession({}, h.adapter, {
    instructions: "root",
    tools: [],
    async execute() {},
  });
  const pending = s.connect("fake");
  h.ready();
  await pending;
  const history = "history:" + "x".repeat(12000);
  s.sendContext(history, { triggerResponse: false });
  s.sendContext("job completed");
  expect(h.sends).toEqual([
    { turns: [{ role: "user", parts: [{ text: history }] }], turnComplete: false },
    { turns: [{ role: "user", parts: [{ text: "job completed" }] }], turnComplete: true },
  ]);
  s.sendContext("é".repeat(524_289));
  expect(s.state).toBe("closed");
  expect(h.sends).toHaveLength(2);
  s.close();
});

describe("Google push-to-talk turns", () => {
  test("manual activity encloses only accepted audio and repeated releases do nothing", async () => {
    const h = harness();
    const s = new VoiceSession({}, h.adapter, undefined, undefined, { inputMode: "push-to-talk" });
    const pending = s.connect("key");
    expect(h.params.config?.realtimeInputConfig?.automaticActivityDetection).toEqual({ disabled: true });
    h.ready();
    await pending;
    s.endAudio();
    s.sendAudio("not base64");
    expect(h.sends).toEqual([]);
    s.sendAudio("AAAAAA==");
    s.sendAudio("AAAAAA==");
    s.endAudio();
    s.endAudio();
    expect(h.sends).toEqual([
      { activityStart: {} },
      { audio: { data: "AAAAAA==", mimeType: "audio/pcm;rate=16000" } },
      { audio: { data: "AAAAAA==", mimeType: "audio/pcm;rate=16000" } },
      { activityEnd: {} },
    ]);
    expect(s.state).toBe("ready");
    s.sendAudio("AAAAAA==");
    s.endAudio();
    expect(h.sends.slice(4)).toEqual([
      { activityStart: {} },
      { audio: { data: "AAAAAA==", mimeType: "audio/pcm;rate=16000" } },
      { activityEnd: {} },
    ]);
    s.close();
    s.sendAudio("AAAAAA==");
    s.endAudio();
    expect(h.sends).toHaveLength(7);
  });

  test("explicit continuous mode keeps automatic detection and stream-end wire", async () => {
    const h = harness();
    const s = new VoiceSession({}, h.adapter, undefined, undefined, { inputMode: "continuous" });
    const pending = s.connect("key");
    expect(h.params.config?.realtimeInputConfig?.automaticActivityDetection).toEqual({ disabled: false });
    h.ready();
    await pending;
    s.sendAudio("AAAAAA==");
    s.endAudio();
    expect(h.sends).toEqual([
      { audio: { data: "AAAAAA==", mimeType: "audio/pcm;rate=16000" } },
      { audioStreamEnd: true },
    ]);
    s.close();
  });
});
