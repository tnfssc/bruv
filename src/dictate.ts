import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { setStatus } from "./status";

export type Recorder = { command: string; args: (file: string) => string[] };

const rate = "16000";
/** Recorders that write a 16 kHz mono WAV file and finish it on SIGINT, best first. */
export const recorders: Recorder[] = [
  { command: "pw-record", args: (file) => ["--rate", rate, "--channels", "1", "--format", "s16", file] },
  {
    command: "parec",
    // parec holds two seconds of audio by default and loses it when stopped early.
    args: (file) => [
      `--rate=${rate}`,
      "--channels=1",
      "--format=s16le",
      "--file-format=wav",
      "--latency-msec=50",
      file,
    ],
  },
  { command: "arecord", args: (file) => ["-q", "-f", "S16_LE", "-r", rate, "-c", "1", file] },
  // sox starts slowly and misses the first moment of speech, so it comes last. It is the one for macOS.
  { command: "sox", args: (file) => ["-q", "-d", "-r", rate, "-b", "16", "-c", "1", file] },
];
const installed = (command: string) => spawnSync("which", [command], { stdio: "ignore" }).status === 0;

// The endpoint Codex apps use for dictation with a ChatGPT sign-in. It is not documented.
const transcribeUrl = "https://chatgpt.com/backend-api/transcribe";
const maxSeconds = 300;
// A WAV header plus a tenth of a second of 16 kHz 16-bit audio.
const minBytes = 44 + 3200;

async function codexToken(ctx: ExtensionContext) {
  const model =
    ctx.model?.api === "openai-codex-responses"
      ? ctx.model
      : ctx.modelRegistry.getAll().find((candidate) => candidate.api === "openai-codex-responses");
  if (!model) return;
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  return auth.ok ? auth.apiKey : undefined;
}

export function registerDictate(
  pi: ExtensionAPI,
  options: { recorder?: Recorder; fetch?: typeof globalThis.fetch } = {},
) {
  let recording: { child: ChildProcess; file: string; errors: string[]; timer: NodeJS.Timeout } | undefined;

  const start = (ctx: ExtensionContext) => {
    const recorder = options.recorder ?? recorders.find((candidate) => installed(candidate.command));
    if (!recorder) {
      ctx.ui.notify("Dictation needs a recorder: pw-record, parec, arecord or sox.", "error");
      return;
    }
    const dir = join(ctx.sessionManager.getSessionDir(), "bruv");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `dictation-${Date.now()}.wav`);
    const child = spawn(recorder.command, recorder.args(file), { stdio: ["ignore", "ignore", "pipe"] });
    const errors: string[] = [];
    child.stderr?.on("data", (chunk: Buffer) => errors.push(chunk.toString()));
    child.on("error", (error) => errors.push(error.message));
    recording = { child, file, errors, timer: setTimeout(() => void stop(ctx), maxSeconds * 1000) };
    setStatus(ctx, "dictate", "● dictating · Ctrl+Alt+D to stop");
  };

  const stop = async (ctx: ExtensionContext) => {
    if (!recording) return;
    const { child, file, errors, timer } = recording;
    recording = undefined;
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) {
      const closed = new Promise((resolve) => child.once("close", resolve));
      child.kill("SIGINT");
      const late = setTimeout(() => child.kill("SIGKILL"), 3000);
      await closed;
      clearTimeout(late);
    }
    setStatus(ctx, "dictate", "transcribing…");
    try {
      let wav: Buffer;
      try {
        wav = readFileSync(file);
      } catch {
        wav = Buffer.alloc(0);
      }
      if (wav.length < minBytes) {
        const why = errors.join("").trim().split("\n").at(-1);
        ctx.ui.notify(`Nothing was recorded${why ? `: ${why}` : ". Is a microphone connected?"}`, "warning");
        return;
      }
      const token = await codexToken(ctx);
      if (!token) {
        ctx.ui.notify("Dictation uses your ChatGPT sign-in. Sign in to OpenAI Codex with /login.", "error");
        return;
      }
      const form = new FormData();
      form.set("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "dictation.wav");
      const response = await (options.fetch ?? globalThis.fetch)(transcribeUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, originator: "pi" },
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      const text = response.ok ? ((await response.json()) as { text?: unknown }).text : undefined;
      if (typeof text !== "string") {
        // Cloudflare marks the requests it blocks before they reach OpenAI.
        const blocked = response.headers.get("cf-mitigated");
        ctx.ui.notify(
          `Transcription failed (${response.status}${blocked ? `, blocked by Cloudflare: ${blocked}` : ""}).`,
          "error",
        );
        return;
      }
      if (text.trim()) ctx.ui.pasteToEditor(text.trim());
    } catch (error) {
      ctx.ui.notify(`Transcription failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      rmSync(file, { force: true });
      setStatus(ctx, "dictate", undefined);
    }
  };

  const toggle = (ctx: ExtensionContext) => (recording ? stop(ctx) : start(ctx));
  pi.registerShortcut("ctrl+alt+d", { description: "Start or stop dictation into the input", handler: toggle });
  pi.registerCommand("dictate", {
    description: "Start or stop dictation into the input (also Ctrl+Alt+D)",
    handler: async (_args, ctx) => {
      await toggle(ctx);
    },
  });
  pi.on("session_shutdown", () => {
    if (!recording) return;
    clearTimeout(recording.timer);
    recording.child.kill("SIGINT");
    rmSync(recording.file, { force: true });
    recording = undefined;
  });
}
