import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createConnection, type Socket } from "node:net";
import { afterEach, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import WebSocket from "ws";
import { startWebServer } from "../../src/web/server";
import { TerminalSession, SOCKET_BYTES, type SocketData } from "../../src/web/terminal";

const command = [
  process.execPath,
  "-e",
  'process.stdin.setRawMode(true);console.log("PID",process.pid);process.stdin.on("data",d=>{const text=d.toString().replace(/\\x1b\\]777;bruv-input;[^\\x07]*\\x07/g,"");if(text==="exit")process.exit(7);console.log("INPUT",text)});setInterval(()=>{},1000)',
];
type App = ReturnType<typeof startWebServer>;
const apps: App[] = [];
const sockets: WebSocket[] = [];
const rawSockets: Socket[] = [];
const terminals: TerminalSession[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  for (const socket of rawSockets.splice(0)) socket.destroy();
  await Promise.all([...apps.splice(0).map((app) => app.stop()), ...terminals.splice(0).map((t) => t.stop())]);
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function start(custom = command) {
  const app = startWebServer({
    command: custom,
    assets: { html: "", javascript: "", css: "", font: new Uint8Array(), wasm: new Uint8Array() },
    port: 0,
  });
  apps.push(app);
  return app;
}
async function until(check: () => boolean) {
  const end = Date.now() + 4000;
  while (!check()) {
    if (Date.now() > end) throw new Error("Timed out");
    await Bun.sleep(10);
  }
}
function request(app: App, path = "/api/workspaces", method = "GET", body?: object) {
  return fetch(app.origin + path, {
    method,
    headers: {
      Authorization: "Bearer " + app.token,
      ...(method !== "GET" ? { Origin: app.origin } : {}),
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function state(app: App) {
  return (await request(app)).json();
}
async function mutate(app: App, path: string, method: string, body: object) {
  const response = await request(app, path, method, body);
  expect(response.status).toBe(200);
  return response.json();
}
function connect(app: App, path = "/api/terminal", protocol = "bruv", extra: string[] = []) {
  const socket = new WebSocket(
    app.origin.replace(/^http/, "ws") + path,
    [protocol, "bruv-token." + app.token, ...extra],
    { headers: { Origin: app.origin } },
  );
  sockets.push(socket);
  socket.on("error", () => {});
  const messages: any[] = [];
  socket.on("message", (data) => messages.push(JSON.parse(String(data))));
  const status = new Promise<number>((resolve) => {
    socket.once("open", () => resolve(101));
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve(response.statusCode!);
    });
  });
  return {
    socket,
    messages,
    status,
    send: (message: object) => socket.send(JSON.stringify(message)),
    owner: () => messages.find((m) => m.type === "audio-owner")?.id as string,
    ownerId: () => messages.find((m) => m.type === "audio-owner")?.ownerId as string,
    text: () =>
      messages
        .filter((m) => m.type === "output")
        .map((m) => Buffer.from(m.data, "base64").toString())
        .join(""),
    latest: () => messages.filter((m) => m.type === "state").at(-1)?.state,
  };
}
function audio(app: App, owner: string, request = "") {
  return connect(app, "/api/live/audio?role=browser&session=terminal&request=" + request, "bruv-audio", [
    "bruv-owner." + owner,
  ]);
}

test("same tab shares PID, live output and both users' input; observer rejoin never evicts", async () => {
  const app = start();
  const first = connect(app);
  await until(() => first.text().includes("PID"));
  const pid = app.terminal.pid;
  const second = connect(app);
  await until(() => !!second.owner() && second.text().includes("PID"));
  expect(second.owner()).not.toBe(first.owner());
  expect(app.terminal.pid).toBe(pid);
  expect(first.socket.readyState).toBe(WebSocket.OPEN);
  first.send({ type: "input", data: "first" });
  second.send({ type: "input", data: "second" });
  await until(() => [first, second].every((c) => c.text().includes("first") && c.text().includes("second")));
  expect(first.messages.filter((m) => m.type === "output")).toEqual(second.messages.filter((m) => m.type === "output"));
  const cursor = second.messages.filter((m) => m.type === "output").at(-1).seq;
  second.socket.close();
  await until(() => second.socket.readyState === WebSocket.CLOSED);
  first.send({ type: "input", data: "while-away" });
  await until(() => first.text().includes("while-away"));
  const rejoined = connect(app, "/api/terminal?after=" + cursor);
  await until(() => rejoined.text().includes("while-away"));
  expect(rejoined.text()).not.toContain("PID");
  expect(rejoined.owner()).not.toBe(second.owner());
  expect(first.socket.readyState).toBe(WebSocket.OPEN);
  expect(app.terminal.pid).toBe(pid);
});

test("events and REST share ordered complete snapshots for concurrent mutations, PID and exit", async () => {
  const app = start();
  const events = connect(app, "/api/events", "bruv-state");
  await until(() => !!events.latest());
  expect(events.socket.protocol).toBe("bruv-state");
  expect(events.latest()).toEqual(await state(app));
  expect(events.latest().voice).toBeNull();
  const initial = events.latest().revision;
  const created = await Promise.all(
    Array.from({ length: 8 }, (_, i) => mutate(app, "/api/workspaces/workspace/tabs", "POST", { name: "Tab " + i })),
  );
  const revisions = created.map((s) => s.revision).sort((a, b) => a - b);
  expect(revisions).toEqual(Array.from({ length: 8 }, (_, i) => initial + i + 1));
  await until(() => events.latest().revision === initial + 8);
  expect(events.messages.map((m) => m.state.revision)).toEqual(Array.from({ length: 9 }, (_, i) => initial + i));
  expect(events.latest()).toEqual(await state(app));
  const id = created[0].workspaces[0].tabs.find((t: any) => t.name === "Tab 0").id;
  const renamed = await mutate(app, "/api/tabs/" + id, "PATCH", { name: "Shared name" });
  await until(() => events.latest().revision === renamed.revision);
  expect(events.latest()).toEqual(renamed);
  const client = connect(app);
  await until(() => !!events.latest().workspaces[0].tabs[0].pid);
  expect(events.latest().workspaces[0].tabs[0].pid).toBe(app.terminal.pid);
  await until(() => !!client.owner());
  client.send({ type: "input", data: "exit" });
  await until(() => events.latest().workspaces[0].tabs[0].exited === true);
  expect(events.latest()).toEqual(await state(app));
  client.send({ type: "resize", cols: 96, rows: 32 });
  await until(() => app.terminal.cols === 96);
  await Bun.sleep(20);
  expect(client.socket.readyState).toBe(WebSocket.OPEN);
  const cwd = mkdtempSync(join(tmpdir(), "bruv-multiplayer-"));
  directories.push(cwd);
  const workspace = await mutate(app, "/api/workspaces", "POST", { cwd, name: "Other" });
  await until(() => events.latest().revision === workspace.revision);
  const otherId = workspace.workspaces[1].id;
  const deletedTab = await mutate(app, "/api/tabs/" + id, "DELETE", { confirm: true });
  await until(() => events.latest().revision === deletedTab.revision);
  expect(events.latest()).toEqual(deletedTab);
  const deletedWorkspace = await mutate(app, "/api/workspaces/" + otherId, "DELETE", { confirm: true });
  await until(() => events.latest().revision === deletedWorkspace.revision);
  expect(events.latest()).toEqual(deletedWorkspace);
  const all = events.messages.map((m) => m.state.revision);
  expect(all.every((revision, i) => i === 0 || revision > all[i - 1])).toBe(true);
  const joined = connect(app, "/api/events", "bruv-state");
  await until(() => !!joined.latest());
  expect(joined.latest()).toEqual(deletedWorkspace);
});

test("state socket needs token, exact Origin/Host and bruv-state protocol", async () => {
  const app = start();
  async function rejected(headers: Record<string, string>, protocols: string[]) {
    const socket = new WebSocket(app.origin.replace(/^http/, "ws") + "/api/events", protocols, { headers });
    sockets.push(socket);
    socket.on("error", () => {});
    return new Promise<number>((resolve) =>
      socket.once("unexpected-response", (_req, response) => {
        response.resume();
        resolve(response.statusCode!);
      }),
    );
  }
  const protocols = ["bruv-state", "bruv-token." + app.token];
  expect(await rejected({}, protocols)).toBe(403);
  expect(await rejected({ Origin: "http://evil.example" }, protocols)).toBe(403);
  expect(await rejected({ Origin: app.origin, Host: "evil.example" }, protocols)).toBe(403);
  expect(await rejected({ Origin: app.origin }, ["bruv-state", "bruv-token.wrong"])).toBe(403);
  expect(await rejected({ Origin: app.origin }, ["bruv", "bruv-token." + app.token])).toBe(400);
});

test("shared size is the minimum active viewport; inactive joins and empty views retain size", async () => {
  // A pong follows earlier frames on this socket, including resize and visibility.
  const settled = (socket: WebSocket) =>
    new Promise<void>((resolve) => {
      socket.once("pong", () => resolve());
      socket.ping();
    });
  const app = start();
  const first = connect(app);
  const second = connect(app);
  await until(() => !!first.owner() && !!second.owner());
  first.send({ type: "resize", cols: 120, rows: 40 });
  await until(() => app.terminal.cols === 120);
  expect(app.terminal.rows).toBe(40);
  second.send({ type: "resize", cols: 90, rows: 50 });
  await until(() => app.terminal.cols === 90);
  expect(app.terminal.rows).toBe(40);
  await until(() =>
    [first, second].every((c) => c.messages.some((m) => m.type === "size" && m.cols === 90 && m.rows === 40)),
  );
  const third = connect(app);
  await until(() => !!third.owner());
  expect(third.messages[0]).toEqual({ type: "ready", cols: 90, rows: 40 });
  expect(app.terminal.cols).toBe(90);
  second.send({ type: "visibility", active: false });
  await until(() => app.terminal.cols === 120);
  first.send({ type: "visibility", active: false });
  await settled(first.socket);
  expect([app.terminal.cols, app.terminal.rows]).toEqual([120, 40]);
  third.send({ type: "resize", cols: 100, rows: 30 });
  await until(() => app.terminal.cols === 100);
  second.send({ type: "resize", cols: 80, rows: 35 });
  await until(() => app.terminal.cols === 80);
  expect(app.terminal.rows).toBe(30);
  await settled(second.socket);
  const count = second.messages.filter((m) => m.type === "size").length;
  second.send({ type: "resize", cols: 80, rows: 35 });
  await settled(second.socket);
  expect(second.messages.filter((m) => m.type === "size")).toHaveLength(count);
  second.socket.close();
  await until(() => app.terminal.cols === 100);
  third.send({ type: "resize", cols: 0, rows: 0 });
  await until(() => third.socket.readyState === WebSocket.CLOSED);
  expect([app.terminal.cols, app.terminal.rows]).toEqual([100, 30]);
  expect(first.socket.readyState).toBe(WebSocket.OPEN);
});

test("voice follows its command owner; A survives observer joins/leaves, fresh request admits B", async () => {
  const app = start([process.execPath, resolve(import.meta.dir, "fixtures/command-audio-cli.ts")]);
  const events = connect(app, "/api/events", "bruv-state");
  const first = connect(app);
  const second = connect(app);
  await until(() => !!first.owner() && !!second.owner());
  await until(() => first.text().includes("AUDIO_FIXTURE_READY"));
  first.send({ type: "input", data: "/live\r" });
  await until(() => first.messages.some((m) => m.type === "audio-request"));
  const firstRequest = first.messages.find((m) => m.type === "audio-request").request;
  expect(second.messages.some((m) => m.type === "audio-request")).toBe(false);
  const firstAudio = audio(app, first.owner(), firstRequest);
  firstAudio.socket.on("message", (raw) => {
    if (JSON.parse(String(raw)).type === "start") firstAudio.send({ type: "ready" });
  });
  expect(await firstAudio.status).toBe(101);
  await until(() => first.text().includes("AUDIO_RUNNING"));
  await until(() => events.latest()?.voice?.ownerId === first.ownerId());
  expect((await state(app)).voice).toEqual({ tabId: "terminal", ownerId: first.ownerId() });
  expect(await audio(app, second.owner(), firstRequest).status).toBe(403);
  second.socket.close();
  await until(() => second.socket.readyState === WebSocket.CLOSED);
  expect(firstAudio.socket.readyState).toBe(WebSocket.OPEN);
  const observer = connect(app);
  await until(() => !!observer.owner());
  expect(firstAudio.socket.readyState).toBe(WebSocket.OPEN);
  expect((await state(app)).voice.ownerId).toBe(first.ownerId());
  expect(JSON.stringify(await state(app))).not.toContain(first.owner());
  expect(await audio(app, first.ownerId()).status).toBe(403);
  expect(await audio(app, second.owner()).status).toBe(403);
  const pid = app.terminal.pid;
  firstAudio.socket.close();
  await until(() => events.latest()?.voice === null);
  expect(first.socket.readyState).toBe(WebSocket.OPEN);
  observer.send({ type: "input", data: "/live\r" });
  await until(() => observer.messages.some((m) => m.type === "audio-request"));
  const nextRequest = observer.messages.find((m) => m.type === "audio-request").request;
  const nextAudio = audio(app, observer.owner(), nextRequest);
  expect(await nextAudio.status).toBe(101);
  await until(() => events.latest()?.voice?.ownerId === observer.ownerId());
  // A's attachment loss must not stop B's new voice ownership.
  first.socket.close();
  await until(() => first.socket.readyState === WebSocket.CLOSED);
  expect(nextAudio.socket.readyState).toBe(WebSocket.OPEN);
  expect(await audio(app, first.owner()).status).toBe(403);
  observer.socket.close();
  await until(() => nextAudio.socket.readyState === WebSocket.CLOSED && events.latest()?.voice === null);
  expect(app.terminal.pid).toBe(pid);
  expect(events.latest()).toEqual(await state(app));
});

test("a slow client's bounded backlog drops only that socket and replay is private to its join", async () => {
  const terminal = new TerminalSession(command, process.cwd());
  terminals.push(terminal);
  function fake(owner: string) {
    let backlog = 0;
    const messages: any[] = [];
    const socket = {
      data: { channel: "terminal", audioOwner: owner },
      readyState: 1,
      getBufferedAmount: () => backlog,
      send: (raw: string) => {
        messages.push(JSON.parse(raw));
        return raw.length;
      },
      close: () => {
        socket.readyState = 3;
      },
    };
    return {
      socket: socket as unknown as ServerWebSocket<SocketData>,
      messages,
      slow: () => {
        backlog = SOCKET_BYTES;
      },
    };
  }
  const first = fake("fast");
  const second = fake("slow");
  expect(terminal.attach(first.socket)).toBe(true);
  await until(() => first.messages.some((m) => m.type === "output"));
  const before = first.messages.length;
  expect(terminal.attach(second.socket)).toBe(true);
  expect(second.messages[0].type).toBe("ready");
  expect(second.messages.some((m) => m.type === "output")).toBe(true);
  expect(first.messages).toHaveLength(before);
  const pid = terminal.pid;
  second.slow();
  terminal.message(first.socket, JSON.stringify({ type: "input", data: "healthy" }));
  await until(() =>
    first.messages.some((m) => m.type === "output" && Buffer.from(m.data, "base64").toString().includes("healthy")),
  );
  expect(second.socket.readyState).toBe(3);
  expect(first.socket.readyState).toBe(1);
  expect(terminal.hasOwner("slow")).toBe(false);
  terminal.detach(second.socket);
  const rejoined = fake("rejoined");
  expect(terminal.attach(rejoined.socket)).toBe(true);
  expect(
    rejoined.messages.some((m) => m.type === "output" && Buffer.from(m.data, "base64").toString().includes("healthy")),
  ).toBe(true);
  expect(terminal.pid).toBe(pid);
});

test("native backpressure closes a paused observer without stopping the healthy view or PTY", async () => {
  const app = start([
    process.execPath,
    "-e",
    'process.stdin.setRawMode(true);console.log("RUNNING");process.stdin.on("data",d=>{const text=d.toString().replace(/\\x1b\\]777;bruv-input;[^\\x07]*\\x07/g,"");if(text==="flood"){let left=128;const t=setInterval(()=>{process.stdout.write("x".repeat(65536));if(!--left){clearInterval(t);console.log("END")}},3)}else console.log("INPUT",text)});setInterval(()=>{},1000)',
  ]);
  const healthy = connect(app);
  await until(() => !!healthy.owner());
  const network = createConnection({ host: "127.0.0.1", port: app.server.port! });
  rawSockets.push(network);
  let closed = false;
  network.on("close", () => {
    closed = true;
  });
  network.on("error", () => {});
  const upgraded = new Promise<void>((resolve) =>
    network.once("data", (data) => {
      expect(data.toString()).toContain("HTTP/1.1 101");
      network.pause();
      resolve();
    }),
  );
  network.once("connect", () =>
    network.write(
      [
        "GET /api/terminal HTTP/1.1",
        "Host: " + new URL(app.origin).host,
        "Origin: " + app.origin,
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Version: 13",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Protocol: bruv, bruv-token." + app.token,
        "",
        "",
      ].join("\r\n"),
    ),
  );
  await upgraded;
  const pid = app.terminal.pid;
  healthy.send({ type: "input", data: "flood" });
  await until(() => healthy.text().includes("END"));
  expect(healthy.socket.readyState).toBe(WebSocket.OPEN);
  expect(app.terminal.pid).toBe(pid);
  network.resume();
  await until(() => closed);
  const cursor = healthy.messages.filter((m) => m.type === "output").at(-1).seq;
  const rejoined = connect(app, "/api/terminal?after=" + cursor);
  await until(() => !!rejoined.owner());
  rejoined.send({ type: "input", data: "after-backlog" });
  await until(() => healthy.text().includes("after-backlog") && rejoined.text().includes("after-backlog"));
  expect(app.terminal.pid).toBe(pid);
});
