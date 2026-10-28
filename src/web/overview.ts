import type { Project, Thread } from "./protocol";

/** How many threads each group lists; the rest are counted. */
const listed = 15;
/** Finished or failed threads older than this are history, not news. */
const recent = 3 * 24 * 60 * 60 * 1000;

const working = new Set(["preparing", "queued", "starting", "running", "waiting"]);

const age = (iso: string | undefined, now: number) => {
  if (!iso) return "";
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
};

/**
 * What is going on across all of the user's T3 work, from the live feed bruv already holds, so answering
 * "what's running?" costs no call to T3 and a few hundred bytes of context. Top-level threads only.
 */
export function overview(threads: Thread[], projects: Project[], options: { project?: string; now?: number } = {}) {
  const now = options.now ?? Date.now();
  const names = new Map(projects.map((project) => [project.id, project.title]));
  const wanted = options.project?.toLowerCase();
  const shown = threads.filter(
    (thread) =>
      !thread.parentId &&
      !thread.away &&
      (!wanted || thread.projectId === options.project || names.get(thread.projectId)?.toLowerCase() === wanted),
  );
  const line = (thread: Thread, when?: string) =>
    [
      `- ${thread.title} (${names.get(thread.projectId) ?? "no project"}, ${thread.status}${when ? `, ${when}` : ""})`,
      thread.requestKind ? ` asks: ${thread.requestKind}` : "",
      thread.lastError ? ` error: ${thread.lastError.split("\n")[0].slice(0, 200)}` : "",
      ` id ${thread.id}`,
    ].join("");
  const group = (title: string, items: Thread[], when: (thread: Thread) => string | undefined) => {
    if (!items.length) return "";
    const more = items.length > listed ? `\n- and ${items.length - listed} more` : "";
    return `${title} (${items.length}):\n${items
      .slice(0, listed)
      .map((thread) => line(thread, when(thread)))
      .join("\n")}${more}`;
  };
  const newest = (a: Thread, b: Thread) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  const fresh = (thread: Thread) => now - Date.parse(thread.finishedAt ?? thread.updatedAt) < recent;
  const needs = shown.filter((thread) => thread.needsUser).sort(newest);
  const busy = shown.filter((thread) => !thread.needsUser && working.has(thread.status)).sort(newest);
  const failed = shown
    .filter((thread) => !thread.needsUser && thread.status === "failed" && fresh(thread))
    .sort(newest);
  const unseen = shown
    .filter(
      (thread) =>
        thread.status === "completed" &&
        !thread.needsUser &&
        thread.finishedAt &&
        (!thread.visitedAt || thread.visitedAt < thread.finishedAt) &&
        fresh(thread),
    )
    .sort(newest);
  const text = [
    group("Waiting on the user", needs, (thread) => age(thread.updatedAt, now)),
    group("Working", busy, (thread) => `started ${age(thread.createdAt, now)}`),
    group("Failed", failed, (thread) => age(thread.updatedAt, now)),
    group("Finished, not yet opened by the user", unseen, (thread) => age(thread.finishedAt, now)),
  ]
    .filter(Boolean)
    .join("\n\n");
  return text || "Nothing is waiting, working, failed or newly finished.";
}
