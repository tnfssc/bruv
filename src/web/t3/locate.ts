import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Where T3 runs and how to get a one-time pairing token from it. No scopes means T3's standard set. */
export type T3Place = { origin: string; pair: (scopes: string[], label: string) => Promise<string> };

const readJson = (path: string) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
};

const alive = (pid: unknown) => {
  if (typeof pid !== "number") return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Reads T3's own files under ~/.t3 (or T3CODE_HOME). Undefined when T3 is not installed or not running. */
export function locateT3(home = process.env.T3CODE_HOME || join(homedir(), ".t3")): T3Place | undefined {
  const server = readJson(join(home, "userdata", "server-runtime.json"));
  const service = readJson(join(home, "runtime", "service-state.json"));
  if (typeof server?.origin !== "string" || typeof service?.activeVersion !== "string" || !alive(server.pid))
    return undefined;
  const bin = join(home, "runtime", "versions", service.activeVersion, "t3");
  return {
    origin: server.origin,
    pair: (scopes, label) =>
      new Promise((resolve, reject) => {
        const args = ["pair", ...scopes.flatMap((scope) => ["--scope", scope]), "--ttl", "5m", "--label", label];
        execFile(bin, args, { timeout: 30_000 }, (error, stdout) => {
          const token = /^Token:\s*(\S+)/m.exec(stdout)?.[1];
          if (token) resolve(token);
          else reject(error ?? new Error("t3 pair printed no token"));
        });
      }),
  };
}
