import { expect, test } from "bun:test";
import { resolve } from "node:path";
import WebSocket from "ws";
import { startWebServer } from "../../src/web/server";

async function until(check: () => boolean) {
  for (let n = 0; n < 300 && !check(); n++) await Bun.sleep(10);
  expect(check()).toBe(true);
}

test("two real attachments reach the actual editor and /live admission, not the last Enter owner", async () => {
  const app = startWebServer({
    port: 0,
    command: [process.execPath, resolve(import.meta.dir, "fixtures/audio-cli.ts"), "--commands"],
    assets: { html: "terminal", javascript: "", css: "", font: new Uint8Array(), wasm: new Uint8Array() },
  });
  const sockets: WebSocket[] = [];
  const connect = (path: string, protocols = ["bruv", "bruv-token." + app.token]) => {
    const socket = new WebSocket(app.origin.replace(/^http/, "ws") + path, protocols, {
      headers: { Origin: app.origin },
    });
    sockets.push(socket);
    return socket;
  };
  const attachment = () => {
    const socket = connect("/api/terminal?tab=terminal");
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
      type: (data: string) => socket.send(JSON.stringify({ type: "input", data })),
      owner: () => messages.find((m) => m.type === "audio-owner")?.id,
      requests: () => messages.filter((m) => m.type === "audio-request"),
    };
  };
  try {
    const a = attachment(),
      b = attachment();
    await until(() => a.text().includes("OFFLINE_LIVE_FIXTURE_READY") && !!b.owner());
    a.type("/live\\\r");
    // Wait for the real editor to retain the continued line before B submits it.
    await until(() => b.text().includes("/live\\"));
    b.type("\r");
    await until(() => a.text().includes("Voice needs an unmixed browser command"));
    expect(a.requests()).toEqual([]);
    expect(b.requests()).toEqual([]);
    expect(a.text()).not.toContain("FAKE_PROVIDER_CAPTURED");
    a.type("/live\\\r");
    a.type("\r");
    await until(() => a.requests().length === 1);
    expect(b.requests()).toEqual([]);
    const request = a.requests()[0].request;
    const audio = connect("/api/live/audio?role=browser&session=terminal&request=" + request, [
      "bruv-audio",
      "bruv-token." + app.token,
      "bruv-owner." + a.owner(),
    ]);
    audio.on("message", (data) => {
      const message = JSON.parse(String(data));
      if (message.type === "start") {
        audio.send('{"type":"ready"}');
      }
      if (message.type === "stop") audio.send('{"type":"stopped"}');
    });
    await until(() => a.text().includes("Live continuous mic"));
    audio.send(JSON.stringify({ type: "capture", data: Buffer.alloc(640).toString("base64") }));
    await until(() => a.text().includes("FAKE_PROVIDER_CAPTURED"));
    a.type("/live stop\r");
    await until(() => audio.readyState === WebSocket.CLOSED);
    expect(app.terminal.pid).toBeDefined();
  } finally {
    for (const socket of sockets) socket.terminate();
    await app.stop();
  }
}, 10_000);
