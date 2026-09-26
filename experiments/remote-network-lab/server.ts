// Deliberately tiny deterministic remote task owner. No model, credentials or arbitrary code.
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
const path = "/data/state.json";
mkdirSync("/data", { recursive: true });
type Event = { v: 1; seq: number; id: string; kind: string; text: string; at: number };
type Task = { id: string; spec: string; status: string; reply?: string };
type State = { v: 1; tasks: Record<string, Task>; events: Event[] };
const state: State = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { v: 1, tasks: {}, events: [] };
if (state.v !== 1) throw Error("unsupported state");
function save() {
  writeFileSync(path + ".tmp", JSON.stringify(state));
  renameSync(path + ".tmp", path);
}
function event(id: string, kind: string, text: string) {
  state.events.push({ v: 1, seq: state.events.length + 1, id, kind, text, at: Date.now() });
  save();
}
// Crash/restart is not job recovery. Explicitly expose unknown, never fabricate completion.
for (const task of Object.values(state.tasks))
  if (task.status === "running") {
    task.status = "unknown";
    event(task.id, "unknown", "owner restarted while task was in flight");
  }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function run(task: Task) {
  await sleep(140);
  if (task.status !== "running") return;
  event(task.id, "progress", "simulated Linux step 1");
  await sleep(160);
  if (task.status !== "running") return;
  if (task.spec === "needs-mac" && !task.reply) {
    task.status = "waiting";
    event(task.id, "question", "request Mac capability: provide demo input (not file sync)");
    return;
  }
  event(task.id, "progress", "simulated Linux step 2");
  await sleep(160);
  if (task.status !== "running") return;
  task.status = "done";
  event(task.id, "done", task.reply ? "simulated result using " + task.reply : "simulated result");
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
Bun.serve({
  hostname: "0.0.0.0",
  port: 8080,
  async fetch(req) {
    try {
      const u = new URL(req.url);
      if (u.pathname === "/payload" && req.method === "GET")
        return new Response("x".repeat(16384), {
          headers: { "content-type": "application/octet-stream", "cache-control": "no-store" },
        });
      if (u.pathname === "/health") return json({ v: 1, ok: true });
      if (u.pathname === "/head") return json({ v: 1, cursor: state.events.length });
      if (u.pathname === "/events" && req.method === "GET") {
        const cursor = Number(u.searchParams.get("cursor") ?? 0),
          limit = Number(u.searchParams.get("limit") ?? 10);
        if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 20)
          return json({ error: "bad page" }, 400);
        if (cursor > state.events.length)
          return json({ error: "cursor ahead of owner; replica needs reconciliation" }, 409);
        const events = state.events.slice(cursor, cursor + limit);
        return json({ v: 1, events, next: cursor + events.length, more: cursor + events.length < state.events.length });
      }
      if (u.pathname === "/launch" && req.method === "POST") {
        const b = await req.json();
        if (
          b.v !== 1 ||
          typeof b.id !== "string" ||
          !/^[-a-zA-Z0-9]{1,64}$/.test(b.id) ||
          !["plain", "needs-mac"].includes(b.spec)
        )
          return json({ error: "bad launch" }, 400);
        const existing = Object.hasOwn(state.tasks, b.id) ? state.tasks[b.id] : undefined;
        if (existing)
          return existing.spec === b.spec
            ? json({ v: 1, id: b.id, status: existing.status, replayed: true })
            : json({ error: "id conflict" }, 409);
        const task: Task = { id: b.id, spec: b.spec, status: "running" };
        state.tasks[b.id] = task;
        event(b.id, "accepted", "simulated " + b.spec + " accepted"); // durable before acceptance response
        void run(task);
        return json({ v: 1, id: b.id, status: "running", replayed: false });
      }
      if (u.pathname === "/reply" && req.method === "POST") {
        const b = await req.json();
        const task = Object.hasOwn(state.tasks, b.id) ? state.tasks[b.id] : undefined;
        if (b.v !== 1 || !task || typeof b.text !== "string" || !/^[a-zA-Z0-9 _-]{1,80}$/.test(b.text))
          return json({ error: "bad reply" }, 400);
        if (task.reply)
          return task.reply === b.text
            ? json({ v: 1, status: task.status, replayed: true })
            : json({ error: "reply conflict" }, 409);
        if (task.status !== "waiting") return json({ error: "not waiting" }, 409);
        task.reply = b.text;
        task.status = "running";
        event(b.id, "answered", "Mac supplied requested demo input");
        void run(task);
        return json({ v: 1, status: "running", replayed: false });
      }
      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  },
});
