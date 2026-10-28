import type { PageEvent, ServerEvent } from "../../../src/web/protocol";
import { setState } from "./store";

/** How long the page waits without a socket before it says so. */
const quietFor = 2000;

let socket: WebSocket | undefined;
let tries = 0;
let retry: ReturnType<typeof setTimeout> | undefined;
let quiet: ReturnType<typeof setTimeout> | undefined;
let started = false;
let opened = 0;
let onEvent: (event: ServerEvent) => void = () => {};

/** Counts sockets opened, so a `hello` can tell what was sent before it from what was sent after. */
export const generation = () => opened;

function address() {
  const key = new URLSearchParams(location.search).get("t") ?? "";
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/socket?t=${encodeURIComponent(key)}`;
}

function down() {
  setState({ online: false, fetching: false });
  quiet ??= setTimeout(() => setState({ offline: true }), quietFor);
}

function open() {
  clearTimeout(retry);
  retry = undefined;
  if (socket && socket.readyState <= WebSocket.OPEN) return;
  const ws = new WebSocket(address());
  socket = ws;
  ws.onopen = () => {
    opened++;
    tries = 0;
    clearTimeout(quiet);
    quiet = undefined;
    setState({ online: true, offline: false });
    // The server counts a new page as in front; a page opened in the background says otherwise.
    if (document.visibilityState !== "visible") ws.send(JSON.stringify({ type: "visible", visible: false }));
  };
  ws.onmessage = (message) => {
    if (typeof message.data !== "string") return;
    try {
      onEvent(JSON.parse(message.data) as ServerEvent);
    } catch {}
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = undefined;
    down();
    // Back off up to 10 s, with some jitter so many pages don't come back at once.
    const wait = Math.min(10_000, 500 * 2 ** tries++) * (0.75 + Math.random() * 0.5);
    retry = setTimeout(open, wait);
  };
}

/** Opens the socket and keeps it open, handing each event to `handle`. Safe to call more than once. */
export function connect(handle: (event: ServerEvent) => void) {
  if (started) return;
  started = true;
  onEvent = handle;
  down();
  open();
  // A phone that wakes up or gets its network back shouldn't wait out the backoff.
  const now = () => {
    // News goes to a page in front, and to push notifications otherwise.
    send({ type: "visible", visible: document.visibilityState === "visible" });
    if (document.visibilityState === "visible" && !socket) {
      tries = 0;
      open();
    }
  };
  document.addEventListener("visibilitychange", now);
  addEventListener("online", now);
}

/** Sends to the server. False when there is no socket, so the caller can keep what the user wrote. */
export function send(event: PageEvent): boolean {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(event));
  return true;
}

if (import.meta.hot) import.meta.hot.accept(() => location.reload());
