// Record a page as PNG frames through Chrome's DevTools protocol.
// Usage: node scripts/record.mjs <chrome> <url> <frames dir> [seconds] [fps]
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [chrome, url, dir, seconds = "23", fps = "15"] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const browser = spawn(
  chrome,
  ["--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--remote-debugging-port=9333", "about:blank"],
  { stdio: ["ignore", "ignore", "pipe"] },
);
await new Promise((resolve) => browser.stderr.on("data", (d) => String(d).includes("DevTools listening") && resolve()));
const target = await (await fetch("http://127.0.0.1:9333/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
let next = 0;
const waiting = new Map();
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  waiting.get(message.id)?.(message.result);
});
// The page provides window.__advance(ms), a clock stepped once per frame.
const advance = (ms) => send("Runtime.evaluate", { expression: `__advance(${ms})`, awaitPromise: true });
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++next;
    waiting.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 675, deviceScaleFactor: 2, mobile: false });
await send("Page.enable");
await send("Page.navigate", { url });
await new Promise((resolve) => setTimeout(resolve, 1500));
const total = Number(seconds) * Number(fps);
const step = 1000 / Number(fps);
const start = performance.now();
for (let i = 0; i < total; i++) {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(dir, `f${String(i).padStart(4, "0")}.png`), Buffer.from(shot.data, "base64"));
  await advance(step);
}
console.log(`frames: ${total}, real seconds: ${((performance.now() - start) / 1000).toFixed(1)}`);
ws.close();
browser.kill();
