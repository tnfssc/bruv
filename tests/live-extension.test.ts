import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { InteractiveMode, initTheme } from "@earendil-works/pi-coding-agent";
import {
  Container,
  type EditorTheme,
  stripTerminalSequences,
  type Terminal,
  type TuiInputListener,
  TuiMainScreen,
} from "@earendil-works/pi-tui";
import type { AudioCallbacks } from "../src/live/audio";
import type { LiveDependencies } from "../src/live/extension";
import liveExtension from "../src/live/extension";
import { stopCurrentLive } from "../src/live/lifecycle-access";
import { defaultSocket, OpenAIRealtimeSession, type RealtimeSocket } from "../src/live/openai-session";
import type { VoiceCallbacks, VoiceOrchestration } from "../src/live/types";
import { CompactEditor } from "../src/ui/editor";
import * as startup from "../src/ui/startup";

let activeEditor: CompactEditor | undefined;
let editorGetter: ReturnType<typeof spyOn>;
const cleanups: (() => void | Promise<void>)[] = [];
beforeEach(() => {
  editorGetter = spyOn(startup, "getActiveCompactEditor").mockImplementation(() => activeEditor);
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  activeEditor = undefined;
  editorGetter.mockRestore();
});
const identity = (text: string) => text;
const editorTheme: EditorTheme = {
  borderColor: identity,
  selectList: {
    selectedPrefix: identity,
    selectedText: identity,
    description: identity,
    scrollInfo: identity,
    noMatch: identity,
  },
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function setup(overrides: Partial<LiveDependencies> = {}, continuousFixture = true) {
  let handler!: (args: string, ctx: any) => Promise<void>;
  let complete!: (prefix: string) => { value: string; label: string }[] | null;
  let shutdown!: () => void;
  let sessionStart!: () => void;
  let beforeTree!: () => Promise<void>;
  let voiceCallbacks!: VoiceCallbacks;
  let ownerCallbacks: any;
  let orchestration: VoiceOrchestration | undefined;
  const contexts: string[] = [];
  const ownerEvents: any[] = [];
  let ownerCloses = 0;
  let ownerAcquires = 0;
  let audioCallbacks!: AudioCallbacks;
  let keyCalls = 0,
    launches = 0,
    starts = 0,
    closes = 0,
    sends = 0;
  let endedAudio = 0;
  const captureGates: Array<number | null> = [];
  const terminalWrites: string[] = [];
  const terminal = {
    rows: 24,
    columns: 100,
    kittyProtocolActive: true,
    write: (data: string) => terminalWrites.push(data),
  } as unknown as Terminal;
  const tui = new TuiMainScreen(terminal);
  // Real SDK raw-listener -> focus -> release filtering -> CompactEditor routing.
  // Drawing, devices, and provider calls are the only simulated boundaries.
  const raw = tui as unknown as { handleTerminalInput(data: string): void; requestImmediateRender(): void };
  raw.requestImmediateRender = () => {};
  tui.requestRender = () => {};
  const editor = new CompactEditor(
    tui,
    editorTheme,
    {
      matches: (data: string, action: string) => action === "app.interrupt" && data === "\x1b",
    } as KeybindingsManager,
    { paddingX: 0 },
  );
  tui.addChild(editor);
  tui.setFocus(editor);
  activeEditor = editor;
  const dialogKeys: string[] = [];
  const dialog = {
    render: () => [],
    invalidate: () => {},
    handleInput: (data: string) => {
      dialogKeys.push(data);
    },
    focused: false,
  };
  let customCalls = 0;
  const played: { length: number; generation: number }[] = [];
  const flushes: number[] = [];
  const status: (string | undefined)[] = [];
  const widgets: (string[] | undefined)[] = [];
  const notices: string[] = [];
  let consent = true;
  let accepted = true;
  let deferred = false;
  let resolveConnect!: () => void;
  let resolveLaunch!: (value: any) => void;
  const audio = {
    setCaptureGate: async (epoch: number | null) => {
      captureGates.push(epoch);
    },
    diagnostics: { queuedMs: 0, captureFrames: 0, capturedBytes: 0 },
    start: async () => {
      starts++;
    },
    play: async (pcm: Buffer, generation: number) => {
      played.push({ length: pcm.length, generation });
    },
    flush: async (generation: number) => {
      flushes.push(generation);
    },
    stop: async () => {},
    close: () => {
      closes++;
    },
  };
  const deps: LiveDependencies = {
    local: () => true,
    config: { load: async () => ({ provider: "google", model: "gemini-3.8-live" }), save: async () => {} },
    speakerCheck: async () => "Test signal detected; compare mic/speaker route manually.",
    owner: async (_pi, _ctx, callbacks) => {
      ownerAcquires++;
      ownerCallbacks = callbacks;
      return {
        orchestration: {
          instructions: "Effective main-agent instructions",
          tools: [
            { name: "execute", description: "Run code", parametersJsonSchema: { type: "object", properties: {} } },
          ],
          execute: async (call: any) => {
            ownerEvents.push(["execute", call]);
            return { ok: true };
          },
        },
        typedInput: (text: string) => callbacks?.onInput?.(text),
        delegate: async (id: string, text: string, _provenance?: unknown, onAdmitted?: () => void) => {
          ownerEvents.push(["delegate", id, text]);
          onAdmitted?.();
        },
        stopForeground: () => {},
        inputTranscript: (text: string, final?: boolean) => ownerEvents.push(["input", text, final]),
        outputTranscript: (text: string, final?: boolean) => ownerEvents.push(["output", text, final]),
        interrupt: () => ownerEvents.push(["interrupt"]),
        turnComplete: () => ownerEvents.push(["turnComplete"]),
        close: () => {
          ownerCloses++;
          ownerEvents.push(["close"]);
        },
        released: Promise.resolve(),
        sendContext: (text: string) => {
          contexts.push(text);
          callbacks?.onContext?.(text);
        },
      };
    },
    credentials: async () => ({
      status: async () => ({ state: "stored_api_key", canImport: false }),
      loadKey: async () => "fake-test-only",
      importLiveEnv: async () => {
        throw new Error("unexpected import");
      },
    }),
    key: async () => {
      keyCalls++;
      return "fake-test-only";
    },
    voice: (callbacks, tools) => {
      orchestration = tools;
      voiceCallbacks = callbacks;
      return {
        state: "ready",
        sendContext: (text: string) => {
          contexts.push(text);
        },
        generation: 0,
        endAudio: () => {
          endedAudio++;
        },
        sendAudio: (_: string) => {
          sends++;
        },
        close: () => {},
        connect: async () => {
          if (deferred)
            await new Promise<void>((resolve) => {
              resolveConnect = resolve;
            });
          if (!accepted) throw new Error("SECRET");
        },
      };
    },
    audio: async (callbacks) => {
      launches++;
      audioCallbacks = callbacks;
      if (deferred)
        return new Promise((resolve) => {
          resolveLaunch = resolve;
        });
      return audio;
    },
    ...overrides,
  };
  // Existing conversation tests use continuous mic. PTT tests set their mode explicitly.
  const fixtureLoad = deps.config.load;
  if (continuousFixture)
    deps.config = { ...deps.config, load: async () => ({ inputMode: "continuous", ...(await fixtureLoad()) }) };
  const transcriptEntries: { type: string; data: any }[] = [];
  const listeners = new Map<string, (value: unknown) => void>();
  const events = {
    on: (name: string, cb: (value: unknown) => void) => {
      listeners.set(name, cb);
      return () => listeners.delete(name);
    },
    emit: (name: string, value: unknown) => listeners.get(name)?.(value),
  };
  const pi = { events } as any;
  liveExtension(
    {
      events,
      appendEntry: (type: string, data: any) => transcriptEntries.push({ type, data }),
      registerMessageRenderer: () => {},
      registerCommand: (name: string, cmd: any) => {
        expect(name).toBe("live");
        handler = cmd.handler;
        complete = cmd.getArgumentCompletions;
      },
      on: (event: string, cb: any) => {
        if (event === "session_shutdown") shutdown = cb;
        if (event === "session_start") sessionStart = cb;
        if (event === "session_before_tree") beforeTree = cb;
      },
    } as any,
    deps,
  );
  const ctx = {
    sessionManager: {
      getSessionId: () => "voice-owner",
      getSessionFile: () => "voice-file",
      getLeafId: () => "voice-branch",
    },
    mode: "tui",
    ui: {
      onTerminalInput: (handler: TuiInputListener) => tui.addInputListener(handler),
      custom: async () => {
        customCalls++;
        throw new Error("Live must use the shared editor, not a talk panel");
      },
      confirm: async () => consent,
      select: async (_title?: string, _options?: string[]): Promise<string | undefined> => "Done",
      notify: (value: string) => {
        notices.push(value);
      },
      setStatus: (key: string, value?: string) => {
        if (key === "bruv-live-cost") return;
        status.push(value);
      },
      setWidget: (_: string, value?: string[]) => {
        widgets.push(value);
      },
    },
  };
  cleanups.push(() => handler("stop", ctx));
  return {
    deliverContext: (text: string) => ownerCallbacks?.onContext?.(text),
    navigate: () => beforeTree(),
    stop: (context: any = ctx) => stopCurrentLive(pi, context),
    run: (arg: string) => handler(arg, ctx),
    complete: (prefix: string) => complete(prefix),
    contexts,
    input: (data: string) => raw.handleTerminalInput(data),
    editor,
    focusDialog: () => tui.setFocus(dialog),
    focusEditor: () => tui.setFocus(editor),
    dialogKeys,
    get customCalls() {
      return customCalls;
    },
    get endedAudio() {
      return endedAudio;
    },
    captureGates,
    terminalWrites,
    ownerEvents,
    get ownerAcquires() {
      return ownerAcquires;
    },
    get ownerCloses() {
      return ownerCloses;
    },
    transcriptEntries,
    get orchestration() {
      return orchestration;
    },
    ctx,
    audio,
    get voice() {
      return voiceCallbacks;
    },
    get capture() {
      return audioCallbacks;
    },
    get keyCalls() {
      return keyCalls;
    },
    get launches() {
      return launches;
    },
    get starts() {
      return starts;
    },
    get closes() {
      return closes;
    },
    get sends() {
      return sends;
    },
    status,
    widgets,
    notices,
    played,
    flushes,
    shutdown,
    sessionStart,
    decline: () => {
      consent = false;
    },
    reject: () => {
      accepted = false;
    },
    defer: () => {
      deferred = true;
    },
    resolveLaunch: () => resolveLaunch(audio),
    resolveConnect: () => resolveConnect(),
  };
}
describe("Live voice", () => {
  test("session switch revokes callbacks before asynchronous teardown and late audio launch", async () => {
    const t = setup();
    await t.run("start");
    const oldCapture = t.capture;
    const oldVoice = t.voice;
    const sent = t.sends;
    (t.ctx.sessionManager as any).getSessionId = () => "new-session";
    oldCapture.capture?.(Buffer.alloc(960));
    oldVoice.onAudio?.(Buffer.alloc(960).toString("base64"), 0);
    expect(t.sends).toBe(sent);
    t.sessionStart();
    await tick();
    expect(t.ownerCloses).toBe(1);
    oldCapture.capture?.(Buffer.alloc(960));
    oldVoice.onAudio?.(Buffer.alloc(960).toString("base64"), 0);
    expect(t.sends).toBe(sent);
  });
  test("direct execute owner is acquired before provider and audio", async () => {
    const order: string[] = [];
    const t = setup({
      owner: async (_pi, _ctx, callbacks) => {
        order.push("owner");
        return {
          orchestration: {
            instructions: "Main instructions",
            tools: [{ name: "execute", description: "Run code", parameters: {} }],
            execute: async () => ({ ok: true }),
          },
          typedInput: (text: string) => callbacks?.onInput?.(text),
          stopForeground: () => {},
          inputTranscript: (text, final) => order.push("input:" + text + ":" + final),
          outputTranscript: (text, final) => order.push("output:" + text + ":" + final),
          interrupt: () => order.push("interrupt"),
          turnComplete: () => order.push("turnComplete"),
          close: () => order.push("close"),
          released: Promise.resolve(),
          sendContext: (text) => callbacks?.onContext?.(text),
        };
      },
      audio: async () => {
        order.push("audio");
        return {
          diagnostics: { queuedMs: 0, captureFrames: 0, capturedBytes: 0 },
          start: async () => {},
          play: async () => {},
          flush: async () => {},
          stop: async () => {},
          close: () => {},
        };
      },
      voice: (_callbacks, tools) => {
        order.push("provider");
        expect(tools?.tools.map((tool) => tool.name)).toEqual(["execute"]);
        return { state: "ready", generation: 0, sendAudio: () => {}, connect: async () => {}, close: () => {} };
      },
    });
    await t.run("start");
    expect(order.indexOf("owner")).toBeLessThan(order.indexOf("audio"));
    expect(order.indexOf("owner")).toBeLessThan(order.indexOf("provider"));
    await t.run("stop");
    expect(order).toContain("close");
  });
  test("scoped execute self-stop awaits mic and provider teardown, not job cancellation", async () => {
    let release!: () => void;
    let stopped = false;
    let providerClosed = false;
    const t = setup({
      audio: async () => ({
        diagnostics: { queuedMs: 0, captureFrames: 0, capturedBytes: 0 },
        start: async () => {},
        play: async () => {},
        flush: async () => {},
        stop: () =>
          new Promise<void>((resolve) => {
            release = () => {
              stopped = true;
              resolve();
            };
          }),
        close: () => {},
      }),
      voice: () => ({
        state: "ready",
        generation: 0,
        sendAudio: () => {},
        connect: async () => {},
        close: () => {
          providerClosed = true;
        },
      }),
    });
    await t.run("start");
    expect(
      (await t.stop({ sessionManager: { getSessionId: () => "other", getSessionFile: () => "voice-file" } })).stopped,
    ).toBe(false);
    // Ordinary conversation advances the leaf; it does not change voice ownership.
    t.ctx.sessionManager.getLeafId = () => "new-message-leaf";
    const pending = t.stop();
    const duplicate = t.stop();
    await tick();
    expect(providerClosed).toBe(true);
    expect(stopped).toBe(false);
    release();
    expect(await pending).toEqual({ stopped: true, errors: [], jobsUnchanged: true });
    expect(await duplicate).toEqual({ stopped: true, errors: [], jobsUnchanged: true });
    expect(stopped).toBe(true);
    expect((await t.stop()).stopped).toBe(false);
  });
  for (const failure of ["reported", "thrown"] as const) {
    test("Gemini provider " + failure + " close failure persists incomplete cost after valid usage", async () => {
      let capturedUsage: VoiceCallbacks["onUsage"];
      const t = setup({
        voice: (callbacks) => {
          // Use the real extension callback and stop path, without a provider call.
          capturedUsage = callbacks.onUsage;
          return {
            state: "ready",
            generation: 0,
            sendAudio: () => {},
            connect: async () => {},
            close: () => {
              if (failure === "thrown") throw new Error("offline close failure");
            },
            ...(failure === "reported" ? { closeError: "offline close failed" } : {}),
          } as any;
        },
      });
      await t.run("start");
      capturedUsage?.({
        promptTokensDetails: [{ modality: "AUDIO", tokenCount: 100 }],
        candidatesTokensDetails: [{ modality: "TEXT", tokenCount: 20 }],
      });
      expect(t.transcriptEntries.filter((entry) => entry.type === "bruv-live-cost").map((entry) => entry.data)).toEqual(
        [{ cost: (100 * 3 + 20 * 4.5) / 1e6 }],
      );
      expect((await t.stop()).stopped).toBe(false);
      expect(t.transcriptEntries.filter((entry) => entry.type === "bruv-live-cost").at(-1)?.data).toEqual({
        cost: 0,
        unknown: true,
      });
    });
  }
  test("self-stop does not claim teardown of a still-pending audio launch", async () => {
    const t = setup();
    t.defer();
    const start = t.run("start");
    await tick();
    expect(await t.stop()).toEqual({
      stopped: false,
      errors: ["Audio startup has not finished; teardown is not yet observed"],
      jobsUnchanged: true,
    });
    t.resolveLaunch();
    await start;
    await tick();
    expect(t.closes).toBe(1);
  });
  test("provider socket close errors still release audio and are not acknowledged as success", async () => {
    let stopped = false;
    const t = setup({
      voice: () => ({
        state: "ready",
        generation: 0,
        sendAudio: () => {},
        connect: async () => {},
        close: () => {
          throw new Error("sensitive provider text");
        },
      }),
      audio: async () => ({
        diagnostics: { queuedMs: 0, captureFrames: 0, capturedBytes: 0 },
        start: async () => {},
        play: async () => {},
        flush: async () => {},
        stop: async () => {
          stopped = true;
        },
        close: () => {},
      }),
    });
    await t.run("start");
    expect(await t.stop()).toEqual({ stopped: false, errors: ["Provider socket close failed"], jobsUnchanged: true });
    expect(stopped).toBe(true);
  });
  test("self-stop reports audio teardown failure rather than claiming completion", async () => {
    const t = setup({
      audio: async () => ({
        diagnostics: { queuedMs: 0, captureFrames: 0, capturedBytes: 0 },
        start: async () => {},
        play: async () => {},
        flush: async () => {},
        stop: async () => {
          throw new Error("sensitive error");
        },
        close: () => {},
      }),
    });
    await t.run("start");
    expect(await t.stop()).toEqual({ stopped: false, errors: ["Audio stop failed"], jobsUnchanged: true });
  });

  test("transcripts reach owner history while the viewport stays bounded and partial stop is not final", async () => {
    const t = setup();
    await t.run("start");
    const long = "A long received sentence. ".repeat(160);
    t.voice.onInputTranscript?.({ text: long, finished: true, finalitySource: "model_contract" });
    t.voice.onOutputTranscript?.({ text: "First half, " }, 0);
    t.voice.onOutputTranscript?.({ text: "second half." }, 0);
    t.voice.onTurnComplete?.(0);
    expect(t.ownerEvents.filter((e) => e[0] === "input")).toContainEqual(["input", long, true]);
    expect(t.ownerEvents.some((e) => e[0] === "output" && e[1] === "First half, second half.")).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect((t.widgets.at(-1)?.join(" ") ?? "").length).toBeLessThan(long.length);
    t.voice.onOutputTranscript?.({ text: "Unfinished reply" }, 0);
    await t.run("stop");
    const events = t.ownerEvents.length;
    t.voice.onOutputTranscript?.({ text: "stale" }, 0);
    expect(t.ownerEvents).toHaveLength(events);
  });

  test("autocomplete lists only Live actions and filters prefixes without side effects", () => {
    const t = setup();
    expect(t.complete("")?.map((item) => item.value)).toEqual([
      "start",
      "stop",
      "setup",
      "status",
      "provider",
      "model",
      "input",
      "mic-check",
      "speaker-check",
    ]);
    expect(t.complete("st")?.map((item) => item.value)).toEqual(["start", "stop", "status"]);
    expect(t.complete("speaker")?.map((item) => item.value)).toEqual(["speaker-check"]);
    expect(t.complete("missing")).toBeNull();
    expect(t.complete("start extra")).toBeNull();
    expect(t.complete("")?.every((item) => item.label === item.value)).toBe(true);
    expect([t.keyCalls, t.launches, t.starts]).toEqual([0, 0, 0]);
  });
  test("bare Live toggles on and off while explicit start and stop stay idempotent", async () => {
    const t = setup();
    await t.run("");
    expect(t.starts).toBe(1);
    await t.run("start");
    expect([t.starts, t.closes]).toEqual([1, 0]);
    await t.run("  ");
    expect(t.status.at(-1)).toBeUndefined(); // Toggle takes effect before asynchronous device cleanup.
    await tick();
    expect(t.closes).toBe(1);
    await t.run("stop");
    expect([t.keyCalls, t.closes]).toEqual([1, 1]);
    await t.run("");
    expect(t.starts).toBe(2);
    await t.run("stop");
  });
  for (const stage of ["helper", "provider"]) {
    test("bare Live cancels pending " + stage + " without late activation", async () => {
      const t = setup();
      t.defer();
      const starting = t.run("");
      await tick();
      if (stage === "provider") {
        t.resolveLaunch();
        await tick();
      }
      await t.run("");
      if (stage === "helper") t.resolveLaunch();
      else t.resolveConnect();
      await starting;
      expect(t.starts).toBe(0);
      expect(t.closes).toBe(1);
      expect(t.status.at(-1)).toBeUndefined();
    });
  }
  test("bare Live cancels pending auth without stale setup or audio", async () => {
    let resolveKey!: (value: string) => void;
    const t = setup({
      key: async () =>
        new Promise<string>((resolve) => {
          resolveKey = resolve;
        }),
    });
    const starting = t.run("");
    await tick();
    await t.run("");
    resolveKey("test-key");
    await starting;
    expect([t.launches, t.starts]).toEqual([0, 0]);
  });

  test("bare /live starts directly without a picker or confirmation", async () => {
    const t = setup();
    t.ctx.ui.select = async () => {
      throw new Error("unexpected picker");
    };
    t.ctx.ui.confirm = async () => {
      throw new Error("unexpected confirmation");
    };
    await t.run("");
    expect([t.launches, t.keyCalls, t.starts]).toEqual([1, 1, 1]);
    expect(t.status.at(-1)).toBe("Voice · mic on");
    await t.run("stop");
  });
  test("status does not inspect auth or open audio", async () => {
    const t = setup();
    await t.run("status");
    expect([t.launches, t.keyCalls, t.starts]).toEqual([0, 0, 0]);
    expect(t.notices).toEqual(["Live off · Google Gemini voice model gemini-3.8-live · continuous."]);
  });
  test("status reports the direct main owner and only execute", async () => {
    const t = setup();
    await t.run("start");
    expect(t.ownerAcquires).toBe(1);
    expect(t.orchestration?.tools.map((tool) => tool.name)).toEqual(["execute"]);
    await t.run("status");
    expect(t.notices.at(-1)).toContain("tools configured 1");
    expect(t.notices.at(-1)).not.toContain("Agent work is independent of voice");
    await t.run("stop");
    expect(t.ownerCloses).toBe(1);
  });
  test("status distinguishes partial transcription from provider-marked completion", async () => {
    const t = setup();
    await t.run("start");
    t.voice.onInputTranscript?.({ text: "synthetic request" });
    await t.run("status");
    expect(t.notices.at(-1)).toContain("completed input transcripts 0");
    t.voice.onInputTranscript?.({ text: "", finished: true });
    await t.run("status");
    expect(t.notices.at(-1)).toContain("completed input transcripts 1");
    await t.run("stop");
  });
  test("owner acquisition failure fails closed before provider or audio, without a host fallback", async () => {
    let hostCalls = 0;
    const t = setup({
      owner: async () => {
        throw new Error("private acquisition detail");
      },
      host: (() => {
        hostCalls++;
        throw new Error("legacy host must not be called");
      }) as any,
    } as any);
    await t.run("start");
    expect(t.launches).toBe(0);
    expect(t.starts).toBe(0);
    expect(hostCalls).toBe(0);
    expect(t.notices.join(" ")).not.toContain("private acquisition detail");
  });
  test("full duplex, bounded frames, interruption flushes but turnComplete does not", async () => {
    const t = setup();
    await t.run("start");
    expect([t.launches, t.keyCalls, t.starts]).toEqual([1, 1, 1]);
    t.voice.onInputTranscript?.({ text: "hello\x1b[2J\nworld" });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(t.widgets.at(-1)).toEqual(["hello world"]); // Active user draft, no duplicate chat label.
    expect(t.ownerEvents).toContainEqual(["input", "hello\x1b[2J\nworld", false]);
    t.voice.onOutputTranscript?.({ text: "reply\u202eok" }, 0);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(t.widgets.at(-1)).toEqual(["Assistant: reply ok"]); // Received replies stay drafts until completed.
    expect(t.widgets.at(-1)?.join(" ")).not.toContain("\x1b");
    t.voice.onAudio?.(Buffer.alloc(2000).toString("base64"), 0);
    t.voice.onTurnComplete?.(0);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(t.played.map((p) => p.length)).toEqual([960, 960, 80]);
    t.capture.capture?.(Buffer.alloc(640));
    expect(t.sends).toBe(1);
    t.voice.onTurnComplete?.(0);
    expect(t.flushes).toEqual([]);
    t.voice.onInterrupted?.(1);
    expect(t.flushes).toEqual([1]);
    t.voice.onAudio?.(Buffer.alloc(960).toString("base64"), 0);
    t.voice.onAudio?.(Buffer.alloc(960).toString("base64"), 1);
    await tick();
    expect(t.played.at(-1)?.generation).toBe(1);
    // Playback changes render through the 100 ms UI throttle, not the next microtask.
    await Bun.sleep(120);
    expect(t.status.at(-1)).toBe("Speaking · mic on");
    await t.run("status");
    expect(t.notices.at(-1)).toContain("provider interruptions unknown");
    expect(t.notices.at(-1)).toContain("native VP unknown");
    await t.run("stop");
    expect(t.status.at(-1)).toBeUndefined();
    expect(t.widgets.at(-1)).toBeUndefined();
  });
  test("stop while helper hello is pending disposes late helper without opening devices", async () => {
    const t = setup();
    t.defer();
    const starting = t.run("start");
    await tick();
    await t.run("stop");
    t.resolveLaunch();
    await starting;
    expect([t.keyCalls, t.starts, t.closes]).toEqual([1, 0, 1]);
  });
  test("provider rejection and helper error tear down without exposing error text", async () => {
    const t = setup();
    t.reject();
    await t.run("start");
    expect(t.starts).toBe(0);
    expect(t.closes).toBe(1);
    expect(t.ownerCloses).toBe(1);
    expect(t.notices.join(" ")).not.toContain("SECRET");
    const running = setup();
    await running.run("start");
    running.capture.error?.("permission", "SECRET");
    expect(running.notices.join(" ")).toContain("Microphone access denied [permission]");
    expect(running.notices.join(" ")).not.toContain("SECRET");
    expect(running.status.at(-1)).toBeUndefined();
  });
  test("mic-check requires consent, never uses key/provider and discards capture", async () => {
    const declined = setup();
    declined.decline();
    await declined.run("mic-check");
    expect([declined.launches, declined.keyCalls, declined.starts]).toEqual([0, 0, 0]);
    const t = setup();
    await t.run("mic-check");
    expect([t.launches, t.keyCalls, t.starts, t.closes]).toEqual([1, 0, 1, 1]);
    expect(t.notices.join(" ")).toContain("Audio route ready. Sound quality not measured.");
    const denied = setup({
      audio: async () => {
        throw new Error("SECRET");
      },
    });
    await denied.run("mic-check");
    expect(denied.notices.join(" ")).toContain("[launch]");
    expect(denied.notices.join(" ")).not.toContain("SECRET");
  });
  test("mic-check reports safe native stage and NSError number without helper text", async () => {
    const t = setup();
    t.audio.start = async () => {
      t.capture.error?.("engine_start", "secret device name", { domain: "NSOSStatusErrorDomain", number: -10875 });
      throw new Error("secret device name");
    };
    await t.run("mic-check");
    expect(t.notices.join(" ")).toContain("[engine_start] (NSError NSOSStatusErrorDomain -10875)");
    expect(t.notices.join(" ")).not.toContain("secret");
  });
  test("session change aborts pending mic-check before devices open", async () => {
    const t = setup();
    t.defer();
    const checking = t.run("mic-check");
    await tick();
    t.sessionStart();
    t.resolveLaunch();
    await checking;
    expect([t.launches, t.starts, t.keyCalls, t.closes]).toEqual([1, 0, 0, 1]);
  });
  test("unknown helper code never reaches UI", async () => {
    const t = setup();
    await t.run("start");
    t.capture.error?.("SECRET", "SECRET");
    expect(t.notices.join(" ")).toContain("[unclassified]");
    expect(t.notices.join(" ")).not.toContain("SECRET");
  });
  test("provider output during setup is held until audio ready; overflow fails visibly", async () => {
    const t = setup();
    const originalStart = t.audio.start;
    t.audio.start = async () => {
      t.voice.onAudio?.(Buffer.alloc(9600).toString("base64"), 0);
      expect(t.played).toHaveLength(0); // No writes before native readiness.
      await originalStart();
    };
    await t.run("start");
    await tick();
    expect(t.played.map((p) => p.length)).toEqual([960, 960, 960, 960]); // Bounded 80ms reserve.
    t.voice.onAudio?.(Buffer.alloc(2_880_002).toString("base64"), 0);
    expect(t.status.at(-1)).toBeUndefined();
    expect(t.notices.at(-1)).toBe(
      "Live stop requested: Local playback queue exceeds pending budget (2880000 bytes); audio incomplete. No agent work was cancelled.",
    );
    expect(t.notices.join(" ")).not.toContain("Provider invalid_audio");
  });
  test("platform gate precedes consent, and session shutdown stops without touching agent", async () => {
    const t = setup({ local: () => false });
    await t.run("start");
    expect(t.launches).toBe(0);
    const x = setup();
    await x.run("start");
    x.shutdown();
    expect(x.status.at(-1)).toBeUndefined();
  });
  test("transcript deltas join without invented spaces and capture keeps running while speaking", async () => {
    const t = setup();
    await t.run("start");
    t.voice.onInputTranscript?.({ text: "Hel" });
    t.voice.onInputTranscript?.({ text: "lo world", finished: true });
    t.voice.onAudio?.(Buffer.alloc(1920).toString("base64"), 0);
    t.capture.played?.(40);
    for (let i = 0; i < 20; i++) t.capture.capture?.(Buffer.alloc(640));
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(t.ownerEvents).toContainEqual(["input", "Hello world", true]);
    expect(t.widgets.at(-1)).toBeUndefined(); // Completed input belongs in shared history, not a duplicate widget.
    expect(t.sends).toBe(20);
    expect(t.status.at(-1)).toBe("Speaking · mic on");
    t.voice.onTurnComplete?.(0);
    t.capture.played?.(0);
    expect(t.status.at(-1)).toBe("Voice · mic on");
    await t.run("stop");
  });
  test("stop invalidates pending auth and concurrent starts have one owner", async () => {
    let accept!: (value: string) => void;
    const t = setup({
      key: () =>
        new Promise((resolve) => {
          accept = resolve;
        }),
    });
    const first = t.run("start");
    await tick();
    await t.run("start");
    expect(t.launches).toBe(0);
    await t.run("stop");
    accept("fake-test-only");
    await first;
    expect(t.launches).toBe(0);
  });
});

describe("local speaker-check wiring", () => {
  test("consent and local gate precede runner; never calls key, provider, host or audio on decline", async () => {
    let runs = 0;
    const t = setup({
      speakerCheck: async () => {
        runs++;
        return "quiet";
      },
    });
    t.decline();
    await t.run("speaker-check");
    expect([runs, t.launches, t.keyCalls]).toEqual([0, 0, 0]);
    (t.ctx as any).mode = "rpc";
    await t.run("speaker-check");
    expect(runs).toBe(0);
  });
  test("summary is bounded and provider disconnected; no agent job or auth path", async () => {
    let runs = 0;
    const t = setup({
      speakerCheck: async ({ signal }) => {
        expect(signal.aborted).toBe(false);
        runs++;
        return "Residual high; check selected output and microphone";
      },
    });
    await t.run("speaker-check");
    expect(runs).toBe(1);
    expect([t.launches, t.keyCalls]).toEqual([0, 0]);
    expect(t.notices.at(-1)).toContain("Residual high");
    expect(t.notices.at(-1)).toContain("provider not connected");
    expect(t.notices.at(-1)).not.toContain("agent work is unchanged");
    expect(t.notices.at(-1)).toContain("cannot prove barge-in or AEC");
  });
  test("stop aborts active measurement; prevents stale result and start/mic overlap", async () => {
    let release!: (value: string) => void;
    let signal!: AbortSignal;
    const t = setup({
      speakerCheck: ({ signal: s }) => {
        signal = s;
        return new Promise<string>((resolve) => {
          release = resolve;
        });
      },
    });
    const pending = t.run("speaker-check");
    await tick();
    await t.run("start");
    await t.run("mic-check");
    await t.run("speaker-check");
    expect([t.launches, t.keyCalls]).toEqual([0, 0]);
    await t.run("stop");
    expect(signal.aborted).toBe(true);
    release("stale result");
    await pending;
    expect(t.notices.join(" ")).not.toContain("stale result");
  });
  test("shutdown invalidates pending consent and session change aborts active runner", async () => {
    const t = setup();
    let accept!: (v: boolean) => void;
    t.ctx.ui.confirm = () =>
      new Promise<boolean>((resolve) => {
        accept = resolve;
      });
    const pending = t.run("speaker-check");
    await tick();
    t.shutdown();
    accept(true);
    await pending;
    expect(t.launches).toBe(0);
    let seen!: AbortSignal;
    const x = setup({
      speakerCheck: async ({ signal }) => {
        seen = signal;
        x.sessionStart();
        return "late";
      },
    });
    await x.run("speaker-check");
    expect(seen.aborted).toBe(true);
    expect(x.notices.join(" ")).not.toContain("late");
  });
  test("runner exceptions are not leaked to UI", async () => {
    const t = setup({
      speakerCheck: async () => {
        throw new Error("secret waveform");
      },
    });
    await t.run("speaker-check");
    expect(t.notices.at(-1)).toContain("Speaker check failed");
    expect(t.notices.join(" ")).not.toContain("secret waveform");
  });
});

test("real local speaker runner uses only injected native audio, never auth/provider/host", async () => {
  let handler!: (args: string, ctx: any) => Promise<void>;
  let keyCalls = 0,
    providerCalls = 0,
    hostCalls = 0,
    plays = 0,
    closes = 0;
  const notices: string[] = [];
  liveExtension(
    {
      registerMessageRenderer: () => {},
      registerCommand: (_: string, command: any) => {
        handler = command.handler;
      },
      on: () => {},
    } as any,
    {
      config: { load: async () => ({ provider: "google", model: "gemini-3.8-live" }), save: async () => {} },
      local: () => true,
      key: async () => {
        keyCalls++;
        throw Error("no auth");
      },
      voice: () => {
        providerCalls++;
        throw Error("no provider");
      },
      owner: async () => {
        hostCalls++;
        throw Error("no owner");
      },
      audio: async () => ({
        diagnostics: { queuedMs: 0, captureFrames: 0, capturedBytes: 0 },
        start: async () => {},
        play: async () => {
          plays++;
        },
        flush: async () => {},
        stop: async () => {},
        close: () => {
          closes++;
        },
      }),
    },
  );
  await handler("speaker-check", {
    mode: "interactive",
    ui: { confirm: async () => true, notify: (message: string) => notices.push(message) },
  });
  expect([keyCalls, providerCalls, hostCalls]).toEqual([0, 0, 0]);
  expect(plays).toBeGreaterThan(0);
  expect(closes).toBe(1);
  expect(notices.at(-1)).toContain("Inconclusive");
  expect(notices.at(-1)).toContain("provider not connected");
  expect(notices.at(-1)).toContain("native processing=unknown");
});

describe("direct entry and focused setup", () => {
  test("missing-key bare /live opens setup and cancelling never opens audio", async () => {
    const t = setup({
      key: async () => {
        throw new Error("SECRET");
      },
      credentials: async () => ({
        status: async () => ({ state: "missing", canImport: true }),
        loadKey: async () => {
          throw new Error("must not read key");
        },
        importLiveEnv: async () => {
          throw new Error("must not import");
        },
      }),
    });
    const titles: string[] = [];
    t.ctx.ui.select = async (title) => {
      titles.push(title!);
      return "Cancel";
    };
    t.ctx.ui.confirm = async () => {
      throw new Error("unexpected confirmation");
    };
    await t.run("");
    expect(titles).toEqual(["Google API key required"]);
    expect([t.launches, t.starts]).toEqual([0, 0]);
    expect(t.notices.join(" ")).not.toContain("SECRET");
    expect(t.notices.join(" ")).not.toContain("Could not read");
  });

  test("setup alone stays offline; only Start voice opens the session", async () => {
    const t = setup();
    await t.run("setup");
    expect([t.launches, t.keyCalls, t.starts]).toEqual([0, 0, 0]);
    t.ctx.ui.select = async () => "Start voice";
    t.ctx.ui.confirm = async () => {
      throw new Error("redundant confirmation");
    };
    await t.run("setup");
    expect([t.launches, t.starts]).toEqual([1, 1]);
    await t.run("stop");
  });

  for (const cancel of ["toggle", "stop", "shutdown", "sessionStart"] as const) {
    test(cancel + " invalidates a pending setup start choice", async () => {
      const t = setup();
      let choose!: (value: string) => void;
      t.ctx.ui.select = () =>
        new Promise((resolve) => {
          choose = resolve;
        });
      const opening = t.run("setup");
      await tick();
      await t.run("start"); // Explicit concurrent start must not acquire authority.
      expect(t.launches).toBe(0);
      if (cancel === "toggle") await t.run("");
      else if (cancel === "stop") await t.run("stop");
      else t[cancel]();
      choose("Start voice");
      await opening;
      expect([t.launches, t.starts]).toEqual([0, 0]);
      // Cancellation releases the owner; a fresh explicit command can start.
      await t.run("");
      expect([t.launches, t.starts]).toEqual([1, 1]);
      await t.run("stop");
    });
  }

  test("shutdown during credential inspection prevents stale setup UI", async () => {
    let finish!: (value: any) => void;
    const t = setup({
      credentials: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    t.ctx.ui.select = async () => {
      throw new Error("stale dialog");
    };
    const opening = t.run("setup");
    await tick();
    t.shutdown();
    finish({
      status: async () => {
        throw new Error("stale inspection");
      },
    });
    await opening;
    expect(t.notices).toEqual([]);
    expect(t.launches).toBe(0);
  });

  test("local restriction precedes direct auth and setup", async () => {
    const t = setup({
      local: () => false,
      credentials: async () => {
        throw new Error("must not inspect");
      },
    });
    await t.run("");
    await t.run("setup");
    expect([t.launches, t.keyCalls, t.starts]).toEqual([0, 0, 0]);
  });
});

test("missing auth can be configured then explicitly started from setup", async () => {
  let checks = 0;
  let keyLoads = 0;
  const t = setup({
    key: async () => {
      throw new Error("missing");
    },
    credentials: async () => ({
      status: async () =>
        ++checks === 1 ? { state: "missing", canImport: true } : { state: "configured_api_key", canImport: false },
      loadKey: async () => {
        keyLoads++;
        return "fake-test-only";
      },
      importLiveEnv: async () => {
        throw new Error("must not import automatically");
      },
    }),
  });
  const titles: string[] = [];
  t.ctx.ui.select = async (title) => {
    titles.push(title!);
    expect([t.launches, t.starts, keyLoads]).toEqual([0, 0, 0]);
    return title === "Live" ? "Start voice" : "Recheck";
  };
  await t.run("");
  expect(titles).toEqual(["Google API key required", "Live"]);
  expect([t.launches, t.starts, keyLoads]).toEqual([1, 1, 1]);
  await t.run("stop");
});

test("compact Voice status follows native playback drain and interruption without waveform churn", async () => {
  const t = setup();
  await t.run("start");
  expect(t.status.at(-1)).toBe("Voice · mic on");
  const loud = Buffer.alloc(960, 0x7f);
  const idleUpdates = t.status.length;
  t.capture.capture?.(loud);
  await new Promise((resolve) => setTimeout(resolve, 110));
  expect(t.sends).toBe(1);
  expect(t.status.at(-1)).toBe("Voice · mic on");
  expect(t.status.length).toBe(idleUpdates); // PCM does not paint a waveform into compact status.
  t.voice.onAudio?.(loud.toString("base64"), 0);
  t.capture.played?.(100);
  await new Promise((resolve) => setTimeout(resolve, 110));
  expect(t.status.at(-1)).toBe("Speaking · mic on");
  t.voice.onTurnComplete?.(0);
  expect(t.status.at(-1)).toBe("Speaking · mic on"); // Native still has buffered sound.
  t.capture.played?.(0);
  expect(t.status.at(-1)).toBe("Voice · mic on");
  t.voice.onAudio?.(loud.toString("base64"), 0);
  t.capture.played?.(100);
  await new Promise((resolve) => setTimeout(resolve, 110)); // Status renders are throttled to 100ms.
  expect(t.status.at(-1)).toBe("Speaking · mic on");
  t.voice.onInterrupted?.(1);
  expect(t.status.at(-1)).toBe("Voice · mic on");
  expect(t.flushes).toEqual([1]);
  const count = t.status.length;
  await t.run("stop");
  await new Promise((resolve) => setTimeout(resolve, 190));
  expect(t.status.length).toBe(count + 1); // No leftover animation timer.
  expect(t.status.at(-1)).toBeUndefined();
});

test("rejected Voice startup clears connecting status and leaves no animation updates", async () => {
  const t = setup();
  t.reject();
  await t.run("start");
  expect(t.status).toContain("Voice · connecting");
  expect(t.status.at(-1)).toBeUndefined();
  const count = t.status.length;
  await new Promise((resolve) => setTimeout(resolve, 180));
  expect(t.status.length).toBe(count);
});

describe("Live model and credential setup", () => {
  test("all models visible regardless of selected provider; labels reflect resolver readiness, not network access", async () => {
    const captures: string[][] = [];
    const t = setup({
      credentials: async (_signal, provider) => ({
        status: async () =>
          provider === "google"
            ? { state: "oauth" as const, canImport: false as const }
            : { state: "stored_api_key" as const, canImport: false as const },
        loadKey: async () => {
          throw new Error("no key read");
        },
        importLiveEnv: async () => {
          throw new Error("no import");
        },
      }),
    });
    t.ctx.ui.select = async (_title, options) => {
      captures.push(options ?? []);
      return undefined;
    };
    await t.run("model");
    expect(captures[0]).toEqual([
      "gemini-3.8-live · Google Gemini · API key needed (OAuth) (selected)",
      "gemini-3.8-live-extended-thinking · Google Gemini · API key needed (OAuth)",
      "gpt-realtime-2.1 · OpenAI · key configured",
      "gpt-realtime-2.1-mini · OpenAI · key configured",
      "gpt-live-1 · OpenAI · key configured",
    ]);
    expect(t.launches).toBe(0);
    expect(t.ownerAcquires).toBe(0);
  });

  test("explicit GPT and Gemini thinking choices atomically switch provider and round-trip the active selection", async () => {
    let saved: import("../src/live/config").LiveConfig = { provider: "google", model: "gemini-3.8-live" };
    const t = setup({
      config: {
        load: async () => saved,
        save: async (next) => {
          saved = next;
        },
      },
    });
    await t.run("model gpt-live-1");
    expect(t.notices.at(-1)).toBe("Live voice: OpenAI · gpt-live-1.");
    expect(saved).toMatchObject({ provider: "openai", model: "gpt-live-1" });
    await t.run("model gemini-3.8-live-extended-thinking");
    expect(saved).toMatchObject({
      provider: "google",
      model: "gemini-3.8-live-extended-thinking",
    });
    await t.run("model gpt-realtime-2.1-mini");
    expect(saved).toMatchObject({
      provider: "openai",
      model: "gpt-realtime-2.1-mini",
    });
    await t.run("model bogus");
    expect(saved.model).toBe("gpt-realtime-2.1-mini");
    const restarted = setup({ config: { load: async () => saved, save: async () => {} } });
    await restarted.run("status");
    expect(restarted.notices.at(-1)).toContain("OpenAI voice model gpt-realtime-2.1-mini");
    expect(t.launches).toBe(0);
  });

  test("picker crosses from either provider and cancellation does not save or launch", async () => {
    let saved: import("../src/live/config").LiveConfig = { provider: "google", model: "gemini-3.8-live" };
    const t = setup({
      config: {
        load: async () => saved,
        save: async (next) => {
          saved = next;
        },
      },
    });
    t.ctx.ui.select = async (_title, options) =>
      options?.find((option) => option.startsWith("gpt-realtime-2.1-mini ·"));
    await t.run("model");
    expect(saved).toMatchObject({ provider: "openai", model: "gpt-realtime-2.1-mini" });
    t.ctx.ui.select = async (_title, options) =>
      options?.find((option) => option.startsWith("gemini-3.8-live-extended-thinking ·"));
    await t.run("model");
    expect(saved).toMatchObject({ provider: "google", model: "gemini-3.8-live-extended-thinking" });
    t.ctx.ui.select = async () => undefined;
    await t.run("model");
    expect(saved.model).toBe("gemini-3.8-live-extended-thinking");
    expect(t.launches).toBe(0);
  });

  test("provider config does not switch model or start mic; missing key and OAuth remain setup-needed", async () => {
    const queried: string[] = [];
    const t = setup({
      credentials: async (_signal, provider) => {
        queried.push(provider!);
        return {
          status: async () =>
            provider === "openai"
              ? { state: "missing" as const, canImport: false as const }
              : { state: "oauth" as const, canImport: false as const },
          loadKey: async () => {
            throw new Error("no key");
          },
          importLiveEnv: async () => {
            throw new Error("no import");
          },
        };
      },
    });
    await t.run("provider openai");
    expect(t.notices.join(" ")).toContain("openai-codex OAuth do not work");
    await t.run("provider google");
    expect(t.notices.join(" ")).toContain("Google OAuth credential will not be replaced");
    await t.run("status");
    expect(t.notices.at(-1)).toContain("Google Gemini voice model gemini-3.8-live");
    expect(queried).toEqual(["openai", "google"]);
    expect(t.launches).toBe(0);
  });

  test("failed save, cancelled picker and active run leave selection untouched", async () => {
    let fail = true;
    let saved: import("../src/live/config").LiveConfig = { provider: "google", model: "gemini-3.8-live" };
    const t = setup({
      config: {
        load: async () => saved,
        save: async (next) => {
          if (fail) throw Error("disk");
          saved = next;
        },
      },
    });
    await t.run("model gpt-realtime-2.1");
    expect(t.notices.at(-1)).toContain("previous choice kept");
    fail = false;
    t.ctx.ui.select = async () => undefined;
    await t.run("model");
    expect(saved.provider).toBe("google");
    await t.run("start");
    await t.run("model gpt-realtime-2.1");
    expect(t.notices.at(-1)).toContain("stop it");
    await t.run("provider openai");
    expect(t.notices.at(-1)).toContain("stop it");
    expect(saved.provider).toBe("google");
    await t.run("stop");
  });
});

describe("Realtime startup diagnostics reach the terminal safely", () => {
  const config = {
    load: async () => ({ provider: "openai" as const, model: "gpt-realtime-2.1" as const }),
    save: async () => {},
  };
  test("adapter connect failure retains classified detail without raw exception", async () => {
    const t = setup({
      config,
      voice: (callbacks) =>
        new OpenAIRealtimeSession(callbacks, () => {
          throw new Error("Bearer fake-secret https://private.invalid/body");
        }),
    });
    await t.run("start");
    expect(t.notices.join("\n")).toContain("Provider connect_failed:");
    expect(t.notices.join("\n")).not.toContain("fake-secret");
    expect(t.notices.join("\n")).not.toContain("private.invalid");
    expect(t.starts).toBe(0);
  });
  test("constructor failure names its stage and withholds arbitrary text", async () => {
    const t = setup({
      config,
      voice: () => {
        throw new Error("fake-secret import body");
      },
    });
    await t.run("start");
    expect(t.notices.join("\n")).toContain("[provider-construction]");
    expect(t.notices.join("\n")).not.toContain("fake-secret");
    expect(t.starts).toBe(0);
  });
  test("rejected lazy connect names its stage and withholds arbitrary text", async () => {
    const t = setup({ config });
    t.reject();
    await t.run("start");
    expect(t.notices.join("\n")).toContain("[provider-connect]");
    expect(t.notices.join("\n")).not.toContain("SECRET");
    expect(t.starts).toBe(0);
  });
});

test("Realtime full and mini localhost HTTP diagnostics survive the extension callback", async () => {
  let requests = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      requests++;
      expect(request.headers.get("authorization")).toBe("Bearer fake-test-only");
      return Response.json({ error: { code: "invalid_api_key", message: "fake-private-body" } }, { status: 401 });
    },
  });
  try {
    for (const model of ["gpt-realtime-2.1", "gpt-realtime-2.1-mini"] as const) {
      const t = setup({
        config: { load: async () => ({ provider: "openai", model }), save: async () => {} },
        voice: (callbacks) =>
          new OpenAIRealtimeSession(
            callbacks,
            (url, headers) =>
              defaultSocket("ws://127.0.0.1:" + server.port + new URL(url).pathname + new URL(url).search, headers),
            undefined,
            model,
          ),
      });
      await t.run("start");
      expect(t.notices.join("\n")).toContain("HTTP 401");
      expect(t.notices.join("\n")).not.toContain("fake-private-body");
      expect(t.notices.join("\n")).not.toContain("fake-test-only");
      expect(t.starts).toBe(0);
    }
    expect(requests).toBe(2);
  } finally {
    server.stop(true);
  }
});

test("branch navigation waits for admitted tool results before moving the owning branch", async () => {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let cancelled = 0;
  let closed = 0;
  const t = setup({
    owner: async () => ({
      orchestration: {
        instructions: "root",
        tools: [],
        async execute() {},
      },
      inputTranscript() {},
      outputTranscript() {},
      typedInput() {},
      sendContext() {},
      interrupt() {},
      turnComplete() {},
      close() {
        closed++;
      },
      stopForeground() {
        cancelled++;
      },
      released,
    }),
  });
  await t.run("start");
  let navigated = false;
  const moving = t.navigate().then(() => {
    navigated = true;
  });
  await tick();
  expect(cancelled).toBe(1);
  expect(closed).toBe(1);
  expect(navigated).toBe(false);
  release();
  await moving;
  expect(navigated).toBe(true);
});

test("extended thinking stays busy across filler turn completion until provider idle", async () => {
  const t = setup({
    config: {
      load: async () => ({ provider: "google", model: "gemini-3.8-live-extended-thinking" }),
      save: async () => {},
    },
  });
  await t.run("start");
  t.voice.onInteractionStatus?.("IN_PROGRESS");
  t.voice.onTurnComplete?.(0);
  await t.run("status");
  expect(t.notices.at(-1)).toContain("Live thinking");
  t.voice.onInteractionStatus?.("IDLE");
  await t.run("status");
  expect(t.notices.at(-1)).toContain("Live listening");
  await t.run("stop");
});

test("GPT-Live routes client delegation to selected main owner, keeps transcript provisional and voice stop leaves work untouched", async () => {
  let callbacks: any;
  const observations: any[] = [];
  const f = setup({
    config: { load: async () => ({ provider: "openai", model: "gpt-live-1" }), save: async () => {} },
    gptSession: (cb: any) => {
      callbacks = cb;
      return {
        state: "ready",
        connect: async () => {},
        appendMicrophone: () => true,
        observation: (message: string) => {
          observations.push(message);
          return true;
        },
        commentary: (id: string, message: string) => {
          observations.push([id, message]);
          return true;
        },
        close: async () => {},
      } as any;
    },
  });
  await f.run("start");
  expect(f.starts).toBe(1);
  f.deliverContext("canonical coding result ".repeat(1000));
  expect(observations.length).toBeGreaterThan(1);
  for (const chunk of observations) expect(Buffer.byteLength(chunk)).toBeLessThanOrEqual(480);
  const beforeTranscript = observations.length;
  callbacks.onOutputTranscript({ delta: "provisional answer", startMs: 20, endMs: 80 });
  callbacks.onInputTranscript({ delta: "please inspect", startMs: 100, endMs: 300 });
  expect(observations).toHaveLength(beforeTranscript);
  expect(f.contexts.filter((text) => text.includes("gpt_live_provisional"))).toHaveLength(2);
  callbacks.onDelegation({ id: "d1", target: "client", offsetMs: 400 });
  callbacks.onDelegation({ id: "d1", target: "client", offsetMs: 400 });
  await tick();
  const delegated = f.ownerEvents.filter((event: any) => event[0] === "delegate");
  expect(delegated).toHaveLength(1);
  expect(delegated[0][1]).toBe("d1");
  expect(delegated[0][2]).toBe("please inspect");
  expect(delegated[0][2]).not.toContain("hostContext");
  expect(delegated[0][2]).not.toContain("Clarify");
  callbacks.onInputTranscript({ delta: "anything else?", startMs: 600, endMs: 850 });
  callbacks.onDelegation({ id: "d2", target: "client", offsetMs: 900 });
  await tick();
  expect(f.ownerEvents.filter((event: any) => event[0] === "delegate").map((event: any) => event[2])).toEqual([
    "please inspect",
    "anything else?",
  ]);
  expect(observations.every((text) => typeof text !== "string" || !text.includes("hostContext"))).toBe(true);
  expect(f.ownerEvents.some((event: any) => event[0] === "input" && event[2] === true)).toBe(false);
  await f.run("stop");
  expect(f.ownerCloses).toBe(1);
});

test("rejected GPT admission leaves speech available for a later delegation", async () => {
  let callbacks: any;
  let attempts = 0;
  const prompts: string[] = [];
  const owner: any = {
    orchestration: { instructions: "", tools: [] },
    delegate: (_id: string, text: string, _snapshot: unknown, admitted: () => void) => {
      prompts.push(text);
      if (++attempts === 1) return Promise.reject(new Error("Not admitted"));
      admitted();
      return Promise.resolve();
    },
    sendContext() {},
    close() {},
    stopForeground() {},
    released: Promise.resolve(),
  };
  const f = setup({
    config: { load: async () => ({ provider: "openai", model: "gpt-live-1" }), save: async () => {} },
    owner: async () => owner,
    gptSession: (cb: any) => {
      callbacks = cb;
      return {
        state: "ready",
        connect: async () => {},
        appendMicrophone: () => true,
        observation: () => true,
        commentary: () => true,
        close: async () => {},
      } as any;
    },
  });
  await f.run("start");
  callbacks.onInputTranscript({ delta: "Check this repo", startMs: 100, endMs: 300 });
  callbacks.onDelegation({ id: "rejected", target: "client", offsetMs: 400 });
  await tick();
  callbacks.onDelegation({ id: "accepted", target: "client", offsetMs: 400 });
  await tick();
  expect(prompts).toEqual(["Check this repo", "Check this repo"]);
  await f.run("stop");
});

test("voice failures render truthful warnings without stopping agent work", async () => {
  const packageDir = process.env.PI_PACKAGE_DIR;
  delete process.env.PI_PACKAGE_DIR;
  try {
    initTheme("dark", false);
  } finally {
    if (packageDir !== undefined) process.env.PI_PACKAGE_DIR = packageDir;
  }
  for (const source of ["provider", "playback"] as const) {
    let cancelled = 0;
    let closed = 0;
    const t = setup({
      config: { load: async () => ({ provider: "openai", model: "gpt-realtime-2.1" }), save: async () => {} },
      owner: async () => ({
        orchestration: {
          instructions: "root",
          tools: [],
          async execute() {},
        },
        inputTranscript() {},
        outputTranscript() {},
        typedInput() {},
        sendContext() {},
        interrupt() {},
        turnComplete() {},
        close() {
          closed++;
        },
        stopForeground() {
          cancelled++;
        },
        released: Promise.resolve(),
      }),
    });
    const view = Object.create(InteractiveMode.prototype) as any;
    view.chatContainer = new Container();
    view.ui = { requestRender() {} };
    t.ctx.ui.notify = (message: string, type?: "info" | "warning" | "error") => {
      view.showExtensionNotify(message, type);
    };
    await t.run("start");
    if (source === "provider") t.voice.onError?.({ code: "invalid_audio", message: "Invalid output audio chunk" });
    else t.voice.onAudio?.(Buffer.alloc(2_880_002).toString("base64"), 0);
    const rendered = view.chatContainer
      .render(240)
      .map((line: string) => stripTerminalSequences(line))
      .join("\n");
    const reason =
      source === "provider"
        ? "Provider invalid_audio: Invalid output audio chunk"
        : "Local playback queue exceeds pending budget (2880000 bytes); audio incomplete";
    expect(rendered).toContain("Warning: Live stop requested: " + reason + ". No agent work was cancelled.");
    expect(cancelled).toBe(0);
    expect(closed).toBe(1);
    expect(t.status.at(-1)).toBeUndefined();
    await tick();
    expect(t.closes).toBe(1);
  }
});

test("real Realtime session accepts a 50-second reply below the playback queue bound", async () => {
  const listeners = new Map<string, ((event: any) => void)[]>();
  const fire = (type: string, event: any) => {
    for (const listener of listeners.get(type) ?? []) listener(event);
  };
  const message = (event: unknown) => fire("message", { data: JSON.stringify(event) });
  const socket: RealtimeSocket = {
    readyState: 1,
    bufferedAmount: 0,
    send(data) {
      if (JSON.parse(data).type === "session.update") message({ type: "session.updated" });
    },
    close() {
      fire("close", {});
    },
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      if (type === "close") queueMicrotask(() => fire("open", {}));
    },
  };
  const t = setup({
    config: { load: async () => ({ provider: "openai", model: "gpt-realtime-2.1" }), save: async () => {} },
    voice: (callbacks) => new OpenAIRealtimeSession(callbacks, () => socket),
  });
  await t.run("start");
  expect(t.starts).toBe(1);
  t.notices.length = 0; // Ignore the normal startup ownership notice.
  message({ type: "response.created", response: { id: "long-response" } });
  message({ type: "response.output_item.added", response_id: "long-response", item: { type: "message", id: "audio" } });
  const delta = Buffer.alloc(96000).toString("base64");
  for (let i = 0; i < 25; i++)
    message({ type: "response.output_audio.delta", response_id: "long-response", item_id: "audio", delta });
  message({ type: "response.done", response: { id: "long-response", status: "completed" } });
  expect(t.notices).toEqual([]);
  expect(t.status.at(-1)).toBeDefined();
  expect(t.closes).toBe(0);
  expect(await t.stop()).toEqual({ stopped: true, errors: [], jobsUnchanged: true });
});

test("Realtime replays owner context before devices start and revokes delivery on stop", async () => {
  const events: string[] = [];
  const updates: Array<{ text: string; options?: { triggerResponse?: boolean } }> = [];
  let deliver!: (text: string, options?: { triggerResponse?: boolean }) => void;
  let input!: (text: string) => void;
  let state: "connecting" | "ready" = "connecting";
  const orchestration: VoiceOrchestration = {
    instructions: "current root authority",
    tools: [],
    execute: async () => ({}),
  };
  const f = setup({
    owner: async (_pi, _ctx, callbacks) => {
      deliver = callbacks!.onContext!;
      input = callbacks!.onInput!;
      deliver("Queued completion reply", { triggerResponse: true });
      input("Queued typed input");
      deliver('{"source":"gpt_live_provisional","text":"already heard"}');
      return {
        orchestration,
        close() {},
        stopForeground() {},
        released: Promise.resolve(),
      } as any;
    },
    voice: (_callbacks, authority) => {
      expect(authority).toBe(orchestration);
      events.push("provider-created");
      return {
        get state() {
          return state;
        },
        generation: 0,
        connect: async () => {
          events.push("provider-connect");
          deliver("Connecting reply", { triggerResponse: false });
          state = "ready";
        },
        sendContext: (text, options) => {
          events.push(text);
          updates.push({ text, options });
        },
        sendAudio: () => {
          events.push("microphone");
        },
        close: async () => {},
      };
    },
    audio: async (callbacks) => {
      events.push("helper-hello");
      return {
        diagnostics: { queuedMs: 0, captureFrames: 0, capturedBytes: 0 },
        start: async () => {
          events.push("audio-start");
          callbacks.capture?.(Buffer.alloc(320));
        },
        play: async () => {},
        flush: async () => {},
        stop: async () => {},
        close: async () => {},
      };
    },
  });
  await f.run("start");
  expect(events).toEqual([
    "helper-hello",
    "provider-created",
    "provider-connect",
    "Queued completion reply",
    "Queued typed input",
    "Connecting reply",
    "audio-start",
    "microphone",
  ]);
  deliver("Ready completion reply", { triggerResponse: true });
  input("Ready typed input");
  expect(updates).toEqual([
    { text: "Queued completion reply", options: { triggerResponse: true } },
    { text: "Queued typed input", options: undefined },
    { text: "Connecting reply", options: { triggerResponse: false } },
    { text: "Ready completion reply", options: { triggerResponse: true } },
    { text: "Ready typed input", options: undefined },
  ]);
  await f.run("stop");
  deliver("Stale completion reply", { triggerResponse: true });
  input("Stale typed input");
  expect(updates).toHaveLength(5);
});

test("GPT-Live replays connecting replies as commentary without speaking ordinary context", async () => {
  const updates: Array<{ text: string; speak: boolean }> = [];
  let deliver!: (text: string, options?: { triggerResponse?: boolean }) => void;
  let state: "connecting" | "ready" = "connecting";
  const f = setup({
    config: { load: async () => ({ provider: "openai", model: "gpt-live-1" }), save: async () => {} },
    owner: async (_pi, _ctx, callbacks) => {
      deliver = callbacks!.onContext!;
      // Owner may return an agent reply before the provider accepts the session.
      deliver("Queued completion reply", { triggerResponse: true });
      deliver("Queued background context");
      return {
        orchestration: { instructions: "root", tools: [] },
        sendContext() {},
        close() {},
        stopForeground() {},
        released: Promise.resolve(),
      } as any;
    },
    gptSession: () =>
      ({
        get state() {
          return state;
        },
        connect: async () => {
          deliver("Connecting completion reply", { triggerResponse: true });
          state = "ready";
        },
        observation: (text: string, speak: boolean) => {
          updates.push({ text, speak });
          return true;
        },
        close: async () => {},
      }) as any,
  });
  await f.run("start");
  deliver("Ready completion reply", { triggerResponse: true });
  deliver("Ready background context", { triggerResponse: false });
  expect(updates).toEqual([
    { text: "Quoted session observation:\nQueued completion reply", speak: true },
    { text: "Quoted session observation:\nQueued background context", speak: false },
    { text: "Quoted session observation:\nConnecting completion reply", speak: true },
    { text: "Quoted session observation:\nReady completion reply", speak: true },
    { text: "Quoted session observation:\nReady background context", speak: false },
  ]);
  await f.run("stop");
});

describe("Live push-to-talk send gate", () => {
  const mode: Partial<LiveDependencies> = {
    config: {
      load: async () => ({ provider: "google", model: "gemini-3.8-live", inputMode: "push-to-talk" }),
      save: async () => {},
    },
  };
  const pcm = Buffer.alloc(640, 12);
  const press = "\x1b[32;1:1u";
  const repeat = "\x1b[32;1:2u";
  const release = "\x1b[32;1:3u";
  function hold(t: ReturnType<typeof setup>) {
    t.input(press);
    t.input(repeat);
  }
  test("omitted input mode defaults to muted shared-editor push-to-talk", async () => {
    const t = setup({}, false); // Use product defaults, not the continuous conversation fixture.
    await t.run("start");
    expect(t.captureGates).toEqual([null]);
    expect(t.editor.wantsKeyRelease).toBe(true);
    expect(t.status.at(-1)).toBe("Voice · hold Space to speak");
    t.capture.capture!(pcm);
    t.capture.capture!(pcm, 1);
    expect(t.sends).toBe(0);
    hold(t);
    t.capture.capture!(pcm, 1);
    expect(t.sends).toBe(1);
    t.input(release);
    await t.run("stop");
  });
  test("starts muted in the shared editor; real holds send only the current capture epoch", async () => {
    const t = setup(mode);
    t.editor.setText("draft");
    const cursor = t.editor.getCursor();
    await t.run("start"); // Startup resolves without opening or awaiting a panel.
    expect(t.customCalls).toBe(0);
    expect(t.editor.focused).toBe(true);
    expect(t.editor.wantsKeyRelease).toBe(true);
    expect(t.captureGates).toEqual([null]);
    expect(t.status.at(-1)).toBe("Voice · hold Space to speak");
    t.capture.capture!(pcm);
    t.capture.capture!(pcm, 1);
    expect(t.sends).toBe(0);
    t.input(press); // A press alone is a typed Space, not permission to send.
    expect(t.editor.getText()).toBe("draft ");
    expect(t.captureGates).toEqual([null]);
    t.input(repeat);
    expect(t.editor.getText()).toBe("draft");
    expect(t.editor.getCursor()).toEqual(cursor); // Remove only the unchanged hold warmup Space.
    expect(t.status.at(-1)).toBe("Listening · release Space to finish");
    expect(t.captureGates).toEqual([null, 1]);
    t.capture.capture!(pcm);
    t.capture.capture!(pcm, 0);
    t.capture.capture!(pcm, 1);
    expect(t.sends).toBe(1);
    t.input(repeat);
    expect(t.captureGates).toEqual([null, 1]); // Repeats extend one hold, not new epochs.
    t.input(release);
    expect(t.status.at(-1)).toBe("Voice · hold Space to speak");
    t.capture.capture!(pcm, 1);
    expect(t.sends).toBe(1);
    expect(t.endedAudio).toBe(1);
    expect(t.closes).toBe(0);
    hold(t);
    t.capture.capture!(pcm, 1);
    t.capture.capture!(pcm, 2);
    expect(t.sends).toBe(2);
    t.input("\x1b[32;5:3u"); // Release with changed modifiers still mutes synchronously.
    expect(t.endedAudio).toBe(2);
    expect(t.captureGates).toEqual([null, 1, null, 2, null]);
    t.capture.capture!(pcm, 2);
    expect(t.sends).toBe(2);
    await t.run("stop");
    expect(t.editor.wantsKeyRelease).toBe(false);
    expect(t.terminalWrites).toEqual(["\x1b[>15u", "\x1b[?1004h", "\x1b[?1004l", "\x1b[<u"]);
  });
  test("a tap or a press timer never opens capture; Enter and Backspace remain editor actions", async () => {
    const t = setup(mode);
    t.editor.setText("draft");
    await t.run("start");
    t.input(press);
    await new Promise((resolve) => setTimeout(resolve, 400));
    t.capture.capture!(pcm, 1);
    expect(t.sends).toBe(0);
    expect(t.captureGates).toEqual([null]);
    t.input(release);
    expect(t.editor.getText()).toBe("draft ");
    t.input("\x7f");
    expect(t.editor.getText()).toBe("draft");
    let submitted = "";
    t.editor.onSubmit = (text) => {
      submitted = text;
    };
    t.input("\r");
    expect(submitted).toBe("draft");
    expect(t.captureGates).toEqual([null]);
    expect(t.endedAudio).toBe(0);
    await t.run("stop");
  });
  test("ordinary input cancels a hold and repeat packets cannot reopen it", async () => {
    const t = setup(mode);
    t.editor.setText("draft");
    await t.run("start");
    hold(t);
    t.capture.capture!(pcm, 1);
    expect(t.sends).toBe(1);
    t.input("x");
    expect(t.editor.getText()).toBe("draftx");
    expect(t.captureGates).toEqual([null, 1, null]);
    expect(t.endedAudio).toBe(1);
    t.input(repeat);
    t.capture.capture!(pcm, 1);
    expect(t.captureGates).toEqual([null, 1, null]);
    expect(t.editor.getText()).toBe("draftx");
    expect(t.sends).toBe(1);
    t.input(release);
    hold(t);
    expect(t.captureGates).toEqual([null, 1, null, 2]);
    t.capture.capture!(pcm, 1);
    t.capture.capture!(pcm, 2);
    expect(t.sends).toBe(2);
    t.input(release);
    await t.run("stop");
  });
  test("legacy repeated Space routes a hold and repeat inactivity bounds capture without key-up", async () => {
    const t = setup(mode);
    t.editor.setText("draft");
    await t.run("start");
    let now = 1000;
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    cleanups.push(() => clock.mockRestore());
    t.input(" ");
    now += 400;
    t.input(" ");
    expect(t.editor.getText()).toBe("draft  ");
    expect(t.captureGates).toEqual([null]);
    now += 30;
    t.input(" ");
    expect(t.editor.getText()).toBe("draft");
    expect(t.captureGates).toEqual([null, 1]);
    t.capture.capture!(pcm, 1);
    expect(t.sends).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(t.captureGates).toEqual([null, 1, null]);
    expect(t.endedAudio).toBe(1);
    expect(t.status.at(-1)).toBe("Voice · hold Space to speak");
    t.capture.capture!(pcm, 1);
    expect(t.sends).toBe(1);
    await t.run("stop");
  });
  test("another dialog taking focus mutes immediately and retains its own Space keys", async () => {
    const t = setup(mode);
    await t.run("start");
    hold(t);
    t.capture.capture!(pcm, 1);
    expect(t.sends).toBe(1);
    t.focusDialog();
    expect(t.captureGates).toEqual([null, 1, null]);
    expect(t.endedAudio).toBe(1);
    t.input(" ");
    t.input("\r");
    expect(t.dialogKeys).toEqual([" ", "\r"]);
    t.capture.capture!(pcm, 1);
    expect(t.sends).toBe(1);
    t.focusEditor();
    t.input(repeat); // Returning during an existing hold cannot acquire capture.
    expect(t.captureGates).toEqual([null, 1, null]);
    expect(t.editor.getText()).toBe("");
    expect(t.status.at(-1)).toBe("Voice · hold Space to speak");
    t.input(release);
    hold(t);
    expect(t.captureGates).toEqual([null, 1, null, 2]);
    t.input(release);
    await t.run("stop");
  });
  test("terminal focus loss cancels capture before an editor can consume the packet", async () => {
    const t = setup(mode);
    await t.run("start");
    hold(t);
    t.input("\x1b[O");
    expect(t.captureGates).toEqual([null, 1, null]);
    expect(t.endedAudio).toBe(1);
    t.capture.capture!(pcm, 1);
    t.input(press);
    t.input(repeat);
    expect(t.sends).toBe(0);
    expect(t.captureGates).toEqual([null, 1, null]);
    t.input("\x1b[I");
    t.input(release);
    hold(t);
    expect(t.captureGates).toEqual([null, 1, null, 2]);
    t.input(release);
    await t.run("stop");
  });
  test("stop during hold detaches shared input and discards late capture without committing", async () => {
    const t = setup(mode);
    t.editor.setText("draft");
    await t.run("start");
    hold(t);
    expect(t.captureGates).toEqual([null, 1]);
    await t.run("stop");
    t.capture.capture!(pcm, 1);
    t.capture.capture!(pcm);
    expect(t.sends).toBe(0);
    expect(t.endedAudio).toBe(0);
    expect(t.editor.wantsKeyRelease).toBe(false);
    expect(t.editor.getText()).toBe("draft");
    expect(t.editor.focused).toBe(true);
    expect(t.customCalls).toBe(0);
    expect(t.status.at(-1)).toBeUndefined();
    expect(t.terminalWrites.at(-1)).toBe("\x1b[<u");
    t.input(" ");
    expect(t.editor.getText()).toBe("draft "); // Normal typing survives detach.
  });
  test("GPT-Live push-to-talk does not launch devices or silently send continuous audio", async () => {
    const t = setup({
      config: {
        load: async () => ({ provider: "openai", model: "gpt-live-1", inputMode: "push-to-talk" }),
        save: async () => {},
      },
    });
    await t.run("start");
    expect(t.launches).toBe(0);
    expect(t.notices.at(-1)).toContain("no manual input-turn control");
  });
  test("mic mode is selectable, persisted, and cannot change during Live", async () => {
    let saved: any;
    const t = setup({
      config: {
        load: async () => ({ provider: "google", model: "gemini-3.8-live", inputMode: "continuous" }),
        save: async (next) => {
          saved = next;
        },
      },
    });
    t.ctx.ui.select = async () => "Push-to-talk — hold Space; audio discarded while muted";
    await t.run("input");
    expect(saved.inputMode).toBe("push-to-talk");
    await t.run("start");
    await t.run("input continuous");
    expect(saved.inputMode).toBe("push-to-talk");
    expect(t.notices.at(-1)).toContain("Stop Live");
    await t.run("stop");
  });
});

test("GPT speech stays visible unless the same pending utterance is admitted as a canonical user turn", async () => {
  let callbacks: any;
  const saved: Array<{ text: string; details: any; display: boolean }> = [];
  const owner: any = {
    delegatedVoice: true,
    orchestration: { instructions: "", tools: [] },
    delegate: (_id: string, _text: string, _snapshot: unknown, admitted: () => void) => {
      admitted();
      return Promise.resolve();
    },
    saveTranscript: (text: string, details: any, display: boolean) => saved.push({ text, details, display }),
    sendContext() {},
    close() {},
    stopForeground() {},
    released: Promise.resolve(),
  };
  const f = setup({
    config: { load: async () => ({ provider: "openai", model: "gpt-live-1" }), save: async () => {} },
    owner: async () => owner,
    gptSession: (cb: any) => {
      callbacks = cb;
      return {
        state: "ready",
        connect: async () => {},
        appendMicrophone: () => true,
        observation: () => true,
        commentary: () => true,
        close: async () => {},
      } as any;
    },
  });
  await f.run("start");
  callbacks.onInputTranscript({ delta: "Hi", startMs: 100, endMs: 200 });
  callbacks.onOutputTranscript({ delta: "Hello", startMs: 250, endMs: 300 });
  expect(saved.filter((entry) => entry.details.speaker === "You").map((entry) => entry.display)).toEqual([true]);
  callbacks.onInputTranscript({ delta: "Check the repo", startMs: 400, endMs: 500 });
  callbacks.onDelegation({ id: "speech", target: "client", offsetMs: 550 });
  await tick();
  // All speech remains in its original passive source. Only the represented boundary is hidden.
  expect(saved.filter((entry) => entry.details.speaker === "You").map((entry) => entry.display)).toEqual([true, false]);
  callbacks.onInputTranscript({ delta: "Thanks", startMs: 600, endMs: 650 });
  callbacks.onOutputTranscript({ delta: "You are welcome", startMs: 660, endMs: 700 });
  expect(saved.filter((entry) => entry.details.speaker === "You").map((entry) => entry.display)).toEqual([
    true,
    false,
    true,
  ]);
  await f.run("stop");
});

test("unconfirmed audio shutdown gives a plain warning, not a false off state or unsupported retry", async () => {
  const f = setup();
  await f.run("start");
  f.audio.stop = async () => {
    throw new Error("test cleanup failure");
  };
  await f.run("stop");
  expect(f.notices.at(-1)).toContain("Couldn't confirm microphone shutdown");
  expect(f.notices.at(-1)).toContain("system mic indicator");
  expect(f.notices.at(-1)).not.toContain("Live off");
  expect(f.notices.at(-1)).not.toContain("Try");
});
