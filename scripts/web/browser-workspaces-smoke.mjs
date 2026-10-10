import { watchRenderer, paintedTerminal } from "./browser-renderer-proof.mjs";
import { withBrowserProbe, waitForFixture } from "./browser-probe.mjs";
import assert from "node:assert/strict";
import { mkdir, readlink, readFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const { chromium } = await import(
  process.env.PLAYWRIGHT_CORE ? pathToFileURL(process.env.PLAYWRIGHT_CORE).href : "playwright"
);
const project = resolve(import.meta.dir, "../..");
await withBrowserProbe("bruv-web-workspaces", async (owned) => {
  const root = owned.root;
  const firstCwd = join(root, "one");
  const secondCwd = join(root, "two");
  const agent = join(root, "agent");
  await Promise.all(
    [firstCwd, secondCwd, agent, join(project, "artifacts/ghostty")].map((p) => mkdir(p, { recursive: true })),
  );
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
      cwd: firstCwd,
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
        BRUV_CODING_AGENT_DIR: agent,
        PI_CODING_AGENT_DIR: agent,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  owned.proc = proc;
  let cliPids = [];
  let output = "",
    errors = "",
    browser,
    page;
  void (async () => {
    for await (const chunk of proc.stdout) output += new TextDecoder().decode(chunk);
  })();
  void (async () => {
    for await (const chunk of proc.stderr) errors += new TextDecoder().decode(chunk);
  })();
  async function until(check, message, timeout = 15000) {
    const end = Date.now() + timeout;
    while (!(await check())) {
      if (Date.now() > end) throw new Error(message);
      await Bun.sleep(30);
    }
  }
  function instrumentBrowser() {
    window.terminalSockets = new Map();
    window.terminalMessages = new Map();
    window.audioSockets = [];
    window.resizeMessages = [];
    window.mediaTracks = [];
    window.audioContexts = [];
    const W = window.WebSocket;
    window.WebSocket = class extends W {
      constructor(url, protocols) {
        super(url, protocols);
        const parsed = new URL(url);
        if (parsed.pathname === "/api/terminal") {
          const id = parsed.searchParams.get("tab") || "terminal";
          window.terminalSockets.set(id, this);
          const send = this.send.bind(this);
          this.send = (data) => {
            const message = JSON.parse(data);
            if (message.type === "resize") window.resizeMessages.push({ id, ...message });
            send(data);
          };
          if (!window.terminalMessages.has(id)) window.terminalMessages.set(id, []);
          this.addEventListener("message", ({ data }) => {
            const message = JSON.parse(data);
            if (message.type === "ready") this.probeReady = true;
            window.terminalMessages.get(id).push(message);
          });
        } else if (parsed.pathname === "/api/live/audio") window.audioSockets.push(this);
      }
    };
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => {
      if (window.denyNextMedia) {
        window.denyNextMedia = false;
        throw new DOMException("Fixture microphone denial", "NotAllowedError");
      }
      const stream = await gum(...args);
      window.mediaTracks.push(...stream.getTracks());
      if (window.delayNextMedia) {
        window.delayNextMedia = false;
        await new Promise((resolve) => {
          window.releaseMedia = resolve;
        });
      }
      return stream;
    };
    const AC = window.AudioContext;
    window.AudioContext = class extends AC {
      constructor(...args) {
        super(...args);
        window.audioContexts.push(this);
      }
    };
  }

  async function connected(page) {
    await waitForFixture(page, "terminalSockets", "terminalMessages");
  }
  try {
    await until(() => output.includes("#token="), "No server URL");
    const url = output.match(/http:\/\/\S+/)[0];
    const origin = new URL(url).origin;
    const token = new URLSearchParams(new URL(url).hash.slice(1)).get("token");
    async function state() {
      const response = await fetch(origin + "/api/workspaces", { headers: { Authorization: "Bearer " + token } });
      assert.equal(response.status, 200, "Authenticated GET without Origin");
      return response.json();
    }
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_BIN,
      headless: process.env.HEADLESS !== "0",
      args: [
        "--no-sandbox",
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-background-timer-throttling",
        ...(process.env.HEADLESS === "0" ? ["--ozone-platform=x11"] : []),
      ],
    });
    owned.browser = browser;
    page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
    page.setDefaultTimeout(15000);
    const failures = [];
    page.on("pageerror", (error) => {
      failures.push(String(error));
      console.error("PAGE_ERROR", String(error));
    });
    await watchRenderer(page);
    await page.addInitScript(instrumentBrowser);
    await page.goto(url);
    await connected(page);
    assert.equal(new URL(page.url()).hash, "", "Token removed from address bar");
    await paintedTerminal(page);
    const cdp = await page.context().newCDPSession(page);
    const ax = (await cdp.send("Accessibility.getFullAXTree")).nodes.filter((node) => !node.ignored);
    assert(
      ax.some((node) => node.name?.value?.includes("bruv")),
      "CLI output reaches accessibility tree",
    );
    assert.equal(await page.locator(".terminal-pane:not([hidden]) .terminal-accessible-output").count(), 1);
    assert.equal(await page.locator("#audio-toggle").count(), 0, "Voice starts from CLI commands");
    await cdp.detach();

    async function rename(name) {
      await page.locator('[role="tab"][aria-selected="true"]').dblclick();
      await page.getByRole("textbox", { name: "Tab name", exact: true }).fill(name);
      await page.keyboard.press("Enter");
      await page.getByRole("tab", { name: "Select tab " + name, exact: true }).waitFor();
    }
    async function openFolder(cwd) {
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
      await page.locator('[id="workspace-' + next.workspaceId + '"][aria-pressed="true"]').waitFor();
      await page.locator("#folder-form").waitFor({ state: "hidden" });
    }
    async function dialogClick(selector, confirm) {
      if (selector.startsWith("#workspace-actions-") && (await page.locator("#open-drawer").isVisible()))
        await page.locator("#open-drawer").click();
      await page.locator(selector).click();
      if (selector.startsWith("#workspace-actions-")) await page.locator("#remove-workspace").click();
      await page.locator("#workspace-dialog").waitFor({ state: "visible" });
      assert.equal(await page.evaluate(() => document.activeElement?.id), "dialog-cancel");
      await page.locator(confirm ? "#dialog-submit" : "#dialog-cancel").click();
      await page.locator("#workspace-dialog").waitFor({ state: "hidden" });
    }
    async function select(workspace, tab) {
      if (await page.locator("#open-drawer").isVisible()) await page.locator("#open-drawer").click();
      await page.locator('[id="workspace-' + workspace.id + '"]').click();
      await page.locator('[id="tab-' + tab.id + '"]').click();
      await connected(page);
    }
    // Pi groups bare ESC + Enter within 10ms as Alt+Enter. Keep the keys distinct.
    async function paste(text) {
      if (text.startsWith("/")) {
        await page.locator("#terminal textarea:visible").focus();
        await page.keyboard.press("Control+u");
        await page.keyboard.type(text);
        await page.keyboard.press("Escape", { delay: 100 });
        return;
      }
      await page.locator("#terminal textarea:visible").evaluate((element, text) => {
        const clipboardData = new DataTransfer();
        clipboardData.setData("text/plain", text);
        element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true }));
      }, text);
    }
    async function terminalText(id) {
      return page.evaluate(
        (id) =>
          document.getElementById("terminal-" + id)?.querySelector(".terminal-accessible-output")?.textContent || "",
        id,
      );
    }

    async function captureVoice(name) {
      const out = join(project, "artifacts/ghostty/spacing-voice");
      await mkdir(out, { recursive: true });
      for (const viewport of [
        { width: 1100, height: 720 },
        { width: 390, height: 680 },
      ]) {
        await page.setViewportSize(viewport);
        await page.waitForTimeout(300);
        const geometry = await page.locator("#voice-status").evaluate((el) => ({
          rect: el.getBoundingClientRect().toJSON(),
          buttons: [...el.querySelectorAll("button:not([hidden])")].map((button) => ({
            rect: button.getBoundingClientRect().toJSON(),
            font: getComputedStyle(button).fontSize,
            library: button.classList.contains("btn"),
          })),
          gap: getComputedStyle(el).gap,
          padding: getComputedStyle(el).paddingLeft,
          width: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));
        assert.equal(geometry.scrollWidth, geometry.width, "Voice strip fits viewport");
        assert.equal(geometry.gap, "8px");
        assert.equal(geometry.padding, viewport.width <= 700 ? "8px" : "12px");
        for (const button of geometry.buttons) {
          assert.equal(button.rect.height, viewport.width <= 700 ? 44 : 32);
          assert(button.library);
          assert(button.rect.right <= geometry.width);
          assert.equal(button.font, "13px");
        }
        const label = name + "-" + (viewport.width <= 700 ? "phone" : "desktop");
        await Bun.write(join(out, label + ".json"), JSON.stringify(geometry, null, 2));
        await page.screenshot({ caret: "initial", path: join(out, label + ".png") });
      }
      await page.setViewportSize({ width: 1100, height: 720 });
    }

    async function allDevicesReleased() {
      await page.waitForFunction(
        () =>
          window.mediaTracks.length > 0 &&
          window.mediaTracks.every((t) => t.readyState === "ended") &&
          window.audioContexts.every((c) => c.state === "closed"),
      );
    }
    let current = await state();
    assert.equal(current.defaultCwd, firstCwd);
    assert.equal(current.workspaces[0].cwd, firstCwd);
    await page.locator("#new-tab").click();
    await until(async () => (await state()).workspaces[0].tabs.length === 2, "Second tab not created");
    await rename("one second");
    await until(
      async () => (await state()).workspaces[0].tabs.some((t) => t.name === "one second"),
      "Rename not saved",
    );
    await openFolder(secondCwd);
    await until(async () => (await state()).workspaces.length === 2, "Second workspace not created");
    await page.locator("#new-tab").click();
    await until(async () => (await state()).workspaces[1].tabs.length === 2, "Fourth tab not created");
    await rename("two second");
    await until(
      async () => (await state()).workspaces[1].tabs.some((t) => t.name === "two second"),
      "Second rename not saved",
    );
    await until(async () => {
      current = await state();
      return (
        current.workspaces.length === 2 &&
        current.workspaces.every((w) => w.tabs.length === 2 && w.tabs.every((t) => t.pid))
      );
    }, "Four CLI PIDs not ready");
    const workspaces = current.workspaces;
    const tabs = workspaces.flatMap((workspace) => workspace.tabs.map((tab) => ({ workspace, tab })));
    const pids = tabs.map(({ tab }) => tab.pid);
    cliPids = pids;
    assert.equal(new Set(pids).size, 4, "Distinct CLI PIDs");
    const relaySecrets = new Set();
    for (const { workspace, tab } of tabs) {
      const env = (await readFile("/proc/" + tab.pid + "/environ", "utf8")).split("\0");
      relaySecrets.add(env.find((value) => value.startsWith("BRUV_LIVE_RELAY_SECRET=")));
      const relayURL = env
        .find((value) => value.startsWith("BRUV_LIVE_RELAY_URL="))
        ?.slice("BRUV_LIVE_RELAY_URL=".length);
      assert.equal(new URL(relayURL).searchParams.get("session"), tab.id, "Per-tab root relay identity");
      assert.equal(await readlink("/proc/" + tab.pid + "/cwd"), workspace.cwd, "Real CLI cwd");
      await select(workspace, tab);
      const marker = "PROOF_" + tab.id;
      await paste("!printf '" + marker + " '; pwd");
      await page.keyboard.press("Enter");
      await until(
        async () => (await terminalText(tab.id)).replace(/\s/g, "").includes(marker + workspace.cwd),
        "Shell cwd output missing for " + tab.id,
      );
    }
    assert.equal(relaySecrets.size, 4, "Distinct per-tab root relay secrets");
    assert(!relaySecrets.has(undefined), "Root relay secret present");
    for (const { tab } of tabs) {
      const text = await terminalText(tab.id);
      for (const { tab: other } of tabs)
        if (other.id !== tab.id) assert(!text.includes("PROOF_" + other.id), "Output crossed tabs");
    }
    console.log(
      "FOUR_REAL_CLIS",
      tabs.map(({ workspace, tab }) => ({
        workspace: workspace.name,
        tab: tab.name,
        pid: tab.pid,
        cwd: workspace.cwd,
      })),
    );

    const jobOwner = tabs[0];
    await select(jobOwner.workspace, jobOwner.tab);
    await paste("!sleep 5; printf 'JOB_%s_%s\\n' survived switching");
    await page.keyboard.press("Enter");
    await select(tabs[3].workspace, tabs[3].tab);
    await page.reload();
    await connected(page);
    // Reload mounts only the selected pane. Revisit the job owner for current output.
    await select(jobOwner.workspace, jobOwner.tab);
    await until(
      async () => (await terminalText(jobOwner.tab.id)).includes("JOB_survived_switching"),
      "Running CLI shell job lost on switch/reload",
    );
    assert.deepEqual(
      (await state()).workspaces.flatMap((w) => w.tabs.map((t) => t.pid)),
      pids,
      "Shell job kept tab PIDs",
    );
    assert.equal(await page.evaluate(() => window.mediaTracks.length), 0, "Load, tab switch, and rejoin never capture");
    console.log("RUNNING_CLI_SHELL_JOB_SURVIVED_SWITCH_AND_RELOAD");

    const owner = tabs[0],
      other = tabs[3];

    // Permission can settle after release. It must close, not move to selection.
    await select(owner.workspace, owner.tab);
    await page.evaluate(() => {
      window.delayNextMedia = true;
    });
    await paste("/fixture-live start");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => typeof window.releaseMedia === "function");
    await captureVoice("pending");
    await select(other.workspace, other.tab);
    await paste("/fixture-live start");
    await page.keyboard.press("Escape", { delay: 20 });
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#audio-toggle").count(), 0, "No permanent microphone control");
    await page.locator("#cancel-voice").waitFor({ state: "visible" });
    assert.equal(await page.locator("#voice-status").isVisible(), true);
    await page.locator("#cancel-voice").click();
    await page.evaluate(() => {
      window.releaseMedia();
      delete window.releaseMedia;
    });
    await allDevicesReleased();
    await page.locator("#voice-status").waitFor({ state: "hidden" });
    console.log("PENDING_MICROPHONE_RELEASED_WITHOUT_TRANSFER");

    // A real CLI request with an emulated permission denial, then a fresh retry.
    await select(owner.workspace, owner.tab);
    await page.evaluate(() => {
      window.denyNextMedia = true;
    });
    await paste("/fixture-live start");
    await page.keyboard.press("Escape", { delay: 20 });
    await page.keyboard.press("Enter");
    await page.locator("#dismiss-voice").waitFor({ state: "visible" });
    assert.match(await page.locator("#audio-status").innerText(), /denied/i);
    await captureVoice("denied");
    await page.locator("#dismiss-voice").click();
    await page.locator("#voice-status").waitFor({ state: "hidden" });
    await until(
      async () => (await terminalText(owner.tab.id)).includes("Microphone permission denied"),
      "CLI receives the denial before retry",
    );

    await select(owner.workspace, owner.tab);
    await paste("/fixture-live start");
    await page.keyboard.press("Escape", { delay: 20 });
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("#audio-status")?.textContent?.includes("Live"));
    assert.equal(await page.locator("#cancel-voice").isVisible(), false, "Only pending requests can be cancelled");
    await captureVoice("live");

    // Reorder the real CLI while it owns fake-device voice and an unsent draft.
    const voiceBeforeMove = (await state()).voice;
    const tracksBeforeMove = await page.evaluate(() => window.mediaTracks.length);
    await page.locator("#terminal textarea:visible").focus();
    await page.keyboard.type("draft-before-reorder");
    await until(
      async () => (await terminalText(owner.tab.id)).includes("draft-before-reorder"),
      "Draft did not reach the real editor",
    );
    for (const [selector, forward, back, path] of [
      ["#tab-" + owner.tab.id, "ArrowRight", "ArrowLeft", "/api/tabs/" + owner.tab.id + "/move"],
      ["#workspace-" + owner.workspace.id, "ArrowDown", "ArrowUp", "/api/workspaces/" + owner.workspace.id + "/move"],
    ]) {
      for (const key of [forward, back]) {
        await page.locator(selector).focus();
        const response = page.waitForResponse((r) => new URL(r.url()).pathname === path);
        await page.keyboard.press("Alt+Shift+" + key);
        assert.equal((await response).status(), 200);
        await page.waitForFunction(() => !document.querySelector("#new-tab").disabled);
        assert.equal(
          await page.locator('[role="tab"][aria-selected="true"]').getAttribute("id"),
          "tab-" + owner.tab.id,
        );
        assert.deepEqual((await state()).voice, voiceBeforeMove, "Reorder moved voice ownership");
      }
    }
    assert.deepEqual(
      (await state()).workspaces.flatMap((w) => w.tabs.map((t) => t.pid)),
      pids,
      "Reorder restarted a CLI",
    );
    assert.equal(await page.evaluate(() => window.mediaTracks.length), tracksBeforeMove, "Reorder reopened microphone");
    assert(await page.evaluate(() => window.mediaTracks.some((t) => t.readyState === "live")));
    assert((await terminalText(owner.tab.id)).includes("draft-before-reorder"), "Reorder lost the editor draft");
    await page.locator("#terminal textarea:visible").focus();
    await page.keyboard.press("Control+u");
    console.log("REORDER_PRESERVED_REAL_PTY_DRAFT_AND_VOICE");

    const otherCapability = await page.evaluate(
      (id) =>
        window.terminalMessages
          .get(id)
          .filter((m) => m.type === "audio-owner")
          .at(-1).id,
      other.tab.id,
    );
    const competingVoice = await fetch(origin + "/api/live/audio?role=browser&session=" + other.tab.id, {
      headers: {
        Origin: origin,
        Authorization: "Bearer " + token,
        "Sec-WebSocket-Protocol": "bruv-audio, bruv-owner." + otherCapability,
      },
    });
    assert.equal(competingVoice.status, 403, "Built server rejects audio without a CLI request, independent of UI");

    await select(other.workspace, other.tab);
    const label = await page.locator("#audio-status").innerText();
    assert(
      label.includes(owner.workspace.name) && label.includes(owner.tab.name),
      "Voice away from selection names its owner",
    );
    assert.equal((await state()).voice.tabId, owner.tab.id, "Switching did not move voice");

    await page.screenshot({
      caret: "initial",
      path: join(project, "artifacts/ghostty/web-workspaces-voice-owner.png"),
    });
    await page.locator("#terminal textarea:visible").focus();
    assert(
      await page.evaluate(() => window.mediaTracks.some((t) => t.readyState === "live")),
      "Switching kept microphone",
    );
    assert.equal(
      await page.evaluate(() => new URL(window.audioSockets.at(-1).url).searchParams.get("session")),
      owner.tab.id,
    );
    await select(owner.workspace, owner.tab);
    await paste("/fixture-live stop");
    await page.keyboard.press("Escape", { delay: 20 });
    await page.keyboard.press("Enter");
    await allDevicesReleased();
    await page.locator("#voice-status").waitFor({ state: "hidden" });
    assert.equal(await page.locator("#audio-status").textContent(), "", "Explicit release clears voice banner");
    await select(other.workspace, other.tab);
    await paste("/fixture-live start");
    await page.keyboard.press("Escape", { delay: 20 });
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("#audio-status")?.textContent?.includes("Live"));
    assert.equal(
      await page.evaluate(() => new URL(window.audioSockets.at(-1).url).searchParams.get("session")),
      other.tab.id,
    );
    await select(owner.workspace, owner.tab);
    const otherLabel = await page.locator("#audio-status").innerText();
    assert(
      otherLabel.includes(other.workspace.name) && otherLabel.includes(other.tab.name),
      "Other voice owner remains labeled",
    );
    assert.equal((await state()).voice.tabId, other.tab.id, "Switch leaves voice on command owner");
    await page.evaluate(
      (id) => window.terminalSockets.get(id).send(JSON.stringify({ type: "input", data: "/fixture-live stop\r" })),
      other.tab.id,
    );
    await allDevicesReleased();
    await select(other.workspace, other.tab);
    await paste("/live mic-check");
    await page.keyboard.press("Escape", { delay: 20 });
    await page.keyboard.press("Enter");
    await until(
      async () => (await terminalText(other.tab.id)).includes("Audio route ready. Sound quality not measured."),
      "Real /live mic-check failed without second confirmation",
    );
    await allDevicesReleased();
    console.log("VOICE_EXPLICIT_OWNER_AND_MIC_CHECK");
    for (let index = 0; index < tabs.length; index++) {
      const { workspace, tab } = tabs[index];
      await select(workspace, tab);
      if (!index) await page.keyboard.type("draft-" + tab.id, { delay: 30 });
      else await paste("draft-" + tab.id);
      await until(async () => (await terminalText(tab.id)).includes("draft-" + tab.id), "Input missing from tab");
    }
    const last = tabs.at(-1);
    await page.evaluate((id) => window.terminalSockets.get(id).close(4000, "acceptance reconnect"), last.tab.id);
    await page.locator("#status").waitFor({ state: "visible" });
    assert.equal(await page.locator("#sync-status").isVisible(), false, "PTY outage does not mark list sync down");
    await page.waitForFunction(
      (id) =>
        window.terminalSockets.get(id)?.readyState === WebSocket.OPEN &&
        window.terminalSockets.get(id)?.probeReady &&
        document.querySelector("#terminal-status")?.hidden,
      last.tab.id,
    );
    assert.deepEqual(
      (await state()).workspaces.flatMap((w) => w.tabs.map((t) => t.pid)),
      pids,
      "Reconnect kept PIDs",
    );
    await page.reload();
    await connected(page);
    assert.deepEqual(
      (await state()).workspaces.flatMap((w) => w.tabs.map((t) => t.pid)),
      pids,
      "Reload kept PIDs",
    );
    for (const { workspace, tab } of tabs) {
      await select(workspace, tab);
      await page.waitForFunction(
        (id) =>
          document
            .querySelector('[id="terminal-' + id + '"] .terminal-accessible-output')
            ?.textContent?.includes("draft-" + id),
        tab.id,
      );
    }
    await select(owner.workspace, owner.tab);
    await page.evaluate(() => {
      window.resizeMessages = [];
    });
    await page.setViewportSize({ width: 390, height: 680 });
    await page.waitForTimeout(300);
    const resizes = await page.evaluate(() => window.resizeMessages);
    assert(
      resizes.length && resizes.every((m) => m.id === owner.tab.id && m.cols >= 2 && m.rows >= 2),
      "Only visible terminal resized",
    );
    assert(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), "Narrow page overflow");
    await paintedTerminal(page);
    await page.screenshot({ caret: "initial", path: join(project, "artifacts/ghostty/web-workspaces-narrow.png") });
    await page.locator("#open-drawer").click();
    await page.screenshot({
      animations: "disabled",
      caret: "initial",
      path: join(project, "artifacts/ghostty/web-workspaces-drawer.png"),
    });
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1100, height: 720 });
    await page.waitForTimeout(300);
    await page.screenshot({ caret: "initial", path: join(project, "artifacts/ghostty/web-workspaces-wide.png") });
    // Arrow navigation is local to this workspace's tab strip.
    await page.locator('[id="tab-' + owner.tab.id + '"]').focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator('[id="tab-' + tabs[1].tab.id + '"]').getAttribute("aria-selected"), "true");

    await select(other.workspace, other.tab);
    // This tab still has its replayed draft. Clear it before an explicit voice command.
    await page.locator("#terminal textarea:visible").focus();
    await page.keyboard.press("Control+c");
    await paste("/fixture-live start");
    await page.keyboard.press("Escape", { delay: 20 });
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("#audio-status")?.textContent?.includes("Live"));
    const oldCapability = await page.evaluate(
      (id) =>
        window.terminalMessages
          .get(id)
          .filter((m) => m.type === "audio-owner")
          .at(-1).id,
      other.tab.id,
    );
    const voiceBeforeObserver = (await state()).voice;
    const replacement = await browser.newPage();
    try {
      await replacement.addInitScript(instrumentBrowser);
      await replacement.goto(url);
      await connected(replacement);
      assert.deepEqual((await state()).voice, voiceBeforeObserver, "New viewer does not steal voice");
      assert(await page.evaluate(() => window.mediaTracks.some((track) => track.readyState === "live")));
      await page.evaluate((id) => window.terminalSockets.get(id).close(4000, "owner disconnect"), other.tab.id);
      await allDevicesReleased();
      const stale = await fetch(origin + "/api/live/audio?role=browser&session=" + other.tab.id, {
        headers: {
          Origin: origin,
          Authorization: "Bearer " + token,
          "Sec-WebSocket-Protocol": "bruv-audio, bruv-owner." + oldCapability,
        },
      });
      assert.equal(stale.status, 403, "Disconnected owner capability rejected");
      assert.deepEqual(
        (await state()).workspaces.flatMap((w) => w.tabs.map((t) => t.pid)),
        pids,
        "Viewer join and owner disconnect kept CLIs",
      );
    } finally {
      await replacement.close();
    }
    await page.reload();
    await connected(page);
    await select(owner.workspace, tabs[1].tab);
    console.log("OBSERVER_JOIN_PRESERVED_VOICE_OWNER_DISCONNECT_RELEASED");

    await dialogClick("#tab-close-" + tabs[1].tab.id, false);
    assert.deepEqual(
      (await state()).workspaces.flatMap((w) => w.tabs.map((t) => t.pid)),
      pids,
      "Cancel close preserved CLIs",
    );
    await dialogClick("#tab-close-" + tabs[1].tab.id, true);
    await until(async () => (await state()).workspaces[0].tabs.length === 1, "Tab close not applied");
    await page.waitForFunction((id) => !document.getElementById("terminal-" + id), tabs[1].tab.id);
    await until(() => {
      try {
        process.kill(tabs[1].tab.pid, 0);
        return false;
      } catch {
        return true;
      }
    }, "Closed CLI cleanup did not finish");
    assert.throws(() => process.kill(tabs[1].tab.pid, 0), "Closed CLI gone");
    await select(other.workspace, other.tab);
    await paste("/fixture-live start");
    await page.keyboard.press("Escape", { delay: 20 });
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("#audio-status")?.textContent?.includes("Live"));
    await dialogClick("#workspace-actions-" + other.workspace.id, false);
    assert.equal((await state()).workspaces.length, 2, "Cancel workspace remove");
    await dialogClick("#workspace-actions-" + other.workspace.id, true);
    await until(async () => (await state()).workspaces.length === 1, "Workspace remove not applied");
    await allDevicesReleased();
    await page.waitForFunction(
      (ids) => ids.every((id) => !document.getElementById("terminal-" + id)),
      tabs.slice(2).map(({ tab }) => tab.id),
    );
    await until(
      () =>
        tabs.slice(2).every(({ tab }) => {
          try {
            process.kill(tab.pid, 0);
            return false;
          } catch {
            return true;
          }
        }),
      "Workspace CLI cleanup did not finish",
    );
    for (const { tab } of tabs.slice(2)) assert.throws(() => process.kill(tab.pid, 0), "Workspace CLI gone");
    await access(secondCwd);
    assert.equal((await state()).workspaces[0].tabs[0].pid, owner.tab.pid, "Unrelated CLI survived cleanup");
    console.log("SWITCH_RECONNECT_RELOAD_CLOSE_RESIZE_KEYS_PASTE_OK");
    assert.deepEqual(failures, []);
  } catch (error) {
    console.error("WORKSPACES_FAILURE", await page?.locator("body").innerText());
    if (page)
      console.error(
        "STATE",
        await page.evaluate(() => ({
          selected: document.querySelector('[role="tab"][aria-selected="true"]')?.id,
          status: document.querySelector("#status")?.textContent,
          hiddenStatus: document.querySelector("#terminal-status")?.hidden,
          sockets: [...window.terminalSockets].map(([id, socket]) => ({
            id,
            ready: socket.readyState,
            probeReady: socket.probeReady,
          })),
        })),
      );
    await page?.screenshot({ caret: "initial", path: join(project, "artifacts/ghostty/web-workspaces-failure.png") });
    throw error;
  } finally {
    await owned.stop();
    const exitCode = await proc.exited;
    assert.equal(exitCode, 0, "Web server clean shutdown");
    for (const pid of cliPids) assert.throws(() => process.kill(pid, 0), "Server reaped owned terminal");
    console.log("WEB_EXIT", exitCode, "STDERR", errors, "FIXTURE", root);
  }
});
