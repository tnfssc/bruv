import type { Decision, Line, Thread } from "../../../src/web/protocol";
import { generation, send } from "./socket";
import { getState, lines, setState } from "./store";

/**
 * What the user just did, shown at once and taken back if the server never shows it. A sent line waits
 * under the page's own id until the server sends it back under that id; an answer waits until the thread
 * no longer waits on that request.
 */

/** How long to wait for the server to show it got something. A setting for tests. */
export const patience = { ms: 15_000 };

type Wait = { on: number; done: () => void; fail: (error: Error) => void; timer?: ReturnType<typeof setTimeout> };
/** Lines sent and not back yet, with the socket they went on (see `generation`). */
const sent = new Map<string, Wait>();
/** Lines taken back; if one shows up after all, the composer hears of it. */
const gaveUp = new Set<string>();
const lateListeners = new Set<(id: string) => void>();

/** A fresh line id the server takes (up to 64 of `[\w-]`). `randomUUID` needs HTTPS; a phone on the LAN has none. */
function freshId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `p-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Shows the user's line at once and sends it. `sent` rejects once the line is taken back: no socket, or
 * the server stayed online and idle for `patience` without sending it back. While the assistant works the
 * server holds a message until its current step ends, and while the socket is down nothing can come back,
 * so then it waits longer; a `hello` settles what was sent on an earlier socket.
 */
export function say(text: string, images: string[]): { id: string; sent: Promise<void> } {
  const id = freshId();
  const pictures = images.length ? { images } : {};
  const line: Line = { id, role: "user", text, at: new Date().toISOString(), ...pictures };
  const promise = new Promise<void>((done, fail) => {
    sent.set(id, { on: generation(), done, fail });
    lines.set(id, line);
    setState({ sending: [...getState().sending, id] });
    if (send({ type: "say", text, ...pictures, id })) arm(id);
    else giveUp(id);
  });
  return { id, sent: promise };
}

function arm(id: string) {
  const wait = sent.get(id);
  if (!wait) return;
  wait.timer = setTimeout(() => {
    const { online, busy } = getState();
    if (!online || busy) arm(id);
    else giveUp(id);
  }, patience.ms);
}

function giveUp(id: string) {
  const wait = sent.get(id);
  if (!wait) return;
  clearTimeout(wait.timer);
  sent.delete(id);
  lines.delete(id);
  gaveUp.add(id);
  setState({ sending: getState().sending.filter((other) => other !== id) });
  wait.fail(new Error("Not sent"));
}

/** The server sent this line; true when it was one the page was waiting for. */
export function heard(id: string): boolean {
  const wait = sent.get(id);
  if (wait) {
    clearTimeout(wait.timer);
    sent.delete(id);
    wait.done();
    return true;
  }
  if (gaveUp.delete(id)) for (const listener of lateListeners) listener(id);
  return false;
}

/** After a `hello` (which already went through `heard`): what an idle server didn't get on an earlier socket is lost. */
export function settleSends(busy: boolean) {
  if (busy) return;
  const now = generation();
  for (const [id, wait] of sent) if (wait.on < now) giveUp(id);
}

/** Tells `listener` when a line taken back reached the server after all. */
export function onLate(listener: (id: string) => void) {
  lateListeners.add(listener);
  return () => {
    lateListeners.delete(listener);
  };
}

/** Answers sent, by thread, with the request they answer. */
const answers = new Map<string, { requestId?: string; timer: ReturnType<typeof setTimeout> }>();
const bump = (change: { missed?: string } = {}) =>
  setState({ ...change, threadsVersion: getState().threadsVersion + 1 });

/** Answers a thread's request at once on the page; if T3 doesn't take it, the buttons come back. */
export function answer(thread: Thread, decision: Decision) {
  const { id, requestId } = thread;
  if (answers.has(id)) return;
  if (!send({ type: "respond", threadId: id, decision })) return bump({ missed: requestId });
  const timer = setTimeout(() => {
    answers.delete(id);
    bump({ missed: requestId });
  }, patience.ms);
  answers.set(id, { requestId, timer });
  bump();
}

/** Threads came in: an answer is in once its thread no longer waits on that request (or, in a `hello`, is gone). */
export function settleAnswers(list: Thread[], whole: boolean) {
  if (answers.size === 0) return;
  const by = new Map(list.map((thread) => [thread.id, thread]));
  for (const [id, { requestId, timer }] of answers) {
    const thread = by.get(id);
    if (thread ? thread.requestId === requestId : !whole) continue;
    clearTimeout(timer);
    answers.delete(id);
  }
}

/** Threads as they will be once the answers on their way are in. */
export function withAnswers(list: Iterable<Thread>): Iterable<Thread> {
  if (answers.size === 0) return list;
  return Array.from(list, (thread) =>
    answers.get(thread.id)?.requestId === thread.requestId && thread.requestId
      ? { ...thread, needsUser: false, requestId: undefined, requestKind: undefined }
      : thread,
  );
}
