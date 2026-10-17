import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const releases = "https://github.com/k2-fsa/sherpa-onnx/releases/download";

/**
 * Silero VAD, NVIDIA's streaming English Nemotron (160 ms chunks) and Kokoro v1.0. All run on the CPU. Kokoro
 * sounds far more natural than Pocket TTS, which came first; its int8 build ran at about real time here,
 * too slow to keep up, so this is the full one.
 */
const models = {
  vad: { url: `${releases}/asr-models/silero_vad_v5.onnx`, name: "silero_vad_v5.onnx", mb: 2 },
  asr: {
    url: `${releases}/asr-models/sherpa-onnx-nemotron-speech-streaming-en-0.6b-160ms-int8-2026-04-25.tar.bz2`,
    name: "sherpa-onnx-nemotron-speech-streaming-en-0.6b-160ms-int8-2026-04-25",
    mb: 463,
  },
  tts: {
    url: `${releases}/tts-models/kokoro-multi-lang-v1_0.tar.bz2`,
    name: "kokoro-multi-lang-v1_0",
    mb: 333,
  },
};

/** Models bruv used before, deleted once their replacements are in. */
const retired = ["sherpa-onnx-pocket-tts-int8-2026-01-26"];

export type ModelPaths = { vad: string; asr: string; tts: string; speaker: number };

/**
 * Kokoro's English voices, in the model's speaker order: American and British, women (f) and men (m).
 * af_heart is the best rated.
 */
export const voices = [
  ...["af_alloy", "af_aoede", "af_bella", "af_heart", "af_jessica", "af_kore", "af_nicole", "af_nova", "af_river"],
  ...["af_sarah", "af_sky", "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx"],
  ...["am_puck", "am_santa", "bf_alice", "bf_emma", "bf_isabella", "bf_lily", "bm_daniel", "bm_fable"],
  ...["bm_george", "bm_lewis"],
];

export function modelPaths(dir: string, voice = "af_heart"): ModelPaths {
  const speaker = voices.indexOf(voice);
  return {
    vad: join(dir, models.vad.name),
    asr: join(dir, models.asr.name),
    tts: join(dir, models.tts.name),
    speaker: speaker < 0 ? voices.indexOf("af_heart") : speaker,
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
  for (const name of retired) rmSync(join(dir, name), { recursive: true, force: true });
}
