import { BrowserLiveAudio, browserAudioEnvironment } from "../../../src/live/browser-audio";
const route = browserAudioEnvironment();
if (!route) throw new Error("Missing route");
process.stdin.setRawMode(true);
process.stdin.on("data", (data) => console.log("INPUT", data.toString()));
const keepAlive = setInterval(() => {}, 1000);
const audio = await BrowserLiveAudio.launch({
  ...route,
  callbacks: {
    closed() {
      console.log("AUDIO_CLOSED");
    },
  },
});
await audio.start();
console.log("AUDIO_RUNNING");
process.on("SIGTERM", () => {
  clearInterval(keepAlive);
  audio.close();
  process.exit(0);
});
