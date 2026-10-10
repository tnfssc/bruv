import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface Profile {
  model?: string;
  thinking?: ThinkingLevel;
}

export interface Config {
  profiles?: Partial<Record<"fast" | "normal", Profile>>;
}

export function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
}

export function readConfig(agentDir = getAgentDir()): Config {
  return readJson<Config>(join(agentDir, "bruv.json"), {});
}
