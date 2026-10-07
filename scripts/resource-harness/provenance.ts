import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** A missing Git executable must not discard completed resource measurements. */
export function sourceProvenance() {
  const cwd = dirname(fileURLToPath(import.meta.url));
  try {
    return {
      revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim(),
      dirty: !!execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" }).trim(),
    };
  } catch (error) {
    return { revision: null, dirty: null, provenanceError: String(error).slice(0, 2048) };
  }
}
