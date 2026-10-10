import { withBrowserProbe } from "./browser-probe.mjs";
// Compiled Bruv, local extension content, no provider calls.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { watchRenderer, paintedTerminal } from "./browser-renderer-proof.mjs";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href);
const project = resolve(import.meta.dir, "../..");
const proof = join(project, "artifacts/ghostty/mouse");
await mkdir(proof, { recursive: true });
await withBrowserProbe("browser-ghostty-mouse", async (owned) => {
  const root = owned.root;
  const extension = join(root, "content.ts");
  await Bun.write(
    extension,
    'export default function(pi) { pi.on("session_start", () => process.stdout.write("\\x1b]BROWSER_FIXTURE_READY\\x07")); pi.registerCommand("renderer-mouse", { description: "Offline mouse proof", handler: async () => { await Bun.write("mouse-command-ran", "ran"); pi.sendMessage({customType:"renderer-proof", display:true, content:Array.from({length:100},(_,i)=>"MOUSE_ROW_"+String(i).padStart(3,"0")).join(String.fromCharCode(10))}, {triggerTurn:false}); } }); }',
  );
  const proc = Bun.spawn(
    [
      join(project, "dist/bruv"),
      "web",
      "--port",
      "0",
      "--",
      "--offline",
      "--approve",
      "--provider",
      "openai",
      "--model",
      "gpt-4o",
      "--extension",
      extension,
    ],
    {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        TMPDIR: process.env.TMPDIR,
        HOME: root,
        LANG: "C.UTF-8",
        SHELL: "/bin/sh",
        XDG_CONFIG_HOME: join(root, "config"),
        XDG_CACHE_HOME: join(root, "cache"),
        XDG_DATA_HOME: join(root, "data"),
        XDG_STATE_HOME: join(root, "state"),
        BRUV_CODING_AGENT_DIR: join(root, "agent"),
        PI_CODING_AGENT_DIR: join(root, "agent"),
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  owned.proc = proc;
  let output = "",
    stderr = "",
    browser,
    page;
  void (async () => {
    for await (const c of proc.stdout) output += new TextDecoder().decode(c);
  })();
  void (async () => {
    for await (const c of proc.stderr) stderr += new TextDecoder().decode(c);
  })();
  async function until(check, why) {
    const end = Date.now() + 20000;
    while (!(await check())) {
      if (Date.now() > end) throw Error(why);
      await Bun.sleep(40);
    }
  }
  const result = { providerScope: "local fixture; no paid-provider proof", root };
  try {
    await until(() => output.includes("#token="), "No CLI URL");
    const url = output.match(/http\S+/)[0];
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_BIN,
      headless: true,
      args: ["--no-sandbox"],
    });
    owned.browser = browser;
    page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
    await watchRenderer(page);
    const inputs = [],
      modes = [];
    result.inputs = inputs;
    result.modePackets = modes;
    let fixtureOutput = "";
    page.on("websocket", (socket) => {
      socket.on("framesent", (e) => {
        const m = JSON.parse(e.payload);
        if (m.type === "input") inputs.push(m);
      });
      socket.on("framereceived", (e) => {
        const m = JSON.parse(e.payload);
        if (m.type === "output") {
          const text = Buffer.from(m.data, "base64").toString();
          fixtureOutput += text;
          if (text.includes("[?1006h")) modes.push(text);
        }
      });
    });
    await page.goto(url);
    const text = () => page.locator(".terminal-pane:not([hidden]) .terminal-accessible-output").textContent();
    await until(() => fixtureOutput.includes("BROWSER_FIXTURE_READY"), "CLI session_start marker missing");
    await page.locator(".terminal-pane:not([hidden]) textarea").focus();
    await until(async () => (await text())?.includes("mode: orchestrator"), "CLI editor did not become ready");
    await page.keyboard.type("/renderer-mouse");
    await until(async () => (await text())?.includes("/renderer-mouse"), "Typed command did not reach the CLI draft");
    await page.keyboard.press("Enter");
    await until(async () => await text()?.then((t) => t.includes("MOUSE_ROW_099")), "Local extension content missing");
    assert(modes.length, "Real fullscreen CLI did not negotiate SGR mouse");
    const before = await text();
    const canvas = page.locator(".terminal-pane:not([hidden]) canvas");
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const first = inputs.length;
    await page.mouse.wheel(0, -300);
    await until(
      () => inputs.slice(first).some((m) => m.data.startsWith("\x1b[<64;")),
      "Wheel did not send negotiated SGR input",
    );
    await until(
      async () => await text()?.then((t) => t !== before && t.includes("MOUSE_ROW_")),
      "Wheel did not scroll actual CLI content",
    );
    const after = await text();
    assert(!inputs.slice(first).some((m) => m.data === "\x1b[A"), "Wheel became editor history key");
    const clickStart = inputs.length;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await until(
      () => inputs.slice(clickStart).some((m) => m.data.startsWith("\x1b") && /^\[<0;\d+;\d+m$/.test(m.data.slice(1))),
      "SGR release missing",
    );
    const paint = await paintedTerminal(page);
    await page.screenshot({ path: join(proof, "fullscreen-scroll.png") });
    Object.assign(result, {
      pass: true,
      negotiatedSGR: true,
      inputs: inputs.slice(first),
      before,
      after,
      paint: { ink: paint.ink, width: paint.width, height: paint.height },
    });
    console.log(
      "MOUSE_OK",
      JSON.stringify({ inputs: result.inputs, ink: paint.ink, providerScope: "local fixture; no paid-provider proof" }),
    );
  } catch (error) {
    result.error = String(error);
    result.stderr = stderr;
    if (page) {
      result.output = await page.locator("body").innerText();
      await page.screenshot({ path: join(proof, "failure.png") });
    }
    throw error;
  } finally {
    await Bun.write(join(proof, "results.json"), JSON.stringify(result, null, 2));
    await owned.stop();
    await proc.exited;
  }
});
