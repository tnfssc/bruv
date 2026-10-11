import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

interface Profile {
  model?: string;
  thinking?: ThinkingLevel;
}

export interface Config {
  checkWork?: boolean;
  keepGoing?: "auto" | "on" | "off";
  codexImportOffered?: boolean;
  migrateOffered?: boolean;
  /** Projects already told about moving wisdom/ to .agents/notes. */
  notesMoveOffered?: string[];
  /** Message to show once the reload after /bruv-migrate finishes. */
  migrated?: { message: string; model: boolean };
  fast?: boolean;
  fastConfirmed?: boolean;
  profiles?: Partial<Record<"fast" | "normal", Profile>>;
  /** Models agents may use, as provider/id. Unset: the main model plus the profile models. */
  agentModels?: string[];
  /** Minutes the provider keeps the prompt cache, for the footer countdown. Default 60. */
  cacheTtlMinutes?: number;
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
