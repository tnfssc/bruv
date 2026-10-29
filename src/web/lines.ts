import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { Line, Shown } from "./protocol";

/**
 * Wake-ups reach the model as user messages that start with this, since a custom message that starts a run
 * skips bruv's prompt sections. The page shows them as the assistant's own check-ins, not as the user.
 */
export const wakeMark = "[wake-up] ";

/** How many lines a page gets at a time: on connecting, and each time it scrolls back for more. */
export const page = 50;

type Block = { type: string; text?: string; data?: string; mimeType?: string };
export type Message = {
  role: string;
  content?: string | Block[];
  customType?: string;
  display?: boolean;
  timestamp?: number;
};

const text = (content: Message["content"]) =>
  typeof content === "string"
    ? content
    : (content ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("\n\n");

/** The pictures in a message, in order. */
export const pictures = (content: Message["content"]) =>
  typeof content === "string" ? [] : (content ?? []).filter((block) => block.type === "image" && block.data);

/** The tool that shows the user a file. */
export const showTool = "show";
/**
 * The session entry a shown file is saved in, as its own line. Not the tool's result: the model often calls
 * `show` from a script, and then the result is the script's.
 */
export const showEntry = "bruv-web-show";

/** The session entry for a thread the assistant started: a live card for it in the conversation. */
export const threadEntry = "bruv-web-thread";

/** The line a saved custom entry shows as (a shown file, a started thread), or nothing. */
export function customLine(entry: { customType?: string; data?: unknown }, id: string, at: number): Line | undefined {
  if (entry.customType === showEntry) return shownLine(entry.data, id, at);
  const thread = (entry.data as { id?: unknown } | undefined)?.id;
  if (entry.customType === threadEntry && typeof thread === "string")
    return { id, role: "assistant", text: "", thread, at: new Date(at).toISOString() };
  return undefined;
}

/** The line for a saved shown file, or nothing when it isn't one. */
export function shownLine(data: unknown, id: string, at: number): Line | undefined {
  const file = data as Shown | undefined;
  if (!file || typeof file.url !== "string" || !file.url.startsWith("/file/")) return undefined;
  return { id, role: "assistant", text: "", files: [file], at: new Date(at).toISOString() };
}

/**
 * What the page shows for a message, or nothing for tool results, thinking and hidden notes. Pictures
 * become links (`link(index)`), so the line stays small however big they are.
 */
export function toLine(
  message: Message,
  id: string,
  link: (index: number) => string,
  at = message.timestamp ?? Date.now(),
): Line | undefined {
  const time = new Date(at).toISOString();
  if (message.role === "user") {
    const words = text(message.content);
    if (words.startsWith(wakeMark)) return { id, role: "wake", text: words.slice(wakeMark.length).trim(), at: time };
    const count = pictures(message.content).length;
    const images = Array.from({ length: count }, (_, index) => link(index));
    return { id, role: "user", text: words, at: time, ...(count ? { images } : {}) };
  }
  if (message.role === "assistant") {
    const words = text(message.content).trim();
    return words ? { id, role: "assistant", text: words, at: time } : undefined;
  }
  if (message.role === "custom" && message.display) {
    const words = text(message.content).trim();
    return words ? { id, role: "note", text: words, at: time } : undefined;
  }
  return undefined;
}

type Entries = {
  getLeafId(): string | null;
  getEntry(id: string): SessionEntry | undefined;
};

/**
 * Up to `page` lines before the entry `before` (or the newest ones), oldest first, and whether there are
 * more. It walks back from there through the session's branch one entry at a time, so the cost is the
 * lines asked for, not the length of the session.
 */
export function lines(entries: Entries, link: (id: string, index: number) => string, before?: string) {
  const found: Line[] = [];
  let id = before === undefined ? entries.getLeafId() : (entries.getEntry(before)?.parentId ?? null);
  while (id !== null) {
    const entry = entries.getEntry(id);
    if (!entry) break;
    id = entry.parentId;
    const line =
      entry.type === "custom"
        ? customLine(entry, entry.id, Date.parse(entry.timestamp))
        : entry.type !== "message"
          ? undefined
          : toLine(entry.message as Message, entry.id, (index) => link(entry.id, index), Date.parse(entry.timestamp));
    if (!line) continue;
    if (found.length === page) return { lines: found.reverse(), more: true };
    found.push(line);
  }
  return { lines: found.reverse(), more: false };
}

/** A data URL from the page as Pi's image block, or nothing when it isn't a picture. */
export function toImage(url: string) {
  const match = /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(url);
  return match ? { type: "image" as const, mimeType: match[1], data: match[2] } : undefined;
}
