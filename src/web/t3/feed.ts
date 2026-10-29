import WebSocket from "ws";
import { call } from "./keys";
import type { T3Project, T3Thread } from "./thread";

/**
 * T3's live overview: the app's websocket speaks Effect RPC, and `orchestration.subscribeShell` streams these
 * values. This is T3's private, versioned protocol (version 2 here), seen on T3 0.1.2-nightly.20261021.
 */
export const protocolVersion = 2;

export type ShellValue =
  /**
   * The whole overview. A snapshot that names `resolvedRepositoryIdentityRoots` is not whole: it has no threads and
   * only refreshes the git identity of some projects, which bruv does not use.
   */
  | {
      kind: "snapshot";
      snapshot: { snapshotSequence: number; threads: T3Thread[]; projects: T3Project[] };
      resolvedRepositoryIdentityRoots?: string[];
    }
  /** Location `archive` means the thread was just archived. */
  | { kind: "thread.updated"; sequence: number; location: "active" | "archive"; thread: T3Thread }
  | { kind: "thread.removed"; sequence: number; location?: "active" | "archive"; threadId: string }
  | { kind: "project.updated"; sequence: number; project: T3Project }
  | { kind: "project.removed"; sequence: number; projectId: string }
  /** Ends the catch-up; sent only when asked for with `requestCompletionMarker`. */
  | { kind: "synchronized" };

/** Why a feed stopped. */
export type FeedEnd =
  | { kind: "incompatible"; version?: number }
  /** T3 refused the ticket. */
  | { kind: "refused" }
  | { kind: "closed"; reason: string };

export async function ticket(origin: string, session: string) {
  const body = await call(`${origin}/api/auth/websocket-ticket`, {
    method: "POST",
    headers: { authorization: `Bearer ${session}` },
  });
  if (typeof body.ticket !== "string") throw new Error("T3 gave no websocket ticket");
  return body.ticket;
}

/**
 * Opens the socket and follows the shell until it ends. Each Chunk is acked after `onValues` sees it.
 * With `after`, T3 sends only what changed since that position, or a whole snapshot if it can't (too old or
 * unknown). Either way it ends the catch-up with `synchronized`. Seen on the real server: a resume is a few KB
 * where a whole snapshot is about 1.8 MB (sent compressed, as T3 accepts permessage-deflate).
 */
export function followShell(
  origin: string,
  wsTicket: string,
  after: number | undefined,
  onValues: (values: ShellValue[]) => void,
) {
  const url = new URL("/ws", origin.replace(/^http/, "ws"));
  url.searchParams.set("wsTicket", wsTicket);
  url.searchParams.set("orchestrationProtocol", String(protocolVersion));
  url.searchParams.set("clientDeviceType", "bot");
  const socket = new WebSocket(url);
  let finish: (end: FeedEnd) => void = () => {};
  const done = new Promise<FeedEnd>((resolve) => {
    finish = (end) => {
      finish = () => {};
      clearInterval(beat);
      socket.removeAllListeners();
      socket.on("error", () => {});
      socket.terminate();
      resolve(end);
    };
  });
  // Notice a dead link: the server answers pings by itself.
  let answered = true;
  const beat = setInterval(() => {
    if (!answered) return finish({ kind: "closed", reason: "T3 stopped answering" });
    answered = false;
    socket.ping();
  }, 20_000);
  beat.unref?.();
  socket.on("pong", () => {
    answered = true;
  });
  socket.on("unexpected-response", (_request, response) => {
    let body = "";
    response.on("data", (data: Buffer) => {
      body += data;
    });
    response.on("end", () => {
      if (response.statusCode === 401) return finish({ kind: "refused" });
      let parsed: { code?: string; orchestrationProtocolVersion?: number } = {};
      try {
        parsed = JSON.parse(body);
      } catch {}
      if (response.statusCode === 426 || parsed.code === "orchestration_protocol_incompatible")
        return finish({ kind: "incompatible", version: parsed.orchestrationProtocolVersion });
      finish({ kind: "closed", reason: `T3 answered ${response.statusCode}` });
    });
  });
  socket.on("open", () => {
    socket.send(
      JSON.stringify({
        _tag: "Request",
        id: "1",
        tag: "orchestration.subscribeShell",
        payload:
          after === undefined
            ? { requestCompletionMarker: true }
            : { afterSequence: after, requestCompletionMarker: true },
        headers: [],
      }),
    );
  });
  socket.on("message", (data) => {
    let message: { _tag?: string; requestId?: string; values?: ShellValue[] };
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (message._tag === "Chunk") {
      try {
        onValues(message.values ?? []);
      } finally {
        if (socket.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify({ _tag: "Ack", requestId: message.requestId }));
      }
    } else if (message._tag === "Ping") socket.send(JSON.stringify({ _tag: "Pong" }));
    else if (message._tag === "Exit" || message._tag === "Defect" || message._tag === "ClientProtocolError")
      finish({ kind: "closed", reason: `T3 ended the feed (${message._tag})` });
  });
  socket.on("close", () => finish({ kind: "closed", reason: "T3 closed the connection" }));
  socket.on("error", (error) => finish({ kind: "closed", reason: error.message }));
  return { done, close: () => finish({ kind: "closed", reason: "closed" }) };
}

/**
 * One call to T3's app API over a socket of its own, answered with its value. Used for what MCP can't do,
 * like answering a thread's permission request or making a link to a thread's file; those are rare next to
 * the live feed, whose socket stays as it is.
 */
export function rpc(origin: string, wsTicket: string, tag: string, payload: Record<string, unknown>): Promise<unknown> {
  const url = new URL("/ws", origin.replace(/^http/, "ws"));
  url.searchParams.set("wsTicket", wsTicket);
  url.searchParams.set("orchestrationProtocol", String(protocolVersion));
  url.searchParams.set("clientDeviceType", "bot");
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const end = (error?: Error, value?: unknown) => {
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.on("error", () => {});
      socket.close();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => end(new Error("T3 didn't answer")), 15_000);
    socket.on("open", () => {
      socket.send(JSON.stringify({ _tag: "Request", id: "1", tag, payload, headers: [] }));
    });
    socket.on("message", (data) => {
      let message: { _tag?: string; exit?: { _tag?: string; value?: unknown; cause?: unknown } };
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (message._tag === "Ping") socket.send(JSON.stringify({ _tag: "Pong" }));
      else if (message._tag === "Exit")
        message.exit?._tag === "Success"
          ? end(undefined, message.exit.value)
          : end(new T3RpcError(message.exit?.cause ?? message));
      else if (message._tag === "Defect" || message._tag === "ClientProtocolError")
        end(new Error(`T3 refused it: ${message._tag}`));
    });
    socket.on("unexpected-response", (_request, response) =>
      end(new T3SocketError(`T3 answered ${response.statusCode}`, response.statusCode ?? 0)),
    );
    socket.on("error", (error) => end(error));
  });
}

/** Sends one command (`orchestration.dispatchCommand`) and waits for T3 to take it. */
export async function dispatch(origin: string, wsTicket: string, command: Record<string, unknown>): Promise<void> {
  await rpc(origin, wsTicket, "orchestration.dispatchCommand", { commandId: crypto.randomUUID(), ...command });
}

/** T3 answered a call with a failure. `tag` is its error's name, like `AssetPreviewTypeValidationError`. */
export class T3RpcError extends Error {
  readonly tag: string | undefined;
  constructor(cause: unknown) {
    const first = Array.isArray(cause) ? (cause[0] as { error?: { _tag?: string; message?: string } }) : undefined;
    super(`T3 refused it: ${first?.error?.message ?? JSON.stringify(cause).slice(0, 300)}`);
    this.tag = first?.error?._tag;
  }
}

/** A socket T3 turned away, with its HTTP status (401: the key was refused). */
export class T3SocketError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
