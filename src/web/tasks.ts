import { type FSWatcher, mkdirSync, readdirSync, readFileSync, statSync, watch } from "node:fs";
import { join } from "node:path";
import type { Task } from "./protocol";

/**
 * Reads a task file: a front matter of `key: value` lines between `---` lines, then free text. `threads`
 * may be a `[a, b]` list or `- a` lines. Only what the page and wake-ups need is read; the rest is the
 * assistant's own notes.
 */
export function parseTask(slug: string, text: string, updatedAt: string): Task {
  const fields = new Map<string, string>();
  const threads: string[] = [];
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  let key = "";
  for (const raw of (match?.[1] ?? "").split(/\r?\n/)) {
    const item = /^\s*-\s+(.+)$/.exec(raw);
    if (item && key === "threads") {
      threads.push(clean(item[1]));
      continue;
    }
    const pair = /^([A-Za-z_]+):\s*(.*)$/.exec(raw);
    if (!pair) continue;
    key = pair[1].toLowerCase();
    if (key === "threads") {
      const list = /^\[(.*)\]$/.exec(pair[2].trim());
      if (list) threads.push(...list[1].split(",").map(clean).filter(Boolean));
      else if (pair[2].trim()) threads.push(clean(pair[2]));
    } else fields.set(key, clean(pair[2]));
  }
  const body = match ? text.slice(match[0].length) : text;
  const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  return {
    slug,
    title: fields.get("title") || heading || slug.replace(/[-_]+/g, " "),
    status: (fields.get("status") || "working").toLowerCase(),
    ...(fields.get("next") ? { next: fields.get("next") } : {}),
    threads,
    updatedAt,
  };
}

/** A value without its quotes; words that mean "nothing" (None, n/a, a dash) count as empty. */
const clean = (value: string) => {
  const text = value.trim().replace(/^["']|["']$/g, "");
  return /^(none|null|n\/a|-+|—)$/i.test(text) ? "" : text;
};

/** Tasks that aren't finished: what wake-ups and the regular look care about. */
export const open = (task: Task) => task.status !== "done";

/**
 * The tasks in `<workspace>/tasks`, kept current. Each file is read once at start and again only when it
 * changes, so a quiet workspace costs nothing.
 */
export function watchTasks(folder: string, changed: (tasks: Task[]) => void) {
  const dir = join(folder, "tasks");
  mkdirSync(dir, { recursive: true });
  const tasks = new Map<string, Task>();
  const read = (name: string) => {
    const slug = name.replace(/\.md$/, "");
    try {
      const file = join(dir, name);
      tasks.set(slug, parseTask(slug, readFileSync(file, "utf8"), statSync(file).mtime.toISOString()));
    } catch {
      // Gone, or caught mid-save: the next event reads it again.
      tasks.delete(slug);
    }
  };
  for (const name of readdirSync(dir)) if (name.endsWith(".md")) read(name);
  const due = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watcher: FSWatcher | undefined;
  try {
    // Editors save in bursts; the last write counts.
    watcher = watch(dir, (_event, name) => {
      if (!name?.endsWith(".md")) return;
      due.add(name);
      clearTimeout(timer);
      timer = setTimeout(() => {
        for (const each of due) read(each);
        due.clear();
        changed(list());
      }, 100);
    });
  } catch {}
  const list = () => [...tasks.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return {
    list,
    close: () => {
      clearTimeout(timer);
      watcher?.close();
    },
  };
}
