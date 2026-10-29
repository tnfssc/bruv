import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import type { Route } from "./part";
import type { PageEvent, ServerEvent } from "./protocol";

/** Serves the page's files. `index` is the page itself; `handle` serves everything else it can. */
export type Assets = {
  index(url: string): Promise<string>;
  handle(request: IncomingMessage, response: import("node:http").ServerResponse): boolean | Promise<boolean>;
  close(): Promise<void>;
};

export type WebServer = {
  url: string;
  port: number;
  /**
   * The HTTP server, for parts that add their own routes or sockets (voice, push). They check the key
   * with `allowed`; upgrades for paths other than `/socket` are left to them.
   */
  http: Server;
  send(event: ServerEvent): void;
  /** Whether some page is open and in front. */
  watched(): boolean;
  /** Adds routes that are tried before the page's files (parts: the app manifest, push, the QR code). */
  route(handler: Route): () => void;
  close(): Promise<void>;
};

export function allowed(request: IncomingMessage, key: string) {
  const given = Buffer.from(new URL(request.url ?? "/", "http://x").searchParams.get("t") ?? "");
  const wanted = Buffer.from(key);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/**
 * The web version's server: the page (with its key) and one socket per open page. Every page gets the whole
 * picture when it connects (`hello`), then each change as it happens.
 */
export async function serveWeb(options: {
  host: string;
  port: number;
  key: string;
  assets: (server: Server) => Promise<Assets>;
  hello: () => ServerEvent;
  /** What a page said; `reply` answers that page only. */
  onPage: (event: PageEvent, reply: (event: ServerEvent) => void) => void;
  /** A picture from the conversation, by line id and position, or nothing. */
  image: (line: string, index: number) => { mimeType: string; data: string } | undefined;
}): Promise<WebServer> {
  let assets: Assets | undefined;
  const routes: Route[] = [];
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://x").pathname;
    try {
      if (path === "/") {
        if (!allowed(request, options.key) || !assets) {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
        });
        response.end(await assets.index(request.url ?? "/"));
        return;
      }
      // Pictures never change once sent, so the browser keeps them.
      const picture = /^\/image\/([^/]+)\/(\d+)$/.exec(path);
      if (picture) {
        const found =
          allowed(request, options.key) && options.image(decodeURIComponent(picture[1]), Number(picture[2]));
        if (!found) {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(200, {
          "content-type": found.mimeType,
          "cache-control": "private, max-age=31536000, immutable",
        });
        response.end(Buffer.from(found.data, "base64"));
        return;
      }
      for (const route of routes) if (await route(request, response, path)) return;
      if (assets && (await assets.handle(request, response))) return;
      response.writeHead(404).end();
    } catch {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    }
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 32 << 20 });
  /** Pages in front; a page counts as in front until it says otherwise. */
  const visible = new Set<WebSocket>();
  // Other upgrades (the dev server's hot reload) are left to whoever listens for them.
  server.on("upgrade", (request, socket, head) => {
    if (new URL(request.url ?? "/", "http://x").pathname !== "/socket") return;
    if (!allowed(request, options.key)) {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => {
      ws.send(JSON.stringify(options.hello()));
      const reply = (event: ServerEvent) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
      };
      visible.add(ws);
      ws.on("close", () => visible.delete(ws));
      ws.on("message", (data, binary) => {
        if (binary) return;
        try {
          const event = JSON.parse(data.toString()) as PageEvent;
          if (event.type === "visible") {
            if (event.visible) visible.add(ws);
            else visible.delete(ws);
            return;
          }
          options.onPage(event, reply);
        } catch {}
      });
    });
  });
  assets = await options.assets(server);
  await listen(server, options.host, options.port);
  const { port } = server.address() as AddressInfo;
  const host = options.host === "0.0.0.0" || options.host === "::" ? "localhost" : options.host;
  return {
    url: `http://${host}:${port}/?t=${options.key}`,
    port,
    http: server,
    watched: () => visible.size > 0,
    route: (handler) => {
      routes.push(handler);
      return () => {
        const at = routes.indexOf(handler);
        if (at >= 0) routes.splice(at, 1);
      };
    },
    send: (event) => {
      const message = JSON.stringify(event);
      for (const ws of sockets.clients) if (ws.readyState === WebSocket.OPEN) ws.send(message);
    },
    close: async () => {
      for (const ws of sockets.clients) ws.close(4000, "bye");
      sockets.close();
      await assets?.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}

/** Listens on the port asked for, or any free port when that one is taken. */
async function listen(server: Server, host: string, port: number) {
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
