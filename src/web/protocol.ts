/**
 * What the web version's server and page say to each other over the socket. The page imports these types
 * only (no runtime code), so this file must stay free of Node imports.
 *
 * Built to stay cheap however long the conversation gets: a page gets only the latest lines and asks for
 * older ones as the user scrolls back; a reply being written arrives as the text added since the last
 * message, not again whole; pictures are links the browser loads when shown and caches, never inline.
 */

/** One T3 thread, cut down to what the page and the assistant need. Built from T3's thread record. */
export type Thread = {
  id: string;
  projectId: string;
  title: string;
  /** T3's run status: idle, preparing, queued, starting, running, waiting, completed, interrupted, failed, cancelled, rolled_back. */
  status: string;
  /** T3 is waiting on the user: a permission request or a question. */
  needsUser: boolean;
  /**
   * Why a thread whose turn ended isn't done yet, in a few words: it watches a pull request, waits on its
   * subagents or other work it started. It comes back on its own; until then it counts as working.
   */
  holding?: string;
  /** A run is going (a provider's subagent shows only this; its status stays idle). */
  active?: boolean;
  /**
   * The request it waits on, when there is one: its id, and its kind (command, file-change, file-read,
   * permission, user_input, …). Kept flat so a changed thread compares field by field.
   */
  requestId?: string;
  requestKind?: string;
  /** The last thing the thread said that a person would read, if T3 has it. */
  lastMessage?: string;
  lastError?: string;
  branch?: string;
  /** The thread's own worktree folder on T3's machine; without one it works in its project's root. */
  worktree?: string;
  /** When the latest run finished, and when the user last opened the thread in T3, for "done, unread". */
  finishedAt?: string;
  visitedAt?: string;
  pinned: boolean;
  /** Settled, snoozed or archived: out of the way in T3. */
  away: boolean;
  parentId?: string;
  createdAt: string;
  updatedAt: string;
};

export type Project = { id: string; title: string; root: string };

/** How bruv's link to T3 is doing. */
export type T3State =
  | { state: "connecting" }
  /** `app`: T3's own page for this environment; a thread opens at `<app>/<thread id, URL-encoded>`. */
  | { state: "connected"; app?: string }
  | { state: "unavailable"; reason: string };

/**
 * A piece of work the user asked for, as the assistant keeps it in `tasks/<slug>.md` in its workspace.
 * The page shows these instead of threads: the user thinks in work, not threads.
 */
export type Task = {
  slug: string;
  title: string;
  /** working, waiting (on the user), blocked, done; anything else shows as working. */
  status: string;
  /** What comes next, in a line. */
  next?: string;
  /** T3 threads doing it. */
  threads: string[];
  updatedAt: string;
};

/** A line in the conversation. Wake-ups are the assistant's own check-ins, shown small. */
/** How the page shows a file: inline for pictures, video, sound and HTML; text in a box; a PDF as a link. */
export type ShownKind = "image" | "video" | "audio" | "html" | "pdf" | "text";

/** A file the assistant showed the user. `url` is on the server and needs no key; `title` is the assistant's words for it. */
export type Shown = { url: string; kind: ShownKind; name: string; title?: string };

export type Line = {
  id: string;
  role: "user" | "assistant" | "wake" | "note";
  text: string;
  /** Pictures sent with a user line, as links on the server (cacheable for good). */
  images?: string[];
  /** Files the assistant showed, on an assistant line of their own. */
  files?: Shown[];
  at: string;
  /** Still being written. */
  partial?: boolean;
};

/** An answer to a thread's permission request: once, for the rest of its session, or no. */
export type Decision = "accept" | "acceptForSession" | "decline";

export type ServerEvent =
  /**
   * Sent first on every connection, so a page that reconnects starts clean: the latest lines only, and
   * whether there are older ones to ask for.
   */
  | {
      type: "hello";
      lines: Line[];
      more: boolean;
      busy: boolean;
      t3: T3State;
      projects: Project[];
      threads: Thread[];
      tasks: Task[];
    }
  /** A new line, or a newer version of one already sent (same id): it replaces that line whole. */
  | { type: "line"; line: Line }
  /** More text for a line being written; it stays `partial` until the whole line comes as `line`. */
  | { type: "append"; id: string; text: string }
  /** Older lines, answering `more`, oldest first; sent only to the page that asked. */
  | { type: "older"; lines: Line[]; more: boolean }
  | { type: "busy"; busy: boolean }
  /**
   * What the assistant is doing now, in a few words (a script's opening comment, or the tool), shown while
   * it works so a long run isn't silence. Gone when the run ends; never saved.
   */
  | { type: "step"; text: string }
  | { type: "t3"; t3: T3State }
  | { type: "projects"; projects: Project[] }
  /** Threads that changed, whole. */
  | { type: "threads"; threads: Thread[] }
  /** All tasks, whenever one changes (there are few). */
  | { type: "tasks"; tasks: Task[] };

export type PageEvent =
  /**
   * The user wrote something. Images are data URLs, already shrunk by the page. `id` is the page's own id
   * for the line it already shows; the server sends the line back under it, so the two become one.
   */
  | { type: "say"; text: string; images?: string[]; id?: string }
  /** Stop what the assistant is doing now. */
  | { type: "stop" }
  /** Older lines than the line with this id (the oldest one the page has). */
  | { type: "more"; before: string }
  /** Answer a thread's permission request from the page, as the user. */
  | { type: "respond"; threadId: string; decision: Decision }
  /** The page came to the front or went away, so news goes to it rather than as a notification. */
  | { type: "visible"; visible: boolean };
