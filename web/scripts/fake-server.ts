/**
 * A stand-in for bruv's web server, to look at the page without Pi or T3: it serves the page through
 * `pageAssets` (built, or Vite with `--dev`) and plays a made-up conversation and T3 threads.
 *
 *   node web/scripts/fake-server.ts [--dev] [--port 7901] [--lines 3000] [--ignore-respond] [--slow-say]
 *
 * `--ignore-respond` drops the page's answers to permission requests, to see the page take its guess back;
 * `--slow-say` sends the user's line back only after 20 s, longer than the page waits.
 *
 * Runs under Node, as Pi does. The page is at http://localhost:<port>/?t=test.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { parseArgs } from "node:util";
import { WebSocket, WebSocketServer } from "ws";
import { pageAssets } from "../../src/web/assets.ts";
import type { Line, PageEvent, Project, ServerEvent, T3State, Thread } from "../../src/web/protocol.ts";

const { values } = parseArgs({
  options: {
    dev: { type: "boolean", default: false },
    port: { type: "string", default: "7901" },
    lines: { type: "string", default: "3000" },
    quiet: { type: "boolean", default: false },
    "ignore-respond": { type: "boolean", default: false },
    "slow-say": { type: "boolean", default: false },
  },
});
const key = "test";
const start = Date.now();
const ago = (minutes: number) => new Date(start - minutes * 60_000).toISOString();

const words =
  "the build passed and the branch is ready for review while the tests on the api side still need one more look before merge".split(
    " ",
  );
const sentence = (seed: number, length: number) =>
  Array.from({ length }, (_, i) => words[(seed * 7 + i * 3) % words.length]).join(" ");

const replies = [
  "Started **two threads** for that:\n\n- *Fix the login redirect* in `web-app`, on a new branch\n- *Add rate limits* to the API\n\nI'll tell you when either needs you.",
  "The payments thread finished. It changed `charge.ts` and added tests; nothing needs you there. Want me to open a PR?",
  "Here's where things stand:\n\n| Work | State |\n|---|---|\n| Login redirect | waiting on you |\n| Rate limits | running |\n| Docs | done |",
];

let history: Line[] = Array.from({ length: Number(values.lines) }, (_, i) => {
  const minutes = Number(values.lines) - i;
  const role: Line["role"] = i % 9 === 4 ? "wake" : i % 13 === 7 ? "note" : i % 2 ? "assistant" : "user";
  const text =
    role === "user"
      ? `${i}: ${sentence(i, 6 + (i % 10))}?`
      : role === "assistant"
        ? i % 5 === 1
          ? (replies[i % replies.length] as string)
          : `${i}: ${sentence(i, 12 + (i % 40))}.`
        : role === "wake"
          ? "Checked on 3 threads; nothing new."
          : `Read ${i % 4} threads, started a thread\n${sentence(i, 30)}`;
  return { id: `l${i}`, role, text, at: ago(minutes) };
});

const projects: Project[] = [
  { id: "p1", title: "web-app", root: "/code/web-app" },
  { id: "p2", title: "api", root: "/code/api" },
  { id: "p3", title: "bruv", root: "/code/bruv" },
];
const statuses = ["running", "completed", "completed", "idle", "waiting", "queued", "failed", "completed"];
const threads: Thread[] = Array.from({ length: 260 }, (_, i) => {
  const status = statuses[i % statuses.length] as string;
  const minutes = i < 20 ? i * 7 : 60 * 24 * (1 + i / 20);
  return {
    id: `t${i}`,
    projectId: `p${(i % 3) + 1}`,
    title: [
      "Fix the login redirect loop",
      "Add rate limits to the public API",
      "Write docs for the new settings page",
      "Bump React to 19.3",
    ][i % 4] as string,
    status,
    needsUser: i === 4 || i === 12,
    ...(i === 4 || i === 12 ? { requestId: `r${i}`, requestKind: "command" } : {}),
    lastMessage: sentence(i, 18),
    lastError: status === "failed" ? "Tests failed: 3 of 212 in auth.test.ts" : undefined,
    branch: `fix/thing-${i}`,
    finishedAt: status === "completed" ? ago(minutes) : undefined,
    visitedAt: status === "completed" && i % 3 ? ago(minutes + 5) : ago(minutes - 1),
    pinned: false,
    away: i % 11 === 10,
    createdAt: ago(minutes + 90),
    updatedAt: ago(minutes),
  };
});
let t3: T3State = { state: "connecting" };
let busy = false;
let stream: ReturnType<typeof setInterval> | undefined;
let count = history.length;
const pictures = new Map<string, Buffer>();

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://x");
  if (url.pathname === "/") {
    if (url.searchParams.get("t") !== key) return void response.writeHead(404).end();
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(await assets.index(request.url ?? "/"));
    return;
  }
  const picture = pictures.get(url.pathname);
  if (picture) {
    response.writeHead(200, { "content-type": "image/webp", "cache-control": "public, max-age=31536000, immutable" });
    response.end(picture);
    return;
  }
  if (await assets.handle(request, response)) return;
  response.writeHead(404).end();
});
const sockets = new WebSocketServer({ noServer: true, maxPayload: 32 << 20 });
server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", "http://x");
  if (url.pathname !== "/socket") return;
  if (url.searchParams.get("t") !== key) return void socket.destroy();
  sockets.handleUpgrade(request, socket, head, (ws) => {
    const say = (event: ServerEvent) => ws.send(JSON.stringify(event));
    say({ type: "hello", lines: history.slice(-50), more: history.length > 50, busy, t3, projects, threads });
    ws.on("message", (data) => onPage(JSON.parse(String(data)) as PageEvent, say));
  });
});
const assets = await pageAssets({ dev: values.dev, server });

const all = (event: ServerEvent) => {
  const text = JSON.stringify(event);
  for (const ws of sockets.clients) if (ws.readyState === WebSocket.OPEN) ws.send(text);
};
const add = (line: Line) => {
  history = [...history, line];
  all({ type: "line", line });
};

function reply(text: string) {
  const id = `l${count++}`;
  const line: Line = { id, role: "assistant", text: "", at: new Date().toISOString(), partial: true };
  add(line);
  const parts = text.match(/\S+\s*/g) ?? [];
  let at = 0;
  stream = setInterval(() => {
    const part = parts[at++];
    if (part !== undefined) {
      line.text += part;
      all({ type: "append", id, text: part });
      return;
    }
    clearInterval(stream);
    stream = undefined;
    line.partial = false;
    all({ type: "line", line: { ...line } });
    busy = false;
    all({ type: "busy", busy });
  }, 45);
}

function onPage(event: PageEvent, say: (event: ServerEvent) => void) {
  if (event.type === "more") {
    const index = history.findIndex((line) => line.id === event.before);
    const from = Math.max(0, index - 50);
    say({ type: "older", lines: index > 0 ? history.slice(from, index) : [], more: from > 0 });
  }
  if (event.type === "say") {
    const images = (event.images ?? []).map((url) => {
      const path = `/img/${pictures.size}`;
      pictures.set(path, Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
      return path;
    });
    // The line goes back under the page's id, as bruv's server does, so the page shows it once.
    const id = event.id && /^[\w-]{1,64}$/.test(event.id) ? event.id : `l${count++}`;
    const echo = () => add({ id, role: "user", text: event.text, images, at: new Date().toISOString() });
    if (values["slow-say"]) setTimeout(echo, 20_000);
    else echo();
    busy = true;
    all({ type: "busy", busy });
    setTimeout(() => reply(replies[count % replies.length] as string), 600);
  }
  if (event.type === "respond" && !values["ignore-respond"]) {
    const thread = threads.find((each) => each.id === event.threadId);
    if (!thread?.requestId) return;
    // T3 takes a moment to pass the answer on.
    setTimeout(() => {
      thread.needsUser = false;
      thread.requestId = undefined;
      thread.requestKind = undefined;
      thread.status = event.decision === "decline" ? "interrupted" : "running";
      thread.updatedAt = new Date().toISOString();
      all({ type: "threads", threads: [thread] });
    }, 400);
  }
  if (event.type === "stop" && stream) {
    clearInterval(stream);
    stream = undefined;
    busy = false;
    all({ type: "busy", busy });
  }
}

setTimeout(() => {
  t3 = { state: "connected" };
  all({ type: "t3", t3 });
}, 1500);
// Threads change now and then, only the changed ones sent.
setInterval(() => {
  const thread = threads[Math.floor(Math.random() * 20)] as Thread;
  thread.status = thread.status === "running" ? "completed" : "running";
  thread.updatedAt = new Date().toISOString();
  if (thread.status === "completed") thread.finishedAt = thread.updatedAt;
  all({ type: "threads", threads: [thread] });
}, 4000);

server.listen(Number(values.port), "127.0.0.1", () => {
  const { port } = server.address() as AddressInfo;
  if (!values.quiet) console.log(`http://localhost:${port}/?t=${key}${values.dev ? " (dev)" : ""}`);
});
