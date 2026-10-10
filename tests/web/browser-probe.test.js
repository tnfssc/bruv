import WebSocket from "ws";
import { test, expect } from "bun:test";
import { access, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { withBrowserProbe, hasFixtureMarker, waitForFixture } from "../../scripts/web/browser-probe.mjs";
import { watchRenderer, paintedTerminal } from "../../scripts/web/browser-renderer-proof.mjs";

const project = resolve(import.meta.dir, "../..");
const browserTest = process.env.PLAYWRIGHT_CORE ? test : test.skip;
async function chromium() {
  return (await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href)).chromium;
}

test("session_start marker spans PTY frames, not transport ready", () => {
  expect(hasFixtureMarker([{ type: "ready" }])).toBe(false);
  expect(
    hasFixtureMarker([
      { type: "output", data: btoa("\x1b]BROWSER_FIX") },
      { type: "resize" },
      { type: "output", data: btoa("TURE_READY\x07") },
    ]),
  ).toBe(true);
});

// A real compiled web process and CLI child, not a fake teardown receipt.
for (const fail of [true, false])
  browserTest(
    "compiled CLI cleanup after " + (fail ? "launch failure" : "success"),
    async () => {
      const launcher = await chromium();
      let root, proc, url, pid;
      const evidence = join(project, ".tmp", "probe-cleanup-" + fail + ".log");
      const run = withBrowserProbe("cleanup-test", async (owned) => {
        root = owned.root;
        const extension = join(root, "ready.ts");
        await writeFile(
          extension,
          'export default function(pi) { pi.on("session_start", async () => { await Bun.sleep(100); process.stdout.write("\\x1b]BROWSER_FIXTURE_READY\\x07"); }); }',
        );
        proc = Bun.spawn(
          [join(project, "dist/bruv"), "web", "--port", "0", "--", "--offline", "--approve", "--extension", extension],
          {
            cwd: root,
            env: {
              ...process.env,
              HOME: root,
              BRUV_CODING_AGENT_DIR: join(root, "agent"),
              PI_CODING_AGENT_DIR: join(root, "agent"),
            },
            stdout: "pipe",
            stderr: "pipe",
          },
        );
        const reader = proc.stdout.getReader();
        let output = "";
        while (!/http:\/\/\S+#token=\S+\r?\n/.test(output)) {
          const { value, done } = await reader.read();
          if (done) throw Error("Compiled web exited without a URL");
          output += new TextDecoder().decode(value);
        }
        url = output.match(/http:\/\/\S+/)[0];
        await writeFile(evidence, output);
        const parsed = new URL(url),
          token = new URLSearchParams(parsed.hash.slice(1)).get("token");
        // Attach a real terminal before forced launch failure, so cleanup owns a CLI too.
        const ws = new WebSocket(
          parsed.origin.replace("http", "ws") + "/api/terminal",
          ["bruv", "bruv-token." + token],
          { headers: { Origin: parsed.origin } },
        );
        await new Promise((resolve, reject) => {
          ws.onopen = resolve;
          ws.onerror = reject;
        });
        owned.proc = proc;
        const state = await (
          await fetch(parsed.origin + "/api/workspaces", { headers: { Authorization: "Bearer " + token } })
        ).json();
        pid = state.workspaces[0].tabs[0].pid;
        expect(pid).toBeGreaterThan(0);
        try {
          owned.browser = await launcher.launch({
            executablePath: fail ? join(root, "missing-chromium") : process.env.CHROMIUM_BIN,
            headless: true,
            args: ["--no-sandbox"],
          });
          const page = await owned.browser.newPage();
          await page.addInitScript(() => {
            window.testSockets = new Map();
            window.testMessages = new Map();
            const WS = window.WebSocket;
            window.WebSocket = class extends WS {
              constructor(url, protocols) {
                super(url, protocols);
                const parsed = new URL(url);
                if (parsed.pathname !== "/api/terminal") return;
                const id = parsed.searchParams.get("tab") || "terminal";
                window.testSockets.set(id, this);
                window.testMessages.set(id, []);
                this.addEventListener("message", ({ data }) => {
                  const message = JSON.parse(data);
                  if (message.type === "ready") this.probeReady = true;
                  window.testMessages.get(id).push(message);
                });
              }
            };
          });
          await page.goto(url);
          await waitForFixture(page, "testSockets", "testMessages");
          await page.locator("#terminal textarea:visible").focus();
          await page.keyboard.type("!printf 'FIRST_%s\\n' command-after-session-start");
          await page.keyboard.press("Enter");
          await page.waitForFunction(() =>
            document
              .querySelector(".terminal-accessible-output")
              ?.textContent?.includes("FIRST_command-after-session-start"),
          );
        } finally {
          ws.close();
        }
      });
      if (fail) await expect(run).rejects.toThrow(/executable.*exist/i);
      else await run;
      expect(pid).toBeGreaterThan(0);
      expect(await proc.exited).toBe(0);
      expect(() => process.kill(pid, 0)).toThrow();
      await expect(access(root)).rejects.toThrow();
      await expect(fetch(new URL(url).origin)).rejects.toThrow();
      expect(await readFile(evidence, "utf8")).toContain("#token=");
    },
    30000,
  );

browserTest(
  "renderer rejects erased glyph history and split readiness works in Chromium",
  async () => {
    await withBrowserProbe("renderer-negative", async (owned) => {
      owned.browser = await (await chromium()).launch({
        executablePath: process.env.CHROMIUM_BIN,
        headless: true,
        args: ["--no-sandbox"],
      });
      const page = await owned.browser.newPage();
      await watchRenderer(page);
      await page.goto(
        "data:text/html,<div class='terminal-pane'><canvas width='300' height='100'></canvas></div><div role='tab' aria-selected='true' id='tab-one'></div><div id='terminal-status' hidden></div>",
      );
      await page.evaluate(() => {
        const canvas = document.querySelector("canvas"),
          ctx = canvas.getContext("2d");
        ctx.font = "20px monospace";
        ctx.fillStyle = "white";
        ctx.fillText("VISIBLE", 10, 30);
        window.sockets = new Map([["one", { readyState: WebSocket.OPEN, probeReady: true }]]);
        window.messages = new Map([
          [
            "one",
            [
              { type: "output", data: btoa("BROWSER_FIX") },
              { type: "output", data: btoa("TURE_READY") },
            ],
          ],
        ]);
      });
      await waitForFixture(page, "sockets", "messages");
      const paint = await paintedTerminal(page);
      expect(
        paint.cells.some(
          (cell) => cell.text === "VISIBLE" && cell.font === "20px monospace" && cell.color === "#ffffff",
        ),
      ).toBe(true);
      for (const erase of ["clearRect", "fillRect", "resize"]) {
        await page.evaluate((erase) => {
          const canvas = document.querySelector("canvas"),
            ctx = canvas.getContext("2d");
          ctx.fillStyle = "white";
          ctx.font = "20px monospace";
          ctx.fillText("OLD", 10, 30);
          if (erase === "resize") {
            const width = canvas.width;
            canvas.width = width;
          } else ctx[erase](0, 0, canvas.width, canvas.height);
          ctx.fillStyle = "#4488cc";
          ctx.fillRect(100, 50, 50, 30);
        }, erase);
        expect(
          await page.evaluate(() =>
            [...(window.terminalPaint.get(document.querySelector("canvas"))?.values() || [])].some((c) =>
              /\S/.test(c.text),
            ),
          ),
        ).toBe(false);
        // Colored current pixels alone must not resurrect the old glyph.
        page.setDefaultTimeout(150);
        await expect(paintedTerminal(page)).rejects.toThrow();
      }
    });
  },
  30000,
);
