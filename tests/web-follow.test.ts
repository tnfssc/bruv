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

/** T3's app socket, answering subscribeThread with the events the test gives it, after the asked position. */
async function fakeT3() {
  const requests: { threadId: string; afterSequence: number }[] = [];
  const log = new Map<string, unknown[]>();
  const sockets = new Set<WebSocket>();
  const server = createServer();
  const wss = new WebSocketServer({ server });
  wss.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      if (message._tag !== "Request") return;
      const { threadId, afterSequence } = message.payload;
      requests.push({ threadId, afterSequence });
      const missed = (log.get(threadId) ?? []).filter(
        (value) => (value as { sequence: number }).sequence > afterSequence,
      );
      socket.send(
        JSON.stringify({ _tag: "Chunk", requestId: message.id, values: [...missed, { kind: "synchronized" }] }),
      );
      (socket as WebSocket & { ids?: Map<string, string> }).ids ??= new Map();
      (socket as WebSocket & { ids?: Map<string, string> }).ids?.set(threadId, message.id);
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  cleanup.push(() => {
    for (const socket of sockets) socket.terminate();
    server.close();
  });
  let sequence = 100;
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    /** A message event on a thread, sent to followers and kept for resuming. */
    say(threadId: string, message: { id: string; role: string; text: string; streaming?: boolean }) {
      const value = { kind: "event", sequence: ++sequence, event: { type: "message.updated", payload: message } };
      log.set(threadId, [...(log.get(threadId) ?? []), value]);
      for (const socket of sockets) {
        const id = (socket as WebSocket & { ids?: Map<string, string> }).ids?.get(threadId);
        if (id) socket.send(JSON.stringify({ _tag: "Chunk", requestId: id, values: [value] }));
      }
    },
    drop: () => {
      for (const socket of sockets) socket.terminate();
    },
  };
}

test("followed threads pass on each finished message once, and resume where they were after a drop", async () => {
  const t3 = await fakeT3();
  const got: ThreadMessage[] = [];
  const follower = followThreads({
    connect: async () => ({ origin: t3.origin, ticket: "t" }),
    position: () => 100,
    onMessage: (message) => got.push(message),
  });
  cleanup.push(() => follower.close());
  follower.follow(["a", "b"]);
  await until(() => t3.requests.length === 2);
  // A new thread starts from the shell feed's position: only what it says from now on.
  expect(t3.requests.map((request) => request.afterSequence)).toEqual([100, 100]);

  t3.say("a", { id: "m1", role: "assistant", text: "Half", streaming: true });
  t3.say("a", { id: "m1", role: "assistant", text: "Half done.", streaming: false });
  t3.say("a", { id: "u1", role: "user", text: "keep going" });
  t3.say("b", { id: "m2", role: "assistant", text: "All tests pass." });
  await until(() => got.length === 2);
  expect(got.map((message) => [message.threadId, message.text])).toEqual([
    ["a", "Half done."],
    ["b", "All tests pass."],
  ]);

  // After a drop each thread resumes from its own last position; what was told isn't told again.
  t3.drop();
  await until(() => t3.requests.length === 4);
  const resumed = t3.requests.slice(2);
  expect(resumed.find((request) => request.threadId === "a")?.afterSequence).toBe(103);
  expect(resumed.find((request) => request.threadId === "b")?.afterSequence).toBe(104);
  t3.say("a", { id: "m3", role: "assistant", text: "Done." });
  await until(() => got.length === 3);
  expect(got[2]?.text).toBe("Done.");

  // Following fewer threads: the dropped one is no longer asked for.
  follower.follow(["b"]);
  await until(() => t3.requests.length === 5);
  expect(t3.requests[4]?.threadId).toBe("b");
});
