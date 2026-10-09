import { resolve } from "node:path";
import { afterEach, expect, test } from "bun:test";
import WebSocket from "ws";
import { startWebServer } from "../../src/web/server";

const assets = { html: "<title>Bruv</title>", javascript: "console.log('terminal')", css: "body{}" };
const fixture = [
  process.execPath,
  "-e",
  'process.stdin.setRawMode(true); console.log("TTY "+process.stdin.isTTY+" "+process.stdout.isTTY); console.log("SIZE "+process.stdout.columns+" "+process.stdout.rows); process.on("SIGWINCH",()=>console.log("SIZE "+process.stdout.columns+" "+process.stdout.rows)); process.stdin.on("data",d=>{if(d.toString()==="exit")process.exit(7);console.log("INPUT",d.toString())}); setInterval(()=>{},1000);',
];
type App = ReturnType<typeof startWebServer>;
const apps: App[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.all(apps.splice(0).map((app) => app.stop()));
});
function start(extra: Partial<Parameters<typeof startWebServer>[0]> = {}) {
  const app = startWebServer({ command: fixture, assets, port: 0, ...extra });
  apps.push(app);
  return app;
}
function connect(app: App, after = 0) {
  const socket = new WebSocket(
    app.origin.replace("http", "ws") + "/api/terminal?after=" + after,
    ["bruv", "bruv-token." + app.token],
    { headers: { Origin: app.origin } },
  );
  sockets.push(socket);
  const messages: any[] = [];
  socket.on("message", (data) => messages.push(JSON.parse(String(data))));
  return {
    socket,
    messages,
    text: () =>
      messages
        .filter((m) => m.type === "output")
        .map((m) => Buffer.from(m.data, "base64").toString())
        .join(""),
  };
}
async function until(check: () => boolean, timeout = 5000) {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) throw new Error("Timed out");
    await Bun.sleep(10);
  }
}

test("loopback, token, Origin and Host guard terminal and extension routes", async () => {
  let calls = 0;
  const app = start({
    extension: {
      fetch: () => {
        calls++;
        return new Response("extension");
      },
    },
  });
  expect(app.terminal.pid).toBeUndefined();
  const auth = { Origin: app.origin, Authorization: "Bearer " + app.token };
  expect((await fetch(app.origin + "/")).status).toBe(200);
  for (const headers of [
    {},
    { Origin: app.origin },
    { ...auth, Origin: "http://evil.example" },
    { ...auth, Authorization: "Bearer wrong" },
  ] as Record<string, string>[]) {
    expect((await fetch(app.origin + "/api/terminal", { headers })).status).toBe(403);
    expect((await fetch(app.origin + "/api/audio", { headers })).status).toBe(403);
  }
  expect(calls).toBe(0);
  expect(await (await fetch(app.origin + "/api/audio", { headers: auth })).text()).toBe("extension");
  expect(calls).toBe(1);
  expect((await fetch(app.origin + "/", { headers: { Host: "evil.example" } })).status).toBe(403);
  expect((await fetch(app.origin + "/api/terminal", { headers: auth })).status).toBe(426);
  expect(app.terminal.pid).toBeUndefined();
  expect(() => startWebServer({ command: fixture, assets, hostname: "0.0.0.0" })).toThrow("loopback");
});

test("real PTY input, resize, reconnect replay and honest exit", async () => {
  const app = start();
  const first = connect(app);
  await until(() => first.text().includes("TTY true true"));
  const pid = app.terminal.pid;
  first.socket.send(JSON.stringify({ type: "resize", cols: 103, rows: 37 }));
  await until(() => first.text().includes("SIZE 103 37"));
  first.socket.send(JSON.stringify({ type: "input", data: "hello" }));
  await until(() => first.text().includes("INPUT hello"));
  const cursor = first.messages.filter((m) => m.type === "output").at(-1).seq;
  first.socket.close();
  await until(() => first.socket.readyState === WebSocket.CLOSED);
  const second = connect(app, cursor);
  await until(() => second.messages.some((m) => m.type === "ready"));
  expect(app.terminal.pid).toBe(pid);
  expect(second.text()).toBe("");
  expect(second.messages[0]).toMatchObject({ type: "ready", cols: 103, rows: 37 });
  second.socket.send(JSON.stringify({ type: "input", data: "again" }));
  await until(() => second.text().includes("INPUT again"));
  const replay = connect(app, 0);
  await until(() => replay.text().includes("INPUT hello") && replay.text().includes("INPUT again"));
  expect(second.socket.readyState).toBe(WebSocket.OPEN);
  replay.socket.send(JSON.stringify({ type: "input", data: "exit" }));
  await until(() => replay.messages.some((m) => m.type === "exit" && m.code === 7));
  const exited = connect(app, replay.messages.filter((m) => m.type === "output").at(-1).seq);
  await until(() => exited.messages.some((m) => m.type === "exit" && m.code === 7));
  expect(app.terminal.pid).toBe(pid);
});

test("replay overflow reports a gap instead of presenting a corrupted terminal", async () => {
  const app = start({
    command: [
      process.execPath,
      "-e",
      'setTimeout(()=>{process.stdout.write("x".repeat(3*1024*1024));console.log("END")},100);setInterval(()=>{},1000)',
    ],
  });
  const first = connect(app);
  await until(() => first.text().includes("END"));
  first.socket.close();
  const second = connect(app, 0);
  await until(() => second.messages.some((m) => m.type === "gap"));
  expect(second.messages.find((m) => m.type === "gap").message).toContain("Close this tab");
  expect(second.messages.some((m) => m.type === "ready")).toBe(false);
});

test("shutdown is idempotent and reaps PTY process even if it ignores TERM", async () => {
  const app = start({
    command: [
      process.execPath,
      "-e",
      'process.on("SIGTERM",()=>{});const tool=Bun.spawn([process.execPath,"-e","setInterval(()=>{},1000)"],{stdio:["ignore","ignore","ignore"]});console.log("TOOL "+tool.pid);console.log("RUNNING");setInterval(()=>{},1000)',
    ],
  });
  const client = connect(app);
  await until(() => client.text().includes("RUNNING"));
  const pid = app.terminal.pid!;
  const toolPid = Number(client.text().match(/TOOL (\d+)/)![1]);
  const stopping = app.stop();
  expect(app.stop()).toBe(stopping);
  await stopping;
  expect(() => process.kill(pid, 0)).toThrow();
  expect(() => process.kill(toolPid, 0)).toThrow();
  await until(() => client.socket.readyState === WebSocket.CLOSED);
  await expect(fetch(app.origin + "/")).rejects.toThrow();
});

test("extension WebSockets share authentication and shutdown without owning terminal", async () => {
  let stopped = false;
  const app = start({
    extension: {
      fetch(request, server) {
        if (new URL(request.url).pathname !== "/api/audio") return;
        return server.upgrade(request, { data: { channel: "audio" }, headers: { "Sec-WebSocket-Protocol": "bruv" } })
          ? "upgraded"
          : new Response("WebSocket required", { status: 426 });
      },
      websocket: {
        message(socket, message) {
          socket.send(message);
        },
      },
      stop() {
        stopped = true;
      },
    },
  });
  const socket = new WebSocket(app.origin.replace("http", "ws") + "/api/audio", ["bruv", "bruv-token." + app.token], {
    headers: { Origin: app.origin },
  });
  sockets.push(socket);
  let echoed = "";
  socket.on("message", (message) => {
    echoed = String(message);
  });
  await until(() => socket.readyState === WebSocket.OPEN);
  socket.send("audio-interface-proof");
  await until(() => echoed === "audio-interface-proof");
  expect(app.terminal.pid).toBeUndefined();
  await app.stop();
  expect(stopped).toBe(true);
});

test("failed CLI startup reports an error and reconnect never retries it", async () => {
  const app = start({ command: ["/bruv-web-test/nonexistent-executable"] });
  const first = connect(app);
  await until(() => first.messages.some((message) => message.type === "error"));
  expect(app.terminal.pid).toBeUndefined();
  const second = connect(app);
  await until(() => second.messages.some((message) => message.type === "exit" && message.code === 1));
  expect(second.messages.some((message) => message.type === "error")).toBe(false);
  expect(app.terminal.pid).toBeUndefined();
});

test("built-in audio authenticates both peers and disconnect leaves the terminal process alive", async () => {
  const app = start({ command: [process.execPath, resolve(import.meta.dir, "fixtures/audio-cli.ts")] });
  const route = app.origin + "/api/live/audio?role=browser&session=terminal";
  for (const headers of [
    {},
    { Origin: app.origin },
    { Origin: "http://evil.example", Authorization: "Bearer " + app.token },
  ] as Record<string, string>[]) {
    expect((await fetch(route, { headers })).status).toBe(403);
  }
  const worklet = await fetch(app.origin + "/audio-worklet.js");
  expect(worklet.status).toBe(200);
  expect(worklet.headers.get("content-security-policy")).toContain("script-src 'self'");
  expect(await worklet.text()).toContain("registerProcessor('bruv-capture'");
  const terminal = connect(app);
  await until(() => terminal.messages.some((m) => m.type === "audio-owner"));
  const owner = terminal.messages.find((m) => m.type === "audio-owner").id;
  const browser = new WebSocket(
    route.replace(/^http/, "ws"),
    ["bruv-audio", "bruv-token." + app.token, "bruv-owner." + owner],
    {
      headers: { Origin: app.origin },
    },
  );
  sockets.push(browser);
  browser.on("message", (raw) => {
    if (JSON.parse(String(raw)).type === "start") browser.send('{"type":"ready"}');
  });
  await until(() => terminal.text().includes("AUDIO_RUNNING"));
  expect(browser.protocol).toBe("bruv-audio");
  const pid = app.terminal.pid;
  browser.close();
  await until(() => terminal.text().includes("AUDIO_CLOSED"));
  expect(app.terminal.pid).toBe(pid);
  terminal.socket.send(JSON.stringify({ type: "input", data: "still-running" }));
  await until(() => terminal.text().includes("INPUT still-running"));
});

test("terminal disconnect releases browser audio on the server while CLI survives", async () => {
  const app = start({ command: [process.execPath, resolve(import.meta.dir, "fixtures/audio-cli.ts")] });
  const terminal = connect(app);
  await until(() => terminal.messages.some((m) => m.type === "audio-owner"));
  const owner = terminal.messages.find((m) => m.type === "audio-owner").id;
  const browser = new WebSocket(
    app.origin.replace(/^http/, "ws") + "/api/live/audio?role=browser&session=terminal",
    ["bruv-audio", "bruv-token." + app.token, "bruv-owner." + owner],
    { headers: { Origin: app.origin } },
  );
  sockets.push(browser);
  browser.on("message", (raw) => {
    if (JSON.parse(String(raw)).type === "start") browser.send('{"type":"ready"}');
  });
  await until(() => terminal.text().includes("AUDIO_RUNNING"));
  const pid = app.terminal.pid;
  terminal.socket.close();
  await until(() => browser.readyState === WebSocket.CLOSED);
  const active = connect(app);
  await until(() => active.text().includes("AUDIO_CLOSED"));
  // An old tab keeps the shared terminal token, but its audio attachment is stale.
  expect(
    (
      await fetch(app.origin + "/api/live/audio?role=browser&session=terminal", {
        headers: {
          Origin: app.origin,
          Authorization: "Bearer " + app.token,
          "Sec-WebSocket-Protocol": "bruv-audio, bruv-owner." + owner,
        },
      })
    ).status,
  ).toBe(403);
  expect(app.terminal.pid).toBe(pid);
  active.socket.send(JSON.stringify({ type: "input", data: "survived-disconnect" }));
  await until(() => active.text().includes("INPUT survived-disconnect"));
});
