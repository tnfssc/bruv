import { StdinBuffer } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import liveExtension from "../../../src/live/extension";
import { BrowserLiveAudio, browserAudioEnvironment } from "../../../src/live/browser-audio";
import { CompactEditor } from "../../../src/ui/editor";
import { LIVE_PROVIDERS } from "../../../src/live/providers";

/** Real Live command/audio lifecycle; only the provider and root owner are fake. */

let commandEditor = import.meta.main
  ? new CompactEditor(
      { requestRender() {} } as any,
      { borderColor: (s: string) => s } as any,
      { matches: (data: string, action: string) => action === "app.interrupt" && data === "\x03" } as any,
    )
  : undefined;
let failProvider = () => {};
function install(pi: ExtensionAPI) {
  liveExtension(pi, {
    editor: () => commandEditor,
    local: () => true,
    audio: (callbacks, signal, request) => {
      const route = browserAudioEnvironment();
      if (!route) throw new Error("Missing route");
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
    voice: (callbacks) => {
      failProvider = () => callbacks.onError?.({ code: "disconnected", message: "Offline provider failure" });
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
  // External extensions have their own module registry. Use the shipped editor
  // class through Pi's normal factory, so this fake provider tracks real submits.
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setEditorComponent((tui, theme, bindings) => {
      commandEditor = new CompactEditor(tui, theme, bindings);
      return commandEditor;
    });
  });
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
                          return key === "onTerminalInput"
                            ? (observe: (data: string) => unknown) =>
                                ui.onTerminalInput((data: string) => {
                                  observe(data);
                                  return undefined;
                                })
                            : Reflect.get(ui, key);
                        },
                      }),
                    })
                : callback,
            );
        return Reflect.get(target, key);
      },
    }),
  );
  // session_start runs after Pi installs its normal editor submit handler.
  pi.on("session_start", () => {
    // An ignored OSC marks the real input boundary without adding a visible status.
    process.stdout.write("\x1b]1337;BROWSER_FIXTURE_READY\x07");
  });
}

if (import.meta.main) {
  process.stdin.setRawMode(true);
  const keepAlive = setInterval(() => {}, 1000);
  let command: any;
  const events = new Map<string, any>();
  let observeInput: (data: string) => any = () => undefined;
  install({
    events: { on: () => () => {}, emit: () => {} },
    appendEntry: () => {},
    on: (name: string, callback: any) => events.set(name, callback),
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
    ui: {
      notify: (text: string) => console.log(text),
      setStatus: () => {},
      setWidget: () => {},
      onTerminalInput: (observe: (data: string) => any) => {
        observeInput = observe;
        return () => {};
      },
    },
  };
  const editor = commandEditor!;
  editor.onEscape = () => editor.setText("");
  editor.onSubmit = (line) => {
    console.log();
    if (line === "/fake-provider-error") failProvider();
    else if (line.startsWith("/live")) void command(line.slice(5).trim(), ctx).catch(console.error);
  };
  events.get("session_start")?.({}, ctx);
  const stdin = new StdinBuffer();
  stdin.on("data", (data) => {
    if (observeInput(data)?.consume) return;
    editor.handleInput(data);
    process.stdout.write(data);
  });
  stdin.on("paste", (data) => {
    const paste = "\x1b[200~" + data + "\x1b[201~";
    observeInput(paste);
    editor.handleInput(paste);
    process.stdout.write(data);
  });
  process.stdin.on("data", (data) => stdin.process(data));
  console.log("OFFLINE_LIVE_FIXTURE_READY");
  process.on("SIGTERM", () => {
    clearInterval(keepAlive);
    void command("stop", ctx);
    process.exit(0);
  });
}
