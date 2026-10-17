import { chmodSync, existsSync, mkdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readStoredCredential } from "@earendil-works/pi-coding-agent";

/**
 * The Cloudflare key lives in Pi's auth.json with the other keys, under its own name, so /logout lists it
 * and can remove it.
 */
export const keyName = "cloudflare-tunnel";

export function readKey(agentDir: string) {
  const credential = readStoredCredential(keyName, join(agentDir, "auth.json"));
  return credential?.type === "api_key" ? credential.key : undefined;
}

/** Saves the key. Takes the same lock as Pi (a `.lock` folder), so a sign-in being saved is not lost. */
export async function saveKey(key: string, agentDir: string) {
  const file = join(agentDir, "auth.json");
  const lock = `${file}.lock`;
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  for (let tries = 0; ; tries++) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Pi treats a lock older than 10 seconds as left behind by a crash.
      const age = existsSync(lock) ? Date.now() - statSync(lock).mtimeMs : 0;
      if (age > 10_000 || tries > 100) rmSync(lock, { recursive: true, force: true });
      else await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    const current = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8") || "{}") as Record<string, unknown>) : {};
    writeFileSync(file, `${JSON.stringify({ ...current, [keyName]: { type: "api_key", key } }, null, 2)}\n`, {
      mode: 0o600,
    });
    chmodSync(file, 0o600);
  } finally {
    rmdirSync(lock);
  }
}
