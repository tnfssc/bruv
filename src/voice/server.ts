import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import type { Call, Device } from "./call";

const page = readFileSync(new URL("./page.html", import.meta.url), "utf8");

export type Served = { url: string; close(): Promise<void> };

function allowed(request: IncomingMessage, token: string) {
  const given = Buffer.from(new URL(request.url ?? "/", "http://x").searchParams.get("t") ?? "");
  const wanted = Buffer.from(token);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/** Serves the voice page and its socket. Every open page is a microphone and a speaker for the call. */
export async function serve(call: Call, options: { host: string; port: number; token: string }): Promise<Served> {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://x").pathname;
    if (path !== "/" || !allowed(request, options.token)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    });
    response.end(page);
  });
  // One page listens at a time, the one opened last, so two open pages don't talk over each other.
  let microphone: WebSocket | undefined;
  const connect = (ws: WebSocket) => {
    let rate = 0;
    const device: Device = {
      send: (event) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
      },
      play: (pcm, sampleRate) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (sampleRate !== rate) {
          rate = sampleRate;
          ws.send(JSON.stringify({ type: "rate", rate }));
        }
        ws.send(pcm);
      },
    };
    call.attach(device);
    ws.on("message", (data, binary) => {
      if (!binary) {
        try {
          const { type } = JSON.parse(data.toString());
          if (type === "played") call.played();
          if (type === "hush") call.hush();
        } catch {}
        return;
      }
      if (microphone?.readyState !== WebSocket.OPEN) microphone = ws;
      if (ws !== microphone) return;
      const bytes = Buffer.isBuffer(data) ? data : Buffer.concat(data as Buffer[]);
      // A copy on its own buffer, so it can move to the engine's thread.
      const pcm = new Int16Array(bytes.length >> 1);
      new Uint8Array(pcm.buffer).set(bytes.subarray(0, pcm.length * 2));
      call.hear(pcm);
    });
    ws.on("close", () => call.detach(device));
  };
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
  server.on("upgrade", (request, socket, head) => {
    if (new URL(request.url ?? "/", "http://x").pathname !== "/socket" || !allowed(request, options.token)) {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => {
      microphone = ws;
      connect(ws);
    });
  });
  await listen(server, options.host, options.port);
  const { port } = server.address() as AddressInfo;
  const host = options.host === "0.0.0.0" || options.host === "::" ? "localhost" : options.host;
  return {
    url: `http://${host}:${port}/?t=${options.token}`,
    close: () =>
      new Promise((resolve) => {
        for (const ws of sockets.clients) ws.terminate();
        sockets.close();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/** Listens on the port asked for, or any free port when that one is taken. */
async function listen(server: ReturnType<typeof createServer>, host: string, port: number) {
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE" || port === 0) throw error;
    await listen(server, host, 0);
  }
}
