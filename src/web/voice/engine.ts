import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readConfig } from "../../config";
import type { Engine } from "../../voice/call";
import { cloudModel } from "../../voice/cloud";
import { type Cloud, startEngine } from "../../voice/engine";
import { download, type ModelPaths, missing, modelPaths } from "../../voice/models";

export type MakeEngine = (paths: ModelPaths, threads?: number, cloud?: Cloud, speed?: number) => Engine;

/** Voice's folder, shared with /voice in the terminal, so the models are downloaded once for both. */
const voiceDir = (agentDir: string) => join(agentDir, "bruv", "voice");
const modelsDir = (agentDir: string) => join(voiceDir(agentDir), "models");

/** MB of models still to download; 0 when voice can start. */
export const modelsNeeded = (agentDir: string) =>
  missing(modelsDir(agentDir)).reduce((sum, model) => sum + model.mb, 0);

export const downloadModels = (agentDir: string, progress: (text: string) => void, fetch?: typeof globalThis.fetch) =>
  download(modelsDir(agentDir), progress, fetch);

/** Pi's key for a provider, and whether there was one when voice started. */
export type Key = { has: boolean; get: () => Promise<string | undefined> };

/** Speech from OpenRouter when Pi has a key, unless the user chose Kokoro; told once, as in the terminal. */
function cloud(
  agentDir: string,
  speech: string | undefined,
  notify: (text: string) => void,
  key: Key | undefined,
): Cloud | undefined {
  if (speech === "kokoro" || !key?.has) return undefined;
  const model = speech ?? cloudModel;
  const dir = voiceDir(agentDir);
  if (!existsSync(join(dir, "told-cloud"))) {
    notify(
      `Voice speaks with ${model} through your OpenRouter key. What the assistant says aloud is sent there. To keep speech on this machine, set "speech": "kokoro" under "voice" in bruv.json.`,
    );
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "told-cloud"), "");
  }
  return { model, key: key.get, fillers: join(dir, "fillers") };
}

/** Starts the speech engine with the user's voice settings from bruv.json. */
export function makeEngine(
  agentDir: string,
  notify: (text: string) => void,
  make: MakeEngine = startEngine,
  key?: Key,
) {
  const config = readConfig(agentDir).voice ?? {};
  return make(
    modelPaths(modelsDir(agentDir), config.voice),
    config.threads,
    cloud(agentDir, config.speech, notify, key),
    config.speed,
  );
}
