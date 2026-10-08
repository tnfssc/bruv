import { open } from "node:fs/promises";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

import type { NativeHistory } from "./history";
import { nativeAssistantCost } from "./message-usage";
import type { ChildEntrySource } from "./task-binding";
import { type ChildFrame, nativeTaskId } from "./task-projection";

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

/** The same durable writer used before runtime child frames are exposed. */
export async function writeNativeChildFrame(
  history: NativeHistory | undefined,
  { link, entry }: ChildEntrySource,
  frame: ChildFrame,
): Promise<boolean | undefined> {
  if (!history || frame.type === "stream_event") return;
  const child = await history.child({
    taskId: nativeTaskId(link),
    sourceSessionId: link.child.sourceSessionId,
    sourceCallId: link.launchToolUseId,
  });
  const written = await child.appendWithResult({
    sourceMessageId: entry.id,
    type: frame.type,
    message: frame.message,
    ...(entry.message.role === "assistant" ? nativeAssistantCost(entry.message) : {}),
    timestamp: entry.timestamp,
    uuid: frame.uuid,
  });
  return written.appended;
}
