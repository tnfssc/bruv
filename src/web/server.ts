import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Server, WebSocketHandler } from "bun";
import { SOCKET_BYTES, TerminalSession, type SocketData } from "./terminal";

export interface WebAssets {
  html: string;
  javascript: string;
  css: string;
}
export type WebRouteResult = Response | "upgraded" | undefined;

/** Extensions own only their routes/socket channels; authentication is shared. */
export interface WebExtension {
  fetch(request: Request, server: Server<SocketData>): WebRouteResult | Promise<WebRouteResult>;
  websocket?: WebSocketHandler<SocketData>;
  stop?(): void | Promise<void>;
}
export interface WebServerOptions {
  command: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  hostname?: string;
  port?: number;
  assets: WebAssets;
  extension?: WebExtension;
}

export function startWebServer(options: WebServerOptions) {
  if (typeof Bun.Terminal !== "function")
    throw new Error("bruv web requires Bun with native Terminal support (1.4.2+).");
  const hostname = options.hostname ?? "127.0.0.1";
  // Intentionally local-only. Remote access should tunnel the loopback listener.
  if (!["127.0.0.1", "::1", "localhost"].includes(hostname))
    throw new Error("bruv web only binds loopback; use an SSH tunnel for remote access.");
  const token = randomBytes(32).toString("hex");
  const terminal = new TerminalSession(options.command, options.cwd ?? process.cwd(), options.env);
  let origin = "";
  const sameToken = (candidate: string) => {
    const bytes = Buffer.from(candidate);
    const expected = Buffer.from(token);
    return bytes.length === expected.length && timingSafeEqual(bytes, expected);
  };
  const authenticated = (request: Request) => {
    const bearer = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    const protocol =
      request.headers
        .get("sec-websocket-protocol")
        ?.split(",")
        .map((s) => s.trim())
        .find((s) => s.startsWith("bruv-token."))
        ?.slice(11) ?? "";
    return request.headers.get("origin") === origin && sameToken(bearer || protocol);
  };
  const headers = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  };
  const response = (body: string, type: string, status = 200) =>
    new Response(body, { status, headers: { ...headers, "Content-Type": type } });
  const extension = options.extension;
  const server = Bun.serve<SocketData>({
    hostname,
    port: options.port ?? 3773,
    async fetch(request, server) {
      const url = new URL(request.url);
      // Reject alternate Host headers, including DNS rebinding to loopback.
      if (url.origin !== origin) return response("Invalid host", "text/plain", 403);
      if (url.pathname.startsWith("/api/")) {
        if (!authenticated(request)) return response("Forbidden", "text/plain", 403);
        if (url.pathname === "/api/terminal") {
          if (request.method !== "GET") return response("Method not allowed", "text/plain", 405);
          const after = Number(url.searchParams.get("after") ?? "0");
          if (!Number.isSafeInteger(after) || after < 0) return response("Invalid replay cursor", "text/plain", 400);
          if (
            server.upgrade(request, {
              data: { channel: "terminal", after },
              headers: { "Sec-WebSocket-Protocol": "bruv" },
            })
          )
            return;
          return response("WebSocket required", "text/plain", 426);
        }
        const result = await extension?.fetch(request, server);
        if (result === "upgraded") return;
        return result ?? response("Not found", "text/plain", 404);
      }
      if (request.method !== "GET") return response("Method not allowed", "text/plain", 405);
      if (url.pathname === "/") return response(options.assets.html, "text/html; charset=utf-8");
      if (url.pathname === "/terminal.js") return response(options.assets.javascript, "text/javascript; charset=utf-8");
      if (url.pathname === "/terminal.css") return response(options.assets.css, "text/css; charset=utf-8");
      return response("Not found", "text/plain", 404);
    },
    websocket: {
      maxPayloadLength: 128 * 1024,
      backpressureLimit: SOCKET_BYTES,
      closeOnBackpressureLimit: true,
      idleTimeout: 60,
      sendPings: true,
      open(socket) {
        if (socket.data.channel === "terminal") terminal.attach(socket);
        else extension?.websocket?.open?.(socket);
      },
      message(socket, message) {
        if (socket.data.channel === "terminal") terminal.message(socket, message);
        else extension?.websocket?.message(socket, message);
      },
      close(socket, code, reason) {
        if (socket.data.channel === "terminal") terminal.detach(socket);
        else extension?.websocket?.close?.(socket, code, reason);
      },
      drain(socket) {
        if (socket.data.channel !== "terminal") extension?.websocket?.drain?.(socket);
      },
    },
  });
  origin = server.url.origin;
  let stopped: Promise<void> | undefined;
  return {
    server,
    terminal,
    token,
    origin,
    url: origin + "/#token=" + token,
    stop() {
      return (stopped ??= (async () => {
        // Stop accepting connections immediately, then tear down owned resources.
        server.stop(true);
        await Promise.all([terminal.stop(), extension?.stop?.()]);
      })());
    },
  };
}
