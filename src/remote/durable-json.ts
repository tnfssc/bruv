import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, openSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Replace a private JSON record only after its file bytes are durable, then sync the directory. */
export function durableJsonReplace(path: string, value: unknown): void {
  const tmp = `${path}.${randomUUID()}`;
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
  const directory = openSync(dirname(path), "r");
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}
