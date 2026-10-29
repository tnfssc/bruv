import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Thread } from "./protocol";

/**
 * The T3 threads this assistant started: the page lists these (and what descends from them) and nothing
 * else. T3 records no more than "created over MCP" on a thread, which every MCP client and T3's own agents
 * share, and threads take no labels, so bruv keeps the list itself. It is kept per workspace folder, so two
 * assistants in two folders each see their own, in a small file outside the workspace, and survives restarts
 * and fresh sessions. Thread ids are unique across T3 environments, so one list serves a T3 elsewhere too.
 */
export type Mine = {
  /** Ids the assistant started, oldest first. */
  ids(): string[];
  /** Adds a thread the assistant just started. Answers whether it was new. */
  add(id: string): boolean;
  /** Whether a thread is the assistant's, or descends from one (a subagent, a fork, a delegated task). */
  has(thread: Thread, lookup: (id: string) => Thread | undefined): boolean;
};

/** Older ones drop off; a page shows a few hundred at most. */
const kept = 2000;

export function mine(file: string, workspace: string): Mine {
  let all: Record<string, string[]> = {};
  try {
    all = JSON.parse(readFileSync(file, "utf8"));
  } catch {}
  let ids = Array.isArray(all[workspace]) ? all[workspace] : [];
  let set = new Set(ids);
  return {
    ids: () => [...ids],
    add(id) {
      if (set.has(id)) return false;
      ids = [...ids, id].slice(-kept);
      set = new Set(ids);
      // Read again before writing, so another assistant's list in the same file isn't lost.
      try {
        all = JSON.parse(readFileSync(file, "utf8"));
      } catch {}
      all[workspace] = ids;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(all)}\n`);
      return true;
    },
    has(thread, lookup) {
      let current: Thread | undefined = thread;
      // Up a few levels: a subagent's subagent still belongs to the work.
      for (let depth = 0; current && depth < 6; depth++) {
        if (set.has(current.id)) return true;
        current = current.parentId ? lookup(current.parentId) : undefined;
      }
      return false;
    },
  };
}

/** The id of the thread a `t3_thread_launch` result names, if it is one. */
export function launched(result: unknown): string | undefined {
  const value = result as { structuredContent?: { threadId?: unknown }; content?: { type?: string; text?: string }[] };
  const direct = value?.structuredContent?.threadId;
  if (typeof direct === "string") return direct;
  for (const block of value?.content ?? []) {
    if (block.type !== "text" || !block.text) continue;
    try {
      const parsed = JSON.parse(block.text) as { threadId?: unknown };
      if (typeof parsed.threadId === "string") return parsed.threadId;
    } catch {}
  }
  return undefined;
}
