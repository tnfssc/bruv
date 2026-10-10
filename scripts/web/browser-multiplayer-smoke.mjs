import { withBrowserProbe, waitForFixture } from "./browser-probe.mjs";
import { watchRenderer, paintedTerminal } from "./browser-renderer-proof.mjs";
import assert from "node:assert/strict";
import { access, mkdir, readlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(
  process.env.PLAYWRIGHT_CORE ? pathToFileURL(process.env.PLAYWRIGHT_CORE).href : "playwright"
);
const project = resolve(import.meta.dir, "../..");
const voiceOnly = process.argv.includes("--voice-only");
await withBrowserProbe("bruv-multiplayer", async (owned) => {
  const fixture = owned.root;
  const one = join(fixture, "one"),
    two = join(fixture, "two"),
    agent = join(fixture, "agent");
  await Promise.all([one, two, agent, join(project, "artifacts/ghostty")].map((p) => mkdir(p, { recursive: true })));
  const proc = Bun.spawn(
    [
      join(project, "dist/bruv"),
      "web",
      "--port",
      "0",
      "--",
      "--offline",
      // These are our disposable fixture folders, not a user project.
      "--approve",
      "--provider",
      "openai",
      "--model",
      "gpt-4o",
      "--extension",
      join(project, "tests/web/fixtures/audio-cli.ts"),
    ],
    {
      cwd: one,
      env: {
        PATH: process.env.PATH,
        TMPDIR: process.env.TMPDIR,
        HOME: fixture,
        LANG: "C.UTF-8",
        SHELL: "/bin/sh",
        XDG_CONFIG_HOME: join(fixture, "config"),
        XDG_CACHE_HOME: join(fixture, "cache"),
        XDG_DATA_HOME: join(fixture, "data"),
        XDG_STATE_HOME: join(fixture, "state"),
        BRUV_CODING_AGENT_DIR: agent,
        PI_CODING_AGENT_DIR: agent,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  owned.proc = proc;
  let output = "",
    stderr = "",
    browser;
  const pages = [];
  void (async () => {
    for await (const chunk of proc.stdout) output += new TextDecoder().decode(chunk);
  })();
  void (async () => {
    for await (const chunk of proc.stderr) stderr += new TextDecoder().decode(chunk);
  })();
  async function until(check, message, timeout = 15000) {
    const end = Date.now() + timeout;
    while (!(await check())) {
      if (Date.now() > end) throw Error(message);
      await Bun.sleep(30);
    }
  }
  const failures = [];
  async function connected(page) {
    await waitForFixture(page, "terminals", "messages");
  }
  try {
    await until(() => output.includes("#token="), "Server URL missing");
    const url = output
        .split("\n")
        .find((line) => line.includes("#token="))
        .split(" ")
        .at(-1),
      origin = new URL(url).origin;
    const token = new URLSearchParams(new URL(url).hash.slice(1)).get("token");
    async function state() {
      const response = await fetch(origin + "/api/workspaces", { headers: { Authorization: "Bearer " + token } });
      assert.equal(response.status, 200);
      return response.json();
    }
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_BIN,
      headless: process.env.HEADLESS !== "0",
      args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    });
    owned.browser = browser;
    const sharedContext = process.env.BRUV_BROWSER_SHARED_CONTEXT === "1" ? await browser.newContext() : null;
    async function open(width) {
      const context = sharedContext ?? (await browser.newContext());
      const page = await context.newPage();
      await page.setViewportSize({ width, height: 800 });
      pages.push(page);
      page.setDefaultTimeout(15000);
      await watchRenderer(page);
      page.on("pageerror", (error) => failures.push(String(error)));
      await page.addInitScript(() => {
        window.terminals = new Map();
        window.messages = new Map();
        window.states = [];
        window.mediaTracks = [];
        window.audioContexts = [];
        window.resizeCount = 0;
        const WS = window.WebSocket;
        window.WebSocket = class extends WS {
          constructor(url, protocols) {
            super(url, protocols);
            const parsed = new URL(url);
            if (parsed.pathname === "/api/terminal") {
              const id = parsed.searchParams.get("tab") || "terminal";
              window.terminals.set(id, this);
              if (!window.messages.has(id)) window.messages.set(id, []);
              this.addEventListener("message", (e) => {
                const message = JSON.parse(e.data);
                if (message.type === "ready") this.probeReady = true;
                window.messages.get(id).push(message);
              });
              const send = this.send.bind(this);
              this.send = (data) => {
                if (JSON.parse(data).type === "resize") window.resizeCount++;
                send(data);
              };
            }
            if (parsed.pathname === "/api/events") {
              window.stateSocket = this;
              this.addEventListener("message", (e) => window.states.push(JSON.parse(e.data)));
            }
          }
        };
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
      await connected(page);
      return page;
    }
    const a = await open(1200),
      b = await open(850);
    await until(async () => (await state()).workspaces[0].tabs[0].pid, "Initial CLI missing");
    await paintedTerminal(a);
    await paintedTerminal(b);
    const initial = await state(),
      first = initial.workspaces[0],
      tab = first.tabs[0],
      pid = tab.pid;
    assert.equal(await readlink("/proc/" + pid + "/cwd"), one);
    async function text(page, id = tab.id) {
      return page.evaluate(
        (id) =>
          document.getElementById("terminal-" + id)?.querySelector(".terminal-accessible-output")?.textContent || "",
        id,
      );
    }
    // Pi groups bare ESC + Enter within 10ms as Alt+Enter. Keep the keys distinct.
    async function paste(page, value) {
      await page.locator("#terminal textarea:visible").focus();
      await page.locator("#terminal textarea:visible").evaluate((el, value) => {
        const clipboardData = new DataTransfer();
        clipboardData.setData("text/plain", value);
        el.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true }));
      }, value);
    }
    async function submit(page, value) {
      if (value.startsWith("/")) {
        await page.locator("#terminal textarea:visible").focus();
        await page.keyboard.press("Control+u");
        await page.keyboard.type(value);
        // ESC must leave the ownership packet buffer, then the editor buffer, before Enter.
        await page.keyboard.press("Escape", { delay: 100 });
      } else await paste(page, value);
      await page.keyboard.press("Enter");
    }
    async function newTab(page) {
      const previous = await selected(page);
      await page.locator("#new-tab").click();
      await page.waitForFunction(
        (previous) => document.querySelector('[role="tab"][aria-selected="true"]')?.id !== previous,
        previous,
      );
      await connected(page);
    }
    async function rename(page, name) {
      await page.locator('[role="tab"][aria-selected="true"]').focus();
      await page.keyboard.press("F2");
      await page.getByRole("textbox", { name: "Tab name", exact: true }).fill(name);
      await page.keyboard.press("Enter");
      await page.locator(".tab-name-input").waitFor({ state: "hidden" });
      await page.getByRole("tab", { name: "Select tab " + name, exact: true }).waitFor();
    }
    async function openFolder(page, cwd) {
      if (await page.locator("#open-drawer").isVisible()) await page.locator("#open-drawer").click();
      await page.locator("#add-workspace").click();
      await page.locator("#rail-entry #folder-form").waitFor({ state: "visible" });
      assert.equal(await page.locator("#folder-form").count(), 1, "One folder form");
      await page.locator("#folder-input").fill(cwd);
      const response = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/workspaces" && r.request().method() === "POST",
      );
      await page.locator("#open-folder").click();
      const result = await response;
      assert.equal(result.status(), 200);
      const next = await result.json();
      assert.equal(next.created, true);
      const workspace = next.workspaces.find((w) => w.id === next.workspaceId);
      assert.equal(workspace?.cwd, cwd);
      await page
        .locator('[id="workspace-' + next.workspaceId + '"][aria-pressed="true"]')
        .waitFor({ state: "attached" });
      await page.locator("#folder-form").waitFor({ state: "hidden" });
    }
    async function dialog(page, selector, confirm) {
      if (selector.startsWith("#workspace-remove-") && (await page.locator("#open-drawer").isVisible()))
        await page.locator("#open-drawer").click();
      if (selector.startsWith("#tab-close-")) {
        // Rename can widen the selected tab. Scroll its whole shell into view.
        await page
          .locator(selector)
          .evaluate((button) => button.parentElement.scrollIntoView({ block: "nearest", inline: "nearest" }));
      }
      await page.locator(selector).click();
      await page.locator("#workspace-dialog").waitFor({ state: "visible" });
      assert.equal(await page.evaluate(() => document.activeElement?.id), "dialog-cancel");
      await page.locator(confirm ? "#dialog-submit" : "#dialog-cancel").click();
      await page.locator("#workspace-dialog").waitFor({ state: "hidden" });
    }
    async function select(page, workspace, id) {
      if (await page.locator("#open-drawer").isVisible()) await page.locator("#open-drawer").click();
      await page.locator('[id="workspace-' + workspace.id + '"]').click();
      await page.locator('[id="tab-' + id + '"]').click();
      await connected(page);
    }
    const selected = (page) => page.locator('[role="tab"][aria-selected="true"]').getAttribute("id");
    await submit(a, "!printf 'A_OUT_%s\\n' $PWD");
    await until(
      async () =>
        (await text(a)).replace(/\s/g, "").includes("A_OUT_" + one) &&
        (await text(b)).replace(/\s/g, "").includes("A_OUT_" + one),
      "A output not shared",
    );
    await submit(b, "!printf 'B_OUT_%s\\n' $PWD");
    await until(
      async () =>
        (await text(a)).replace(/\s/g, "").includes("B_OUT_" + one) &&
        (await text(b)).replace(/\s/g, "").includes("B_OUT_" + one),
      "B input not shared",
    );
    assert.equal((await state()).workspaces[0].tabs[0].pid, pid, "Second browser duplicated CLI");
    await a.locator("#terminal textarea:visible").focus();
    await a.keyboard.type("shared-draft");
    await until(
      async () =>
        (await b.locator(".terminal-pane:visible .terminal-accessible-output").innerText()).includes("shared-draft"),
      "Draft input not shared",
    );
    await b.keyboard.press("Control+u");
    let second;
    if (!voiceOnly) {
      await openFolder(b, two);
      await a.getByRole("button", { name: "Open workspace two · " + two, exact: true }).waitFor();
      assert.equal(await selected(a), "tab-" + tab.id, "Remote creation stole A selection");
      const current = await state();
      second = current.workspaces.find((w) => w.cwd === two);
      assert(second);
      assert.equal(current.workspaces.length, 2);
      await newTab(b);
      await rename(b, "from-B");
      const bSelectionBefore = await selected(b);
      await select(a, second, second.tabs[0].id);
      await a.getByRole("tab", { name: "Select tab from-B", exact: true }).waitFor();
      assert.equal(await selected(b), bSelectionBefore, "A navigation changed B selection");
      // Concurrent UI mutations return potentially interleaved snapshots. Both must converge.
      await Promise.all([a.locator("#new-tab").click(), b.locator("#new-tab").click()]);
      await until(
        async () => (await state()).workspaces.find((w) => w.id === second.id).tabs.length === 4,
        "Concurrent creates lost a tab",
      );
      await until(
        async () => (await a.getByRole("tab").count()) === 4 && (await b.getByRole("tab").count()) === 4,
        "Browser snapshots diverged",
      );
      const selectedBefore = await selected(a);
      const bEditId = (await selected(b)).slice(4);
      assert.notEqual(selectedBefore, "tab-" + bEditId, "Viewers keep independent selection");
      await a.locator('[id="' + selectedBefore + '"]').dblclick();
      const draft = a.getByRole("textbox", { name: "Tab name", exact: true });
      await draft.fill("local draft");
      await draft.evaluate((el) => {
        window.renameInput = el;
        el.setSelectionRange(2, 7);
      });
      await rename(b, "renamed-remotely");
      await a.getByRole("tab", { name: "Select tab renamed-remotely", exact: true }).waitFor();
      assert(await draft.evaluate((el) => el === window.renameInput && document.activeElement === el));
      assert.equal(await draft.inputValue(), "local draft");
      assert.deepEqual(await draft.evaluate((el) => [el.selectionStart, el.selectionEnd]), [2, 7]);
      await a.keyboard.press("Enter");
      await a.getByRole("tab", { name: "Select tab local draft", exact: true }).waitFor();
      assert.equal(await selected(a), selectedBefore, "Remote rename stole selection");
      const renamedTabs = (await state()).workspaces.find((w) => w.id === second.id).tabs;
      assert.equal(renamedTabs.find((t) => "tab-" + t.id === selectedBefore).name, "local draft");
      assert.equal(
        renamedTabs.find((t) => t.id === bEditId).name,
        "renamed-remotely",
        "Draft cannot rename another tab",
      );
      // Deletion from another viewer cancels an edit without submitting it.
      await a.locator('[id="tab-' + bEditId + '"]').dblclick();
      await draft.fill("deleted draft");
      await dialog(b, "#tab-close-" + bEditId, false);
      assert.equal((await state()).workspaces.find((w) => w.id === second.id).tabs.length, 4);
      assert.equal(await draft.inputValue(), "deleted draft", "Remote close cancellation keeps the draft");
      await dialog(b, "#tab-close-" + bEditId, true);
      await until(
        async () => (await a.getByRole("tab").count()) === 3 && (await b.getByRole("tab").count()) === 3,
        "Close did not propagate",
      );
      assert.equal(await draft.count(), 0, "Deleted tab exits edit mode");
    }
    await select(a, first, tab.id);
    await select(b, first, tab.id);
    await submit(a, "!sleep 2; printf 'JOB_%s\\n' survives-reload");
    await a.reload();
    await connected(a);
    await until(
      async () => (await text(b)).includes("JOB_survives-reload") && (await text(a)).includes("JOB_survives-reload"),
      "Reload lost shared job or replay",
    );
    assert.equal((await state()).workspaces[0].tabs[0].pid, pid);
    await a.evaluate(() => window.stateSocket.close(4000, "reconnect fixture"));
    await a.locator("#sync-status").waitFor({ state: "visible" });
    assert.equal(await a.locator("#status").isVisible(), false, "List outage does not mark the PTY down");
    await a.locator("#sync-status").waitFor({ state: "hidden" });
    // Shared dimensions must settle, not resize forever between different viewports.
    await a.setViewportSize({ width: 1100, height: 750 });
    await b.setViewportSize({ width: 650, height: 650 });
    await Bun.sleep(350);
    const counts = await Promise.all([a.evaluate(() => window.resizeCount), b.evaluate(() => window.resizeCount)]);
    await Bun.sleep(350);
    assert.deepEqual(
      await Promise.all([a.evaluate(() => window.resizeCount), b.evaluate(() => window.resizeCount)]),
      counts,
      "Resize feedback loop",
    );
    const sizes = await Promise.all(
      [a, b].map((page) =>
        page.evaluate((id) => (window.messages.get(id) || []).filter((m) => m.type === "size").at(-1), tab.id),
      ),
    );
    assert(sizes[0]);
    assert.deepEqual(sizes[0], sizes[1], "Different shared terminal geometry");
    await submit(a, "/fixture-live start");
    await a.waitForFunction(() => document.querySelector("#audio-status")?.textContent?.includes("Live"));
    await b.waitForFunction(() => document.querySelector("#audio-status")?.textContent?.includes("another browser"));
    assert.equal(await b.evaluate(() => window.mediaTracks.length), 0, "Observer never opens capture");
    assert.equal(await a.locator("#audio-toggle").count(), 0, "No permanent microphone control");
    const voice = (await state()).voice;
    assert.equal(voice.tabId, tab.id);
    await b.evaluate((id) => window.terminals.get(id).close(4000, "observer leaves"), tab.id);
    await connected(b);
    assert.deepEqual((await state()).voice, voice, "Observer disconnect stopped voice");
    await b.reload();
    await connected(b);
    assert.deepEqual((await state()).voice, voice, "Observer reload stopped voice");
    assert.equal(await b.evaluate(() => window.mediaTracks.length), 0, "Observer rejoin must not capture");
    await submit(b, "/fixture-live start");
    await Bun.sleep(250);
    assert.deepEqual((await state()).voice, voice, "Another browser command cannot steal active owner");
    assert.equal(await b.evaluate(() => window.mediaTracks.length), 0);
    assert(await a.evaluate(() => window.mediaTracks.some((t) => t.readyState === "live")));
    await a.screenshot({
      caret: "initial",
      path: join(project, "artifacts/ghostty/web-multiplayer-owner.png"),
    });
    await b.screenshot({
      caret: "initial",
      path: join(project, "artifacts/ghostty/web-multiplayer-observer.png"),
    });
    await a.setViewportSize({ width: 390, height: 680 });
    await Bun.sleep(200);
    await a.locator("#voice-status").waitFor({ state: "visible" });
    assert.equal(await a.locator("#cancel-voice").isVisible(), false, "Active voice is not a pending request");
    assert.equal(await b.locator("#cancel-voice").isVisible(), false, "Observer has no cancel control");
    assert.equal(await a.locator("#status").isVisible(), false, "Voice is separate from healthy PTY status");
    const voiceGeometry = await a.evaluate(() => {
      const rect = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
      return {
        voice: rect("#voice-status"),
        label: rect("#audio-status"),
        bar: rect(".tab-bar"),
        terminal: rect("#terminal"),
      };
    });
    assert(voiceGeometry.voice.y >= voiceGeometry.bar.bottom, "Voice banner stays below tab controls");
    assert(voiceGeometry.terminal.y >= voiceGeometry.voice.bottom, "Voice banner does not cover the PTY");
    assert(
      voiceGeometry.label.x >= voiceGeometry.voice.x && voiceGeometry.label.right <= voiceGeometry.voice.right,
      "Voice label fits banner",
    );
    assert.equal(await a.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await Bun.write(join(project, "artifacts/ghostty/voice-alignment.json"), JSON.stringify(voiceGeometry, null, 2));
    await a.screenshot({
      caret: "initial",
      path: join(project, "artifacts/ghostty/web-multiplayer-owner-phone.png"),
    });
    await a.setViewportSize({ width: 1100, height: 800 });
    await submit(a, "/fixture-live stop");
    await until(async () => (await state()).voice === null, "Explicit release not shared");
    await submit(b, "/live mic-check");

    await until(
      async () =>
        (await text(a)).includes("Audio route ready. Sound quality not measured.") &&
        (await text(b)).includes("Audio route ready. Sound quality not measured."),
      "Shared CLI mic-check failed",
    );
    await b.waitForFunction(
      () =>
        window.mediaTracks.length > 0 &&
        window.mediaTracks.every((t) => t.readyState === "ended") &&
        window.audioContexts.every((c) => c.state === "closed"),
    );
    await until(async () => (await state()).voice === null, "Mic-check owner not cleared");
    // Losing the owner releases voice, but a spectator can still use the very same CLI.
    await submit(a, "/fixture-live start");
    await a.waitForFunction(() => document.querySelector("#audio-status")?.textContent?.includes("Live"));
    await a.evaluate((id) => window.terminals.get(id).close(4000, "owner leaves"), tab.id);
    await until(async () => (await state()).voice === null, "Owner disconnect retained microphone");
    await submit(b, "!printf 'AFTER_%s\\n' owner-loss");
    await until(async () => (await text(b)).includes("AFTER_owner-loss"), "Observer lost terminal after owner left");
    assert.equal((await state()).workspaces[0].tabs[0].pid, pid);
    if (voiceOnly) {
      await openFolder(b, two);
      second = (await state()).workspaces.find((workspace) => workspace.cwd === two);
    }
    await select(b, second, second.tabs[0].id);
    const otherPids = (await state()).workspaces
      .find((w) => w.id === second.id)
      .tabs.map((t) => t.pid)
      .filter(Boolean);
    await dialog(b, "#workspace-remove-" + second.id, true);
    await until(
      async () => (await a.getByRole("button", { name: "Open workspace two · " + two, exact: true }).count()) === 0,
      "Remote workspace deletion not observed",
    );
    await until(
      () =>
        otherPids.every((pid) => {
          try {
            process.kill(pid, 0);
            return false;
          } catch {
            return true;
          }
        }),
      "Removed workspace processes survived",
    );
    await access(two);
    assert.equal((await state()).workspaces[0].tabs[0].pid, pid);
    await b.setViewportSize({ width: 390, height: 680 });
    await Bun.sleep(150);
    await b.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
    assert.equal(await b.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    for (const page of [a, b]) {
      const revisions = await page.evaluate(() => window.states.map((m) => m.state.revision));
      assert(revisions.length > 1);
      assert(
        revisions.every((r, i) => !i || r >= revisions[i - 1]),
        "State revision went backwards",
      );
    }
    assert.deepEqual(failures, []);
    console.log(
      JSON.stringify({
        pass: true,
        browsers: 2,
        scope: voiceOnly ? "shared PTY and Live ownership" : "multiplayer UI, shared PTY and Live ownership",
        sharedPid: pid,
        workspaceSync: true,
        sharedInputOutput: true,
        voiceHandoff: true,
        observerSafe: true,
        providerScope: "injected fake Live provider; no paid-provider proof",
        fixture,
      }),
    );
  } catch (error) {
    for (const [index, page] of pages.entries()) {
      try {
        console.error("BROWSER", index, await page.locator("body").innerText());
        console.error(
          "STATE",
          failures,
          await page.evaluate(() => ({
            selected: document.querySelector('[role="tab"][aria-selected="true"]')?.id,
            status: document.querySelector("#status")?.textContent,
            hiddenStatus: document.querySelector("#terminal-status")?.hidden,
            sockets: [...window.terminals].map(([id, socket]) => ({
              id,
              ready: socket.readyState,
              probeReady: socket.probeReady,
            })),
            messages: [...window.messages].map(([id, messages]) => ({
              id,
              messages: messages.filter((m) => m.type !== "output"),
            })),
          })),
        );
        await page.screenshot({
          caret: "initial",
          path: join(project, "artifacts/ghostty/web-multiplayer-failure-" + index + ".png"),
        });
      } catch {}
    }
    throw error;
  } finally {
    await owned.stop();
    console.log("WEB_EXIT", await proc.exited, "STDERR", stderr);
  }
});
