import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const releases = "https://github.com/k2-fsa/sherpa-onnx/releases/download";

/** Silero VAD, NVIDIA's streaming English Nemotron (160 ms chunks) and Kyutai's Pocket TTS. All run on the CPU. */
const models = {
  vad: { url: `${releases}/asr-models/silero_vad_v5.onnx`, name: "silero_vad_v5.onnx", mb: 2 },
  asr: {
    url: `${releases}/asr-models/sherpa-onnx-nemotron-speech-streaming-en-0.6b-160ms-int8-2026-04-25.tar.bz2`,
    name: "sherpa-onnx-nemotron-speech-streaming-en-0.6b-160ms-int8-2026-04-25",
    mb: 463,
  },
  tts: {
    url: `${releases}/tts-models/sherpa-onnx-pocket-tts-int8-2026-01-26.tar.bz2`,
    name: "sherpa-onnx-pocket-tts-int8-2026-01-26",
    mb: 98,
  },
};

export type ModelPaths = { vad: string; asr: string; tts: string; voice: string };

/** Voices that come with Pocket TTS. A path to a WAV file of someone talking also works. */
export const voices = ["bria", "loona"];

export function modelPaths(dir: string, voice = "bria"): ModelPaths {
  const tts = join(dir, models.tts.name);
  return {
    vad: join(dir, models.vad.name),
    asr: join(dir, models.asr.name),
    tts,
    voice: voices.includes(voice) ? join(tts, "test_wavs", `${voice}.wav`) : voice,
  };
}

/** The models not yet downloaded, with their size in MB. */
export function missing(dir: string) {
  return Object.values(models).filter((model) => !existsSync(join(dir, model.name)));
}

/** Downloads the missing models. Archives are unpacked to a temporary folder first, so a failed download leaves nothing behind. */
export async function download(dir: string, progress: (text: string) => void, fetch = globalThis.fetch) {
  mkdirSync(dir, { recursive: true });
  for (const model of missing(dir)) {
    progress(`Downloading ${model.name} (${model.mb} MB)…`);
    const response = await fetch(model.url);
    if (!response.ok || !response.body) throw new Error(`Download of ${model.name} failed (${response.status}).`);
    const body = Readable.fromWeb(response.body as unknown as import("node:stream/web").ReadableStream);
    const partial = join(dir, `.partial-${model.name}`);
    rmSync(partial, { recursive: true, force: true });
    if (model.url.endsWith(".tar.bz2")) {
      mkdirSync(partial);
      const tar = spawn("tar", ["xjf", "-", "-C", partial], { stdio: ["pipe", "ignore", "pipe"] });
      const errors: string[] = [];
      tar.stderr.on("data", (chunk: Buffer) => errors.push(chunk.toString()));
      const exited = new Promise<number | null>((resolve, reject) => {
        tar.on("error", reject);
        tar.on("close", resolve);
      });
      await pipeline(body, tar.stdin);
      if ((await exited) !== 0) throw new Error(`Unpacking ${model.name} failed: ${errors.join("").trim()}`);
      renameSync(join(partial, model.name), join(dir, model.name));
      rmSync(partial, { recursive: true, force: true });
    } else {
      await pipeline(body, createWriteStream(partial));
      renameSync(partial, join(dir, model.name));
    }
  }
}
