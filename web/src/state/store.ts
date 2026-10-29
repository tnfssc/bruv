import type { Line, Project, T3State, Thread } from "../../../src/web/protocol";

/**
 * Everything the page shows, outside React so a hot reload of a component keeps it. Built so a long
 * conversation costs the same as a short one:
 * - the list of line ids changes only when lines come or go; a line's text lives in a map and growing it
 *   wakes only that line's component;
 * - at most `keep` lines stay in memory while the user follows the end; older ones are asked for again.
 * `feed.ts` writes the server's events in; `optimistic.ts` adds what the user just did, until the server
 * shows it.
 */
export type State = {
  /** The socket is open. */
  online: boolean;
  /** No socket for a while: shown quietly, so short drops don't flash. */
  offline: boolean;
  /** A `hello` has arrived since the page opened. */
  ready: boolean;
  busy: boolean;
  t3: T3State;
  projects: Project[];
  /** The server has lines older than the oldest one here. */
  more: boolean;
  /** Asked for older lines and waiting. */
  fetching: boolean;
  /** The server's line ids in order. A new array only when lines come or go. */
  ids: string[];
  /** Ids of lines the user sent that the server hasn't sent back yet; shown after `ids`. */
  sending: string[];
  /** Bumped when threads (or answers waiting on them) change; the threads themselves are in `threads`. */
  threadsVersion: number;
  /** What the assistant is doing right now, while it works. */
  step: string;
  /** The request whose answer last didn't go through, shown by its buttons. */
  missed?: string;
};

/** The most lines kept while the user follows the end. */
export const keep = 2000;

let state: State = {
  online: false,
  offline: false,
  ready: false,
  busy: false,
  t3: { state: "connecting" },
  projects: [],
  more: false,
  fetching: false,
  ids: [],
  sending: [],
  threadsVersion: 0,
  step: "",
};
const listeners = new Set<() => void>();
const lineListeners = new Map<string, Set<() => void>>();

/** Lines by id, the server's and those on their way to it. */
export const lines = new Map<string, Line>();
/** Threads by id, changed in place; `threadsVersion` says when. */
export const threads = new Map<string, Thread>();
/** Set by the conversation: whether the user is at the end, where dropping the oldest lines is safe. */
let following = true;

export const getState = () => state;
export const getLine = (id: string) => lines.get(id);
export const setFollowing = (on: boolean) => {
  following = on;
  if (on && state.ids.length > keep) setState(trimmed(state.ids));
};

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function subscribeLine(id: string, listener: () => void) {
  const set = lineListeners.get(id) ?? new Set();
  lineListeners.set(id, set);
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) lineListeners.delete(id);
  };
}

export function setState(change: Partial<State>) {
  state = { ...state, ...change };
  for (const listener of listeners) listener();
}

/** Wakes the component showing this line. */
export function touch(id: string) {
  const set = lineListeners.get(id);
  if (set) for (const listener of set) listener();
}

export function touchAll() {
  for (const id of lineListeners.keys()) touch(id);
}

/** Drops the oldest lines past `keep`, while the user is at the end and won't see them go. */
export function trimmed(ids: string[]): Partial<State> {
  if (!following || ids.length <= keep) return { ids };
  const gone = ids.length - keep;
  for (let i = 0; i < gone; i++) lines.delete(ids[i] as string);
  return { ids: ids.slice(gone), more: true };
}

// The socket and this state belong together: an edit here reloads the page, and `hello` fills it again.
if (import.meta.hot) import.meta.hot.accept(() => location.reload());
