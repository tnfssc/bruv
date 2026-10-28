import type { Task, Thread } from "./protocol";
import { open } from "./tasks";

/** What a thread was last seen doing, to tell a change worth waking for from churn. */
type Seen = { status: string; needsUser: boolean };

const working = new Set(["preparing", "queued", "starting", "running", "waiting"]);

/** Events that close together go as one wake-up. */
const gather = 3000;

/**
 * Decides when the assistant wakes up on its own, and with what. It follows only the threads its open tasks
 * name, and wakes when one needs the user, fails or finishes. It also takes a regular look while any task
 * is open. A wake-up waits until the assistant is free and the user isn't talking, then goes as one message.
 */
export class Waker {
  private seen = new Map<string, Seen>();
  private followed = new Map<string, string>();
  private pending: string[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private look: ReturnType<typeof setInterval> | undefined;
  private lastWake = 0;
  private openTasks = 0;

  constructor(
    private options: {
      /** Sends the wake-up; called only when `free()` says so. */
      wake: (text: string) => void;
      /** Whether the assistant is idle and nobody is talking. */
      free: () => boolean;
      /** Minutes between regular looks while a task is open; 0 turns them off. */
      everyMinutes: number;
      /** How long to gather events into one wake-up; for tests. */
      gather?: number;
      /** A thread as T3 shows it now, to start following it from where it is. */
      lookup?: (id: string) => Thread | undefined;
      now?: () => number;
    },
  ) {
    if (options.everyMinutes > 0) {
      this.look = setInterval(() => this.regular(), options.everyMinutes * 60_000);
      this.look.unref?.();
    }
  }

  /** The tasks changed: follow the threads of the open ones. */
  tasks(tasks: Task[]) {
    this.followed.clear();
    const live = tasks.filter(open);
    this.openTasks = live.length;
    for (const task of live) for (const id of task.threads) this.followed.set(id, task.title);
    for (const id of this.seen.keys()) if (!this.followed.has(id)) this.seen.delete(id);
    // A thread starts being followed from where it is now, so its next change is news even when T3 sends
    // nothing in between.
    for (const id of this.followed.keys()) {
      if (this.seen.has(id)) continue;
      const thread = this.options.lookup?.(id);
      if (thread) this.seen.set(id, { status: thread.status, needsUser: thread.needsUser });
    }
  }

  /** Threads changed; the followed ones may be news. */
  threads(threads: Thread[]) {
    for (const thread of threads) {
      const task = this.followed.get(thread.id);
      if (!task) continue;
      const before = this.seen.get(thread.id);
      const now = { status: thread.status, needsUser: thread.needsUser };
      this.seen.set(thread.id, now);
      // The first sighting only sets the baseline.
      if (!before) continue;
      // The task's name is enough when the thread is named the same.
      const name = thread.title.trim() === task.trim() ? `"${task}"` : `"${thread.title}" (${task})`;
      if (now.needsUser && !before.needsUser) this.add(`${name} is waiting on the user.`);
      else if (now.status === "failed" && before.status !== "failed")
        this.add(`${name} failed${thread.lastError ? `: ${thread.lastError.split("\n")[0].slice(0, 200)}` : "."}`);
      else if (now.status === "completed" && working.has(before.status)) this.add(`${name} finished.`);
    }
  }

  /** The assistant became free (or the user stopped talking): deliver what waited. */
  free() {
    if (!this.pending.length) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 0);
  }

  close() {
    clearTimeout(this.timer);
    clearInterval(this.look);
  }

  private add(line: string) {
    if (!this.pending.includes(line)) this.pending.push(line);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.options.gather ?? gather);
  }

  private flush() {
    this.timer = undefined;
    if (!this.pending.length) return;
    // Busy or someone is talking: try again shortly, and at once when the run settles (`free`).
    if (!this.options.free()) {
      this.timer = setTimeout(() => this.flush(), 5000);
      return;
    }
    const lines = this.pending.splice(0);
    this.lastWake = this.now();
    this.options.wake(lines.join("\n"));
  }

  private regular() {
    const minutes = this.options.everyMinutes;
    // A wake-up for news already counts as a look.
    if (!this.openTasks || this.now() - this.lastWake < minutes * 60_000 * 0.9) return;
    this.add(`Regular look: ${this.openTasks} open task${this.openTasks === 1 ? "" : "s"}.`);
  }

  private now() {
    return this.options.now?.() ?? Date.now();
  }
}
