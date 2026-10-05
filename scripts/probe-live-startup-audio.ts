// Test-only. At most four paid sessions (two providers x burst/paced), no retries/devices.
import { createDefaultLiveCredentialService } from "../src/live/credentials";
import { VoiceSession } from "../src/live/session";
import { OpenAIRealtimeSession } from "../src/live/openai-session";
import type { VoiceCallbacks, VoiceOrchestration } from "../src/live/types";
import { StartupAudioQueue } from "../tests/helpers/live-startup-audio-queue";

const phrase = "Please repeat these words: amber river seven lighthouse.";
const words = ["amber", "river", "seven", "lighthouse"];
const trailingSilenceMs = 1200;
async function command(args: string[], input?: Uint8Array): Promise<Buffer> {
  const child = Bun.spawn(args, { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  if (input) child.stdin.write(input);
  child.stdin.end();
  const timeout = setTimeout(() => child.kill(), 4000);
  try {
    const [output, code] = await Promise.all([new Response(child.stdout).arrayBuffer(), child.exited]);
    if (code !== 0) throw new Error("Synthetic speech command failed");
    return Buffer.from(output);
  } finally {
    clearTimeout(timeout);
    child.kill();
  }
}
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
async function trial(provider: "google" | "openai", mode: "burst" | "paced", key: string, pcm: Buffer) {
  let queue!: StartupAudioQueue;
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
  const session =
    provider === "google"
      ? new VoiceSession(callbacks, undefined, orchestration)
      : new OpenAIRealtimeSession(callbacks, undefined, orchestration);
  let sentBytes = 0;
  queue = new StartupAudioQueue(
    (b) => {
      sentBytes += b.length;
      session.sendAudio(b.toString("base64"));
    },
    () => session.state === "ready",
  );
  const start = Date.now();
  const timer = setTimeout(() => {
    errors.push("probe_deadline");
    queue.stop();
    session.close();
  }, 35_000);
  try {
    const connecting = session.connect(key);
    // All speech is buffered while the actual provider setup is pending. No mic or disk audio.
    for (let i = 0; i < pcm.length; i += 640) queue.push(pcm.subarray(i, i + 640));
    const bufferedDuringConnect = session.state === "connecting";
    await connecting;
    if (session.state !== "ready") throw new Error("Provider setup did not become ready");
    const replayAt = Date.now();
    await queue.ready(mode === "paced" ? 20 : 0);
    const replayMs = Date.now() - replayAt;
    // No forced commit/response or audioStreamEnd: trailing silence must cause remote turn-end.
    while (Date.now() - start < 34_000 && !errors.length && !(turns && input && output && outputAudioBytes))
      await Bun.sleep(50);
    const normalized = input.toLowerCase().replace(/[^a-z0-9 ]/g, " ");
    let position = 0;
    const retainedWords = words.every((word) => {
      const at = normalized.indexOf(word, position);
      if (at < 0) return false;
      position = at + word.length;
      return true;
    });
    const ok =
      bufferedDuringConnect &&
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
        ok,
        bufferedDuringConnect,
        inputTranscript: !!input,
        inputFinished,
        retainedWords,
        turnEndBeforeStreamEnd: turns > 0,
        outputTranscript: !!output,
        outputAudioBytes,
        pcmMs: pcm.length / 32,
        trailingSilenceMs,
        sentBytes,
        replayMs,
        elapsedMs: Date.now() - start,
        errors,
      }),
    );
    if (!ok) process.exitCode = 1;
  } catch {
    console.log(JSON.stringify({ provider, mode, ok: false, phase: "setup-or-replay", errors }));
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    queue.stop();
    session.endAudio(); // cleanup only, not counted as VAD success
    session.close();
  }
}
async function main() {
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
  for (const provider of ["google", "openai"] as const) {
    let key: string;
    try {
      const credentials = await createDefaultLiveCredentialService(undefined, provider);
      const status = await credentials.status();
      console.log(JSON.stringify({ provider, credentialState: status.state }));
      key = await credentials.loadKey(); // canonical existing credentials ONLY; never import
    } catch {
      console.log(JSON.stringify({ provider, blocked: "existing canonical API key unavailable", paidSessions: 0 }));
      process.exitCode = 1;
      continue;
    }
    pcm ??= await synthesize();
    for (const mode of ["burst", "paced"] as const) await trial(provider, mode, key, pcm);
  }
}
main().catch(() => {
  console.error("Startup speech probe failed; details suppressed");
  process.exitCode = 1;
});
