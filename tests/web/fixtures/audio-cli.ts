import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import liveExtension from "../../../src/live/extension";
import { BrowserLiveAudio, browserAudioEnvironment } from "../../../src/live/browser-audio";
import { LIVE_PROVIDERS } from "../../../src/live/providers";

/** Real Live command/audio lifecycle; only the provider and root owner are fake. */
let pendingTicket: string | undefined;
let framing = "";
process.stdin.on("data", (chunk) => {
  framing += chunk.toString();
  const matches = [...framing.matchAll(/\x1b\]777;bruv-input;([a-f0-9]{32})\x07/g)];
  if (matches.length) pendingTicket = matches.at(-1)![1];
  framing = framing.slice(-80);
});

function install(pi: ExtensionAPI) {
  liveExtension(pi, {
    local: () => true,
    audio: (callbacks, signal) => {
      const route = browserAudioEnvironment();
      if (!route) throw new Error("Missing route");
      const request = pendingTicket;
      pendingTicket = undefined;
      return BrowserLiveAudio.launch({ ...route, callbacks, signal, request });
    },
    key: async () => "fixture-key",
    config: {
      load: async () => ({ provider: "google", model: LIVE_PROVIDERS.google.models[0], inputMode: "continuous" }),
      save: async () => {},
    },
    owner: async () =>
      ({
        orchestration: { instructions: "Offline browser smoke", tools: [], execute: async () => ({}) },
        close: () => {},
        stopForeground: () => {},
        released: Promise.resolve(),
      }) as any,
    voice: () => {
      let captured = false;
      return {
        state: "ready",
        generation: 0,
        connect: async () => {},
        sendAudio: () => {
          if (!captured && import.meta.main) console.log("FAKE_PROVIDER_CAPTURED");
          captured = true;
        },
        close: () => {},
      };
    },
  });
}

// Loaded by the built CLI: leave its own /live mic-check intact.
export default function fixtureExtension(pi: ExtensionAPI) {
  install(
    new Proxy(pi, {
      get(target, key) {
        if (key === "registerCommand")
          return (_name: string, command: any) => target.registerCommand("fixture-live", command);
        if (key === "on")
          return (event: string, callback: any) =>
            target.on(
              event as any,
              event === "session_start"
                ? (event: any, ctx: any) =>
                    callback(event, {
                      ...ctx,
                      ui: new Proxy(ctx.ui, {
                        get(ui, key) {
                          return key === "onTerminalInput" ? () => () => {} : Reflect.get(ui, key);
                        },
                      }),
                    })
                : callback,
            );
        return Reflect.get(target, key);
      },
    }),
  );
}

if (import.meta.main) {
  process.stdin.setRawMode(true);
  const keepAlive = setInterval(() => {}, 1000);
  let command: any;
  install({
    events: { on: () => () => {}, emit: () => {} },
    appendEntry: () => {},
    on: () => {},
    registerMessageRenderer: () => {},
    registerCommand: (_name: string, value: any) => {
      command = value.handler;
    },
  } as any);
  const ctx: any = {
    mode: "tui",
    sessionManager: {
      getSessionId: () => "fixture",
      getLeafId: () => "leaf",
      getSessionFile: () => "fixture",
      getBranch: () => [],
    },
    ui: { notify: (text: string) => console.log(text), setStatus: () => {}, setWidget: () => {} },
  };
  let input = "";
  process.stdin.on("data", (data) => {
    for (const character of data.toString().replace(/\x1b\]777;bruv-input;[a-f0-9]{32}\x07/g, "")) {
      if (character === "\r" || character === "\n") {
        const line = input;
        input = "";
        console.log();
        if (line.startsWith("/live")) void command(line.slice(5).trim(), ctx).catch(console.error);
      } else {
        input += character;
        process.stdout.write(character);
      }
    }
  });
  console.log("Type /live to start. /live stop releases the microphone.");
  process.on("SIGTERM", () => {
    clearInterval(keepAlive);
    void command("stop", ctx);
    process.exit(0);
  });
}
