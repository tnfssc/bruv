import { GoogleGenAI } from "@google/genai";
// Test-only: default control + paced (max four sessions, two with --gemini-live-env).
// --mode=control|paced|burst selects one trial per provider. No retries/devices.
// --manual-activity frames Gemini retention with automatic VAD disabled.
// --flush-after-pause tests cached-audio flushing separately; neither proves silence-only VAD.
// --gemini-live-env --fixture=gemini-natural: one memory-only generation + control/paced/burst (max four sessions).
import { createDefaultLiveCredentialService, loadLiveKey } from "../../src/live/credentials";
import { OPENAI_VOICE_MODEL, OpenAIRealtimeSession } from "../../src/live/openai-session";
import { VoiceSession } from "../../src/live/session";
import type { LiveAdapter, LiveConnection, VoiceCallbacks, VoiceOrchestration } from "../../src/live/types";
import { StartupAudioQueue } from "../../tests/live/helpers/live-startup-audio-queue";
import {
  fixtureCommand as command,
  generateNaturalFixture,
  naturalFixturePcm,
  pcmCounts,
  startupPhrase as phrase,
  startupWordCounts,
  trailingSilenceMs,
} from "./startup-fixture";

/** Select credential sources; --gemini-live-env restricts the probe to its explicit source. */
export function startupSpeechCredentialPlan(args: readonly string[]): {
  provider: "google" | "openai";
  source: "canonical" | "live.env";
}[] {
  return args.includes("--gemini-live-env")
    ? [{ provider: "google", source: "live.env" }]
    : [
        { provider: "google", source: "canonical" },
        { provider: "openai", source: "canonical" },
      ];
}

type SpeechMode = "control" | "burst" | "paced";

/** Same production session/fixture; control bypasses the experimental queue entirely. */
export async function deliverStartupSpeech(
  session: { readonly state: string; connect(key: string): Promise<void>; sendAudio(base64: string): void },
  key: string,
  pcm: Buffer,
  mode: SpeechMode,
  onSend: (bytes: number) => void,
  onQueue: (queue: StartupAudioQueue) => void = () => {},
  activity?: { start(): void; end(): void },
) {
  const start = Date.now();
  const send = (chunk: Buffer) => {
    session.sendAudio(chunk.toString("base64"));
    onSend(chunk.length);
  };
  const connecting = session.connect(key);
  let queue: StartupAudioQueue | undefined;
  if (mode !== "control") {
    queue = new StartupAudioQueue(send, () => session.state === "ready");
    onQueue(queue);
    for (let i = 0; i < pcm.length; i += 640) queue.push(pcm.subarray(i, i + 640));
  }
  const bufferedDuringConnect = !!queue && session.state === "connecting";
  await connecting;
  if (session.state !== "ready") throw new Error("Provider setup did not become ready");
  const setupMs = Date.now() - start;
  const replayAt = Date.now();
  activity?.start();
  if (queue) await queue.ready(mode === "paced" ? 20 : 0);
  else {
    for (let i = 0; i < pcm.length; i += 640) {
      if (session.state !== "ready") throw new Error("Provider closed during control");
      send(pcm.subarray(i, i + 640));
      await Bun.sleep(20);
    }
  }
  activity?.end();
  return { bufferedDuringConnect, setupMs, replayMs: Date.now() - replayAt };
}

/** Test-only override: production retains automatic VAD. Never mix both policies. */
export function startupSpeechGoogleAdapter(adapter: LiveAdapter, manualActivity: boolean): LiveAdapter {
  return (apiKey) => {
    const ai = adapter(apiKey);
    return {
      live: {
        connect: (params) =>
          ai.live.connect({
            ...params,
            ...(manualActivity
              ? {
                  config: { ...params.config, realtimeInputConfig: { automaticActivityDetection: { disabled: true } } },
                }
              : {}),
          }),
      },
    };
  };
}

/** File playback pauses capture; automatic VAD docs require flushing cached audio. */
export async function finishStartupSpeech(session: { endAudio(): void }, flushAfterPause: boolean) {
  if (!flushAfterPause) return false;
  await Bun.sleep(1500);
  session.endAudio();
  return true;
}

/** Synthesize the fixed phrase as bounded 16 kHz mono PCM for the local probe. */
async function synthesize() {
  const wav = await command(["espeak-ng", "--stdout", "-s", "165", phrase]);
  const speech = await command(
    [
      "ffmpeg",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-f",
      "s16le",
      "-ac",
      "1",
      "-ar",
      "16000",
      "pipe:1",
    ],
    wav,
  );
  const pcm = Buffer.concat([speech, Buffer.alloc(32 * trailingSilenceMs)]);
  if (!speech.length || pcm.length > 320_000 || pcm.length % 2) throw new Error("Invalid synthetic PCM duration");
  return pcm;
}
/** Run one provider/mode observation and collect timings, transcript retention, and PCM diagnostics. */
async function trial(
  provider: "google" | "openai",
  mode: SpeechMode,
  key: string,
  pcm: Buffer,
  flushAfterPause: boolean,
  manualActivity: boolean,
) {
  let queue: StartupAudioQueue | undefined;
  let input = "",
    output = "",
    inputFinished = false,
    turns = 0,
    outputAudioBytes = 0;
  const errors: string[] = [];
  const callbacks: VoiceCallbacks = {
    onInputTranscript: (t) => {
      input = t.replace ? t.text : input + t.text;
      inputFinished ||= !!t.finished;
    },
    onOutputTranscript: (t) => {
      output = t.replace ? t.text : output + t.text;
    },
    onTurnComplete: () => {
      turns++;
    },
    onAudio: (b64) => {
      outputAudioBytes += Buffer.from(b64, "base64").length;
    },
    onError: (e) => {
      errors.push(e.code);
      queue?.stop();
    },
    onState: (state) => {
      if (state === "closed") queue?.stop();
    },
  };
  const orchestration: VoiceOrchestration = {
    instructions: "Repeat the user's four requested words briefly. Do not use tools.",
    tools: [],
    execute: async () => ({ status: "denied" }),
  };
  const providerMessages = {
    total: 0,
    setup: 0,
    sessionResumption: 0,
    usage: 0,
    goAway: 0,
    voiceActivity: 0,
    serverContent: 0,
    inputTranscript: 0,
    audio: 0,
  };
  let googleConnection: LiveConnection | undefined;
  let manualStartSent = false;
  let manualEndSent = false;
  const session =
    provider === "google"
      ? new VoiceSession(
          callbacks,
          startupSpeechGoogleAdapter((apiKey) => {
            const ai = new GoogleGenAI({ apiKey });
            return {
              live: {
                connect: async (params) => {
                  googleConnection = await ai.live.connect({
                    ...params,
                    callbacks: {
                      ...params.callbacks,
                      onmessage: (message) => {
                        providerMessages.total++;
                        if (message.setupComplete) providerMessages.setup++;
                        if (message.sessionResumptionUpdate) providerMessages.sessionResumption++;
                        if (message.usageMetadata) providerMessages.usage++;
                        if (message.goAway) providerMessages.goAway++;
                        if (message.voiceActivity) providerMessages.voiceActivity++;
                        if (message.serverContent) providerMessages.serverContent++;
                        if (message.serverContent?.inputTranscription) providerMessages.inputTranscript++;
                        if (message.serverContent?.modelTurn?.parts?.some((part) => part.inlineData))
                          providerMessages.audio++;
                        params.callbacks?.onmessage?.(message);
                      },
                    },
                  });
                  return googleConnection;
                },
              },
            };
          }, manualActivity),
          orchestration,
        )
      : new OpenAIRealtimeSession(callbacks, undefined, orchestration);
  let sentBytes = 0;
  let bufferedDuringConnect = false;
  let replayMs: number | null = null;
  let setupMs: number | null = null;
  let streamEndSent = false;
  let turnEndBeforeStreamEnd = false;
  let inputBeforeStreamEnd = false;
  let audioBytesBeforeStreamEnd = 0;
  let streamEndMs: number | null = null;
  const start = Date.now();
  const timer = setTimeout(() => {
    errors.push("probe_deadline");
    queue?.stop();
    session.close();
  }, 35_000);
  try {
    ({ bufferedDuringConnect, setupMs, replayMs } = await deliverStartupSpeech(
      session,
      key,
      pcm,
      mode,
      (bytes) => {
        sentBytes += bytes;
      },
      (value) => {
        queue = value;
      },
      manualActivity
        ? {
            start: () => {
              if (!googleConnection) throw new Error("Manual activity requires a ready Google connection");
              googleConnection.sendRealtimeInput({ activityStart: {} });
              manualStartSent = true;
            },
            end: () => {
              if (!googleConnection) throw new Error("Manual activity requires a ready Google connection");
              googleConnection.sendRealtimeInput({ activityEnd: {} });
              manualEndSent = true;
            },
          }
        : undefined,
    ));
    if (flushAfterPause) {
      // Snapshot immediately before the end marker, after the documented >1 second pause.
      streamEndSent = await finishStartupSpeech(
        {
          endAudio: () => {
            turnEndBeforeStreamEnd = turns > 0;
            inputBeforeStreamEnd = !!input;
            audioBytesBeforeStreamEnd = outputAudioBytes;
            streamEndMs = Date.now() - start;
            session.endAudio();
          },
        },
        true,
      );
    }
    // Silence-only and flushed speech acceptance are intentionally distinct.
    while (Date.now() - start < 34_000 && !errors.length && !(turns && input && output && outputAudioBytes))
      await Bun.sleep(50);
  } catch {
    errors.push("probe_setup_or_replay_failed");
  } finally {
    clearTimeout(timer);
    const wordCounts = startupWordCounts(input);
    const { retainedWords } = wordCounts;
    // A provider turn is independent of how it spells a recognized number.
    const automaticTurnAccepted =
      !manualActivity &&
      !flushAfterPause &&
      !streamEndSent &&
      !!input &&
      !!output &&
      turns > 0 &&
      outputAudioBytes > 0 &&
      !errors.length;
    const ok =
      (mode === "control" ? !bufferedDuringConnect : bufferedDuringConnect) &&
      sentBytes === pcm.length &&
      retainedWords &&
      turns > 0 &&
      output.length > 0 &&
      outputAudioBytes > 0 &&
      !errors.length;
    console.log(
      JSON.stringify({
        provider,
        mode,
        model: provider === "google" ? (session as VoiceSession).model : OPENAI_VOICE_MODEL,
        ok,
        // Full speech/retention acceptance, not merely an observed automatic turn end.
        silenceOnlyVadAccepted: ok && automaticTurnAccepted,
        automaticTurnAccepted,
        manuallyFramedSpeechAccepted: ok && manualActivity,
        flushedSpeechAccepted: ok && flushAfterPause,
        bufferedDuringConnect,
        inputTranscript: !!input,
        inputFinished,
        ...wordCounts,
        turnEndBeforeStreamEnd: streamEndSent ? turnEndBeforeStreamEnd : turns > 0,
        turnComplete: turns > 0,
        streamEndSent,
        inputBeforeStreamEnd: streamEndSent ? inputBeforeStreamEnd : !!input,
        audioBytesBeforeStreamEnd: streamEndSent ? audioBytesBeforeStreamEnd : outputAudioBytes,
        streamEndMs,
        automaticVad: !manualActivity,
        manualActivityMarkers: manualActivity,
        manualStartSent,
        manualEndSent,
        providerMessages,
        outputTranscript: !!output,
        outputAudioBytes,
        pcmMs: pcm.length / 32,
        trailingSilenceMs,
        sentBytes,
        setupMs,
        replayMs,
        elapsedMs: Date.now() - start,
        errors,
      }),
    );
    if (!ok) process.exitCode = 1;
    queue?.stop();
    if (!manualActivity) session.endAudio(); // cleanup only, not counted as VAD success
    session.close();
  }
}
/** Parse fixture selection without connecting and report its session budget. */
export function startupSpeechFixturePlan(args: readonly string[]) {
  const fixture = args.find((arg) => arg.startsWith("--fixture="))?.slice(10) ?? "espeak";
  if (!["espeak", "gemini-natural"].includes(fixture)) throw new Error("Invalid fixture");
  const selected = args.find((arg) => arg.startsWith("--mode="))?.slice(7);
  if (selected && !["control", "burst", "paced"].includes(selected)) throw new Error("Invalid mode");
  if (
    fixture === "gemini-natural" &&
    (!args.includes("--gemini-live-env") ||
      args.includes("--manual-activity") ||
      args.includes("--flush-after-pause") ||
      args.includes("--fixture-only"))
  )
    throw new Error("Natural fixture requires supplied Google key and automatic silence-only trials");
  const modes: SpeechMode[] = selected
    ? [selected as SpeechMode]
    : fixture === "gemini-natural"
      ? ["control", "paced", "burst"]
      : ["control", "paced"];
  return { fixture, modes };
}

/** Resolve one credential source; unavailable keys skip only that provider. */
async function loadStartupSpeechKey(
  provider: "google" | "openai",
  source: "canonical" | "live.env",
): Promise<string | undefined> {
  try {
    if (source === "live.env" && provider === "google") {
      const key = await loadLiveKey(); // explicit test-only read; never import or store
      console.log(JSON.stringify({ provider, credentialSource: source, credentialState: "supplied_api_key" }));
      return key;
    }
    const credentials = await createDefaultLiveCredentialService(undefined, provider);
    const status = await credentials.status();
    console.log(JSON.stringify({ provider, credentialState: status.state }));
    return await credentials.loadKey(); // default canonical behavior unchanged; never import
  } catch {
    console.log(JSON.stringify({ provider, blocked: `existing ${source} API key unavailable`, paidSessions: 0 }));
    process.exitCode = 1;
    return undefined;
  }
}

/** Prepare shared PCM; failed natural generation ends the run without retry or paid controls. */
async function prepareStartupSpeechFixture(fixture: string, key: string): Promise<Buffer | undefined> {
  if (fixture !== "gemini-natural") return synthesize();

  let generated: Awaited<ReturnType<typeof generateNaturalFixture>>;
  try {
    generated = await generateNaturalFixture(key);
  } catch (error) {
    const code =
      error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : "fixture_generation_failed";
    console.log(JSON.stringify({ fixture, stage: "generation", ok: false, error: code }));
    process.exitCode = 1;
    return undefined; // no retry, no unusable fixture sent to paid controls
  }
  const pcm = await naturalFixturePcm(generated.pcm24);
  const { pcm24: _pcm24, model: _model, elapsedMs: _elapsedMs, ...wordCounts } = generated;
  console.log(
    JSON.stringify({
      fixture,
      stage: "generation",
      ok: true,
      model: generated.model,
      elapsedMs: generated.elapsedMs,
      ...wordCounts,
      textTriggeredGeneration: true,
      automaticTurnAccepted: false,
      source: pcmCounts(generated.pcm24, 24000),
      input: pcmCounts(pcm, 16000),
      trailingSilenceMs,
      silenceTail: pcm.subarray(-32 * trailingSilenceMs).every((v) => v === 0),
    }),
  );
  return pcm;
}

/** Dispatch the CLI-selected fixture or provider trials and print their diagnostics. */
async function main() {
  const { fixture, modes } = startupSpeechFixturePlan(process.argv);
  if (process.argv.includes("--fixture-only")) {
    const pcm = await synthesize();
    console.log(
      JSON.stringify({
        fixtureOnly: true,
        pcmBytes: pcm.length,
        pcmMs: pcm.length / 32,
        trailingSilenceMs,
        silenceTail: pcm.subarray(-32 * trailingSilenceMs).every((v) => v === 0),
      }),
    );
    return;
  }
  if (process.env.BRUV_RUN_LIVE_STARTUP_SPEECH !== "1") throw new Error("Explicit paid opt-in required");
  let pcm: Buffer | undefined;
  for (const { provider, source } of startupSpeechCredentialPlan(process.argv)) {
    const key = await loadStartupSpeechKey(provider, source);
    if (key === undefined) continue;
    if (!pcm) {
      pcm = await prepareStartupSpeechFixture(fixture, key);
      if (!pcm) return;
    }
    const manualActivity = process.argv.includes("--manual-activity");
    const flushAfterPause = process.argv.includes("--flush-after-pause");
    if (manualActivity && (provider !== "google" || flushAfterPause)) throw new Error("Invalid activity policy");
    for (const mode of modes) await trial(provider, mode, key, pcm, flushAfterPause, manualActivity);
  }
}
if (import.meta.main) {
  main().catch(() => {
    console.error("Startup speech probe failed; details suppressed");
    process.exitCode = 1;
  });
}
