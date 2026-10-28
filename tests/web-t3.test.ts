import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { type WebSocket, WebSocketServer } from "ws";
import type { Thread } from "../src/web/protocol";
import { connectT3, type T3Change, type T3Link } from "../src/web/t3";
import type { ShellValue } from "../src/web/t3/feed";
import { type T3Thread, toThread } from "../src/web/t3/thread";

const record = (id: string, extra: Partial<T3Thread> = {}): T3Thread => ({
  id,
  projectId: "p1",
  title: `Thread ${id}`,
  status: "idle",
  branch: null,
  lineage: { parentThreadId: null },
  pendingRuntimeRequest: null,
  latestVisibleMessage: null,
  latestRunCompletedAt: null,
  lastVisitedAt: null,
  pinnedAt: null,
  settledAt: null,
  archivedAt: null,
  deletedAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...extra,
});
const project = (id: string, root = `/code/${id}`) => ({ id, title: id, workspaceRoot: root });

/** Just enough of T3: pairing, token exchange, MCP OAuth, websocket tickets and the shell feed. */
async function fakeT3() {
  const codes = new Set<string>();
  const sessions = new Set<string>();
  const tickets = new Set<string>();
  const mcpKeys = new Set<string>();
  const grants = new Map<string, string>();
  const sockets = new Set<WebSocket>();
  let n = 0;
  const fake = {
    pairs: 0,
    subscribes: 0,
    chunks: 0,
    acks: 0,
    protocol: "2",
    /** Whether T3 can resume a subscription from a position; when not, it sends a whole snapshot. */
    resumable: true,
    wholeSnapshots: 0,
    requests: [] as { afterSequence?: number }[],
    /** Everything sent with `send`, for resuming. */
    log: [] as ShellValue[],
    snapshot: { snapshotSequence: 10, threads: [record("a")], projects: [project("p1")] },
    sessions,
    mcpKeys,
    origin: "",
    send(values: ShellValue[]) {
      fake.log.push(...values);
      for (const socket of sockets) {
        fake.chunks++;
        socket.send(JSON.stringify({ _tag: "Chunk", requestId: "1", values }));
      }
    },
    drop: () => {
      for (const socket of sockets) socket.terminate();
    },
    locate: () => ({
      origin: fake.origin,
      pair: async () => {
        fake.pairs++;
        const code = `code-${++n}`;
        codes.add(code);
        return code;
      },
    }),
    close: () => {
      fake.drop();
      server.close();
    },
  };
  const body = (request: IncomingMessage) =>
    new Promise<string>((done) => {
      let text = "";
      request.on("data", (data) => {
        text += data;
      });
      request.on("end", () => done(text));
    });
  const reply = (response: ServerResponse, status: number, value: unknown) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(value));
  };
  const bearer = (request: IncomingMessage) => request.headers.authorization?.replace(/^Bearer /, "") ?? "";
  const server = createServer(async (request, response) => {
    const text = await body(request);
    const url = new URL(request.url ?? "/", fake.origin);
    if (url.pathname === "/oauth/token") {
      const form = new URLSearchParams(text);
      const code = form.get("subject_token") ?? "";
      if (!codes.delete(code)) return reply(response, 400, { error: "invalid_grant" });
      const token = `session-${++n}`;
      sessions.add(token);
      return reply(response, 200, { access_token: token, token_type: "Bearer", expires_in: 3600 });
    }
    if (url.pathname === "/api/auth/websocket-ticket") {
      if (!sessions.has(bearer(request))) return reply(response, 401, { code: "auth_invalid" });
      const ticket = `ticket-${++n}`;
      tickets.add(ticket);
      return reply(response, 200, { ticket, expiresAt: "2026-10-28T00:00:00.000Z" });
    }
    if (url.pathname === "/oauth/mcp/register") return reply(response, 201, { client_id: "client-1" });
    if (url.pathname === "/oauth/mcp/decision") {
      const { authorization, decision } = JSON.parse(text);
      if (decision._tag !== "pairing-code" || !codes.delete(decision.code)) return reply(response, 400, {});
      const code = `grant-${++n}`;
      grants.set(code, authorization.code_challenge);
      return reply(response, 200, {
        redirectTo: `${authorization.redirect_uri}?code=${code}&state=${authorization.state}`,
      });
    }
    if (url.pathname === "/oauth/mcp/token") {
      const form = new URLSearchParams(text);
      const challenge = createHash("sha256")
        .update(form.get("code_verifier") ?? "")
        .digest("base64url");
      if (grants.get(form.get("code") ?? "") !== challenge) return reply(response, 400, {});
      const token = `mcp-${++n}`;
      mcpKeys.add(token);
      return reply(response, 200, { access_token: token, token_type: "Bearer", expires_in: 3600 });
    }
    if (url.pathname === "/mcp") return reply(response, mcpKeys.has(bearer(request)) ? 405 : 401, {});
    reply(response, 404, {});
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", fake.origin);
    const refuse = (status: number, value: unknown) => {
      socket.end(`HTTP/1.1 ${status} No\r\ncontent-type: application/json\r\n\r\n${JSON.stringify(value)}`);
    };
    if (url.searchParams.get("orchestrationProtocol") !== fake.protocol)
      return refuse(426, { code: "orchestration_protocol_incompatible", orchestrationProtocolVersion: 3 });
    if (!tickets.delete(url.searchParams.get("wsTicket") ?? "")) return refuse(401, { code: "auth_invalid" });
    wss.handleUpgrade(request, socket, head, (ws) => {
      sockets.add(ws);
      ws.on("close", () => sockets.delete(ws));
      ws.on("message", (data) => {
        const message = JSON.parse(data.toString());
        if (message._tag === "Ack") fake.acks++;
        if (message._tag === "Request" && message.tag === "orchestration.subscribeShell") {
          fake.subscribes++;
          fake.requests.push(message.payload);
          const chunk = (values: unknown[]) => {
            fake.chunks++;
            ws.send(JSON.stringify({ _tag: "Chunk", requestId: message.id, values }));
          };
          const after = message.payload.afterSequence;
          if (fake.resumable && after !== undefined) {
            const missed = fake.log.filter((value) => "sequence" in value && value.sequence > after);
            if (missed.length) chunk(missed);
          } else {
            fake.wholeSnapshots++;
            chunk([{ kind: "snapshot", snapshot: fake.snapshot }]);
          }
          if (message.payload.requestCompletionMarker) chunk([{ kind: "synchronized" }]);
        }
      });
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  fake.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return fake;
}

async function until(check: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((done) => setTimeout(done, 10));
  }
}

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const step of cleanup.splice(0)) step();
});

async function setup() {
  const fake = await fakeT3();
  mkdirSync(".tmp", { recursive: true });
  const dir = mkdtempSync(resolve(".tmp/web-t3-"));
  const links: T3Link[] = [];
  const open = () => {
    const link = connectT3({ dir, locate: fake.locate });
    const changes: T3Change[] = [];
    link.onChange((change) => changes.push(change));
    links.push(link);
    return { link, changes };
  };
  cleanup.push(() => {
    for (const link of links) link.close();
    fake.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { fake, dir, open };
}

const threadsIn = (changes: T3Change[]) => changes.flatMap((change) => change.threads ?? []);
const byId = (link: T3Link, id: string) => link.threads().find((thread) => thread.id === id);

test("maps T3 thread records", () => {
  const now = Date.parse("2026-10-28T12:00:00.000Z");
  const thread = toThread(
    record("t", {
      status: "completed",
      branch: "feature",
      lineage: { parentThreadId: "parent" },
      pendingRuntimeRequest: { id: "r", kind: "command" },
      latestVisibleMessage: { role: "assistant", text: "Done." },
      lastError: "",
      latestRunCompletedAt: "2026-10-28T10:00:00.000Z",
      lastVisitedAt: "2026-10-28T09:00:00.000Z",
      pinnedAt: "2026-10-01T00:00:00.000Z",
    }),
    now,
  );
  expect(thread).toEqual({
    id: "t",
    projectId: "p1",
    title: "Thread t",
    requestId: "r",
    requestKind: "command",
    status: "completed",
    needsUser: true,
    lastMessage: "Done.",
    lastError: undefined,
    branch: "feature",
    finishedAt: "2026-10-28T10:00:00.000Z",
    visitedAt: "2026-10-28T09:00:00.000Z",
    pinned: true,
    away: false,
    parentId: "parent",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  });
  const plain = toThread(record("t"), now);
  expect([plain.needsUser, plain.pinned, plain.away, plain.parentId, plain.lastMessage]).toEqual([
    false,
    false,
    false,
    undefined,
    undefined,
  ]);
  expect(toThread(record("t", { hasActionableProposedPlan: true }), now).needsUser).toBe(true);
  expect(
    toThread(record("t", { latestVisibleMessage: { role: "user", text: "hi" } }), now).lastMessage,
  ).toBeUndefined();
  expect(toThread(record("t", { settledAt: "2026-10-27T00:00:00.000Z" }), now).away).toBe(true);
  expect(toThread(record("t", { snoozedUntil: "2026-10-29T00:00:00.000Z" }), now).away).toBe(true);
  expect(toThread(record("t", { snoozedUntil: "2026-10-27T00:00:00.000Z" }), now).away).toBe(false);
});

test("follows the shell feed and reports only what changed", async () => {
  const { fake, open } = await setup();
  fake.snapshot.threads = [record("a"), record("b", { settledAt: "2026-10-02T00:00:00.000Z" })];
  const { link, changes } = open();
  expect(link.state()).toEqual({ state: "connecting" });
  await until(() => link.state().state === "connected");
  expect(link.projects()).toEqual([{ id: "p1", title: "p1", root: "/code/p1" }]);
  expect(link.threads().map((thread) => [thread.id, thread.away])).toEqual([
    ["a", false],
    ["b", true],
  ]);
  expect(changes.at(-1)).toEqual({ t3: { state: "connected" } });
  expect(fake.acks).toBe(fake.chunks);

  changes.length = 0;
  fake.send([
    { kind: "thread.updated", sequence: 11, location: "active", thread: record("a", { status: "running" }) },
    {
      kind: "thread.updated",
      sequence: 12,
      location: "active",
      thread: record("c", { lineage: { parentThreadId: "a" } }),
    },
  ]);
  await until(() => changes.length > 0);
  expect(threadsIn(changes).map((thread) => [thread.id, thread.status, thread.parentId])).toEqual([
    ["a", "running", undefined],
    ["c", "idle", "a"],
  ]);

  // Churn in fields bruv doesn't map, or in updatedAt alone, says nothing but keeps the newest updatedAt.
  changes.length = 0;
  const later = "2026-10-03T00:00:00.000Z";
  fake.send([
    {
      kind: "thread.updated",
      sequence: 13,
      location: "active",
      thread: { ...record("a", { status: "running", updatedAt: later }), itemCount: 99 } as T3Thread,
    },
  ]);
  await until(() => fake.acks === fake.chunks);
  expect(changes).toEqual([]);
  expect(byId(link, "a")?.updatedAt).toBe(later);

  fake.send([
    // Unchanged and stale records say nothing.
    { kind: "thread.updated", sequence: 13.5, location: "active", thread: record("a", { status: "running" }) },
    { kind: "thread.updated", sequence: 5, location: "active", thread: record("a", { status: "failed" }) },
    // A partial snapshot only refreshes git identity; it must not empty the list.
    {
      kind: "snapshot",
      snapshot: { snapshotSequence: 13, threads: [], projects: [project("p1")] },
      resolvedRepositoryIdentityRoots: ["/code/p1"],
    },
    { kind: "thread.updated", sequence: 14, location: "archive", thread: record("b") },
    { kind: "thread.removed", sequence: 15, location: "active", threadId: "c" },
    { kind: "project.updated", sequence: 16, project: project("p2") },
    { kind: "project.removed", sequence: 17, projectId: "p1" },
  ]);
  await until(() => fake.acks === fake.chunks && changes.length > 0);
  expect(changes).toHaveLength(1);
  expect(changes[0]?.projects).toEqual([{ id: "p2", title: "p2", root: "/code/p2" }]);
  expect(threadsIn(changes).map((thread) => [thread.id, thread.away])).toEqual([
    ["b", true],
    ["c", true],
  ]);
  expect(link.threads().map((thread) => [thread.id, thread.status])).toEqual([["a", "running"]]);
});

test("resumes from the last position after T3 drops the socket", async () => {
  const { fake, dir, open } = await setup();
  fake.snapshot.threads = [record("a"), record("b")];
  const { link, changes } = open();
  await until(() => link.state().state === "connected");
  fake.send([{ kind: "thread.updated", sequence: 11, location: "active", thread: record("a", { status: "running" }) }]);
  await until(() => byId(link, "a")?.status === "running");
  // Keys are not read or written again while the link runs.
  rmSync(`${dir}/t3.json`);
  changes.length = 0;
  fake.drop();
  await until(() => link.state().state === "connecting");
  // Missed while away.
  fake.send([
    { kind: "thread.updated", sequence: 12, location: "active", thread: record("a", { status: "completed" }) },
    { kind: "thread.removed", sequence: 13, threadId: "b" },
  ]);
  await until(() => link.state().state === "connected");
  expect(fake.requests.at(-1)?.afterSequence).toBe(11);
  expect(fake.wholeSnapshots).toBe(1);
  expect(fake.pairs).toBe(1);
  expect(threadsIn(changes).map((thread) => [thread.id, thread.status, thread.away])).toEqual([
    ["a", "completed", false],
    ["b", "idle", true],
  ]);
  expect(link.threads().map((thread) => thread.id)).toEqual(["a"]);
  expect(existsSync(`${dir}/t3.json`)).toBe(false);
});

test("loads a whole snapshot when T3 can't resume", async () => {
  const { fake, open } = await setup();
  fake.resumable = false;
  fake.snapshot.threads = [record("a"), record("b")];
  const { link, changes } = open();
  await until(() => link.state().state === "connected");
  changes.length = 0;
  fake.snapshot = { snapshotSequence: 20, threads: [record("a", { status: "completed" })], projects: [project("p1")] };
  fake.drop();
  await until(() => link.state().state === "connecting");
  await until(() => link.state().state === "connected");
  expect(fake.subscribes).toBe(2);
  expect(fake.wholeSnapshots).toBe(2);
  expect(fake.pairs).toBe(1);
  const changed = threadsIn(changes);
  expect(changed.map((thread) => [thread.id, thread.status, thread.away]).sort()).toEqual([
    ["a", "completed", false],
    ["b", "idle", true],
  ]);
  expect(byId(link, "b")).toBeUndefined();
});

test("keeps keys private, reuses them, and signs in again when T3 refuses one", async () => {
  const { fake, dir, open } = await setup();
  const first = open().link;
  await until(() => first.state().state === "connected");
  expect(fake.pairs).toBe(1);
  expect(statSync(`${dir}/t3.json`).mode & 0o777).toBe(0o600);
  first.close();

  const second = open().link;
  await until(() => second.state().state === "connected");
  expect(fake.pairs).toBe(1);

  fake.sessions.clear();
  fake.drop();
  await until(() => fake.subscribes === 3);
  await until(() => second.state().state === "connected");
  expect(fake.pairs).toBe(2);
  const saved = JSON.parse(readFileSync(`${dir}/t3.json`, "utf8"));
  expect(fake.sessions.has(saved.session.token)).toBe(true);
  expect(statSync(`${dir}/t3.json`).mode & 0o777).toBe(0o600);
});

test("gives an MCP key on demand and replaces it once refused", async () => {
  const { fake, open } = await setup();
  const { link } = open();
  const first = await link.mcp();
  expect(first?.url).toBe(`${fake.origin}/mcp`);
  const token = first?.headers.Authorization?.replace("Bearer ", "") ?? "";
  expect(fake.mcpKeys.has(token)).toBe(true);
  await until(() => link.state().state === "connected");
  const pairs = fake.pairs;
  expect(await link.mcp()).toEqual(first);
  expect(fake.pairs).toBe(pairs);

  fake.mcpKeys.clear();
  const next = await link.mcp();
  expect(next?.headers.Authorization).not.toBe(first?.headers.Authorization);
  expect(fake.mcpKeys.has(next?.headers.Authorization?.replace("Bearer ", "") ?? "")).toBe(true);
});

test("is unavailable when T3 is missing or speaks another protocol", async () => {
  const missing = connectT3({ dir: resolve(".tmp/web-t3-missing"), locate: () => undefined });
  cleanup.push(() => missing.close());
  await until(() => missing.state().state === "unavailable");
  expect(missing.threads()).toEqual([] as Thread[]);
  expect(await missing.mcp()).toBeUndefined();

  const { fake, open } = await setup();
  fake.protocol = "3";
  const { link } = open();
  await until(() => link.state().state === "unavailable");
  expect(fake.subscribes).toBe(0);
});
