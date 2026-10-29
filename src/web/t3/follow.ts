import WebSocket from "ws";
import { protocolVersion } from "./feed";

/**
 * What the threads bruv follows say, as they say it. T3's shell feed tells when a thread's status changes
 * but not what it said, so each followed thread gets `orchestration.subscribeThread` too, all on one socket
 * (Effect RPC carries many requests on one). Each resumes from its own last position, which T3 answers with
 * only the events since (a few KB a run); a thread followed for the first time starts from the shell feed's
 * position, so only what it says from then on comes. Seen on T3 0.1.2-nightly.20261021.
 */
export type ThreadMessage = { threadId: string; id: string; text: string; at: string };

type Value =
  | { kind: "synchronized" }
  | { kind: "snapshot"; snapshotSequence: number; projection?: { messages?: Message[] } }
  | { kind: "event"; sequence: number; event: { type: string; payload?: unknown } };
type Message = { id: string; role: string; text: string; streaming?: boolean; createdAt?: string; updatedAt?: string };

const firstDelay = 500;
const maxDelay = 30_000;

export function followThreads(options: {
  /** Where T3 is and a fresh websocket ticket for it, or nothing when T3 can't be reached now. */
  connect: () => Promise<{ origin: string; ticket: string } | undefined>;
  /** The shell feed's position, where a newly followed thread starts. Negative while unknown. */
  position: () => number;
  onMessage: (message: ThreadMessage) => void;
}) {
  /** Each followed thread's last position, kept across sockets so a new one resumes. */
  const positions = new Map<string, number>();
  /** Messages already passed on, per thread, so a replay or an edit with the same text isn't news twice. */
  const told = new Map<string, Map<string, string>>();
  let wanted = new Set<string>();
  let socket: WebSocket | undefined;
  let closed = false;
  let delay = firstDelay;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const seen = (threadId: string, message: Message) => {
    let known = told.get(threadId);
    if (!known) {
      known = new Map();
      told.set(threadId, known);
    }
    if (known.get(message.id) === message.text) return true;
    known.set(message.id, message.text);
    for (const old of known.keys()) if (known.size > 50) known.delete(old);
    return false;
  };

  const handle = (threadId: string, values: Value[]) => {
    for (const value of values) {
      if (value.kind === "snapshot") {
        // A whole picture (the position was too old): what it holds is the past, not news.
        positions.set(threadId, value.snapshotSequence);
        for (const message of value.projection?.messages ?? []) seen(threadId, message);
        continue;
      }
      if (value.kind !== "event") continue;
      if (value.sequence <= (positions.get(threadId) ?? -1)) continue;
      positions.set(threadId, value.sequence);
      if (value.event.type !== "message.updated") continue;
      const message = value.event.payload as Message;
      // Streaming text comes again whole each time; only the finished message is passed on.
      if (message?.role !== "assistant" || message.streaming || !message.text?.trim()) continue;
      if (seen(threadId, message)) continue;
      options.onMessage({
        threadId,
        id: message.id,
        text: message.text,
        at: message.updatedAt ?? new Date().toISOString(),
      });
    }
  };

  const open = async () => {
    timer = undefined;
    if (closed || socket || !wanted.size) return;
    const start = options.position();
    const place = start < 0 ? undefined : await options.connect().catch(() => undefined);
    if (closed || socket) return;
    if (!place || !wanted.size) return retry();
    const url = new URL("/ws", place.origin.replace(/^http/, "ws"));
    url.searchParams.set("wsTicket", place.ticket);
    url.searchParams.set("orchestrationProtocol", String(protocolVersion));
    url.searchParams.set("clientDeviceType", "bot");
    const current = new WebSocket(url);
    socket = current;
    const threads = [...wanted];
    current.on("open", () => {
      delay = firstDelay;
      threads.forEach((threadId, index) => {
        if (!positions.has(threadId)) positions.set(threadId, start);
        current.send(
          JSON.stringify({
            _tag: "Request",
            id: String(index + 1),
            tag: "orchestration.subscribeThread",
            payload: { threadId, afterSequence: positions.get(threadId), requestCompletionMarker: true },
            headers: [],
          }),
        );
      });
    });
    current.on("message", (data) => {
      let message: { _tag?: string; requestId?: string; values?: Value[] };
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (message._tag === "Ping") return current.send(JSON.stringify({ _tag: "Pong" }));
      if (message._tag !== "Chunk") return;
      const threadId = threads[Number(message.requestId) - 1];
      try {
        if (threadId) handle(threadId, message.values ?? []);
      } finally {
        if (current.readyState === WebSocket.OPEN)
          current.send(JSON.stringify({ _tag: "Ack", requestId: message.requestId }));
      }
    });
    const end = () => {
      current.removeAllListeners();
      current.on("error", () => {});
      if (socket !== current) return;
      socket = undefined;
      retry();
    };
    current.on("close", end);
    current.on("error", end);
    current.on("unexpected-response", end);
  };

  const retry = () => {
    if (closed || timer || !wanted.size) return;
    timer = setTimeout(() => void open(), delay);
    timer.unref?.();
    delay = Math.min(delay * 2, maxDelay);
  };

  /** Starts over on a new socket, which resumes every thread from its own position. */
  const restart = () => {
    const old = socket;
    socket = undefined;
    old?.removeAllListeners();
    old?.on("error", () => {});
    old?.terminate();
    clearTimeout(timer);
    timer = undefined;
    delay = firstDelay;
    void open();
  };

  return {
    /** The threads to follow now. A change starts a new socket; positions carry over. */
    follow(ids: Iterable<string>) {
      const next = new Set(ids);
      if (next.size === wanted.size && [...next].every((id) => wanted.has(id))) return;
      wanted = next;
      for (const id of positions.keys()) if (!wanted.has(id)) positions.delete(id);
      for (const id of told.keys()) if (!wanted.has(id)) told.delete(id);
      restart();
    },
    /** T3 moved (another origin): positions mean nothing there. */
    reset() {
      positions.clear();
      told.clear();
      restart();
    },
    close() {
      closed = true;
      clearTimeout(timer);
      socket?.removeAllListeners();
      socket?.on("error", () => {});
      socket?.terminate();
      socket = undefined;
    },
  };
}
