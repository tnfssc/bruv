import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { StdinBuffer } from "@earendil-works/pi-tui";
import { BrowserLiveAudio, browserAudioEnvironment } from "../../../src/live/browser-audio";
import { createBrowserRequestInput } from "../../../src/live/browser-request";
const route = browserAudioEnvironment();
if (!route) throw new Error("Missing route");
const requestInput = createBrowserRequestInput();
const stdin = new StdinBuffer();
const editor = new CustomEditor(
  { requestRender() {} } as any,
  { borderColor: (s: string) => s } as any,
  { matches: (data: string, action: string) => action === "app.interrupt" && data === "\x03" } as any,
);
const detachEditor = requestInput.attach(editor);
editor.onEscape = () => editor.setText("");
editor.onSubmit = (text) => {
  void command(text, requestInput.take(editor));
};
let audio: BrowserLiveAudio | undefined;
let starting: AbortController | undefined;
async function command(text: string, request?: string) {
  if (text === "/live stop") {
    starting?.abort();
    await audio?.stop();
    audio = undefined;
    return;
  }
  if (!text.startsWith("/live")) return;
  if (audio || starting) {
    console.log("AUDIO_BUSY");
    return;
  }
  const controller = new AbortController();
  starting = controller;
  try {
    const device = await BrowserLiveAudio.launch({
      ...route!,
      request,
      signal: controller.signal,
      callbacks: {
        closed() {
          console.log("AUDIO_CLOSED");
          audio = undefined;
        },
      },
    });
    audio = device;
    await device.start();
    console.log("AUDIO_RUNNING");
    if (text === "/live mic-check") {
      await Bun.sleep(50);
      await device.stop();
    }
  } catch (error) {
    console.log("AUDIO_ERROR", error instanceof Error ? error.message : "failed");
  } finally {
    if (starting === controller) starting = undefined;
  }
}
stdin.on("data", (data) => {
  if (requestInput.observe(data)) return;
  process.stdout.write(data);
  editor.handleInput(data);
});
stdin.on("paste", (data) => {
  const paste = "\x1b[200~" + data + "\x1b[201~";
  requestInput.observe(paste);
  editor.handleInput(paste);
  process.stdout.write(data);
});
process.stdin.setRawMode(true);
console.log("AUDIO_FIXTURE_READY");
process.stdin.on("data", (data) => stdin.process(data));
const keepAlive = setInterval(() => {}, 1000);
process.on("SIGTERM", () => {
  clearInterval(keepAlive);
  stdin.destroy();
  detachEditor();
  starting?.abort();
  audio?.close();
  process.exit(0);
});
