import { going, type Thread } from "../../../src/web/protocol";

export type Group = "needs" | "working" | "done" | "recent";

/** Recent threads older than this sit behind a "show older" fold. */
export const recentFor = 72 * 60 * 60 * 1000;

export function groupOf(thread: Thread, kids: Thread[] = []): Group {
  // A subagent waiting on the user holds up its parent, so the parent shows as needing the user.
  if (thread.needsUser || thread.status === "failed" || kids.some((kid) => kid.needsUser)) return "needs";
  // Ended its turn but watches a pull request or waits on subagents: it comes back on its own.
  if (going.has(thread.status) || thread.holding) return "working";
  if (
    thread.status === "completed" &&
    thread.finishedAt &&
    (!thread.visitedAt || Date.parse(thread.finishedAt) > Date.parse(thread.visitedAt))
  )
    return "done";
  return "recent";
}

/** Newest first. T3's times are ISO strings in UTC, which sort as text. */
const newest = (key: (thread: Thread) => string | undefined) => (a: Thread, b: Thread) => {
  const x = key(a) ?? a.updatedAt;
  const y = key(b) ?? b.updatedAt;
  return x < y ? 1 : x > y ? -1 : 0;
};

export type Activity = {
  /** Each thread's subagents and delegated tasks, which show under it rather than on their own. */
  kids: ReadonlyMap<string, Thread[]>;
  needs: Thread[];
  working: Thread[];
  done: Thread[];
  recent: Thread[];
  /** Recent threads past `recentFor`. */
  older: Thread[];
};

/**
 * Sorts the assistant's threads into what the panel shows: top-level ones in groups, subagents under their
 * parents. Threads put away in T3 aren't shown at all.
 */
export function activity(threads: Iterable<Thread>, now: number): Activity {
  const byId = new Map<string, Thread>();
  for (const thread of threads) byId.set(thread.id, thread);
  // Every subagent goes under the top-level thread it descends from, however deep, so one row shows all
  // that thread's work and anything in it that waits on the user.
  const kids = new Map<string, Thread[]>();
  const top: Thread[] = [];
  for (const thread of byId.values()) {
    if (!thread.parentId) {
      top.push(thread);
      continue;
    }
    let root = thread;
    for (let depth = 0; root.parentId && depth < 8; depth++) {
      const parent = byId.get(root.parentId);
      if (!parent) break;
      root = parent;
    }
    kids.set(root.id, [...(kids.get(root.id) ?? []), thread]);
  }
  const out: Activity = { kids, needs: [], working: [], done: [], recent: [], older: [] };
  for (const thread of top) {
    if (thread.away) continue;
    const group = groupOf(thread, kids.get(thread.id));
    if (group === "recent" && now - Date.parse(thread.updatedAt) > recentFor) out.older.push(thread);
    else out[group].push(thread);
  }
  const updated = newest((thread) => thread.updatedAt);
  out.needs.sort(updated);
  out.working.sort(updated);
  out.done.sort(newest((thread) => thread.finishedAt));
  out.recent.sort(updated);
  out.older.sort(updated);
  return out;
}
