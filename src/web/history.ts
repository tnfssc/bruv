import { existsSync } from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { lineAt, parentOf, readBack } from "./archive";
import { customLine, lines, type Message, page, pictures, toLine } from "./lines";
import type { Line } from "./protocol";

/** Lines of earlier sessions have ids `a<n>.<offset>`: the nth parent session, and where the line starts. */
const archived = /^a(\d+)\.(\d+)$/;

type Picture = { mimeType: string; data: string };

/**
 * The conversation as pages read it back: a page of lines at a time, going on into earlier sessions, and
 * the pictures in them. Lines a page saw live have ids made before Pi saved them; each is linked to its
 * saved entry so scrolling back from it, or a picture in it, still works.
 */
export function conversationHistory(options: {
  session: () => ExtensionContext["sessionManager"] | undefined;
  /** The link a picture is served at. */
  link: (id: string, index: number) => string;
}) {
  const { session, link } = options;
  /**
   * Pictures of lines sent before Pi saves their message (it saves after extensions hear `message_end`).
   * Only the last few; older ones are read back from the session by entry id.
   */
  const recent = new Map<string, Picture[]>();
  /** Live ids to saved entries. Only the newest few thousand are kept, which covers what a page holds. */
  const aliases = new Map<string, string>();
  const entryOf = (id: string) => aliases.get(id) ?? id;
  /** Earlier session files, the parent first, found as the page scrolls back into them. */
  let chain: string[] = [];

  const archive = (index: number) => {
    while (chain.length <= index) {
      const parent = chain.length ? parentOf(chain[chain.length - 1] as string) : session()?.getHeader()?.parentSession;
      if (!parent || !existsSync(parent)) return undefined;
      chain.push(parent);
    }
    return chain[index];
  };

  const alias = (id: string, entry: string | null | undefined) => {
    if (!entry || id === entry) return;
    aliases.set(id, entry);
    for (const old of aliases.keys()) if (aliases.size > 4000) aliases.delete(old);
  };

  const picture = (content: Message["content"], index: number): Picture | undefined => {
    const block = pictures(content)[index];
    return block?.data ? { mimeType: block.mimeType ?? "image/png", data: block.data } : undefined;
  };

  return {
    /** A page of lines before `asked` (or the newest), going on into earlier sessions when this one runs out. */
    page(asked?: string): { lines: Line[]; more: boolean } {
      const before = asked === undefined ? undefined : entryOf(asked);
      const found: Line[] = [];
      let index = 0;
      let end: number | undefined;
      const old = before === undefined ? null : archived.exec(before);
      if (old) {
        index = Number(old[1]);
        end = Number(old[2]);
      } else {
        const manager = session();
        if (!manager) return { lines: [], more: false };
        const current = lines(manager, link, before);
        if (current.more) return current;
        found.push(...current.lines);
      }
      while (found.length < page) {
        const file = archive(index);
        if (!file) return { lines: found, more: false };
        const n = index;
        const back = readBack(file, end, page - found.length, (entry, offset) => {
          const id = `a${n}.${offset}`;
          if (entry.type === "custom")
            return customLine(
              entry as { customType?: string; data?: unknown },
              id,
              Date.parse(String(entry.timestamp)),
            );
          if (entry.type !== "message") return undefined;
          return toLine(entry.message as Message, id, (each) => link(id, each), Date.parse(String(entry.timestamp)));
        });
        found.unshift(...back.found);
        if (!back.done) return { lines: found, more: true };
        index++;
        end = undefined;
      }
      return { lines: found, more: archive(index) !== undefined };
    },

    /** Picture `index` of line `asked`, from memory for the newest, else from the session it is saved in. */
    image(asked: string, index: number) {
      const found = recent.get(asked);
      if (found) return found[index];
      const id = entryOf(asked);
      const old = archived.exec(id);
      if (old) {
        const file = archive(Number(old[1]));
        const text = file && lineAt(file, Number(old[2]));
        return text ? picture((JSON.parse(text).message as Message | undefined)?.content, index) : undefined;
      }
      const entry = session()?.getEntry(id);
      return entry?.type === "message" ? picture((entry.message as Message).content, index) : undefined;
    },

    /** Keeps the pictures of a line just sent, until Pi has saved them. */
    remember(id: string, message: Message) {
      recent.set(
        id,
        pictures(message.content).map((block) => ({ mimeType: block.mimeType ?? "image/png", data: block.data ?? "" })),
      );
      for (const old of recent.keys()) if (recent.size > 8) recent.delete(old);
    },

    /** Links a live id to the entry just saved (the session's leaf), as for a shown file. */
    savedAs(id: string) {
      alias(id, session()?.getLeafId());
    },

    /** After Pi saves a message (just after `message_end`), links its line id to the saved entry. */
    whenSaved(message: { role: string; timestamp?: number }, id: string) {
      setTimeout(() => {
        const manager = session();
        // More may have been saved since (a fast reply), so look back a few entries for this one.
        let at = manager?.getLeafId() ?? null;
        for (let step = 0; manager && at !== null && step < 20; step++) {
          const entry = manager.getEntry(at);
          if (!entry) return;
          const saved = entry.type === "message" ? (entry.message as { role: string; timestamp?: number }) : undefined;
          if (saved && saved.role === message.role && saved.timestamp === message.timestamp) return alias(id, at);
          at = entry.parentId;
        }
      }, 0);
    },

    /** A new session: its parents are found again. */
    reset() {
      chain = [];
    },
  };
}
