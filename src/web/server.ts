import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { statSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import { createAudioRelay, type AudioRelayData } from "./audio-relay";
import { CAPTURE_WORKLET } from "./browser-audio";
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
  const defaultCwd = resolve(options.cwd ?? process.cwd());
  type Tab = { id: string; name: string; terminal: TerminalSession; controller?: ServerWebSocket<SocketData> };
  type Workspace = { id: string; name: string; cwd: string; tabs: Tab[] };
  const workspaces: Workspace[] = [];
  const tabs = new Map<string, Tab>();
  let origin = "";
  const sameToken = (candidate: string) => {
    const bytes = Buffer.from(candidate);
    const expected = Buffer.from(token);
    return bytes.length === expected.length && timingSafeEqual(bytes, expected);
  };
  const authenticated = (request: Request, websocket = false) => {
    const bearer = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1] ?? "";
    const protocol =
      request.headers
        .get("sec-websocket-protocol")
        ?.split(",")
        .map((s) => s.trim())
        .find((s) => s.startsWith("bruv-token."))
        ?.slice(11) ?? "";
    const requestOrigin = request.headers.get("origin");
    const needsOrigin = websocket || request.method !== "GET";
    return (
      (requestOrigin === origin || (!needsOrigin && requestOrigin === null)) &&
      sameToken(websocket ? bearer || protocol : bearer)
    );
  };
  const audioOrigins: string[] = [];
  const relay = createAudioRelay({
    allowedOrigins: audioOrigins,
    authorizeBrowser: (request, id) => {
      const controller = tabs.get(id)?.controller;
      return (
        controller?.readyState === 1 &&
        authenticated(request, true) &&
        request.headers
          .get("sec-websocket-protocol")
          ?.split(",")
          .map((value) => value.trim())
          .includes("bruv-owner." + controller.data.audioOwner) === true
      );
    },
  });
  function addTab(workspace: Workspace, name?: string, id: string = randomUUID()): Tab {
    const secret = relay.registerSession(id);
    const env = {
      ...(options.env ?? process.env),
      BRUV_LIVE_RELAY_URL: origin.replace(/^http/, "ws") + relay.pathname + "?role=cli&session=" + id,
      BRUV_LIVE_RELAY_SECRET: secret,
    };
    const tab = {
      id,
      name: name ?? "Terminal " + (workspace.tabs.length + 1),
      terminal: new TerminalSession(options.command, workspace.cwd, env),
    };
    workspace.tabs.push(tab);
    tabs.set(id, tab);
    return tab;
  }
  function state() {
    return {
      workspaces: workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        cwd: workspace.cwd,
        tabs: workspace.tabs.map((tab) => ({
          id: tab.id,
          name: tab.name,
          ...(tab.terminal.pid !== undefined ? { pid: tab.terminal.pid } : {}),
          ...(tab.terminal.exited ? { exited: true } : {}),
        })),
      })),
      defaultCwd,
    };
  }
  function disposeTab(tab: Tab) {
    tabs.delete(tab.id);
    tab.controller = undefined;
    relay.unregisterSession(tab.id);
    return tab.terminal.stop();
  }
  const audioSocket = (socket: ServerWebSocket<SocketData>) => socket as unknown as ServerWebSocket<AudioRelayData>;
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
      // CLI peers have no browser Origin and authenticate with their private relay secret.
      // Browser peers still use the normal terminal token and exact Origin check.
      if (relay.matches(request)) return relay.upgrade(request, server);
      if (url.pathname.startsWith("/api/")) {
        if (
          !authenticated(
            request,
            request.headers.get("upgrade")?.toLowerCase() === "websocket" || url.pathname === "/api/terminal",
          )
        )
          return response("Forbidden", "text/plain", 403);
        if (url.pathname === "/api/terminal") {
          if (request.method !== "GET") return response("Method not allowed", "text/plain", 405);
          const tabId = url.searchParams.get("tab") ?? "terminal";
          if (!tabs.has(tabId)) return response("Tab not found", "text/plain", 404);
          const after = Number(url.searchParams.get("after") ?? "0");
          if (!Number.isSafeInteger(after) || after < 0) return response("Invalid replay cursor", "text/plain", 400);
          if (
            server.upgrade(request, {
              data: { channel: "terminal", tabId, after, audioOwner: randomBytes(16).toString("hex") },
              headers: { "Sec-WebSocket-Protocol": "bruv" },
            })
          )
            return;
          return response("WebSocket required", "text/plain", 426);
        }
        const workspaceMatch = /^\/api\/workspaces\/([^/]+)(\/tabs)?$/.exec(url.pathname);
        const tabMatch = /^\/api\/tabs\/([^/]+)$/.exec(url.pathname);
        if (url.pathname === "/api/workspaces" || workspaceMatch || tabMatch) {
          const json = () => response(JSON.stringify(state()), "application/json");
          if (url.pathname === "/api/workspaces" && request.method === "GET") return json();
          const createWorkspace = url.pathname === "/api/workspaces" && request.method === "POST";
          const createTab = workspaceMatch?.[2] && request.method === "POST";
          const renameTab = tabMatch && request.method === "PATCH";
          const deleteTab = tabMatch && request.method === "DELETE";
          const deleteWorkspace = workspaceMatch && !workspaceMatch?.[2] && request.method === "DELETE";
          if (!createWorkspace && !createTab && !renameTab && !deleteTab && !deleteWorkspace)
            return response("Method not allowed", "text/plain", 405);
          let body: { cwd?: unknown; name?: unknown; confirm?: unknown };
          try {
            body = await request.json();
            if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid body");
          } catch {
            return response("JSON body required", "text/plain", 400);
          }
          const workspace = workspaceMatch && workspaces.find((w) => w.id === workspaceMatch[1]);
          const tab = tabMatch && tabs.get(tabMatch[1]!);
          if ((workspaceMatch && !workspace) || (tabMatch && !tab)) return response("Not found", "text/plain", 404);
          if (
            (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim())) ||
            (renameTab && body.name === undefined)
          )
            return response("Name required", "text/plain", 400);
          if ((deleteTab || deleteWorkspace) && body.confirm !== true)
            return response("Deletion requires confirm: true", "text/plain", 400);
          if (createWorkspace) {
            if (body.cwd !== undefined && typeof body.cwd !== "string")
              return response("Invalid directory", "text/plain", 400);
            const cwd = resolve(defaultCwd, (body.cwd as string | undefined) ?? defaultCwd);
            try {
              if (!statSync(cwd).isDirectory()) throw new Error("Not a directory");
            } catch {
              return response("Directory not found", "text/plain", 400);
            }
            const workspace: Workspace = {
              id: randomUUID(),
              name: (body.name as string | undefined) ?? (basename(cwd) || cwd),
              cwd,
              tabs: [],
            };
            workspaces.push(workspace);
            addTab(workspace);
          } else if (createTab) addTab(workspace!, body.name as string | undefined);
          else if (renameTab) tab!.name = body.name as string;
          else if (deleteTab) {
            const owner = workspaces.find((w) => w.tabs.includes(tab!))!;
            owner.tabs.splice(owner.tabs.indexOf(tab!), 1);
            await disposeTab(tab!);
          } else if (deleteWorkspace) {
            workspaces.splice(workspaces.indexOf(workspace!), 1);
            await Promise.all(workspace!.tabs.map(disposeTab));
          }
          return json();
        }
        const result = await extension?.fetch(request, server);
        if (result === "upgraded") return;
        return result ?? response("Not found", "text/plain", 404);
      }
      if (request.method !== "GET") return response("Method not allowed", "text/plain", 405);
      if (url.pathname === "/audio-worklet.js") return response(CAPTURE_WORKLET, "text/javascript; charset=utf-8");
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
        if (socket.data.channel === "terminal") {
          const tab = tabs.get(String(socket.data.tabId));
          if (!tab) return socket.close(1008, "Tab not found");
          if (!tab.terminal.attach(socket)) return;
          if (tab.controller && tab.controller !== socket) relay.releaseSession(tab.id);
          tab.controller = socket;
          socket.send(JSON.stringify({ type: "audio-owner", id: socket.data.audioOwner }));
        } else if (socket.data.channel === "live-audio") relay.websocket.open(audioSocket(socket));
        else extension?.websocket?.open?.(socket);
      },
      message(socket, message) {
        if (socket.data.channel === "terminal") tabs.get(String(socket.data.tabId))?.terminal.message(socket, message);
        else if (socket.data.channel === "live-audio") relay.websocket.message(audioSocket(socket), message);
        else extension?.websocket?.message(socket, message);
      },
      close(socket, code, reason) {
        if (socket.data.channel === "terminal") {
          const tab = tabs.get(String(socket.data.tabId));
          if (tab?.controller === socket) {
            tab.controller = undefined;
            relay.releaseSession(tab.id);
          }
          tab?.terminal.detach(socket);
        } else if (socket.data.channel === "live-audio") relay.websocket.close(audioSocket(socket));
        else extension?.websocket?.close?.(socket, code, reason);
      },
      drain(socket) {
        if (socket.data.channel !== "terminal") extension?.websocket?.drain?.(socket);
      },
    },
  });
  origin = server.url.origin;
  audioOrigins.push(origin);
  const initialWorkspace: Workspace = {
    id: "workspace",
    name: basename(defaultCwd) || defaultCwd,
    cwd: defaultCwd,
    tabs: [],
  };
  workspaces.push(initialWorkspace);
  const terminal = addTab(initialWorkspace, undefined, "terminal").terminal;
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
        const cleanup = [...tabs.values()].map(disposeTab);
        server.stop(true);
        await Promise.all([...cleanup, extension?.stop?.()]);
      })());
    },
  };
}
