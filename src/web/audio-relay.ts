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
type Session = { secret: string; generation: number; cli?: Socket; browser?: Socket; pending: Set<Socket> };
export interface AudioRelayOptions {
  pathname?: string;
  /** Exact externally visible origins (scheme + host + port), never a wildcard. */
  allowedOrigins: readonly string[];
  /** Verify web auth and an attached capability. Return its ID to scope voice release. */
  authorizeBrowser(request: Request, sessionId: string): boolean | string | Promise<boolean | string>;
  onOwnerChange?(owner: { tabId: string; ownerId: string } | null): void;
}
/** Mount in the terminal server. This relay never owns jobs or provider connections. */
export function createAudioRelay(options: AudioRelayOptions) {
  const sessions = new Map<string, Session>();
  // Reserve at upgrade, not open: concurrent tabs must not both gain voice.
  let browserOwner: { session: Session; admission: string; ownerId?: string } | undefined;
  function clearOwner() {
    if (!browserOwner) return;
    browserOwner = undefined;
    options.onOwnerChange?.(null);
  }
  const pathname = options.pathname ?? "/api/live/audio";
  function closeSession(s: Session) {
    s.generation++;
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
      sessions.set(sessionId, { secret, generation: 0, pending: new Set() });
      return secret;
    },
    /** Release current voice without revoking the surviving CLI's launch secret. */
    releaseSession(sessionId: string) {
      const s = sessions.get(sessionId);
      if (s) closeSession(s);
    },
    /** An observer leaving must not release another attachment's voice. */
    releaseAttachment(sessionId: string, ownerId: string) {
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
    async upgrade(
      request: Request,
      server: {
        upgrade(request: Request, options: { data: AudioRelayData; headers?: Record<string, string> }): boolean;
      },
    ): Promise<Response | undefined> {
      const url = new URL(request.url);
      if (url.pathname !== pathname) return new Response("Not found", { status: 404 });
      const sessionId = url.searchParams.get("session") ?? "";
      const role = url.searchParams.get("role");
      const origin = request.headers.get("origin");
      const s = sessions.get(sessionId);
      if (!s || (role !== "cli" && role !== "browser")) return new Response("Forbidden", { status: 403 });
      let admission: string | undefined;
      if (role === "browser") {
        if (!origin || !options.allowedOrigins.includes(origin)) return new Response("Forbidden", { status: 403 });
        const generation = s.generation;
        // Synchronous ownership checks and reservation stay in one turn.
        const authorization = options.authorizeBrowser(request, sessionId);
        const owner =
          typeof authorization === "boolean" || typeof authorization === "string" ? authorization : await authorization;
        if (!owner) return new Response("Forbidden", { status: 403 });
        if (sessions.get(sessionId) !== s || s.generation !== generation)
          return new Response("Forbidden", { status: 403 });
        if (browserOwner) return new Response("Voice already attached", { status: 409 });
        admission = randomBytes(16).toString("hex");
        const ownerId = typeof owner === "string" ? owner : undefined;
        browserOwner = { session: s, admission, ownerId };
        if (ownerId) options.onOwnerChange?.({ tabId: sessionId, ownerId });
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
      if (admission && browserOwner?.admission === admission) clearOwner();
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
          let m: { type?: unknown; secret?: unknown };
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
          pair(s);
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
