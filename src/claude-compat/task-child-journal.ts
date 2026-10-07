import { open } from "node:fs/promises";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

/** Tail an append-only child journal. In-flight final lines are retried next time. */
export async function* childJournalEntries(
  path: string,
  offset: number,
): AsyncGenerator<{ entry?: SessionEntry; endOffset: number }> {
  const file = await open(path, "r");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let position = offset;
  let pieces: Buffer[] = [];
  let length = 0;
  try {
    if ((await file.stat()).size < offset) throw new Error("Child journal was truncated after delivery");
    for (;;) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
      if (!bytesRead) return;
      let start = 0;
      for (;;) {
        const newline = buffer.indexOf(10, start);
        if (newline < 0 || newline >= bytesRead) break;
        const fragment = buffer.subarray(start, newline);
        const line = pieces.length ? Buffer.concat([...pieces, fragment], length + fragment.length) : fragment;
        const endOffset = position + newline + 1;
        const text = line.toString("utf8");
        let entry: SessionEntry | undefined;
        try {
          entry = text.trim() ? (JSON.parse(text) as SessionEntry) || undefined : undefined;
        } catch {
          // Match SDK loading: skip malformed complete rows, never rewrite them.
          // The offset still advances; an incomplete final row is retried below.
        }
        yield { entry, endOffset };
        pieces = [];
        length = 0;
        start = newline + 1;
      }
      if (start < bytesRead) {
        const fragment = Buffer.from(buffer.subarray(start, bytesRead));
        pieces.push(fragment);
        length += fragment.length;
      }
      position += bytesRead;
    }
  } finally {
    await file.close();
  }
}
