import { closeSync, fstatSync, openSync, readSync } from "node:fs";

/**
 * Earlier sessions of the web version. When the session file grows big, the assistant moves to a fresh
 * session that names the old one as its parent; the page can still scroll back into it. These files are
 * read backwards from a byte offset, a chunk at a time, so paging back costs the lines asked for, not the
 * size of the file, and nothing of them stays in memory.
 */

const chunk = 64 * 1024;

/** The session file a session file continues, from its header (the first line). */
export function parentOf(file: string): string | undefined {
  try {
    const line = lineAt(file, 0);
    const header = line ? JSON.parse(line) : undefined;
    return header?.type === "session" && typeof header.parentSession === "string" ? header.parentSession : undefined;
  } catch {
    return undefined;
  }
}

/** The JSON line that starts at `offset`, read up to its newline. */
export function lineAt(file: string, offset: number): string | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const parts: Buffer[] = [];
    let position = offset;
    for (;;) {
      const buffer = Buffer.alloc(chunk);
      const read = readSync(fd, buffer, 0, chunk, position);
      if (read === 0) break;
      const end = buffer.subarray(0, read).indexOf(10);
      if (end >= 0) {
        parts.push(buffer.subarray(0, end));
        break;
      }
      parts.push(buffer.subarray(0, read));
      position += read;
    }
    return Buffer.concat(parts).toString("utf8");
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Up to `want` entries that `pick` keeps, ending before byte `end` (the file's end when not given), oldest
 * first, each with the byte offset its line starts at. `done` is true when the file's start was reached.
 */
export function readBack<T>(
  file: string,
  end: number | undefined,
  want: number,
  pick: (entry: Record<string, unknown>, offset: number) => T | undefined,
): { found: T[]; done: boolean } {
  const found: T[] = [];
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    let position = Math.min(end ?? Number.POSITIVE_INFINITY, fstatSync(fd).size);
    // Bytes of a line cut by the chunk boundary, kept until the rest of it is read.
    let tail = Buffer.alloc(0);
    while (position > 0 && found.length < want) {
      const size = Math.min(chunk, position);
      position -= size;
      const buffer = Buffer.alloc(size);
      readSync(fd, buffer, 0, size, position);
      let data = Buffer.concat([buffer, tail]);
      // Walk the complete lines from the last one back. The first line in `data` may be cut, unless this
      // chunk starts the file.
      let stop = data.length;
      for (let index = data.lastIndexOf(10, stop - 1); ; index = data.lastIndexOf(10, stop - 1)) {
        if (index < 0 && position > 0) break;
        const start = index + 1;
        const text = data.subarray(start, stop).toString("utf8").trim();
        stop = Math.max(index, 0);
        if (text) {
          try {
            const kept = pick(JSON.parse(text), position + start);
            if (kept !== undefined) found.push(kept);
          } catch {}
          if (found.length === want) return { found: found.reverse(), done: false };
        }
        if (index < 0) break;
      }
      data = data.subarray(0, stop);
      tail = Buffer.from(data);
    }
    return { found: found.reverse(), done: position === 0 };
  } catch {
    return { found: found.reverse(), done: true };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
