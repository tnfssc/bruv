import assert from "node:assert/strict";
import { mkdtemp, mkdir, readlink, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const { chromium } = await import(
  process.env.PLAYWRIGHT_CORE ? pathToFileURL(process.env.PLAYWRIGHT_CORE).href : "playwright"
);
const project = resolve(import.meta.dir, "../..");
const fixture = await mkdtemp(join(tmpdir(), "bruv-multiplayer-"));
const one = join(fixture, "one"),
  two = join(fixture, "two"),
  agent = join(fixture, "agent");
await Promise.all([one, two, agent, join(project, "artifacts")].map((p) => mkdir(p, { recursive: true })));
const proc = Bun.spawn(
  [
    join(project, "dist/bruv"),
    "web",
    "--port",
    "0",
    "--",
    "--offline",
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
    headless: true,
    args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  const sharedContext = process.env.BRUV_BROWSER_SHARED_CONTEXT === "1" ? await browser.newContext() : null;
  async function open(width) {
    const context = sharedContext ?? (await browser.newContext());
    const page = await context.newPage();
    await page.setViewportSize({ width, height: 800 });
    pages.push(page);
    page.setDefaultTimeout(15000);
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
            this.addEventListener("message", (e) => window.messages.get(id).push(JSON.parse(e.data)));
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
    await page.waitForFunction(() => document.querySelector("#status")?.textContent?.startsWith("Connected"));
    return page;
  }
  const a = await open(1200),
    b = await open(850);
  await until(async () => (await state()).workspaces[0].tabs[0].pid, "Initial CLI missing");
  const initial = await state(),
    first = initial.workspaces[0],
    tab = first.tabs[0],
    pid = tab.pid;
  assert.equal(await readlink("/proc/" + pid + "/cwd"), one);
  async function text(page, id = tab.id) {
    return page.evaluate(
      (id) =>
        (window.messages.get(id) || [])
          .filter((m) => m.type === "output")
          .map((m) => atob(m.data))
          .join(""),
      id,
    );
  }
  async function paste(page, value) {
    await page.locator("#terminal .xterm-helper-textarea:visible").evaluate((el, value) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", value);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true }));
    }, value);
  }
  async function submit(page, value) {
    await paste(page, value);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Enter");
  }
  async function dialog(page, selector, answer) {
    if (["#rename-tab", "#close-tab"].includes(selector)) await page.locator("#tab-menu-toggle").click();
    if (selector === "#remove-workspace") {
      if (await page.locator("#open-drawer").isVisible()) await page.locator("#open-drawer").click();
      await page.locator("#workspace-menu-toggle").click();
    }
    await page.locator(selector).click();
    await page.locator("#workspace-dialog").waitFor({ state: "visible" });
    if (typeof answer === "string") await page.locator("#dialog-input").fill(answer);
    await page.locator(answer === false ? "#dialog-cancel" : "#dialog-submit").click();
    await page.locator("#workspace-dialog").waitFor({ state: "hidden" });
  }
  async function select(page, workspace, id) {
    if (await page.locator("#open-drawer").isVisible()) await page.locator("#open-drawer").click();
    await page.getByRole("button", { name: "Open workspace " + workspace.name, exact: true }).click();
    await page.locator('[id="tab-' + id + '"]').click();
    await page.waitForFunction(() => document.querySelector("#status")?.textContent?.startsWith("Connected"));
  }
  const selected = (page) => page.locator('[role="tab"][aria-selected="true"]').getAttribute("id");
  await submit(a, "!printf 'A_OUT_%s\\n' $PWD");
  await until(
    async () => (await text(a)).includes("A_OUT_" + one) && (await text(b)).includes("A_OUT_" + one),
    "A output not shared",
  );
  await submit(b, "!printf 'B_OUT_%s\\n' $PWD");
  await until(
    async () => (await text(a)).includes("B_OUT_" + one) && (await text(b)).includes("B_OUT_" + one),
    "B input not shared",
  );
  assert.equal((await state()).workspaces[0].tabs[0].pid, pid, "Second browser duplicated CLI");
  await a.keyboard.type("shared-draft");
  await until(
    async () => (await b.locator(".terminal-pane:visible .xterm-rows").innerText()).includes("shared-draft"),
    "Draft input not shared",
  );
  await b.keyboard.press("Control+u");
  await dialog(b, "#add-workspace", two);
  await a.getByRole("button", { name: "Open workspace two", exact: true }).waitFor();
  assert.equal(await selected(a), "tab-" + tab.id, "Remote creation stole A selection");
  let current = await state(),
    second = current.workspaces.find((w) => w.cwd === two);
  assert(second);
  assert.equal(current.workspaces.length, 2);
  await b.locator("#new-tab").click();
  await dialog(b, "#rename-tab", "from-B");
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
  await dialog(b, "#rename-tab", "renamed-remotely");
  await a.getByRole("tab", { name: "Select tab renamed-remotely", exact: true }).waitFor();
  assert.equal(await selected(a), selectedBefore, "Remote rename stole focus");
  await dialog(b, "#close-tab", false);
  assert.equal((await state()).workspaces.find((w) => w.id === second.id).tabs.length, 4);
  await dialog(b, "#close-tab", true);
  await until(
    async () => (await a.getByRole("tab").count()) === 3 && (await b.getByRole("tab").count()) === 3,
    "Close did not propagate",
  );
  await select(a, first, tab.id);
  await select(b, first, tab.id);
  await submit(a, "!sleep 2; printf 'JOB_%s\\n' survives-reload");
  await a.reload();
  await a.waitForFunction(() => document.querySelector("#status")?.textContent?.startsWith("Connected"));
  await until(
    async () => (await text(b)).includes("JOB_survives-reload") && (await text(a)).includes("JOB_survives-reload"),
    "Reload lost shared job or replay",
  );
  assert.equal((await state()).workspaces[0].tabs[0].pid, pid);
  await a.evaluate(() => window.stateSocket.close(4000, "reconnect fixture"));
  await dialog(b, "#rename-tab", "shared first");
  await a.getByRole("tab", { name: "Select tab shared first", exact: true }).waitFor();
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
  await b.waitForFunction(() => document.querySelector("#status")?.textContent?.startsWith("Connected"));
  assert.deepEqual((await state()).voice, voice, "Observer disconnect stopped voice");
  await b.reload();
  await b.waitForFunction(() => document.querySelector("#status")?.textContent?.startsWith("Connected"));
  assert.deepEqual((await state()).voice, voice, "Observer reload stopped voice");
  assert.equal(await b.evaluate(() => window.mediaTracks.length), 0, "Observer rejoin must not capture");
  await submit(b, "/fixture-live start");
  await Bun.sleep(250);
  assert.deepEqual((await state()).voice, voice, "Another browser command cannot steal active owner");
  assert.equal(await b.evaluate(() => window.mediaTracks.length), 0);
  assert(await a.evaluate(() => window.mediaTracks.some((t) => t.readyState === "live")));
  await a.screenshot({ path: join(project, "artifacts/web-multiplayer-owner.png") });
  await b.screenshot({ path: join(project, "artifacts/web-multiplayer-observer.png") });
  await a.setViewportSize({ width: 390, height: 680 });
  await Bun.sleep(200);
  await a.screenshot({ path: join(project, "artifacts/web-multiplayer-owner-phone.png") });
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
  await select(b, second, second.tabs[0].id);
  const otherPids = (await state()).workspaces
    .find((w) => w.id === second.id)
    .tabs.map((t) => t.pid)
    .filter(Boolean);
  await dialog(b, "#remove-workspace", true);
  await until(
    async () => (await a.getByRole("button", { name: "Open workspace two", exact: true }).count()) === 0,
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
      sharedPid: pid,
      workspaceSync: true,
      sharedInputOutput: true,
      voiceHandoff: true,
      observerSafe: true,
      providerCalls: 0,
      fixture,
    }),
  );
} catch (error) {
  for (const [index, page] of pages.entries()) {
    try {
      console.error("BROWSER", index, await page.locator("body").innerText());
      await page.screenshot({ path: join(project, "artifacts/web-multiplayer-failure-" + index + ".png") });
    } catch {}
  }
  throw error;
} finally {
  await browser?.close();
  proc.kill("SIGTERM");
  console.log("WEB_EXIT", await proc.exited, "STDERR", stderr);
}
