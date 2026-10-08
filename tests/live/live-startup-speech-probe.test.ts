import { expect, test } from "bun:test";
import {
  deliverStartupSpeech,
  finishStartupSpeech,
  startupSpeechCredentialPlan,
  startupSpeechGoogleAdapter,
} from "../../scripts/live/probe-startup-audio";
import { VoiceSession } from "../../src/live/session";
import type { LiveConnection, LiveParams } from "../../src/live/types";

test("startup speech defaults to canonical Google and OpenAI keys", () => {
  expect(startupSpeechCredentialPlan([])).toEqual([
    { provider: "google", source: "canonical" },
    { provider: "openai", source: "canonical" },
  ]);
});

test("explicit live.env startup speech is Google-only", () => {
  expect(startupSpeechCredentialPlan(["--gemini-live-env"])).toEqual([{ provider: "google", source: "live.env" }]);
});

for (const mode of ["control", "paced", "burst"] as const) {
  test(`startup speech ${mode} waits for provider ready and sends complete PCM`, async () => {
    let state = "idle";
    let release!: () => void;
    const sent: Buffer[] = [];
    const pcm = Buffer.alloc(1280, 3);
    const session = {
      get state() {
        return state;
      },
      connect: async (_key: string) => {
        state = "connecting";
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        state = "ready";
      },
      sendAudio: (base64: string) => {
        expect(state).toBe("ready");
        sent.push(Buffer.from(base64, "base64"));
      },
    };
    const delivering = deliverStartupSpeech(session, "test-only", pcm, mode, () => {});
    expect(sent).toHaveLength(0);
    release();
    const result = await delivering;
    expect(result.bufferedDuringConnect).toBe(mode !== "control");
    expect(Buffer.concat(sent)).toEqual(pcm);
    expect(sent).toHaveLength(2);
    expect(result.replayMs).toBeGreaterThanOrEqual(mode === "burst" ? 0 : 35);
  });
}

test("silence-only probe does not flush; paused-stream probe does", async () => {
  let ended = 0;
  const session = {
    endAudio: () => {
      ended++;
    },
  };
  expect(await finishStartupSpeech(session, false)).toBe(false);
  expect(ended).toBe(0);
  const start = Date.now();
  expect(await finishStartupSpeech(session, true)).toBe(true);
  expect(ended).toBe(1);
  expect(Date.now() - start).toBeGreaterThanOrEqual(1500);
});

for (const manual of [false, true]) {
  test(`Google probe preserves setup and ${manual ? "manually frames" : "does not frame"} PCM`, async () => {
    let params!: LiveParams;
    const sent: unknown[] = [];
    let ready = false;
    const connection = {
      sendRealtimeInput: (value: unknown) => {
        expect(ready).toBe(true);
        sent.push(value);
      },
      close: () => {},
    } as unknown as LiveConnection;
    const adapter = startupSpeechGoogleAdapter(
      () => ({
        live: {
          connect: async (value: LiveParams) => {
            params = value;
            return connection;
          },
        },
      }),
      manual,
    );
    const session = new VoiceSession(
      {
        onReady: () => {
          ready = true;
        },
      },
      adapter,
      {
        instructions: "fixture instructions",
        tools: [],
        execute: async () => ({}),
      },
    );
    await deliverStartupSpeech(
      session,
      "test-only",
      Buffer.alloc(1280, 3),
      "paced",
      () => {},
      undefined,
      manual
        ? {
            start: () => connection.sendRealtimeInput({ activityStart: {} }),
            end: () => connection.sendRealtimeInput({ activityEnd: {} }),
          }
        : undefined,
    );
    expect(params.model).toBe("gemini-3.8-live");
    expect(params.config?.systemInstruction).toBe("fixture instructions");
    expect(params.config?.inputAudioTranscription).toEqual({});
    expect(params.config?.outputAudioTranscription).toEqual({});
    expect(params.config?.realtimeInputConfig?.automaticActivityDetection?.disabled).toBe(manual);
    const audio = { audio: { data: Buffer.alloc(640, 3).toString("base64"), mimeType: "audio/pcm;rate=16000" } };
    expect(sent).toEqual(manual ? [{ activityStart: {} }, audio, audio, { activityEnd: {} }] : [audio, audio]);
    session.close();
  });
}
