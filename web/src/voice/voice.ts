/**
 * Voice in the page, loaded on the first tap of the talk button: the microphone, playback and the `/voice`
 * socket, ported from the old voice page (src/voice/page.html; why it works this way is in live-mode.md).
 *
 * One button, two ways to talk: holding it is a turn, and a tap (shorter than `tapTime`) turns hands-free
 * on or off. Optimistic: the button reacts at once and the microphone and socket catch up; what would be
 * sent before the socket opens waits in an outbox.
 */
import { getVoice, level, setVoice, type VoiceState } from "./load";
import { openMic } from "./mic";
import { Player } from "./player";

const tapTime = 280;

let socket: WebSocket | undefined;
let outbox: (string | ArrayBuffer)[] = [];
let tries = 0;
let retry: ReturnType<typeof setTimeout> | undefined;
let quiet: ReturnType<typeof setTimeout> | undefined;
let audio: { input: AudioContext; output: AudioContext } | undefined;
let player: Player | undefined;
let mic: Awaited<ReturnType<typeof openMic>> | undefined;
let wakeLock: WakeLockSentinel | undefined;
let pressedAt = 0;
/** After a held turn is let go: the last word often ends just after the finger lifts. */
let tail: ReturnType<typeof setTimeout> | undefined;
/** While hands-free is on, a press becomes a held turn only once it outlasts a tap. */
let hold: ReturnType<typeof setTimeout> | undefined;

/** Whether microphone audio goes to bruv; none while the models it needs are missing. */
const sending = () => {
  const { free, holding, need } = getVoice();
  return !need && (free || holding || tail !== undefined);
};

function send(message: object | ArrayBuffer) {
  const data = message instanceof ArrayBuffer ? message : JSON.stringify(message);
  if (socket?.readyState === WebSocket.OPEN) return socket.send(data);
  outbox.push(data);
  // About 20 seconds of audio; the oldest audio goes first.
  if (outbox.length > 1000)
    outbox.splice(
      outbox.findIndex((item) => item instanceof ArrayBuffer),
      1,
    );
}

function connect() {
  retry = undefined;
  const key = new URLSearchParams(location.search).get("t") ?? "";
  const ws = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/voice?t=${encodeURIComponent(key)}`,
  );
  ws.binaryType = "arraybuffer";
  socket = ws;
  ws.onopen = () => {
    tries = 0;
    clearTimeout(quiet);
    quiet = undefined;
    player?.reconnected();
    // Voice is on in this page; then whatever waited, such as a turn held through a drop.
    ws.send(JSON.stringify({ type: "mic" }));
    for (const data of outbox.splice(0)) ws.send(data);
    setVoice({ offline: false });
  };
  ws.onmessage = (message) => {
    if (typeof message.data === "string") onEvent(JSON.parse(message.data));
    else player?.play(message.data as ArrayBuffer);
  };
  ws.onclose = (event) => {
    if (socket !== ws) return;
    socket = undefined;
    // bruv stopped: voice goes off rather than trying again.
    if (event.code === 4000) return off();
    if (getVoice().holding || tail !== undefined) outbox.unshift(JSON.stringify({ type: "talk", on: true }));
    // A short drop isn't worth showing.
    quiet ??= setTimeout(() => setVoice({ offline: true }), 2000);
    retry = setTimeout(connect, Math.min(4000, 500 * 2 ** tries++));
  };
}

type ServerEvent =
  | { type: "state"; state: VoiceState["state"] }
  | { type: "partial"; text: string }
  | { type: "user" }
  | { type: "rate"; rate: number }
  | { type: "part"; part: number }
  | { type: "pause"; soft?: boolean }
  | { type: "resume" }
  | { type: "flush" }
  | { type: "error"; message: string }
  | { type: "models"; mb: number; downloading?: boolean }
  | { type: "progress"; text: string };

function onEvent(event: ServerEvent) {
  switch (event.type) {
    case "state":
      // Words heard that were only echo or noise never become a line.
      setVoice({
        state: event.state,
        need: 0,
        progress: "",
        ...(event.state === "hearing" ? {} : { partial: "" }),
      });
      return;
    case "partial":
      setVoice({ partial: event.text });
      return;
    case "user":
      // Talking to it means you want to hear the answer.
      setVoice({ partial: "" });
      player?.setMuted(false);
      return;
    case "rate":
      if (player) player.rate = event.rate;
      return;
    case "part":
      if (player) player.incoming = event.part;
      return;
    case "pause": {
      if (!player) return;
      // Only the microphone hearing something turns the reply down, as it may be its own echo; a press stops
      // it, unless it turns out to be a tap.
      player.duck();
      const { holding } = getVoice();
      if (event.soft || (!holding && tail === undefined)) return;
      player.suspend(holding ? tapTime - (performance.now() - pressedAt) : 0, () => getVoice().holding || !!tail);
      return;
    }
    case "resume":
      player?.resume();
      return;
    case "flush":
      player?.flush();
      return;
    case "error":
      setVoice({ error: event.message });
      return;
    case "models":
      setVoice({ need: event.mb, progress: event.downloading ? "Downloading…" : "" });
      return;
    case "progress":
      setVoice({ progress: event.text });
      return;
  }
}

/** The level shown on the talk button: the user's voice while it is sent, else the reply's. */
let shown = 0;
let smooth = 0;
function frame() {
  if (!getVoice().on) return;
  requestAnimationFrame(frame);
  const heard = sending() && mic ? mic.level() * 4 : 0;
  const target = Math.min(1, Math.max(heard, (player?.level() ?? 0) * 3));
  smooth += (target - smooth) * (target > smooth ? 0.5 : 0.12);
  if (Math.abs(smooth - shown) < 0.01) return;
  shown = smooth;
  level.element?.style.setProperty("--level", smooth.toFixed(2));
}

async function keepAwake() {
  // Keeps a phone awake while voice is on; the browser lets go of it when the page is hidden.
  if (document.visibilityState !== "visible" || !getVoice().on) return;
  wakeLock = await navigator.wakeLock?.request("screen").catch(() => undefined);
}

function start(contexts: { input: AudioContext; output: AudioContext }) {
  audio = contexts;
  player = new Player(
    contexts.output,
    (part) => send({ type: "played", part }),
    () => setVoice({ playing: player?.playing ?? false, muted: player?.muted ?? false }),
  );
  setVoice({ on: true, state: "starting", free: false, muted: false, playing: false, partial: "", error: "" });
  connect();
  void keepAwake();
  document.addEventListener("visibilitychange", keepAwake);
  requestAnimationFrame(frame);
  openMic(contexts.input, (pcm) => {
    if (sending()) send(pcm);
  }).then(
    (opened) => {
      if (audio === contexts) mic = opened;
      else opened.close();
    },
    (error: Error) => {
      off();
      setVoice({ error: `Microphone: ${error.message}` });
    },
  );
}

/** Turns voice off in this page: the microphone, sound and socket all close, so nothing is kept. */
export function off() {
  clearTimeout(retry);
  clearTimeout(quiet);
  clearTimeout(tail);
  clearTimeout(hold);
  retry = quiet = tail = hold = undefined;
  const ws = socket;
  socket = undefined;
  ws?.close(1000);
  outbox = [];
  mic?.close();
  mic = undefined;
  void audio?.input.close();
  void audio?.output.close();
  audio = undefined;
  player = undefined;
  void wakeLock?.release();
  wakeLock = undefined;
  document.removeEventListener("visibilitychange", keepAwake);
  level.element?.style.removeProperty("--level");
  shown = smooth = 0;
  setVoice({ on: false, free: false, holding: false, playing: false, offline: false, partial: "", need: 0 });
}

/** The talk button went down at `at`; `contexts` come with the press that turns voice on. */
export function down(at: number, contexts?: { input: AudioContext; output: AudioContext }) {
  if (contexts) start(contexts);
  if (!audio) return;
  const { free } = getVoice();
  pressedAt = at;
  navigator.vibrate?.(8);
  setVoice({ holding: true });
  // Pressing again just after letting go carries on the same turn.
  if (tail !== undefined) {
    clearTimeout(tail);
    tail = undefined;
  } else if (free) {
    // Hands-free already sends everything; a tap that turns it off then leaves a reply playing, and the
    // words since the press are kept.
    hold = setTimeout(
      () => {
        hold = undefined;
        send({ type: "talk", on: true, keep: true });
      },
      Math.max(0, tapTime - (performance.now() - at)),
    );
  } else send({ type: "talk", on: true });
}

export function up(at: number) {
  const { holding, free } = getVoice();
  if (!holding) return;
  if (at - pressedAt < tapTime) {
    // A tap. Turning hands-free on hands the turn to silence detection, so words said right away are kept;
    // turning it off ends the turn now.
    clearTimeout(hold);
    hold = undefined;
    setVoice({ holding: false, free: !free });
    send({ type: "talk", on: false, keep: !free });
    return;
  }
  setVoice({ holding: false });
  tail = setTimeout(() => {
    tail = undefined;
    send({ type: "talk", on: false });
  }, 300);
}

export const mute = () => player?.setMuted(!player.muted);

/** Stops speaking; the assistant goes on with its work. */
export function hush() {
  player?.flush();
  send({ type: "hush" });
}

export const download = () => send({ type: "download" });

if (import.meta.hot) import.meta.hot.accept(() => location.reload());
