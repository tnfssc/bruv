import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { ServerWebSocket } from "bun";
import { createAudioRelay, type AudioRelayData } from "./audio-relay";
import { CAPTURE_WORKLET } from "./browser-audio";
import { SOCKET_BYTES, TerminalSession, type SocketData } from "./terminal";

export interface WebAssets {
  html: string;
  javascript: string;
  css: string;
  font: Uint8Array<ArrayBuffer>;
  wasm: Uint8Array<ArrayBuffer>;
}
export interface WebServerOptions {
  command: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  hostname?: string;
  port?: number;
  assets: WebAssets;
}

export function startWebServer(options: WebServerOptions) {
  if (typeof Bun.Terminal !== "function")
    throw new Error("bruv web requires Bun with native Terminal support (1.4.2+).");
  const hostname = options.hostname ?? "127.0.0.1";
  // Intentionally local-only. Remote access should tunnel the loopback listener.
  if (!["127.0.0.1", "::1", "localhost"].includes(hostname))
    throw new Error("bruv web only binds loopback; use an SSH tunnel for remote access.");
  const token = randomBytes(32).toString("hex");
  const defaultCwd = realpathSync(resolve(options.cwd ?? process.cwd()));
  type Tab = { id: string; name: string; terminal: TerminalSession };
  type Workspace = { id: string; name: string; cwd: string; tabs: Tab[] };
  const workspaces: Workspace[] = [];
  const tabs = new Map<string, Tab>();
  const listeners = new Set<ServerWebSocket<SocketData>>();
  let revision = 0;
  let voice: { tabId: string; ownerId: string } | null = null;
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
  // State is shared; never publish the capability that authorizes a microphone.
  const publicOwnerId = (capability: string) => createHash("sha256").update(capability).digest("hex");
  const relay = createAudioRelay({
    authorizeBrowser: (request, id) => {
      if (!authenticated(request, true)) return false;
      const protocols =
        request.headers
          .get("sec-websocket-protocol")
          ?.split(",")
          .map((value) => value.trim()) ?? [];
      for (const protocol of protocols) {
        if (!protocol.startsWith("bruv-owner.")) continue;
        const ownerId = protocol.slice(11);
        if (tabs.get(id)?.terminal.hasOwner(ownerId)) return ownerId;
      }
      return false;
    },
    requestBrowser: (id, owner, request) =>
      tabs.get(id)?.terminal.sendOwner(owner, { type: "audio-request", request }) ?? false,
    cancelBrowser: (id, owner, request) => {
      tabs.get(id)?.terminal.sendOwner(owner, { type: "audio-cancel", request });
    },
    onOwnerChange(owner) {
      voice = owner ? { tabId: owner.tabId, ownerId: publicOwnerId(owner.ownerId) } : null;
      publish();
    },
  });
  function addTab(workspace: Workspace, name?: string, id: string = randomUUID()): Tab {
    const secret = relay.registerSession(id);
    const env = {
      ...(options.env ?? process.env),
      BRUV_LIVE_RELAY_URL: origin.replace(/^http/, "ws") + relay.pathname + "?role=cli&session=" + id,
      BRUV_LIVE_RELAY_SECRET: secret,
    };
    if (name === undefined) {
      let number = 1;
      while (workspace.tabs.some((tab) => tab.name === "Terminal " + number)) number++;
      name = "Terminal " + number;
    }
    const tab = {
      id,
      name,
      terminal: new TerminalSession(
        options.command,
        workspace.cwd,
        env,
        () => {
          if (tabs.has(id)) publish();
        },
        (owner, previous) => relay.inputTicket(id, owner, previous),
      ),
    };
    workspace.tabs.push(tab);
    tabs.set(id, tab);
    return tab;
  }
  function state() {
    return {
      revision,
      voice,
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
  function sendState(socket: ServerWebSocket<SocketData>, snapshot: ReturnType<typeof state>) {
    const text = JSON.stringify({ type: "state", state: snapshot });
    if (socket.getBufferedAmount() + Buffer.byteLength(text) > SOCKET_BYTES || socket.send(text) === 0) {
      listeners.delete(socket);
      socket.close(1013, "State backlog; reconnect for current state");
    }
  }
  function publish() {
    revision++;
    const snapshot = state();
    for (const socket of listeners) sendState(socket, snapshot);
  }
  function disposeTab(tab: Tab) {
    tabs.delete(tab.id);
    relay.unregisterSession(tab.id);
    return tab.terminal.stop();
  }
  const audioSocket = (socket: ServerWebSocket<SocketData>) => socket as unknown as ServerWebSocket<AudioRelayData>;
  const headers = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  };
  const response = (body: BodyInit, type: string, status = 200) =>
    new Response(body, { status, headers: { ...headers, "Content-Type": type } });
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
        if (url.pathname === "/api/events") {
          if (request.method !== "GET") return response("Method not allowed", "text/plain", 405);
          const protocols = request.headers
            .get("sec-websocket-protocol")
            ?.split(",")
            .map((value) => value.trim());
          if (!protocols?.includes("bruv-state")) return response("State protocol required", "text/plain", 400);
          if (
            server.upgrade(request, { data: { channel: "state" }, headers: { "Sec-WebSocket-Protocol": "bruv-state" } })
          )
            return;
          return response("WebSocket required", "text/plain", 426);
        }
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
        const workspaceMatch = /^\/api\/workspaces\/([^/]+)(\/tabs|\/move)?$/.exec(url.pathname);
        const tabMatch = /^\/api\/tabs\/([^/]+)(\/move)?$/.exec(url.pathname);
        if (url.pathname === "/api/workspaces" || workspaceMatch || tabMatch) {
          const json = () => response(JSON.stringify(state()), "application/json");
          if (url.pathname === "/api/workspaces" && request.method === "GET") return json();
          const createWorkspace = url.pathname === "/api/workspaces" && request.method === "POST";
          const createTab = workspaceMatch?.[2] === "/tabs" && request.method === "POST";
          const moveWorkspace = workspaceMatch?.[2] === "/move" && request.method === "POST";
          const moveTab = tabMatch?.[2] === "/move" && request.method === "POST";
          const renameTab = tabMatch && !tabMatch[2] && request.method === "PATCH";
          const renameWorkspace = workspaceMatch && !workspaceMatch[2] && request.method === "PATCH";
          const deleteTab = tabMatch && !tabMatch[2] && request.method === "DELETE";
          const deleteWorkspace = workspaceMatch && !workspaceMatch?.[2] && request.method === "DELETE";
          if (
            !createWorkspace &&
            !createTab &&
            !renameTab &&
            !renameWorkspace &&
            !deleteTab &&
            !deleteWorkspace &&
            !moveWorkspace &&
            !moveTab
          )
            return response("Method not allowed", "text/plain", 405);
          let body: { cwd?: unknown; name?: unknown; confirm?: unknown; beforeId?: unknown };
          try {
            body = await request.json();
            if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid body");
          } catch {
            return response("JSON body required", "text/plain", 400);
          }
          const workspace = workspaceMatch && workspaces.find((w) => w.id === workspaceMatch[1]);
          const tabId = tabMatch?.[1];
          const tab = tabId ? tabs.get(tabId) : undefined;
          if ((workspaceMatch && !workspace) || (tabMatch && !tab)) return response("Not found", "text/plain", 404);
          if (moveWorkspace || moveTab) {
            if (body.beforeId !== null && typeof body.beforeId !== "string")
              return response("beforeId must be an item ID or null", "text/plain", 400);
            const items: { id: string }[] = moveWorkspace
              ? workspaces
              : (workspaces.find((item) => item.tabs.some((item) => item.id === tabId))?.tabs ?? []);
            const from = items.findIndex((item) => item.id === (moveWorkspace ? workspaceMatch?.[1] : tabId));
            if (from < 0) return response("Move source not found", "text/plain", 404);
            const before = body.beforeId === null ? items.length : items.findIndex((item) => item.id === body.beforeId);
            if (before === -1) return response("Drop target not found in this list", "text/plain", 404);
            const to = before > from ? before - 1 : before;
            if (from !== to) {
              const [item] = items.splice(from, 1);
              items.splice(to, 0, item);
              publish();
            }
            return json();
          }
          if (
            (body.name !== undefined &&
              (typeof body.name !== "string" || !body.name.trim() || body.name.length > 120)) ||
            ((renameTab || renameWorkspace) && body.name === undefined)
          )
            return response("Name must be 1–120 characters", "text/plain", 400);
          if (typeof body.name === "string") body.name = body.name.trim();
          if ((deleteTab || deleteWorkspace) && body.confirm !== true)
            return response("Deletion requires confirm: true", "text/plain", 400);
          let cleanup: Promise<void> | undefined;
          if (createWorkspace) {
            if (body.cwd !== undefined && typeof body.cwd !== "string")
              return response("Invalid directory", "text/plain", 400);
            let cwd = resolve(defaultCwd, (body.cwd as string | undefined) ?? defaultCwd);
            try {
              cwd = realpathSync(cwd);
              if (!statSync(cwd).isDirectory()) throw new Error("Not a directory");
            } catch {
              return response("Directory not found", "text/plain", 400);
            }
            // Keep lookup and creation synchronous so concurrent Adds share one workspace.
            const existing = workspaces.find((workspace) => workspace.cwd === cwd);
            if (existing)
              return response(
                JSON.stringify({ ...state(), workspaceId: existing.id, created: false }),
                "application/json",
              );
            const workspace: Workspace = {
              id: randomUUID(),
              name: (body.name as string | undefined) ?? (basename(cwd) || cwd),
              cwd,
              tabs: [],
            };
            workspaces.push(workspace);
            addTab(workspace);
            publish();
            return response(
              JSON.stringify({ ...state(), workspaceId: workspace.id, created: true }),
              "application/json",
            );
          } else if (createTab && workspace) {
            const tab = addTab(workspace, body.name as string | undefined);
            publish();
            return response(JSON.stringify({ ...state(), tabId: tab.id }), "application/json");
          } else if (renameTab && tab) tab.name = body.name as string;
          else if (renameWorkspace && workspace) workspace.name = body.name as string;
          else if (deleteTab && tab) {
            const owner = workspaces.find((w) => w.tabs.includes(tab));
            if (!owner) throw new Error("Missing workspace for tab");
            owner.tabs.splice(owner.tabs.indexOf(tab), 1);
            cleanup = disposeTab(tab);
          } else if (deleteWorkspace && workspace) {
            workspaces.splice(workspaces.indexOf(workspace), 1);
            cleanup = Promise.all(workspace.tabs.map(disposeTab)).then(() => {});
          }
          publish();
          const result = json();
          if (cleanup) await cleanup;
          return result;
        }
        return response("Not found", "text/plain", 404);
      }
      if (request.method !== "GET") return response("Method not allowed", "text/plain", 405);
      if (url.pathname === "/audio-worklet.js") return response(CAPTURE_WORKLET, "text/javascript; charset=utf-8");
      if (url.pathname === "/") return response(options.assets.html, "text/html; charset=utf-8");
      if (url.pathname === "/terminal.js") return response(options.assets.javascript, "text/javascript; charset=utf-8");
      if (url.pathname === "/fonts/JetBrainsMonoNerdFontMono-Regular.woff2")
        return response(options.assets.font, "font/woff2");
      if (url.pathname === "/ghostty-vt.wasm") return response(options.assets.wasm, "application/wasm");
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
          socket.send(
            JSON.stringify({
              type: "audio-owner",
              id: socket.data.audioOwner,
              ownerId: publicOwnerId(String(socket.data.audioOwner)),
            }),
          );
        } else if (socket.data.channel === "state") {
          listeners.add(socket);
          sendState(socket, state());
        } else if (socket.data.channel === "live-audio") relay.websocket.open(audioSocket(socket));
      },
      message(socket, message) {
        if (socket.data.channel === "terminal") {
          let event: { type?: unknown; request?: unknown; message?: unknown } | null | undefined;
          try {
            event = JSON.parse(String(message));
          } catch {
            /* Terminal validates malformed input. */
          }
          if (event?.type === "audio-error" && typeof event.request === "string" && typeof event.message === "string")
            relay.failRequest(String(socket.data.tabId), String(socket.data.audioOwner), event.request, event.message);
          else tabs.get(String(socket.data.tabId))?.terminal.message(socket, message);
        } else if (socket.data.channel === "live-audio") relay.websocket.message(audioSocket(socket), message);
      },
      close(socket) {
        if (socket.data.channel === "terminal") {
          const tab = tabs.get(String(socket.data.tabId));
          if (tab) relay.releaseAttachment(tab.id, String(socket.data.audioOwner));
          tab?.terminal.detach(socket);
        } else if (socket.data.channel === "state") listeners.delete(socket);
        else if (socket.data.channel === "live-audio") relay.websocket.close(audioSocket(socket));
      },
    },
  });
  origin = server.url.origin;
  const initialWorkspace: Workspace = {
    id: "workspace",
    name: basename(defaultCwd) || defaultCwd,
    cwd: defaultCwd,
    tabs: [],
  };
  workspaces.push(initialWorkspace);
  const terminal = addTab(initialWorkspace, undefined, "terminal").terminal;
  publish();
  let stopped: Promise<void> | undefined;
  return {
    server,
    terminal,
    token,
    origin,
    url: origin + "/#token=" + token,
    stop() {
      stopped ??= (async () => {
        // Stop accepting connections immediately, then tear down owned resources.
        const cleanup = [...tabs.values()].map(disposeTab);
        server.stop(true);
        await Promise.all(cleanup);
      })();
      return stopped;
    },
  };
}
