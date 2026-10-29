import { type Thread, going as working } from "./protocol";

/** What a thread was last seen doing, to tell a change worth waking for from churn. */
type Seen = { status: string; needsUser: boolean; holding?: string };

/** Events that close together go as one wake-up. */
const gather = 3000;
/**
 * What a thread says while it works waits this long for more before it wakes the assistant, so a thread
 * thinking out loud costs one wake-up every few minutes, not one per message. A status change brings it
 * sooner.
 */
const progress = 2 * 60_000;
/** The most of one message passed on, and of the messages kept per thread. */
const longest = 4000;
const kept = 3;

/** A wake-up: one line per event for the page, and what the threads said, for the assistant only. */
export type Wake = { text: string; said?: string };

/**
 * Decides when the assistant wakes up on its own, and with what. It follows the threads the assistant
 * started (and their subagents), and wakes when one needs the user, fails or finishes. It also takes a
 * regular look while any of them is at work. A wake-up waits until the assistant is free and the user isn't
 * talking, then goes as one message.
 */
export class Waker {
  private seen = new Map<string, Seen>();
  private followed = new Set<string>();
  private pending: string[] = [];
  /** What followed threads said since the last wake-up, newest last, by thread. */
  private said = new Map<string, { name: string; texts: string[] }>();
  /** When the waiting wake-up goes: soon for events, later for messages alone. */
  private due = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private look: ReturnType<typeof setInterval> | undefined;
  private lastWake = 0;

  constructor(
    private options: {
      /** Sends the wake-up; called only when `free()` says so. */
      wake: (wake: Wake) => void;
      /** Whether the assistant is idle and nobody is talking. */
      free: () => boolean;
      /** Minutes between regular looks while a followed thread is at work; 0 turns them off. */
      everyMinutes: number;
      /** How long to gather events into one wake-up; for tests. */
      gather?: number;
      /** How long messages alone wait for more; for tests. */
      progress?: number;
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

  /** The threads to follow: the ones the assistant started. */
  follow(ids: Iterable<string>) {
    this.followed = new Set(ids);
    // Subagents of followed threads are kept too.
    for (const id of this.seen.keys()) if (!this.followed.has(id) && !this.isChild(id)) this.seen.delete(id);
    // A thread starts being followed from where it is now, so its next change is news even when T3 sends
    // nothing in between.
    for (const id of this.followed) {
      if (this.seen.has(id)) continue;
      const thread = this.options.lookup?.(id);
      if (thread) this.seen.set(id, { status: thread.status, needsUser: thread.needsUser, holding: thread.holding });
    }
  }

  /** Threads changed; the followed ones (and their subagents) may be news. */
  threads(threads: Thread[]) {
    for (const thread of threads) {
      if (!this.followed.has(thread.id)) {
        this.child(thread);
        continue;
      }
      const before = this.seen.get(thread.id);
      const now = { status: thread.status, needsUser: thread.needsUser, holding: thread.holding };
      this.seen.set(thread.id, now);
      // The first sighting only sets the baseline.
      if (!before) continue;
      const name = this.name(thread.title);
      const ended = now.status === "completed" && (working.has(before.status) || !!before.holding);
      if (now.needsUser && !before.needsUser) this.add(`${name} is waiting on the user.`);
      else if (now.status === "failed" && before.status !== "failed")
        this.add(`${name} failed${thread.lastError ? `: ${thread.lastError.split("\n")[0].slice(0, 200)}` : "."}`);
      // A turn that ended with work left going (a watched pull request, subagents) isn't the end: the thread
      // comes back on its own. What it said then is an update, not a result.
      else if (ended && now.holding) {
        if (now.holding !== before.holding || working.has(before.status))
          this.add(
            `${name} stopped for now, ${now.holding}; it carries on by itself.`,
            this.options.progress ?? progress,
          );
      } else if (ended) this.add(`${name} finished.`);
    }
  }

  /** A subagent (or delegated task) of a followed thread that starts waiting on the user is news too. */
  private child(thread: Thread) {
    let parent = thread.parentId;
    // Up a few levels: a subagent's subagent still belongs to the work.
    for (let depth = 0; parent && depth < 4 && !this.followed.has(parent); depth++)
      parent = this.options.lookup?.(parent)?.parentId;
    if (!parent || !this.followed.has(parent)) return;
    const before = this.seen.get(thread.id);
    this.seen.set(thread.id, { status: thread.status, needsUser: thread.needsUser });
    if (thread.needsUser && !before?.needsUser)
      this.add(
        `A subagent of ${this.name(this.options.lookup?.(parent)?.title ?? parent)}, "${thread.title}" (thread ${thread.id}), is waiting on the user.`,
      );
  }

  /**
   * A followed thread said something (a finished message). It goes with the next wake-up: soon when its
   * status changed too (a thread's last words come with "finished"), else after a while, with what else it
   * said by then.
   */
  message(threadId: string, text: string) {
    if (!this.followed.has(threadId)) return;
    let entry = this.said.get(threadId);
    if (!entry) {
      entry = { name: this.name(this.options.lookup?.(threadId)?.title ?? threadId), texts: [] };
      this.said.set(threadId, entry);
    }
    const trimmed = text.trim();
    entry.texts.push(
      trimmed.length > longest ? `${trimmed.slice(0, longest)}… (cut; read the thread for the rest)` : trimmed,
    );
    if (entry.texts.length > kept) entry.texts.shift();
    this.schedule(this.options.progress ?? progress);
  }

  /** The assistant became free (or the user stopped talking): deliver what waited. */
  free() {
    if (!this.pending.length && !this.said.size) return;
    if (!this.pending.length && this.due > this.now()) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 0);
  }

  close() {
    clearTimeout(this.timer);
    clearInterval(this.look);
  }

  private isChild(id: string) {
    const parent = this.options.lookup?.(id)?.parentId;
    return !!parent && this.followed.has(parent);
  }

  private name(title: string) {
    return `"${title.trim() || "Untitled"}"`;
  }

  private add(line: string, wait = this.options.gather ?? gather) {
    if (!this.pending.includes(line)) this.pending.push(line);
    this.schedule(wait);
  }

  /** Flush within `wait`, or sooner if already due sooner. */
  private schedule(wait: number) {
    const at = this.now() + wait;
    if (this.timer && this.due <= at) return;
    clearTimeout(this.timer);
    this.due = at;
    this.timer = setTimeout(() => this.flush(), wait);
  }

  private flush() {
    this.timer = undefined;
    if (!this.pending.length && !this.said.size) return;
    // Busy or someone is talking: try again shortly, and at once when the run settles (`free`).
    if (!this.options.free()) {
      this.timer = setTimeout(() => this.flush(), 5000);
      return;
    }
    const lines = this.pending.splice(0);
    const said = [...this.said.values()];
    this.said.clear();
    // Threads that only spoke get a line too, so the page shows why the assistant woke.
    for (const entry of said)
      if (!lines.some((line) => line.startsWith(entry.name))) lines.push(`${entry.name} has an update.`);
    this.lastWake = this.now();
    this.options.wake({
      text: lines.join("\n"),
      ...(said.length
        ? { said: said.map((entry) => `${entry.name} said:\n\n${entry.texts.join("\n\n---\n\n")}`).join("\n\n") }
        : {}),
    });
  }

  private regular() {
    const minutes = this.options.everyMinutes;
    // Only while something is at work; a wake-up for news already counts as a look.
    const busy = [...this.followed].filter((id) => {
      const thread = this.options.lookup?.(id);
      return thread && !thread.away && (working.has(thread.status) || !!thread.holding);
    }).length;
    if (!busy || this.now() - this.lastWake < minutes * 60_000 * 0.9) return;
    this.add(`Regular look: ${busy} thread${busy === 1 ? "" : "s"} at work.`);
  }

  private now() {
    return this.options.now?.() ?? Date.now();
  }
}
