/**
 * The small part of voice that ships with the page: its state for the talk button and the voice line, and
 * a loader for the rest (microphone, playback, its socket), which is fetched on the first tap. Plain TS
 * outside React, so a hot reload of a component keeps a call going.
 */

export type VoiceState = {
  /** Voice is on in this page: replies are spoken and the microphone is open. */
  on: boolean;
  /** The call's state from bruv. */
  state: "starting" | "listening" | "hearing" | "thinking" | "speaking";
  /** Hands-free: the microphone is always sent and silence ends a turn. */
  free: boolean;
  /** The talk button (or Space) is down. */
  holding: boolean;
  muted: boolean;
  /** Some reply audio is queued or playing. */
  playing: boolean;
  /** The voice socket has been down for a while. */
  offline: boolean;
  /** Words being heard, before the turn ends. */
  partial: string;
  /** MB of speech models bruv needs before voice can start, and how their download goes. */
  need: number;
  progress: string;
  error: string;
};

let state: VoiceState = {
  on: false,
  state: "starting",
  free: false,
  holding: false,
  muted: false,
  playing: false,
  offline: false,
  partial: "",
  need: 0,
  progress: "",
  error: "",
};
const listeners = new Set<() => void>();

export const getVoice = () => state;
export function setVoice(change: Partial<VoiceState>) {
  state = { ...state, ...change };
  for (const listener of listeners) listener();
}
export function subscribeVoice(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The talk button, which shows the voice level through its `--level` property. */
export const level: { element?: HTMLElement | null } = {};

type Voice = typeof import("./voice");
let loading: Promise<Voice> | undefined;
/** Runs in order: a press and its release keep their order while the voice code loads. */
let queue: Promise<unknown> = Promise.resolve();

export const preload = () => {
  loading ??= import("./voice");
  return loading;
};

function run(task: (voice: Voice) => void) {
  const loaded = preload();
  queue = queue
    .then(() => loaded)
    .then(task)
    .catch((error) => setVoice({ error: `Voice failed: ${error instanceof Error ? error.message : String(error)}` }));
}

/**
 * The talk button or Space went down. The first press turns voice on. Safari lets audio start only inside
 * the tap itself, so both audio contexts are made here, before the voice code has loaded.
 */
export function down() {
  const at = performance.now();
  let audio: { input: AudioContext; output: AudioContext } | undefined;
  if (!state.on) {
    audio = { input: new AudioContext(), output: new AudioContext() };
    setVoice({ on: true, state: "starting", holding: true, error: "" });
  }
  run((voice) => voice.down(at, audio));
}

export function up() {
  if (!loading) return;
  const at = performance.now();
  run((voice) => voice.up(at));
}

/** The voice line's buttons, once voice is on (so the code is loaded). */
export const act = (task: (voice: Voice) => void) => run(task);

// Space talks on a computer, unless the user is typing.
addEventListener("keydown", (event: KeyboardEvent) => {
  if (event.code !== "Space" || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target as HTMLElement | null;
  if (target && target !== document.body && !target.closest("[data-talk]")) return;
  event.preventDefault();
  down();
});
addEventListener("keyup", (event: KeyboardEvent) => {
  if (event.code !== "Space" || !state.holding) return;
  event.preventDefault();
  up();
});

// The voice state and its call belong together: an edit here reloads the page.
if (import.meta.hot) import.meta.hot.accept(() => location.reload());
