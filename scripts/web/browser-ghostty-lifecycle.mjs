import { withBrowserProbe } from "./browser-probe.mjs";
// Real compiled CLI + a local replay-flood command. No provider or fake renderer.
import assert from "node:assert/strict";
import { mkdir, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { watchRenderer, paintedTerminal } from "./browser-renderer-proof.mjs";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href);
const project = resolve(import.meta.dir, "../..");
const proof = join(project, "artifacts/ghostty/lifecycle");
await mkdir(proof, { recursive: true });
await withBrowserProbe("browser-ghostty-lifecycle", async (owned) => {
  const root = owned.root;
  const extension = join(root, "replay-flood.ts");
  await Bun.write(
    extension,
    'export default function(pi) { pi.on("session_start", () => Bun.write("renderer-ready-" + process.pid, "ready")); pi.registerCommand("renderer-flood", { description: "Browser replay proof", handler: async (_args, ctx) => { await Bun.write("replay-work-started", "started"); await Bun.sleep(700); for (let i = 0; i < 52; i++) { process.stdout.write("REPLAY_PROOF ".repeat(5000) + "\\r\\n"); await Bun.sleep(60); } await Bun.write("replay-work-finished", "same CLI finished work after replay loss"); ctx.ui.notify("Replay proof work finished", "info"); } }); }',
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
    browser;
  void (async () => {
    for await (const chunk of proc.stdout) output += new TextDecoder().decode(chunk);
  })();
  void (async () => {
    for await (const chunk of proc.stderr) stderr += new TextDecoder().decode(chunk);
  })();
  async function until(check, why, timeout = 20000) {
    const end = Date.now() + timeout;
    while (!(await check())) {
      if (Date.now() > end) throw Error(why);
      await Bun.sleep(40);
    }
  }
  const results = { errors: [], root };
  const pages = [];
  try {
    await until(() => output.includes("#token="), "No CLI URL");
    const url = output.match(/http:\/\/\S+/)[0];
    const origin = new URL(url).origin;
    const token = new URLSearchParams(new URL(url).hash.slice(1)).get("token");
    const api = async (path = "/api/workspaces", method = "GET", body) => {
      const response = await fetch(origin + path, {
        method,
        headers: { Authorization: "Bearer " + token, Origin: origin, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_BIN,
      headless: true,
      args: ["--no-sandbox"],
    });
    owned.browser = browser;
    async function open(viewport) {
      const context = await browser.newContext({ viewport, hasTouch: true });
      const page = await context.newPage();
      pages.push(page);
      page.setDefaultTimeout(20000);
      page.on("pageerror", (error) => results.errors.push(String(error)));
      await watchRenderer(page);
      await page.addInitScript(() => {
        window.proofSockets = new Map();
        window.proofMessages = new Map();
        window.proofInputs = [];
        window.pauseTerminal = false;
        window.documentListeners = [];
        const add = EventTarget.prototype.addEventListener,
          remove = EventTarget.prototype.removeEventListener;
        const capture = (o) => (typeof o === "boolean" ? o : !!o?.capture);
        EventTarget.prototype.addEventListener = function (type, fn, options) {
          if (this === document && ["mousedown", "mouseup"].includes(type))
            window.documentListeners.push({ type, fn, capture: capture(options) });
          return add.call(this, type, fn, options);
        };
        EventTarget.prototype.removeEventListener = function (type, fn, options) {
          if (this === document)
            window.documentListeners = window.documentListeners.filter(
              (r) => !(r.type === type && r.fn === fn && r.capture === capture(options)),
            );
          return remove.call(this, type, fn, options);
        };
        const WS = window.WebSocket;
        window.WebSocket = class extends WS {
          constructor(url, protocols) {
            const parsed = new URL(url);
            if (parsed.pathname === "/api/terminal" && window.pauseTerminal) parsed.port = "1";
            super(parsed, protocols);
            if (parsed.pathname !== "/api/terminal") return;
            const id = parsed.searchParams.get("tab");
            window.proofSockets.set(id, this);
            this.addEventListener("message", (e) => {
              const list = window.proofMessages.get(id) || [];
              list.push(JSON.parse(e.data));
              window.proofMessages.set(id, list);
            });
            const send = this.send.bind(this);
            this.send = (raw) => {
              const m = JSON.parse(raw);
              if (m.type === "input") window.proofInputs.push({ id, ...m });
              return send(raw);
            };
          }
        };
      });
      await page.goto(url);
      await page.waitForFunction(() => document.querySelector("#status")?.textContent.startsWith("Connected"));
      await page.waitForFunction(
        () =>
          document.querySelector(".terminal-pane:not([hidden]) .terminal-accessible-output")?.textContent.trim()
            .length > 0,
      );
      const selected = await page.locator('[role="tab"][aria-selected="true"]').getAttribute("id");
      const tab = (await api()).workspaces
        .flatMap((workspace) => workspace.tabs)
        .find((tab) => "tab-" + tab.id === selected);
      await until(async () => {
        try {
          await access(join(root, "renderer-ready-" + tab.pid));
          return true;
        } catch {
          return false;
        }
      }, "CLI session_start marker missing");
      await paintedTerminal(page);
      return page;
    }
    const a = await open({ width: 1100, height: 720 });
    const b = await open({ width: 390, height: 780 });
    const original = (await api()).workspaces[0].tabs[0];
    await a.locator(".terminal-pane:not([hidden]) textarea").focus();
    await a.locator(".terminal-pane:not([hidden]) textarea").evaluate((el) => {
      const data = new DataTransfer();
      data.setData("text/plain", "SHARED_RENDERER_DRAFT✓");
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await b.waitForFunction(() =>
      document
        .querySelector(".terminal-pane:not([hidden]) .terminal-accessible-output")
        ?.textContent.includes("SHARED_RENDERER_DRAFT✓"),
    );
    assert.equal((await api()).workspaces[0].tabs[0].pid, original.pid, "Shared paste replaced the CLI");
    await a.keyboard.press("Control+u");
    results.sharedPaste = true;
    const baselineListeners = await a.evaluate(() => window.documentListeners.length);
    await a.locator("#new-tab").click();
    await a.waitForFunction(() => document.querySelectorAll(".terminal-pane canvas").length === 2);
    await a.waitForFunction(() => document.querySelector("#status")?.textContent.startsWith("Connected"));
    const second = (await api()).workspaces[0].tabs.at(-1);
    assert.equal(
      await b.locator('[role="tab"][aria-selected="true"]').getAttribute("id"),
      "tab-" + original.id,
      "A navigation moved B",
    );
    results.localNavigation = true;
    await a.locator('[id="tab-' + original.id + '"]').click();
    await a.evaluate((id) => {
      window.heldPane = document.getElementById("terminal-" + id);
      window.heldCanvas = window.heldPane.querySelector("canvas");
      const t = new Touch({ identifier: 7, target: window.heldCanvas, clientX: 120, clientY: 240 });
      window.heldCanvas.dispatchEvent(
        new TouchEvent("touchstart", { touches: [t], changedTouches: [t], bubbles: true, cancelable: true }),
      );
    }, original.id);
    await a.locator('[id="tab-' + second.id + '"]').click();
    await a.locator('[id="tab-' + original.id + '"]').click();
    await a.waitForTimeout(50);
    await a.locator("#new-tab").focus();
    const late = await a.evaluate(() => {
      const before = window.proofInputs.length;
      const t = new Touch({ identifier: 7, target: window.heldCanvas, clientX: 120, clientY: 80 });
      window.heldCanvas.dispatchEvent(
        new TouchEvent("touchmove", { touches: [t], changedTouches: [t], bubbles: true, cancelable: true }),
      );
      window.heldCanvas.dispatchEvent(
        new TouchEvent("touchend", { touches: [], changedTouches: [t], bubbles: true, cancelable: true }),
      );
      return { inputs: window.proofInputs.slice(before), focused: document.activeElement.id };
    });
    assert.deepEqual(late.inputs, [], "Canceled touch sent input after hide/show");
    assert.equal(late.focused, "new-tab", "Late touchend stole focus");
    results.lateTouch = late;
    const activeOutputs = await a.evaluate(() =>
      [...document.querySelectorAll(".terminal-accessible-output")].map((e) => ({
        hidden: e.hidden,
        text: e.textContent,
      })),
    );
    assert.equal(activeOutputs.filter((e) => !e.hidden).length, 1);
    assert(activeOutputs.filter((e) => e.hidden).every((e) => !e.text));
    results.activeOutputs = activeOutputs;
    const axSession = await a.context().newCDPSession(a);
    const axNodes = (await axSession.send("Accessibility.getFullAXTree")).nodes;
    const axOutputs = axNodes.filter(
      (n) => !n.ignored && n.role?.value === "region" && n.name?.value === "Terminal output",
    );
    assert.equal(axOutputs.length, 1, "Inactive terminal output leaked into AX tree");
    results.axActiveOutputs = axOutputs.length;
    // Close a pane while its finger is still held. Disposal must free DOM and document listeners.
    await a.evaluate(() => {
      const t = new Touch({ identifier: 8, target: window.heldCanvas, clientX: 120, clientY: 200 });
      window.heldCanvas.dispatchEvent(new TouchEvent("touchstart", { touches: [t], bubbles: true, cancelable: true }));
    });
    await api("/api/tabs/" + original.id, "DELETE", { confirm: true });
    await a.waitForFunction((id) => !document.getElementById("terminal-" + id), original.id);
    await a.locator("#new-tab").focus();
    const disposed = await a.evaluate(() => {
      window.heldCanvas.dispatchEvent(new TouchEvent("touchend", { touches: [], bubbles: true, cancelable: true }));
      return {
        children: window.heldPane.querySelectorAll("canvas, textarea, .terminal-accessible-output").length,
        listeners: window.documentListeners.length,
        focused: document.activeElement.id,
      };
    });
    assert.equal(disposed.children, 0, "Disposed terminal still owns renderer DOM");
    assert.equal(disposed.listeners, baselineListeners, "Disposed terminal leaked document listeners");
    assert.equal(disposed.focused, "new-tab", "Disposed touchend stole focus");
    await until(() => {
      try {
        process.kill(original.pid, 0);
        return false;
      } catch {
        return true;
      }
    }, "Closed CLI survived pane disposal");
    results.disposal = { ...disposed, pidReaped: original.pid };
    await b.locator('[id="tab-' + second.id + '"]').click();
    await b.waitForFunction(() => document.querySelector("#status")?.textContent.startsWith("Connected"));
    const secondPid = (await api()).workspaces[0].tabs[0].pid;
    await until(
      async () => {
        try {
          await access(join(root, "renderer-ready-" + secondPid));
          return true;
        } catch {
          return false;
        }
      },
      "Second CLI startup did not finish",
      60000,
    );
    await a.waitForTimeout(200);
    await a.locator(".terminal-pane:not([hidden]) textarea").focus();
    await a.keyboard.type("/renderer-flood");
    await a.waitForFunction(() =>
      document
        .querySelector(".terminal-pane:not([hidden]) .terminal-accessible-output")
        ?.textContent.includes("/renderer-flood"),
    );
    await a.keyboard.press("Enter");
    await a.waitForTimeout(100);
    await a.keyboard.press("Enter");
    await until(async () => {
      try {
        await access(join(root, "replay-work-started"));
        return true;
      } catch {
        return false;
      }
    }, "Replay command did not start");
    await a.evaluate((id) => {
      window.pauseTerminal = true;
      window.proofSockets.get(id).close(4000, "Replay-loss proof");
    }, second.id);
    await until(async () => {
      try {
        await access(join(root, "replay-work-finished"));
        return true;
      } catch {
        return false;
      }
    }, "CLI work stopped when browser left");
    const pidBefore = (await api()).workspaces[0].tabs[0].pid;
    await a.reload();
    await a.waitForFunction(
      () => [...window.proofMessages.values()].some((list) => list.some((m) => m.type === "gap")),
      null,
      { timeout: 30000 },
    );
    const gaps = await a.evaluate(() => [...window.proofMessages.values()].flat().filter((m) => m.type === "gap"));
    assert.match(gaps.at(-1).message, /without closing this one/);
    assert.equal((await api()).workspaces[0].tabs[0].pid, pidBefore, "Replay loss replaced the CLI");
    process.kill(pidBefore, 0);
    const inputCount = await a.evaluate(() => window.proofInputs.length);
    await a.locator(".terminal-pane:not([hidden]) textarea").focus();
    await a.keyboard.type("must-not-send");
    assert.equal(await a.evaluate(() => window.proofInputs.length), inputCount, "Gap pane still accepted input");
    await b.locator(".terminal-pane:not([hidden]) textarea").focus();
    await b.keyboard.type("!printf 'AFTER_%s\\n' REPLAY_LOSS");
    await b.keyboard.press("Enter");
    await b.waitForFunction(() =>
      document
        .querySelector(".terminal-pane:not([hidden]) .terminal-accessible-output")
        ?.textContent.includes("AFTER_REPLAY_LOSS"),
    );
    results.replay = { gaps, samePid: pidBefore, workFinished: true, observerStillAcceptsInput: true };
    await a.screenshot({ path: join(proof, "replay-gap-desktop.png") });
    await b.screenshot({ path: join(proof, "observer-phone.png") });
    await paintedTerminal(b);
    assert.deepEqual(results.errors, []);
    console.log("GHOSTTY_LIFECYCLE_OK", JSON.stringify(results));
  } catch (error) {
    results.error = String(error);
    for (const [index, page] of pages.entries()) {
      await page.screenshot({ path: join(proof, "failure-" + index + ".png") });
      results["browser" + index] = await page.evaluate(() => ({
        output: document.querySelector(".terminal-pane:not([hidden]) .terminal-accessible-output")?.textContent,
        inputs: window.proofInputs,
        messages: [...window.proofMessages.entries()].map(([id, list]) => [
          id,
          {
            bytes: list.filter((m) => m.type === "output").reduce((n, m) => n + atob(m.data).length, 0),
            events: list.filter((m) => m.type !== "output"),
          },
        ]),
      }));
    }
    throw error;
  } finally {
    await Bun.write(join(proof, "results.json"), JSON.stringify(results, null, 2));
    await owned.stop();
    console.log("CLI_EXIT", await proc.exited, "STDERR", stderr);
  }
});
