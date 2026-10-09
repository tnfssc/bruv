import assert from "node:assert/strict";
import { watchRenderer, paintedTerminal } from "./browser-renderer-proof.mjs";
import { pathToFileURL } from "node:url";
const { chromium } = await import(
  process.env.PLAYWRIGHT_CORE ? pathToFileURL(process.env.PLAYWRIGHT_CORE).href : "playwright"
);
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const project = resolve(import.meta.dir, "../..");
await mkdir(resolve(project, "artifacts/ghostty"), { recursive: true });
const root = await mkdtemp(join(tmpdir(), "bruv-web-browser-"));
const agent = join(root, "agent");
await mkdir(agent, { recursive: true });
const env = {
  PATH: process.env.PATH,
  TMPDIR: process.env.TMPDIR,
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
  await watchRenderer(page);
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
  console.log("SCREEN", await page.locator(".terminal-accessible-output").innerText());
  const desktopPaint = await paintedTerminal(page);
  const cdp = await page.context().newCDPSession(page);
  let ax = (await cdp.send("Accessibility.getFullAXTree")).nodes.filter((n) => !n.ignored);
  assert(
    ax.some((n) => n.name?.value?.includes("bruv")),
    "Active terminal output missing from AX tree",
  );
  assert.equal(await page.locator(".terminal-accessible-output").count(), 1, "One active output element");
  if (await page.evaluate(() => window.mediaTracks.length)) throw new Error("Microphone opened on page load");
  if (await page.locator("#audio-toggle").count()) throw new Error("Permanent mic control returned");
  await page.locator("textarea").focus();
  await page.keyboard.type("/live mic-check", { delay: 10 });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  console.log("TERMINAL", await page.locator(".terminal-accessible-output").innerText());

  await page.waitForFunction(() =>
    document
      .querySelector(".terminal-accessible-output")
      ?.textContent?.includes("Audio route ready. Sound quality not measured."),
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
  if (!(await page.locator(".terminal-accessible-output").innerText()).includes("browser PTY input"))
    throw new Error("Input not rendered");
  ax = (await cdp.send("Accessibility.getFullAXTree")).nodes.filter((node) => !node.ignored);
  assert(
    ax.some((node) => node.role?.value === "StaticText" && node.name?.value?.includes("browser PTY input")),
    "Actual PTY draft is missing from accessible output text",
  );
  await page.screenshot({ path: project + "/artifacts/ghostty/web-terminal-wide.png" });
  await page.evaluate(() => window.terminalSocket.close(4000, "test reconnect"));
  await page.waitForTimeout(1600);
  if (!(await page.locator("#status").innerText()).startsWith("Connected")) throw new Error("No reconnect");
  if (!(await page.locator(".terminal-accessible-output").innerText()).includes("browser PTY input"))
    throw new Error("Lost screen after reconnect");
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#status")?.textContent?.startsWith("Connected"));
  await page.waitForTimeout(500);
  if (!(await page.locator(".terminal-accessible-output").innerText()).includes("browser PTY input"))
    throw new Error("Lost screen after refresh");
  if (await page.evaluate(() => window.mediaTracks.length)) throw new Error("Refresh restarted capture");
  await page.setViewportSize({ width: 390, height: 680 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: project + "/artifacts/ghostty/web-terminal-narrow.png" });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
    throw new Error("Horizontal page overflow");
  const phonePaint = await paintedTerminal(page);
  await Bun.write(
    project + "/artifacts/ghostty/cli-render.json",
    JSON.stringify(
      {
        desktop: { ink: desktopPaint.ink, width: desktopPaint.width, height: desktopPaint.height },
        phone: { ink: phonePaint.ink, width: phonePaint.width, height: phonePaint.height },
        ax: ax.map((n) => ({ role: n.role?.value, name: n.name?.value })),
      },
      null,
      2,
    ),
  );
  console.log("BROWSER_OK", failures, "FIXTURE", root);
  if (failures.length) throw new Error(failures.join("\n"));
} catch (error) {
  console.error("BROWSER_FAILURE", await page?.locator("body").innerText());
  await page?.screenshot({ path: project + "/artifacts/ghostty/web-terminal-failure.png" });
  throw error;
} finally {
  await browser?.close();
  proc.kill("SIGTERM");
  console.log("WEB_EXIT", await proc.exited, "STDERR", errors);
}
