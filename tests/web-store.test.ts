import { beforeEach, expect, mock, test } from "bun:test";
import type { Line, PageEvent, ServerEvent, Thread } from "../src/web/protocol";

// The page's socket, swapped for a list of what was sent, so the store runs as it does in the browser.
const sent: PageEvent[] = [];
let online = true;
let opened = 1;
mock.module("../web/src/state/socket", () => ({
  send: (event: PageEvent) => {
    if (online) sent.push(event);
    return online;
  },
  generation: () => opened,
  connect: () => {},
}));

const { apply, askOlder } = await import("../web/src/state/feed");
const { say, answer, onLate, patience, withAnswers } = await import("../web/src/state/optimistic");
const { getLine, getState, keep, setFollowing, setState, subscribeLine, threads } = await import(
  "../web/src/state/store"
);

patience.ms = 30;
const line = (id: string, text = id, role: Line["role"] = "assistant"): Line => ({
  id,
  role,
  text,
  at: "2026-10-29T10:00:00Z",
});
const thread = (id: string, requestId?: string): Thread => ({
  id,
  projectId: "p",
  title: id,
  status: requestId ? "waiting" : "running",
  needsUser: !!requestId,
  ...(requestId ? { requestId, requestKind: "command" } : {}),
  pinned: false,
  away: false,
  createdAt: "2026-10-29T10:00:00Z",
  updatedAt: "2026-10-29T10:00:00Z",
});
const hello = (more: Partial<Extract<ServerEvent, { type: "hello" }>> = {}): ServerEvent => ({
  type: "hello",
  lines: [],
  more: false,
  busy: false,
  t3: { state: "connected" },
  projects: [],
  threads: [],
  tasks: [],
  ...more,
});
/** What the conversation shows, in order. */
const shown = () => [...getState().ids, ...getState().sending];
/** The id of the line the page sent last. */
const lastSaid = () => {
  const event = sent.at(-1);
  if (event?.type !== "say" || !event.id) throw new Error("No line sent");
  return event.id;
};
const settled = (promise: Promise<unknown>) =>
  promise.then(
    () => "sent",
    () => "failed",
  );
const waiting = (id: string) => [...withAnswers(threads.values())].find((each) => each.id === id);

beforeEach(() => {
  sent.length = 0;
  online = true;
  setState({ online: true, busy: false });
  setFollowing(true);
  apply(hello());
});

test("hello replaces everything, so a reconnect starts clean", () => {
  apply(hello({ lines: [line("a"), line("b")], threads: [thread("t1")] }));
  apply({ type: "line", line: line("c") });
  apply(hello({ lines: [line("x")], threads: [thread("t2")] }));
  expect(shown()).toEqual(["x"]);
  expect(getLine("a")).toBeUndefined();
  expect(threads.has("t1")).toBe(false);
  expect(threads.has("t2")).toBe(true);
});

test("appends wake only their line and leave the list alone", () => {
  apply(hello({ lines: [line("a")] }));
  apply({ type: "line", line: { ...line("b", ""), partial: true } });
  const list = getState().ids;
  let woken = 0;
  let other = 0;
  const stop = subscribeLine("b", () => woken++);
  const stopOther = subscribeLine("a", () => other++);
  for (const part of ["one ", "two"]) apply({ type: "append", id: "b", text: part });
  stop();
  stopOther();
  expect(getLine("b")?.text).toBe("one two");
  expect(woken).toBe(2);
  expect(other).toBe(0);
  expect(getState().ids).toBe(list);
});

test("older pages go before the oldest line, skipping ones already here", () => {
  apply(hello({ lines: [line("c"), line("d")], more: true }));
  askOlder();
  askOlder();
  expect(sent).toEqual([{ type: "more", before: "c" }]);
  apply({ type: "older", lines: [line("a"), line("b"), line("c")], more: false });
  expect(shown()).toEqual(["a", "b", "c", "d"]);
  expect(getState()).toMatchObject({ more: false, fetching: false });
});

test("only the newest lines stay while following the end", () => {
  apply(hello({ lines: Array.from({ length: keep }, (_, i) => line(`l${i}`)) }));
  setFollowing(false);
  apply({ type: "line", line: line("new1") });
  expect(getState().ids).toHaveLength(keep + 1);
  setFollowing(true);
  apply({ type: "line", line: line("new2") });
  expect(getState().ids).toHaveLength(keep);
  expect(getState().ids[0]).toBe("l2");
  expect(getLine("l0")).toBeUndefined();
  expect(getState().more).toBe(true);
});

test("a sent line shows at once and stays one line once the server sends it back", async () => {
  apply(hello({ lines: [line("a")] }));
  const { id, sent: back } = say("hi", []);
  const done = settled(back);
  expect(id).toMatch(/^[\w-]{1,64}$/);
  expect(lastSaid()).toBe(id);
  expect(shown()).toEqual(["a", id]);
  // A reply streams in while the line waits; the waiting line stays last until it comes back.
  apply({ type: "line", line: { ...line("r", ""), partial: true } });
  apply({ type: "append", id: "r", text: "streaming" });
  expect(shown()).toEqual(["a", "r", id]);
  apply({ type: "line", line: line(id, "hi", "user") });
  expect(await done).toBe("sent");
  expect(shown()).toEqual(["a", "r", id]);
  expect(getState().sending).toEqual([]);
});

test("a sent line nobody sends back is taken back", async () => {
  const { sent: back } = say("lost", []);
  expect(await settled(back)).toBe("failed");
  expect(shown()).toEqual([]);
});

test("a send with no socket is taken back at once", async () => {
  online = false;
  const { id, sent: back } = say("hi", []);
  expect(await settled(back)).toBe("failed");
  expect(getLine(id)).toBeUndefined();
});

test("across a reconnect, a sent line is matched by the next hello", async () => {
  const { id, sent: back } = say("hi", []);
  opened++;
  apply(hello({ lines: [line(id, "hi", "user")] }));
  expect(await settled(back)).toBe("sent");
  expect(shown()).toEqual([id]);
});

test("across a reconnect, a line the idle server never got is taken back", async () => {
  const { sent: back } = say("hi", []);
  opened++;
  apply(hello());
  expect(await settled(back)).toBe("failed");
});

test("while the assistant works, a sent line waits for it, across a reconnect too", async () => {
  setState({ busy: true });
  const { id, sent: back } = say("steer", []);
  opened++;
  apply(hello({ busy: true }));
  await Bun.sleep(patience.ms * 2);
  expect(shown()).toEqual([id]);
  apply({ type: "line", line: line(id, "steer", "user") });
  expect(await settled(back)).toBe("sent");
});

test("a line taken back that reaches the server late says so, and shows once", async () => {
  const late: string[] = [];
  const stop = onLate((id) => late.push(id));
  const { id, sent: back } = say("slow", []);
  expect(await settled(back)).toBe("failed");
  apply({ type: "line", line: line(id, "slow", "user") });
  stop();
  expect(late).toEqual([id]);
  expect(shown()).toEqual([id]);
});

test("an answer moves the thread on at once and stays once T3 has it", async () => {
  apply(hello({ threads: [thread("t1", "r1")] }));
  answer(thread("t1", "r1"), "accept");
  expect(sent.at(-1)).toEqual({ type: "respond", threadId: "t1", decision: "accept" });
  expect(waiting("t1")?.needsUser).toBe(false);
  apply({ type: "threads", threads: [thread("t1")] });
  await Bun.sleep(patience.ms * 2);
  expect(waiting("t1")?.requestId).toBeUndefined();
  expect(getState().missed).toBeUndefined();
});

test("an answer T3 never takes comes back", async () => {
  apply(hello({ threads: [thread("t1", "r2")] }));
  answer(thread("t1", "r2"), "decline");
  expect(waiting("t1")?.requestId).toBeUndefined();
  await Bun.sleep(patience.ms * 2);
  expect(getState().missed).toBe("r2");
  expect(waiting("t1")?.requestId).toBe("r2");
});
