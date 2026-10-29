import { going, type Thread } from "../../../src/web/protocol";

export type Group = "needs" | "working" | "done" | "recent";

/** Recent threads older than this sit behind a "show older" fold. */
export const recentFor = 72 * 60 * 60 * 1000;

export function groupOf(thread: Thread): Group {
  if (thread.needsUser || thread.status === "failed") return "needs";
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
  needs: Thread[];
  working: Thread[];
  done: Thread[];
  recent: Thread[];
  /** Recent threads past `recentFor`. */
  older: Thread[];
};

/** Sorts threads into what the panel shows. Threads put away in T3 aren't shown at all. */
export function activity(threads: Iterable<Thread>, now: number): Activity {
  const out: Activity = { needs: [], working: [], done: [], recent: [], older: [] };
  for (const thread of threads) {
    if (thread.away) continue;
    const group = groupOf(thread);
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
