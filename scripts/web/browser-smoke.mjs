import { pathToFileURL } from "node:url";
const { chromium } = await import(
  process.env.PLAYWRIGHT_CORE ? pathToFileURL(process.env.PLAYWRIGHT_CORE).href : "playwright"
);
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const project = resolve(import.meta.dir, "../..");
await mkdir(resolve(project, "artifacts"), { recursive: true });
const root = await mkdtemp(join(tmpdir(), "bruv-web-browser-"));
const agent = join(root, "agent");
await mkdir(agent, { recursive: true });
const env = {
  PATH: process.env.PATH,
  HOME: root,
  LANG: "C.UTF-8",
  SHELL: "/bin/sh",
  XDG_CONFIG_HOME: join(root, "config"),
  XDG_CACHE_HOME: join(root, "cache"),
  XDG_DATA_HOME: join(root, "data"),
  XDG_STATE_HOME: join(root, "state"),
  BRUV_CODING_AGENT_DIR: agent,
  PI_CODING_AGENT_DIR: agent,
};
const proc = Bun.spawn(
  [resolve(project, "dist/bruv"), "web", "--port", "0", "--", "--offline", "--provider", "openai", "--model", "gpt-4o"],
  { cwd: root, env, stdout: "pipe", stderr: "pipe" },
);
let output = "";
let errors = "";
void (async () => {
  for await (const d of proc.stdout) output += new TextDecoder().decode(d);
})();
void (async () => {
  for await (const d of proc.stderr) errors += new TextDecoder().decode(d);
})();
let browser;
let page;
try {
  for (let i = 0; i < 200 && !output.includes("#token="); i++) await Bun.sleep(25);
  const url = output.match(/http:\/\/\S+/)?.[0];
  if (!url) throw new Error("No URL " + output + " " + errors);
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_BIN,
    headless: true,
    args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  page.setDefaultTimeout(15000);
  const failures = [];
  page.on("pageerror", (e) => failures.push(String(e)));
  await page.addInitScript(() => {
    const W = window.WebSocket;
    class InspectSocket extends W {
      constructor(url, protocols) {
        super(url, protocols);
        if (String(url).includes("/api/terminal")) window.terminalSocket = this;
      }
    }
    window.WebSocket = InspectSocket;
    window.mediaTracks = [];
    window.audioContexts = [];
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => {
      const stream = await gum(...args);
      window.mediaTracks.push(...stream.getTracks());
      return stream;
    };
    const AC = window.AudioContext;
    window.AudioContext = class extends AC {
      constructor(...args) {
        super(...args);
        window.audioContexts.push(this);
      }
    };
  });
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector("#status")?.textContent?.startsWith("Connected"));
  await page.waitForTimeout(1500);
  console.log("SCREEN", await page.locator(".xterm-rows").innerText());
  if (await page.evaluate(() => window.mediaTracks.length)) throw new Error("Microphone opened before click");
  await page.getByRole("button", { name: "Enable microphone" }).click();
  await page.waitForFunction(() => document.querySelector("#audio-status")?.textContent?.includes("Mic enabled"));
  console.log("MIC_ENABLED");
  await page.locator(".xterm-helper-textarea").evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "/live mic-check");
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true }));
  });
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
  console.log("TERMINAL", await page.locator(".xterm-rows").innerText());
  await page.waitForFunction(() =>
    document.querySelector(".xterm-rows")?.textContent?.includes("Audio crosses the session relay"),
  );
  await page.keyboard.press("Enter");
  await page.waitForFunction(() =>
    document.querySelector(".xterm-rows")?.textContent?.includes("Audio route ready. Sound quality not measured."),
  );
  await page.waitForFunction(
    () =>
      window.mediaTracks.length > 0 &&
      window.mediaTracks.every((t) => t.readyState === "ended") &&
      window.audioContexts.every((c) => c.state === "closed"),
  );
  console.log(
    "LIVE_MIC_CHECK",
    "compiled CLI + browser fake microphone + real relay + strict CSP passed; no provider calls",
  );
  await page.keyboard.type("browser PTY input");
  await page.waitForTimeout(300);
  if (!(await page.locator(".xterm-rows").innerText()).includes("browser PTY input"))
    throw new Error("Input not rendered");
  await page.screenshot({ path: project + "/artifacts/web-terminal-wide.png" });
  await page.evaluate(() => window.terminalSocket.close(4000, "test reconnect"));
  await page.waitForTimeout(1600);
  if (!(await page.locator("#status").innerText()).startsWith("Connected")) throw new Error("No reconnect");
  if (!(await page.locator(".xterm-rows").innerText()).includes("browser PTY input"))
    throw new Error("Lost screen after reconnect");
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#status")?.textContent?.startsWith("Connected"));
  await page.waitForTimeout(500);
  if (!(await page.locator(".xterm-rows").innerText()).includes("browser PTY input"))
    throw new Error("Lost screen after refresh");
  await page.setViewportSize({ width: 390, height: 680 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: project + "/artifacts/web-terminal-narrow.png" });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
    throw new Error("Horizontal page overflow");
  console.log("BROWSER_OK", failures, "FIXTURE", root);
  if (failures.length) throw new Error(failures.join("\n"));
} catch (error) {
  console.error("BROWSER_FAILURE", await page?.locator("body").innerText());
  await page?.screenshot({ path: project + "/artifacts/web-terminal-failure.png" });
  throw error;
} finally {
  await browser?.close();
  proc.kill("SIGTERM");
  console.log("WEB_EXIT", await proc.exited, "STDERR", errors);
}
