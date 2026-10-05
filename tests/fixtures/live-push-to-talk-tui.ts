/** Real terminal UI, synthetic mic frames and a fake provider. No devices or network. */
import liveExtension from "../../src/live/extension";

export default function (pi: any) {
  let epoch: number | null = null;
  let captures = 0;
  let sends = 0;
  let ends = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const fakePi = new Proxy(pi, {
    get(target, key) {
      if (key === "registerCommand") return (_: string, cmd: any) => pi.registerCommand("liveptt", cmd);
      const value = target[key];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  pi.on("session_start", (_: any, ctx: any) => ctx.ui.notify("PTT FIXTURE LOADED", "info"));
  pi.registerCommand("pttproof", {
    handler: async (_: string, ctx: any) =>
      ctx.ui.notify("PTT proof: captures " + captures + " sends " + sends + " ends " + ends, "info"),
  });
  liveExtension(fakePi, {
    local: () => true,
    config: {
      load: async () => ({ provider: "google", model: "gemini-3.8-live", inputMode: "push-to-talk" }),
      save: async () => {},
    },
    key: async () => "OFFLINE-FAKE",
    owner: async () => ({
      orchestration: { instructions: "Offline fixture", tools: [], execute: async () => {} },
      close: () => {},
      turnComplete: () => {},
      interrupt: () => {},
    }),
    voice: () => ({
      state: "ready",
      generation: 0,
      connect: async () => {},
      sendAudio: () => {
        sends++;
      },
      endAudio: () => {
        ends++;
      },
      close: () => {},
    }),
    audio: async (callbacks: any) => ({
      diagnostics: {},
      setCaptureGate: async (next: number | null) => {
        epoch = next;
      },
      start: async () => {
        timer = setInterval(() => {
          captures++;
          callbacks.capture(Buffer.alloc(640, 32), epoch ?? undefined);
        }, 20);
      },
      stop: async () => {
        clearInterval(timer);
        timer = undefined;
      },
      close: async () => {},
      play: async () => {},
      flush: async () => {},
    }),
  } as any);
}
