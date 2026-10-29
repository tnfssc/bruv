import WebSocket from "ws";
import { protocolVersion } from "./feed";

/**
 * What the threads bruv follows say, as they say it. T3's shell feed tells when a thread's status changes
 * but not what it said, so each followed thread gets `orchestration.subscribeThread` too, all on one socket
 * (Effect RPC carries many requests on one). A thread followed for the first time starts with a bounded
 * snapshot, whose messages are the past; after that each resumes from its own last position, which T3
 * answers with only the events since (a few KB a run). Positions are the thread's own: T3 answers a position
 * past the thread's last event, or more than 128 events back, with a snapshot (T3's `ws.ts`, v0.1.4 and the
 * 0.1.2 nightly alike).
 */
export type ThreadMessage = { threadId: string; id: string; text: string; at: string };

type Value =
  | { kind: "synchronized" }
  | { kind: "snapshot"; snapshotSequence: number; projection?: { messages?: Message[] } }
  | { kind: "event"; sequence: number; event: { type: string; payload?: unknown } };
type Message = {
  id: string;
  role: string;
  text: string;
  runId?: string;
  streaming?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

/** A run's end, as `run.updated` says it. */
const ended = new Set(["completed", "interrupted", "failed", "cancelled", "rolled_back"]);

const firstDelay = 500;
const maxDelay = 30_000;

export function followThreads(options: {
  /** Where T3 is and a fresh websocket ticket for it, or nothing when T3 can't be reached now. */
  connect: () => Promise<{ origin: string; ticket: string } | undefined>;
  onMessage: (message: ThreadMessage) => void;
}) {
  /** Each followed thread's last position, kept across sockets so a new one resumes. */
  const positions = new Map<string, number>();
  /** Messages already passed on, per thread, so a replay or an edit with the same text isn't news twice. */
  const told = new Map<string, Map<string, string>>();
  /** When each thread started being followed: what it said before that is the past. */
  const since = new Map<string, number>();
  /** Each run's latest assistant message, to pass on when the run ends with it still marked streaming. */
  const latest = new Map<string, { threadId: string; message: Message }>();
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

  const tell = (threadId: string, message: Message) => {
    if (!message.text?.trim() || seen(threadId, message)) return;
    options.onMessage({
      threadId,
      id: message.id,
      text: message.text,
      at: message.updatedAt ?? new Date().toISOString(),
    });
  };

  const handle = (threadId: string, values: Value[]) => {
    for (const value of values) {
      if (value.kind === "snapshot") {
        // A whole picture: on first following, the past. When it replaced a resume, it may hold what was
        // said while bruv wasn't listening: finished messages from after following began are passed on.
        positions.set(threadId, value.snapshotSequence);
        const from = since.get(threadId) ?? Date.now();
        for (const message of value.projection?.messages ?? []) {
          if (message.role !== "assistant") continue;
          if (!message.streaming && Date.parse(message.updatedAt ?? "") > from) tell(threadId, message);
          else seen(threadId, message);
        }
        continue;
      }
      if (value.kind !== "event") continue;
      if (value.sequence <= (positions.get(threadId) ?? -1)) continue;
      positions.set(threadId, value.sequence);
      const payload = value.event.payload as (Message & { status?: string }) | undefined;
      if (value.event.type === "run.updated" && payload && ended.has(payload.status ?? "")) {
        // T3 normally marks the last message finished; this catches one it left streaming.
        const last = latest.get(payload.id);
        latest.delete(payload.id);
        if (last) tell(last.threadId, last.message);
        continue;
      }
      if (value.event.type !== "message.updated" || payload?.role !== "assistant") continue;
      if (payload.runId) {
        latest.set(payload.runId, { threadId, message: payload });
        for (const old of latest.keys()) if (latest.size > 100) latest.delete(old);
      }
      // Streaming text comes again whole each time; only the finished message is passed on.
      if (!payload.streaming) tell(threadId, payload);
    }
  };

  const open = async () => {
    timer = undefined;
    if (closed || socket || !wanted.size) return;
    const place = await options.connect().catch(() => undefined);
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
        if (!since.has(threadId)) since.set(threadId, Date.now());
        const after = positions.get(threadId);
        current.send(
          JSON.stringify({
            _tag: "Request",
            id: String(index + 1),
            tag: "orchestration.subscribeThread",
            payload: {
              threadId,
              requestCompletionMarker: true,
              ...(after === undefined ? { acceptBoundedSnapshot: true } : { afterSequence: after }),
            },
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
      for (const id of since.keys()) if (!wanted.has(id)) since.delete(id);
      restart();
    },
    /** T3 moved (another origin): positions mean nothing there. */
    reset() {
      positions.clear();
      told.clear();
      since.clear();
      latest.clear();
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
