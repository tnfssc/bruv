import { connectBrowserAudio } from "./browser-audio";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

const status = document.querySelector<HTMLElement>("#status")!;
const container = document.querySelector<HTMLElement>("#terminal")!;
const token = new URLSearchParams(location.hash.slice(1)).get("token") ?? sessionStorage.getItem("bruv-terminal-token");
if (token) sessionStorage.setItem("bruv-terminal-token", token);
// Keep the capability out of request URLs, history entries and referrers.
history.replaceState(null, "", location.pathname);
const term = new Terminal({ cursorBlink: true, fontSize: 14, scrollback: 5000, theme: { background: "#111318" } });
const fit = new FitAddon();
term.loadAddon(fit);
term.open(container);
fit.fit();
let socket: WebSocket | undefined;
let sequence = 0;
let halted = false;
let ready = false;
let reconnect: ReturnType<typeof setTimeout> | undefined;
const audioButton = document.querySelector<HTMLButtonElement>("#audio-toggle")!;
const audioStatus = document.querySelector<HTMLElement>("#audio-status")!;
let audio: Awaited<ReturnType<typeof connectBrowserAudio>> | undefined;
let audioPending = false;
let audioOwner: string | undefined;
async function releaseAudio() {
  const current = audio;
  audio = undefined;
  await current?.close();
  audioButton.textContent = "Enable microphone";
  audioStatus.textContent = "Voice off";
}
audioButton.addEventListener("click", async () => {
  if (audioPending || !ready || !token || !audioOwner) return;
  if (audio) {
    await releaseAudio();
    return;
  }
  audioPending = true;
  audioButton.disabled = true;
  try {
    const device = await connectBrowserAudio({
      url: location.origin.replace(/^http/, "ws") + "/api/live/audio?role=browser&session=terminal",
      token,
      owner: audioOwner,
      onState(state) {
        audioStatus.textContent =
          state === "enabled"
            ? "Mic enabled · type /live"
            : state === "running"
              ? "Live · this terminal"
              : state === "connecting"
                ? "Requesting microphone…"
                : state === "error"
                  ? "Audio failed · try enabling again"
                  : "Voice off";
        if (state === "closed" || state === "error") {
          audio = undefined;
          audioButton.textContent = "Enable microphone";
        }
      },
    });
    if (!ready) {
      await device.close();
      return;
    }
    audio = device;
    audioButton.textContent = "Disable microphone";
    term.focus();
  } catch (error) {
    audioStatus.textContent = error instanceof Error ? error.message : "Could not enable microphone";
  } finally {
    audioPending = false;
    audioButton.disabled = !ready;
  }
});
const send = (message: object) => {
  if (ready && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
};
const resize = () => {
  fit.fit();
  send({ type: "resize", cols: term.cols, rows: term.rows });
};
new ResizeObserver(resize).observe(container);
term.onData((data) => send({ type: "input", data }));
term.onBinary((data) => send({ type: "input", data: btoa(data), encoding: "base64" }));

function connect() {
  if (!token) {
    status.textContent = "Open the full URL printed by bruv web (including its token).";
    return;
  }
  ready = false;
  term.options.disableStdin = true;
  status.textContent = "Connecting…";
  socket = new WebSocket(location.origin.replace(/^http/, "ws") + "/api/terminal?after=" + sequence, [
    "bruv",
    "bruv-token." + token,
  ]);
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "ready") {
      ready = true;
      audioButton.disabled = true;
      term.options.disableStdin = false;
      status.textContent = "Connected · real Bruv TUI · one browser controls this terminal";
      resize();
      term.focus();
    } else if (message.type === "audio-owner") {
      audioOwner = message.id;
      audioButton.disabled = !ready;
    } else if (message.type === "output") {
      if (message.seq <= sequence) return;
      if (message.seq !== sequence + 1) {
        halted = true;
        status.textContent = "Output gap; screen is incomplete. Restart bruv web.";
        socket?.close();
        return;
      }
      term.write(Uint8Array.from(atob(message.data), (char) => char.charCodeAt(0)));
      sequence = message.seq;
    } else if (message.type === "exit") {
      halted = true;
      ready = false;
      term.options.disableStdin = true;
      audioButton.disabled = true;
      void releaseAudio();
      status.textContent = "Bruv exited (" + message.code + "). Restart bruv web for a new terminal.";
    } else if (message.type === "gap" || message.type === "error") {
      halted = true;
      ready = false;
      status.textContent = message.message;
    }
  };
  socket.onclose = (event) => {
    ready = false;
    audioButton.disabled = true;
    audioOwner = undefined;
    void releaseAudio();
    term.options.disableStdin = true;
    if (halted) return;
    if (event.code === 1000 || event.code === 1008) {
      halted = true;
      status.textContent = event.reason || "Terminal detached.";
      return;
    }
    status.textContent = "Disconnected · input is disabled · reconnecting to the same CLI…";
    reconnect = setTimeout(connect, 1000);
  };
  socket.onerror = () => {
    status.textContent = "Connection failed. Check the server and token URL.";
  };
}
window.addEventListener("beforeunload", () => {
  halted = true;
  clearTimeout(reconnect);
  socket?.close();
  void releaseAudio();
});
connect();
