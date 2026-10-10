import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

interface Profile {
  model?: string;
  thinking?: ThinkingLevel;
}

export interface Config {
  keepGoing?: "auto" | "on" | "off";
  codexImportOffered?: boolean;
  fast?: boolean;
  fastConfirmed?: boolean;
  profiles?: Partial<Record<"fast" | "normal", Profile>>;
}

export function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
}

export function readConfig(agentDir = getAgentDir()): Config {
  return readJson<Config>(join(agentDir, "bruv.json"), {});
}

export function saveConfig(changes: Partial<Config>, agentDir = getAgentDir()): void {
  const config = { ...readConfig(agentDir), ...changes };
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, "bruv.json"), `${JSON.stringify(config, null, 2)}\n`);
}
