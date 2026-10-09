import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "bun:test";
import WebSocket from "ws";
import type { ServerWebSocket } from "bun";
import { createAudioRelay, type AudioRelayData } from "../../src/web/audio-relay";
import { startWebServer } from "../../src/web/server";

const assets = { html: "terminal", javascript: "", css: "" };
const command = [
  process.execPath,
  "-e",
  `
  process.stdin.setRawMode(true);
  console.log("META " + JSON.stringify({cwd:process.cwd(),pid:process.pid,url:process.env.BRUV_LIVE_RELAY_URL,secret:process.env.BRUV_LIVE_RELAY_SECRET}));
  process.stdin.on("data",d=>{if(d.toString()==="exit")process.exit(7);console.log("INPUT",d.toString())});
  setInterval(()=>{},1000);
`,
];
type App = ReturnType<typeof startWebServer>;
type State = {
  defaultCwd: string;
  workspaces: {
    id: string;
    name: string;
    cwd: string;
    tabs: { id: string; name: string; pid?: number; exited?: boolean }[];
  }[];
};
const apps: App[] = [];
const sockets: WebSocket[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.all(apps.splice(0).map((app) => app.stop()));
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function directory() {
  const cwd = mkdtempSync(join(tmpdir(), "bruv-multiplexer-"));
  directories.push(cwd);
  return cwd;
}
function start(extra: Partial<Parameters<typeof startWebServer>[0]> = {}) {
  const app = startWebServer({ command, assets, port: 0, ...extra });
  apps.push(app);
  return app;
}
async function until(check: () => boolean) {
  const end = Date.now() + 5000;
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
async function state(app: App): Promise<State> {
  return (await request(app)).json();
}
async function mutate(app: App, path: string, method: string, body: object): Promise<State> {
  const result = await request(app, path, method, body);
  expect(result.status).toBe(200);
  return result.json();
}
function connect(app: App, tab = "terminal", after = 0) {
  const socket = new WebSocket(
    app.origin.replace(/^http/, "ws") + "/api/terminal?tab=" + tab + "&after=" + after,
    ["bruv", "bruv-token." + app.token],
    { headers: { Origin: app.origin } },
  );
  sockets.push(socket);
  const messages: any[] = [];
  socket.on("message", (data) => messages.push(JSON.parse(String(data))));
  const text = () =>
    messages
      .filter((m) => m.type === "output")
      .map((m) => Buffer.from(m.data, "base64").toString())
      .join("");
  return {
    socket,
    messages,
    text,
    owner: () => messages.find((m) => m.type === "audio-owner")?.id as string,
    meta: () => JSON.parse(text().match(/META (.*)\r?\n/)![1]!),
  };
}
function audio(app: App, tab: string, owner: string) {
  const socket = new WebSocket(
    app.origin.replace(/^http/, "ws") + "/api/live/audio?role=browser&session=" + tab,
    ["bruv-audio", "bruv-token." + app.token, "bruv-owner." + owner],
    { headers: { Origin: app.origin } },
  );
  sockets.push(socket);
  socket.on("error", () => {});
  socket.on("message", (raw) => {
    if (JSON.parse(String(raw)).type === "start") socket.send('{"type":"ready"}');
  });
  const status = new Promise<number>((resolve) => {
    socket.on("open", () => resolve(101));
    socket.on("unexpected-response", (_request, response) => {
      response.resume();
      resolve(response.statusCode!);
      socket.terminate();
    });
  });
  return { socket, status };
}

test("REST GET uses bearer auth without Origin; mutations and sockets require exact Origin", async () => {
  const app = start();
  const auth = { Authorization: "Bearer " + app.token };
  expect((await request(app)).status).toBe(200);
  for (const headers of [
    {},
    { Authorization: "Bearer wrong" },
    { Authorization: app.token },
    { ...auth, Origin: "http://evil.example" },
    { ...auth, Host: "evil.example" },
    { "Sec-WebSocket-Protocol": "bruv-token." + app.token },
  ] as Record<string, string>[]) {
    expect((await fetch(app.origin + "/api/workspaces", { headers })).status).toBe(403);
  }
  expect((await fetch(app.origin + "/api/workspaces?token=" + app.token)).status).toBe(403);
  for (const headers of [auth, { ...auth, Origin: "http://evil.example" }]) {
    expect((await fetch(app.origin + "/api/workspaces", { method: "POST", headers, body: "{}" })).status).toBe(403);
  }
  expect((await fetch(app.origin + "/api/terminal", { headers: auth })).status).toBe(403);
  expect((await request(app, "/api/tabs/terminal", "DELETE", {})).status).toBe(400);
  expect((await request(app, "/api/workspaces/workspace", "DELETE", { confirm: "true" })).status).toBe(400);
  expect((await request(app, "/api/workspaces", "POST", { cwd: join(directory(), "missing") })).status).toBe(400);
  expect((await request(app, "/api/workspaces", "POST", { cwd: import.meta.path })).status).toBe(400);
  expect((await state(app)).workspaces).toHaveLength(1);
  expect(app.terminal.pid).toBeUndefined();
});

test("tabs have their own cwd, PID, input, replay and launch credentials; reconnect never restarts", async () => {
  const cwd = directory();
  const otherCwd = directory();
  const app = start({ cwd });
  let current = await mutate(app, "/api/workspaces", "POST", { cwd: otherCwd, name: "Other" });
  const workspace = current.workspaces[1]!;
  const otherId = workspace.tabs[0]!.id;
  expect(workspace.cwd).toBe(otherCwd);
  expect(workspace.name).toBe("Other");
  current = await mutate(app, "/api/workspaces/workspace/tabs", "POST", { name: "Second" });
  const secondId = current.workspaces[0]!.tabs[1]!.id;
  expect(current.workspaces.flatMap((w) => w.tabs).every((t) => t.pid === undefined)).toBe(true);
  const first = connect(app);
  const second = connect(app, secondId);
  const other = connect(app, otherId);
  await until(() => [first, second, other].every((c) => c.text().includes("META")));
  const metadata = [first, second, other].map((c) => c.meta());
  expect(metadata.map((m) => m.cwd)).toEqual([cwd, cwd, otherCwd]);
  expect(new Set(metadata.map((m) => m.pid)).size).toBe(3);
  expect(new Set(metadata.map((m) => m.secret)).size).toBe(3);
  expect(metadata.map((m) => new URL(m.url).searchParams.get("session"))).toEqual(["terminal", secondId, otherId]);
  const wrongSecret = new WebSocket(metadata[1].url);
  sockets.push(wrongSecret);
  let closeCode: number | undefined;
  wrongSecret.on("open", () => wrongSecret.send(JSON.stringify({ type: "hello", secret: metadata[0].secret })));
  wrongSecret.on("close", (code) => {
    closeCode = code;
  });
  await until(() => wrongSecret.readyState === WebSocket.CLOSED);
  expect(closeCode).toBe(1008);
  expect(app.terminal.pid).toBe(metadata[0].pid);
  expect((await state(app)).workspaces[0]!.tabs[1]!.pid).toBe(metadata[1].pid);
  first.socket.send(JSON.stringify({ type: "input", data: "one-only" }));
  second.socket.send(JSON.stringify({ type: "input", data: "two-only" }));
  await until(() => first.text().includes("INPUT one-only") && second.text().includes("INPUT two-only"));
  expect(first.text()).not.toContain("two-only");
  expect(other.text()).not.toContain("one-only");
  first.socket.close();
  await until(() => first.socket.readyState === WebSocket.CLOSED);
  const resumed = connect(app);
  await until(() => resumed.text().includes("INPUT one-only"));
  expect(resumed.meta().pid).toBe(metadata[0].pid);
  const cursor = resumed.messages.filter((m) => m.type === "output").at(-1).seq;
  resumed.socket.close();
  await until(() => resumed.socket.readyState === WebSocket.CLOSED);
  const incremental = connect(app, "terminal", cursor);
  await until(() => !!incremental.owner());
  expect(incremental.text()).toBe("");
  current = await mutate(app, "/api/tabs/" + secondId, "PATCH", { name: "Renamed" });
  expect(current.workspaces[0]!.tabs[1]!.name).toBe("Renamed");
  second.socket.send(JSON.stringify({ type: "input", data: "exit" }));
  await until(() => second.messages.some((m) => m.type === "exit" && m.code === 7));
  expect((await state(app)).workspaces[0]!.tabs[1]!.exited).toBe(true);
  current = await mutate(app, "/api/tabs/" + secondId, "DELETE", { confirm: true });
  expect(current.workspaces[0]!.tabs).toHaveLength(1);
  expect(() => process.kill(metadata[1].pid, 0)).toThrow();
  expect(
    (
      await fetch(app.origin + "/api/terminal?tab=" + secondId, {
        headers: { Authorization: "Bearer " + app.token, Origin: app.origin },
      })
    ).status,
  ).toBe(404);
  current = await mutate(app, "/api/workspaces/" + workspace.id, "DELETE", { confirm: true });
  expect(current.workspaces).toHaveLength(1);
  expect(() => process.kill(metadata[2].pid, 0)).toThrow();
  expect(() => process.kill(metadata[0].pid, 0)).not.toThrow();
  current = await mutate(app, "/api/workspaces", "POST", {});
  expect(current.workspaces[1]!.cwd).toBe(cwd);
  expect(current.workspaces[1]!.tabs).toHaveLength(1);
});

test("audio admission is global across live PTYs, and audio close frees only that owner", async () => {
  const app = start({ command: [process.execPath, resolve(import.meta.dir, "fixtures/audio-cli.ts")] });
  const current = await mutate(app, "/api/workspaces/workspace/tabs", "POST", {});
  const id = current.workspaces[0]!.tabs[1]!.id;
  const first = connect(app);
  const second = connect(app, id);
  await until(() => !!first.owner() && !!second.owner());
  const attempts = [audio(app, "terminal", first.owner()), audio(app, id, second.owner())];
  const statuses = await Promise.all(attempts.map((a) => a.status));
  expect([...statuses].sort()).toEqual([101, 409]);
  const winner = statuses.indexOf(101);
  const loser = 1 - winner;
  const terminals = [first, second];
  const ids = ["terminal", id];
  await until(() => terminals[winner]!.text().includes("AUDIO_RUNNING"));
  const pids = (await state(app)).workspaces[0]!.tabs.map((t) => t.pid);
  attempts[winner]!.socket.close();
  await until(() => attempts[winner]!.socket.readyState === WebSocket.CLOSED);
  const next = audio(app, ids[loser]!, terminals[loser]!.owner());
  expect(await next.status).toBe(101);
  await until(() => terminals[loser]!.text().includes("AUDIO_RUNNING"));
  // Closing an unrelated terminal cannot give away the current tab's voice.
  terminals[winner]!.socket.close();
  await until(() => terminals[winner]!.socket.readyState === WebSocket.CLOSED);
  const reattached = connect(app, ids[winner]!);
  await until(() => !!reattached.owner());
  expect(await audio(app, ids[winner]!, reattached.owner()).status).toBe(409);
  expect((await state(app)).workspaces[0]!.tabs.map((t) => t.pid)).toEqual(pids);
});

for (const mode of ["disconnect", "replace", "delete", "delete-workspace"] as const) {
  test("audio owner releases on terminal " + mode + "; stale capabilities stay rejected", async () => {
    const app = start({ command: [process.execPath, resolve(import.meta.dir, "fixtures/audio-cli.ts")] });
    const current = await mutate(app, "/api/workspaces", "POST", {});
    const workspace = current.workspaces[1]!;
    const id = workspace.tabs[0]!.id;
    const first = connect(app);
    const second = connect(app, id);
    await until(() => !!first.owner() && !!second.owner());
    const oldOwner = first.owner();
    const activeAudio = audio(app, "terminal", oldOwner);
    expect(await activeAudio.status).toBe(101);
    await until(() => first.text().includes("AUDIO_RUNNING"));
    const pid = app.terminal.pid!;
    if (mode === "disconnect") first.socket.close();
    if (mode === "replace") {
      const replacement = connect(app);
      await until(() => !!replacement.owner());
    }
    if (mode === "delete") await mutate(app, "/api/tabs/terminal", "DELETE", { confirm: true });
    if (mode === "delete-workspace") await mutate(app, "/api/workspaces/workspace", "DELETE", { confirm: true });
    await until(() => activeAudio.socket.readyState === WebSocket.CLOSED);
    expect(await audio(app, "terminal", oldOwner).status).toBe(403);
    const nextAudio = audio(app, id, second.owner());
    expect(await nextAudio.status).toBe(101);
    await until(() => second.text().includes("AUDIO_RUNNING"));
    if (mode === "disconnect" || mode === "replace") expect(() => process.kill(pid, 0)).not.toThrow();
    else expect(() => process.kill(pid, 0)).toThrow();
    second.socket.send(JSON.stringify({ type: "input", data: "still-here" }));
    await until(() => second.text().includes("INPUT still-here"));
  });
}

test("audio reserves before open; delayed old socket close cannot free the new reservation", async () => {
  const origin = "http://127.0.0.1:3773";
  const relay = createAudioRelay({ allowedOrigins: [origin], authorizeBrowser: () => true });
  relay.registerSession("one");
  relay.registerSession("two");
  const admitted: AudioRelayData[] = [];
  const server = {
    upgrade(_request: Request, options: { data: AudioRelayData }) {
      admitted.push(options.data);
      return true;
    },
  };
  const request = (id: string) =>
    new Request(origin + relay.pathname + "?role=browser&session=" + id, { headers: { Origin: origin } });
  expect(await relay.upgrade(request("one"), server)).toBeUndefined();
  // No open event yet. Admission must already block other sessions.
  expect((await relay.upgrade(request("two"), server))?.status).toBe(409);
  const socket = (data: AudioRelayData) => ({ data, close() {} }) as ServerWebSocket<AudioRelayData>;
  const old = socket(admitted[0]!);
  relay.websocket.open(old);
  relay.releaseSession("one");
  expect(await relay.upgrade(request("one"), server)).toBeUndefined();
  const fresh = socket(admitted[1]!);
  relay.websocket.open(fresh);
  relay.websocket.close(old);
  expect((await relay.upgrade(request("two"), server))?.status).toBe(409);
  relay.websocket.close(fresh);
  expect(await relay.upgrade(request("two"), server)).toBeUndefined();
  // A reservation cancelled before open is stale, even on the same tab.
  const cancelled = socket(admitted[2]!);
  relay.releaseSession("two");
  expect(await relay.upgrade(request("two"), server)).toBeUndefined();
  relay.websocket.open(cancelled);
  relay.websocket.close(cancelled);
  expect((await relay.upgrade(request("one"), server))?.status).toBe(409);
  relay.unregisterSession("two");
  const failingServer = {
    upgrade() {
      return false;
    },
  };
  expect((await relay.upgrade(request("one"), failingServer))?.status).toBe(400);
  expect(await relay.upgrade(request("one"), server)).toBeUndefined();
  relay.websocket.close(socket(admitted.at(-1)!));
  expect(await relay.upgrade(request("one"), server)).toBeUndefined();
  relay.unregisterSession("one");
});

test("terminal release invalidates an audio authorization still waiting", async () => {
  const origin = "http://127.0.0.1:3773";
  let authorize!: (value: boolean) => void;
  const relay = createAudioRelay({
    allowedOrigins: [origin],
    authorizeBrowser: () =>
      new Promise<boolean>((resolve) => {
        authorize = resolve;
      }),
  });
  relay.registerSession("terminal");
  let upgrades = 0;
  const admission = relay.upgrade(
    new Request(origin + relay.pathname + "?role=browser&session=terminal", { headers: { Origin: origin } }),
    {
      upgrade() {
        upgrades++;
        return true;
      },
    },
  );
  relay.releaseSession("terminal");
  authorize(true);
  expect((await admission)?.status).toBe(403);
  expect(upgrades).toBe(0);
});
