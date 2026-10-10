import { randomBytes, timingSafeEqual } from "node:crypto";
import type { ServerWebSocket } from "bun";
import { AUDIO_MAX_BUFFER, AUDIO_MAX_MESSAGE, parseAudio } from "../live/browser-protocol";

export type AudioRelayData = {
  channel: "live-audio";
  sessionId: string;
  role: "cli" | "browser";
  authenticated: boolean;
  admission?: string;
  timer?: ReturnType<typeof setTimeout>;
};
type Socket = ServerWebSocket<AudioRelayData>;
type Session = {
  secret: string;
  cli?: Socket;
  browser?: Socket;
  tickets: Map<string, string | undefined>;
  pending: Set<Socket>;
};
export interface AudioRelayOptions {
  pathname?: string;
  /** Verify exact Origin, web auth and an attached capability. Return its ID to scope voice release. */
  authorizeBrowser(request: Request, sessionId: string): string | false;
  requestBrowser?(sessionId: string, ownerId: string, request: string): boolean;
  cancelBrowser?(sessionId: string, ownerId: string, request: string): void;
  onOwnerChange?(owner: { tabId: string; ownerId: string } | null): void;
}
/** Mount in the terminal server. This relay never owns jobs or provider connections. */
export function createAudioRelay(options: AudioRelayOptions) {
  const sessions = new Map<string, Session>();
  // Reserve on the CLI request, before any browser can acquire devices.
  let browserOwner:
    | { sessionId: string; session: Session; admission?: string; ownerId: string; request: string }
    | undefined;
  function clearOwner() {
    if (!browserOwner) return;
    const owner = browserOwner;
    options.cancelBrowser?.(owner.sessionId, owner.ownerId, owner.request);
    browserOwner = undefined;
    options.onOwnerChange?.(null);
  }
  const pathname = options.pathname ?? "/api/live/audio";
  function closeSession(s: Session) {
    if (browserOwner?.session === s) clearOwner();
    const sockets = new Set([...s.pending, s.cli, s.browser]);
    s.cli = s.browser = undefined;
    s.pending.clear();
    for (const ws of sockets)
      if (ws) {
        clearTimeout(ws.data.timer);
        ws.close(1000, "Voice released");
      }
  }
  function send(ws: Socket, value: unknown) {
    const text = JSON.stringify(value);
    if (ws.getBufferedAmount() + text.length > AUDIO_MAX_BUFFER || ws.send(text) <= 0) {
      const s = sessions.get(ws.data.sessionId);
      if (s) closeSession(s);
      return false;
    }
    return true;
  }
  function pair(s: Session) {
    if (s.cli && s.browser) {
      clearTimeout(s.cli.data.timer);
      send(s.cli, { type: "hello" });
    }
  }
  return {
    pathname,
    /** Call once when spawning a terminal CLI; secret is server/CLI-only. */
    registerSession(sessionId: string): string {
      if (!sessionId || sessions.has(sessionId)) throw new Error("Audio session already registered or empty");
      const secret = randomBytes(32).toString("hex");
      sessions.set(sessionId, { secret, tickets: new Map(), pending: new Set() });
      return secret;
    },
    inputTicket(sessionId: string, ownerId: string | undefined, previous?: string): string {
      const s = sessions.get(sessionId);
      if (!s) throw new Error("Unknown audio session");
      // Input labels can share an unspent ticket. Admission still consumes it once.
      if (ownerId && previous && s.tickets.get(previous) === ownerId) return previous;
      const ticket = randomBytes(16).toString("hex");
      s.tickets.set(ticket, ownerId);
      while (s.tickets.size > 64) {
        const oldest = s.tickets.keys().next().value;
        if (oldest === undefined) throw new Error("Expected an input ticket");
        s.tickets.delete(oldest);
      }
      return ticket;
    },
    failRequest(sessionId: string, ownerId: string, request: string, message: string) {
      const s = sessions.get(sessionId);
      if (s && browserOwner?.session === s && browserOwner.ownerId === ownerId && browserOwner.request === request) {
        if (s.cli)
          // biome-ignore lint/suspicious/noControlCharactersInRegex: Strip control bytes from browser error text.
          send(s.cli, { type: "request-error", message: message.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 500) });
        closeSession(s);
      }
    },
    /** An observer leaving must not release another attachment's voice. */
    releaseAttachment(sessionId: string, ownerId: string) {
      const s = sessions.get(sessionId);
      if (s) for (const [ticket, owner] of s.tickets) if (owner === ownerId) s.tickets.delete(ticket);
      if (browserOwner?.session === sessions.get(sessionId) && browserOwner?.ownerId === ownerId)
        closeSession(browserOwner.session);
    },
    /** Call on terminal disposal/logout; closes audio sockets, not jobs. */
    unregisterSession(sessionId: string) {
      const s = sessions.get(sessionId);
      if (s) {
        sessions.delete(sessionId);
        closeSession(s);
      }
    },
    matches(request: Request) {
      return new URL(request.url).pathname === pathname;
    },
    upgrade(
      request: Request,
      server: {
        upgrade(request: Request, options: { data: AudioRelayData; headers?: Record<string, string> }): boolean;
      },
    ): Response | undefined {
      const url = new URL(request.url);
      if (url.pathname !== pathname) return new Response("Not found", { status: 404 });
      const sessionId = url.searchParams.get("session") ?? "";
      const role = url.searchParams.get("role");
      const origin = request.headers.get("origin");
      const s = sessions.get(sessionId);
      if (!s || (role !== "cli" && role !== "browser")) return new Response("Forbidden", { status: 403 });
      let admission: string | undefined;
      if (role === "browser") {
        const owner = options.authorizeBrowser(request, sessionId);
        if (!owner) return new Response("Forbidden", { status: 403 });
        if (
          !browserOwner ||
          browserOwner.session !== s ||
          browserOwner.ownerId !== owner ||
          browserOwner.request !== url.searchParams.get("request") ||
          s.browser ||
          browserOwner.admission
        )
          return new Response("No microphone request for this attachment", { status: 403 });
        admission = randomBytes(16).toString("hex");
        browserOwner.admission = admission;
        options.onOwnerChange?.({ tabId: sessionId, ownerId: owner });
      } else if (origin) return new Response("Forbidden", { status: 403 });
      const protocols = request.headers
        .get("sec-websocket-protocol")
        ?.split(",")
        .map((value) => value.trim());
      const upgraded = server.upgrade(request, {
        data: { channel: "live-audio", sessionId, role, authenticated: role === "browser", admission },
        ...(protocols?.includes("bruv-audio") ? { headers: { "Sec-WebSocket-Protocol": "bruv-audio" } } : {}),
      });
      if (upgraded) return;
      if (admission && browserOwner?.admission === admission) {
        if (s.cli)
          send(s.cli, { type: "request-error", message: "Browser audio connection failed. Type /live to retry." });
        closeSession(s);
      }
      return new Response("WebSocket required", { status: 400 });
    },
    websocket: {
      open(ws: Socket) {
        const s = sessions.get(ws.data.sessionId);
        if (!s) return ws.close(1008, "Unknown session");
        if (ws.data.role === "browser") {
          if (browserOwner?.session !== s || browserOwner.admission !== ws.data.admission || s.browser)
            return ws.close(1008, "Stale admission");
          s.browser = ws;
          pair(s);
        } else {
          if (s.cli || s.pending.size) return ws.close(1008, "Already attached");
          s.pending.add(ws);
          ws.data.timer = setTimeout(() => ws.close(1008, "Authentication timed out"), 5000);
        }
      },
      message(ws: Socket, message: string | Buffer) {
        const s = sessions.get(ws.data.sessionId);
        if (!s || typeof message !== "string" || message.length > AUDIO_MAX_MESSAGE)
          return ws.close(1008, "Invalid audio message");
        if (!ws.data.authenticated) {
          if (!s.pending.has(ws)) return ws.close(1008, "Stale session");
          let m: { type?: unknown; secret?: unknown; request?: unknown };
          try {
            m = JSON.parse(message);
          } catch {
            return ws.close(1008, "Invalid authentication");
          }
          const secret = typeof m?.secret === "string" ? Buffer.from(m.secret) : Buffer.alloc(0);
          if (
            m?.type !== "hello" ||
            secret.length !== s.secret.length ||
            !timingSafeEqual(secret, Buffer.from(s.secret)) ||
            s.cli
          )
            return ws.close(1008, "Forbidden");
          clearTimeout(ws.data.timer);
          s.pending.delete(ws);
          ws.data.authenticated = true;
          s.cli = ws;
          ws.data.timer = setTimeout(() => closeSession(s), 30_000);
          const ticket = typeof m.request === "string" ? m.request : "";
          const ownerId = s.tickets.get(ticket);
          s.tickets.delete(ticket);
          const reject = (message: string) => {
            send(ws, { type: "request-error", message });
            closeSession(s);
          };
          if (!ownerId)
            return reject(
              "Voice needs an unmixed browser command. Clear the prompt, then type /live again in one browser.",
            );
          if (browserOwner)
            return reject("Voice is already active in another browser or terminal. Stop it there first.");
          browserOwner = { sessionId: ws.data.sessionId, session: s, ownerId, request: ticket };
          if (!options.requestBrowser?.(ws.data.sessionId, ownerId, ticket))
            return reject("The requesting browser detached. Type /live again after reconnecting.");
          return;
        }
        if ((ws.data.role === "cli" ? s.cli : s.browser) !== ws) return ws.close(1008, "Stale session");
        const event = parseAudio(message, ws.data.role);
        if (!event) {
          closeSession(s);
          return;
        }
        const peer = ws.data.role === "cli" ? s.browser : s.cli;
        if (peer) send(peer, event);
        // Before CLI starts there is nothing to capture or acknowledge. Drop, never queue.
      },
      close(ws: Socket) {
        clearTimeout(ws.data.timer);
        const s = sessions.get(ws.data.sessionId);
        if (!s) return;
        s.pending.delete(ws);
        if (
          s.cli === ws ||
          s.browser === ws ||
          (ws.data.role === "browser" && browserOwner?.session === s && browserOwner.admission === ws.data.admission)
        )
          closeSession(s);
      },
    },
  };
}
