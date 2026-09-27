import { mkdirSync, openSync, closeSync, writeFileSync, renameSync, fsyncSync } from "node:fs";
import { join, dirname } from "node:path";
import type { SessionHost } from "../session/host";
/** Snapshot scoped native job output before the owning CLI exits and releases its in-memory buffers. */
export async function captureNativeJobText(
  host: Pick<SessionHost, "inspect">,
  runtimePath: string,
  jobs: Array<{ id?: string; status: string }>,
): Promise<string | undefined> {
  let gap: string | undefined;
  for (const job of jobs) {
    if (
      !job.id ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(job.id) ||
      !["completed", "failed", "cancelled", "stopped", "killed"].includes(job.status)
    )
      continue;
    const chunks: string[] = [];
    let offset = 0,
      bytes = 0;
    try {
      for (let page = 0; page < 2200; page++) {
        const value = (await host.inspect(job.id, offset)) as {
          output?: string;
          nextOffset?: number;
          hasMore?: boolean;
          outputLost?: boolean;
          baseOffset?: number;
        };
        if (value.outputLost || (value.baseOffset ?? 0) > offset) gap = "Native job output retention gap: " + job.id;
        const text = typeof value.output === "string" ? value.output : "";
        bytes += Buffer.byteLength(text);
        if (bytes > 10 * 1024 * 1024) throw Error("Native job output exceeds 10 MiB artifact limit");
        chunks.push(text);
        if (!value.hasMore) break;
        if (typeof value.nextOffset !== "number" || value.nextOffset <= offset || page === 2199)
          throw Error("Native job output pagination gap");
        offset = value.nextOffset;
      }
    } catch (error) {
      gap = "Native job text capture incomplete for " + job.id + ": " + String(error);
      chunks.push("\n[" + gap + "]\n");
    }
    const dir = join(dirname(runtimePath), "session.jsonl.artifacts", "execute-job-" + job.id);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, "stdout.log"),
      temp = path + "." + process.pid;
    const fd = openSync(temp, "w", 0o600);
    try {
      writeFileSync(fd, chunks.join(""));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
  }
  return gap;
}
