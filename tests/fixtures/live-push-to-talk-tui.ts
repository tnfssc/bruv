/** Real terminal UI and main owner; synthetic mic/provider, no devices or network. */

import type { AudioCallbacks } from "../../src/live/audio";
import liveExtension from "../../src/live/extension";
import { installOfflineModelReply } from "./live-offline-model";

export default function (pi: any) {
  const microphone = createSyntheticMicrophone();
  let sends = 0;
  let ends = 0;
  let typed = 0;
  let proofs = 0;
  let staleFrames = 0;
  const fakePi = new Proxy(pi, {
    get(target, key) {
      if (key === "registerCommand") return (_: string, cmd: any) => pi.registerCommand("liveptt", cmd);
      const value = target[key];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  pi.on("session_start", (_: any, ctx: any) => {
    installOfflineModelReply(ctx.sessionManager, "UNEXPECTED_NORMAL_MODEL_REPLY");
    ctx.ui.notify("PTT FIXTURE LOADED", "info");
  });
  pi.registerCommand("pttproof", {
    handler: async (_: string, ctx: any) =>
      ctx.ui.notify(
        "PTT proof " +
          ++proofs +
          ": captures " +
          microphone.captures +
          " sends " +
          sends +
          " ends " +
          ends +
          " typed " +
          typed,
        "info",
      ),
  });
  pi.registerCommand("pttstale", {
    handler: async (_: string, ctx: any) => {
      microphone.injectStaleFrame();
      ctx.ui.notify("PTT stale frame injected " + ++staleFrames, "info");
    },
  });
  liveExtension(fakePi, {
    local: () => true,
    config: {
      load: async () => ({ provider: "google", model: "gemini-3.8-live", inputMode: "push-to-talk" }),
      save: async () => {},
    },
    key: async () => "OFFLINE-FAKE",
    voice: (callbacks: any) => ({
      state: "ready",
      generation: 0,
      connect: async () => {},
      sendAudio: () => {
        sends++;
      },
      endAudio: () => {
        const turn = ++ends;
        callbacks.onInputActivity();
        callbacks.onInputTranscript({ text: "SPOKEN_INPUT_" + turn + " Keep voice in this chat.", finished: true });
        callbacks.onOutputTranscript({ text: "SPOKEN_REPLY_" + turn + " BEGIN ", finished: false });
        callbacks.onOutputTranscript({
          replace: true,
          text:
            "SPOKEN_REPLY_" +
            turn +
            " BEGIN " +
            "This complete spoken reply remains in normal conversation history. ".repeat(12) +
            "END_REPLY_" +
            turn,
          finished: true,
        });
        callbacks.onTurnComplete();
      },
      sendContext: (text: string, options?: { triggerResponse?: boolean }) => {
        if (options?.triggerResponse === false) return;
        typed++;
        callbacks.onOutputTranscript({ text: "TYPED_REPLY: " + text, finished: true });
        callbacks.onTurnComplete();
      },
      close: () => {},
    }),
    audio: microphone.open,
  } as any);
}

/** Own the capture clock and gate, including deliberate late frames for the TUI proof. */
function createSyntheticMicrophone() {
  let epoch: number | null = null;
  let previousEpoch = 0;
  let captures = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let audioCallbacks: AudioCallbacks;
  const stop = async () => {
    clearInterval(timer);
    timer = undefined;
  };
  return {
    get captures() {
      return captures;
    },
    injectStaleFrame() {
      audioCallbacks.capture!(Buffer.alloc(640, 32), previousEpoch);
    },
    open: async (callbacks: AudioCallbacks) => {
      audioCallbacks = callbacks;
      return {
        diagnostics: {},
        setCaptureGate: async (next: number | null) => {
          epoch = next;
          if (next !== null) previousEpoch = next;
        },
        start: async () => {
          timer = setInterval(() => {
            captures++;
            callbacks.capture!(Buffer.alloc(640, 32), epoch ?? undefined);
          }, 20);
        },
        stop,
        close: stop,
        play: async () => {},
        flush: async () => {},
      };
    },
  };
}
