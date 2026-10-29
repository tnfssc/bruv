import { afterEach, expect, test } from "bun:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { type WebSocket, WebSocketServer } from "ws";
import type { Thread } from "../src/web/protocol";
import { followThreads, type ThreadMessage } from "../src/web/t3/follow";
import { type Wake, Waker } from "../src/web/wake";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const each of cleanup.splice(0)) each();
});

async function until(check: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((done) => setTimeout(done, 5));
  }
}

const thread = (id: string, status: string): Thread => ({
  id,
  projectId: "p",
  title: id,
  status,
  needsUser: false,
  pinned: false,
  away: false,
  createdAt: "",
  updatedAt: "",
});

function waker(options: Partial<ConstructorParameters<typeof Waker>[0]> = {}) {
  const woke: Wake[] = [];
  const instance = new Waker({
    wake: (wake) => woke.push(wake),
    free: () => true,
    everyMinutes: 0,
    gather: 10,
    ...options,
  });
  cleanup.push(() => instance.close());
  instance.tasks([{ slug: "x", title: "Fix login", status: "working", threads: ["a"], updatedAt: "" }]);
  instance.threads([thread("a", "running")]);
  return { instance, woke };
}

test("a finishing thread's last words come with the wake-up, for the assistant only", async () => {
  const { instance, woke } = waker({ progress: 60_000 });
  instance.message("a", "Fixed it. PR 12 is open.");
  instance.threads([thread("a", "completed")]);
  await until(() => woke.length === 1);
  expect(woke[0]?.text).toContain('"a"');
  expect(woke[0]?.text).not.toContain("PR 12");
  expect(woke[0]?.said).toContain("PR 12 is open");
  // Threads no task follows are not news.
  instance.message("z", "something else");
  await new Promise((done) => setTimeout(done, 30));
  expect(woke.length).toBe(1);
});

test("a thread named like its task is named once, whatever its quotes", async () => {
  const woke: Wake[] = [];
  const instance = new Waker({
    wake: (wake) => woke.push(wake),
    free: () => true,
    everyMinutes: 0,
    gather: 10,
    lookup: () => ({ ...thread("a", "running"), title: "Print today\u2019s weekday" }),
  });
  cleanup.push(() => instance.close());
  instance.tasks([{ slug: "x", title: "Print today's weekday", status: "working", threads: ["a"], updatedAt: "" }]);
  instance.threads([{ ...thread("a", "completed"), title: "Print today\u2019s weekday" }]);
  await until(() => woke.length === 1);
  expect(woke[0]?.text).not.toContain("(");
});

test("what a thread says while it works gathers into one later wake-up", async () => {
  const { instance, woke } = waker({ progress: 60 });
  instance.message("a", "Looking at the login code.");
  instance.message("a", "Found the redirect bug.");
  await new Promise((done) => setTimeout(done, 20));
  expect(woke).toEqual([]);
  await until(() => woke.length === 1);
  expect(woke[0]?.said).toContain("Looking at the login code.");
  expect(woke[0]?.said).toContain("Found the redirect bug.");
  // The page's line says why it woke, by the task's name when the thread's isn't known.
  expect(woke[0]?.text).toContain("Fix login");
  // A very long message is cut.
  instance.message("a", "x".repeat(10_000));
  await until(() => woke.length === 2);
  expect(woke[1]?.said?.length).toBeLessThan(5000);
});

/**
 * T3's app socket for subscribeThread: a first subscription gets a snapshot of the thread, a resume the
 * events after its position, or a snapshot when `snapshotOnResume` says T3 can't resume.
 */
async function fakeT3() {
  const requests: { threadId: string; afterSequence?: number }[] = [];
  const log = new Map<string, { sequence: number; event: { type: string; payload: Record<string, unknown> } }[]>();
  const sockets = new Set<WebSocket & { ids?: Map<string, string> }>();
  const server = createServer();
  const wss = new WebSocketServer({ server });
  let sequence = 100;
  const fake = {
    origin: "",
    requests,
    snapshotOnResume: false,
    /** The thread's messages as a snapshot shows them: the last version of each. */
    snapshot(threadId: string) {
      const messages = new Map<string, unknown>();
      for (const value of log.get(threadId) ?? [])
        if (value.event.type === "message.updated") messages.set(String(value.event.payload.id), value.event.payload);
      const events = log.get(threadId) ?? [];
      return {
        kind: "snapshot",
        snapshotSequence: events.at(-1)?.sequence ?? 0,
        projection: { messages: [...messages.values()] },
      };
    },
    /** An event on a thread: kept, and sent to followers unless `quiet`. */
    event(threadId: string, type: string, payload: Record<string, unknown>, quiet = false) {
      const value = { kind: "event", sequence: ++sequence, event: { type, payload } };
      log.set(threadId, [...(log.get(threadId) ?? []), value]);
      if (quiet) return;
      for (const socket of sockets) {
        const id = socket.ids?.get(threadId);
        if (id) socket.send(JSON.stringify({ _tag: "Chunk", requestId: id, values: [value] }));
      }
    },
    say(
      threadId: string,
      message: { id: string; text: string; role?: string; streaming?: boolean; runId?: string },
      quiet = false,
    ) {
      fake.event(
        threadId,
        "message.updated",
        { role: "assistant", updatedAt: new Date().toISOString(), ...message },
        quiet,
      );
    },
    drop: () => {
      for (const socket of sockets) socket.terminate();
    },
  };
  wss.on("connection", (socket: WebSocket & { ids?: Map<string, string> }) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      if (message._tag !== "Request") return;
      const { threadId, afterSequence } = message.payload;
      requests.push({ threadId, afterSequence });
      const values =
        afterSequence === undefined || fake.snapshotOnResume
          ? [fake.snapshot(threadId)]
          : (log.get(threadId) ?? []).filter((value) => value.sequence > afterSequence);
      socket.send(
        JSON.stringify({ _tag: "Chunk", requestId: message.id, values: [...values, { kind: "synchronized" }] }),
      );
      socket.ids ??= new Map();
      socket.ids.set(threadId, message.id);
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  fake.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cleanup.push(() => {
    fake.drop();
    server.close();
  });
  return fake;
}

function follow(t3: Awaited<ReturnType<typeof fakeT3>>) {
  const got: ThreadMessage[] = [];
  const follower = followThreads({
    connect: async () => ({ origin: t3.origin, ticket: "t" }),
    onMessage: (message) => got.push(message),
  });
  cleanup.push(() => follower.close());
  return { follower, got };
}

test("followed threads pass on each finished message once, and resume where they were after a drop", async () => {
  const t3 = await fakeT3();
  // Said before bruv followed: the past.
  t3.say("a", { id: "old", text: "Earlier work." }, true);
  const { follower, got } = follow(t3);
  follower.follow(["a", "b"]);
  await until(() => t3.requests.length === 2);
  // A thread followed for the first time starts from a snapshot of it.
  expect(t3.requests.map((request) => request.afterSequence)).toEqual([undefined, undefined]);

  t3.say("a", { id: "m1", text: "Half", streaming: true });
  t3.say("a", { id: "m1", text: "Half done.", streaming: false });
  t3.say("a", { id: "u1", role: "user", text: "keep going" });
  t3.say("b", { id: "m2", text: "All tests pass." });
  await until(() => got.length === 2);
  expect(got.map((message) => [message.threadId, message.text])).toEqual([
    ["a", "Half done."],
    ["b", "All tests pass."],
  ]);

  // After a drop each thread resumes from its own last position; what was told isn't told again.
  t3.drop();
  await until(() => t3.requests.length === 4);
  const resumed = t3.requests.slice(2);
  expect(resumed.find((request) => request.threadId === "a")?.afterSequence).toBe(104);
  expect(resumed.find((request) => request.threadId === "b")?.afterSequence).toBe(105);
  t3.say("a", { id: "m3", text: "Done." });
  await until(() => got.length === 3);
  expect(got[2]?.text).toBe("Done.");

  // Following fewer threads: the dropped one is no longer asked for.
  follower.follow(["b"]);
  await until(() => t3.requests.length === 5);
  expect(t3.requests[4]?.threadId).toBe("b");
});

test("what a thread said while bruv wasn't listening still comes, and a run's last message left streaming too", async () => {
  const t3 = await fakeT3();
  const { follower, got } = follow(t3);
  follower.follow(["a"]);
  await until(() => t3.requests.length === 1);
  await new Promise((done) => setTimeout(done, 20));

  // While the socket is down the thread finishes, and T3 can't resume: a snapshot holds the news.
  t3.drop();
  t3.snapshotOnResume = true;
  t3.say("a", { id: "m1", text: "Finished: PR 12 is open." }, true);
  await until(() => got.length === 1);
  expect(got[0]?.text).toBe("Finished: PR 12 is open.");

  // A run that ends with its message still marked streaming: the run's end brings it.
  t3.snapshotOnResume = false;
  await until(() => t3.requests.length === 2);
  t3.say("a", { id: "m2", text: "Last words", streaming: true, runId: "r1" });
  t3.event("a", "run.updated", { id: "r1", status: "completed" });
  await until(() => got.length === 2);
  expect(got[1]?.text).toBe("Last words");
});
