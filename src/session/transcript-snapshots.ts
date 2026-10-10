import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, lstat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Shared across reconnects; unexpired files are never evicted before queued readers run.
export const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;
export const SNAPSHOT_MAX_BYTES = 16 * 1024 * 1024;
export const SNAPSHOT_MAX_FILES = 64;
export const SNAPSHOT_DIR = join(tmpdir(), `bruv-live-transcript-snapshots-${process.getuid?.() ?? "user"}`);
const LOCK = join(SNAPSHOT_DIR, ".lock");

async function withSnapshotLock<T>(run: () => Promise<T>): Promise<T> {
  await mkdir(SNAPSHOT_DIR, { recursive: true, mode: 0o700 });
  const dir = await lstat(SNAPSHOT_DIR);
  if (!dir.isDirectory() || dir.mode & 0o077 || (process.getuid && dir.uid !== process.getuid()))
    throw new Error("Unsafe transcript snapshot directory");
  let acquired = false;
  for (let i = 0; i < 200; i++) {
    try {
      await mkdir(LOCK, { mode: 0o700 });
      acquired = true;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // A crashed process may leave the lock behind. Normal writes are bounded
      // to 16 MiB; an abandoned lock older than ten minutes is recoverable.
      try {
        if (Date.now() - (await lstat(LOCK)).mtimeMs > 10 * 60 * 1000) await rm(LOCK, { recursive: true, force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  if (!acquired) throw new Error("Transcript snapshot store busy");
  try {
    return await run();
  } finally {
    await rm(LOCK, { recursive: true, force: true });
  }
}

// Both operations run under the store lock: expiry determines the admission
// budget, while renewal keeps existing content alive without rewriting it.
async function reclaimExpiredSnapshots(now: number): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  for (const file of await readdir(SNAPSHOT_DIR)) {
    if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
    const path = join(SNAPSHOT_DIR, file);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Unsafe transcript snapshot file");
    if (now - info.mtimeMs >= SNAPSHOT_TTL_MS) {
      await rm(path);
    } else {
      bytes += info.size;
      files++;
    }
  }
  return { bytes, files };
}

async function renewSnapshot(path: string, hash: string, now: number): Promise<boolean> {
  try {
    const existing = await readFile(path);
    if (createHash("sha256").update(existing).digest("hex") !== hash) throw new Error("Transcript snapshot corrupted");
    await utimes(path, new Date(now), new Date(now));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return false;
  }
}

export async function retainTranscriptSnapshot(content: string): Promise<string> {
  const bytes = Buffer.byteLength(content);
  if (bytes > SNAPSHOT_MAX_BYTES) throw new Error("Transcript snapshot over 16 MiB. Handoff not queued.");
  const hash = createHash("sha256").update(content).digest("hex");
  const path = join(SNAPSHOT_DIR, `${hash}.json`);
  return withSnapshotLock(async () => {
    const now = Date.now();
    const retained = await reclaimExpiredSnapshots(now);
    // Reuse is allowed even at capacity: another handoff adds no stored content.
    if (await renewSnapshot(path, hash, now)) return path;
    if (retained.files >= SNAPSHOT_MAX_FILES || retained.bytes + bytes > SNAPSHOT_MAX_BYTES)
      throw new Error("Transcript snapshot budget used up. Handoff not queued.");
    try {
      await writeFile(path, content, { flag: "wx", mode: 0o600 });
    } catch (error) {
      // Remove a partial write, never a file that failed exclusive creation.
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") await rm(path, { force: true });
      throw error;
    }
    return path;
  });
}
