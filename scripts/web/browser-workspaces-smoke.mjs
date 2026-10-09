import assert from "node:assert/strict";
import { mkdtemp, mkdir, readlink, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const { chromium } = await import(
  process.env.PLAYWRIGHT_CORE ? pathToFileURL(process.env.PLAYWRIGHT_CORE).href : "playwright"
);
const project = resolve(import.meta.dir, "../..");
const root = await mkdtemp(join(tmpdir(), "bruv-web-workspaces-"));
const firstCwd = join(root, "one");
const secondCwd = join(root, "two");
const agent = join(root, "agent");
await Promise.all([firstCwd, secondCwd, agent, join(project, "artifacts")].map((p) => mkdir(p, { recursive: true })));
const proc = Bun.spawn(
  [join(project, "dist/bruv"), "web", "--port", "0", "--", "--offline", "--provider", "openai", "--model", "gpt-4o"],
  {
    cwd: firstCwd,
    env: {
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
    },
    stdout: "pipe",
    stderr: "pipe",
  },
);
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
    headless: true,
    args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  page.setDefaultTimeout(15000);
  const failures = [];
  page.on("pageerror", (error) => failures.push(String(error)));
  await page.addInitScript(() => {
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
          this.addEventListener("message", ({ data }) => window.terminalMessages.get(id).push(JSON.parse(data)));
        } else if (parsed.pathname === "/api/live/audio") window.audioSockets.push(this);
      }
    };
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => {
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
  });
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector("#status")?.textContent?.startsWith("Connected"));
  assert.equal(new URL(page.url()).hash, "", "Token removed from address bar");

  async function dialogClick(selector, answer) {
    const answered = new Promise((resolve) =>
      page.once("dialog", async (dialog) => {
        if (answer === false) await dialog.dismiss();
        else await dialog.accept(typeof answer === "string" ? answer : undefined);
        resolve();
      }),
    );
    await page.locator(selector).click();
    await answered;
  }
  async function select(workspace, tab) {
    await page.getByRole("button", { name: "Open workspace " + workspace.name, exact: true }).click();
    await page.locator('[id="tab-' + tab.id + '"]').click();
    await page.waitForFunction(() => document.querySelector("#status")?.textContent?.startsWith("Connected"));
  }
  async function paste(text) {
    await page.locator("#terminal .xterm-helper-textarea:visible").evaluate((element, text) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", text);
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true }));
    }, text);
  }
  async function terminalText(id) {
    return page.evaluate(
      (id) =>
        (window.terminalMessages.get(id) || [])
          .filter((m) => m.type === "output")
          .map((m) => atob(m.data))
          .join(""),
      id,
    );
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
  await dialogClick("#rename-tab", "one second");
  await until(async () => (await state()).workspaces[0].tabs.some((t) => t.name === "one second"), "Rename not saved");
  await dialogClick("#add-workspace", secondCwd);
  await until(async () => (await state()).workspaces.length === 2, "Second workspace not created");
  await page.locator("#new-tab").click();
  await until(async () => (await state()).workspaces[1].tabs.length === 2, "Fourth tab not created");
  await dialogClick("#rename-tab", "two second");
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
      async () => (await terminalText(tab.id)).includes(marker + " " + workspace.cwd),
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
    tabs.map(({ workspace, tab }) => ({ workspace: workspace.name, tab: tab.name, pid: tab.pid, cwd: workspace.cwd })),
  );

  const jobOwner = tabs[0];
  await select(jobOwner.workspace, jobOwner.tab);
  await paste("!sleep 5; printf 'JOB_%s_%s\\n' survived switching");
  await page.keyboard.press("Enter");
  await select(tabs[3].workspace, tabs[3].tab);
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#status")?.textContent?.startsWith("Connected"));
  await until(
    async () => (await terminalText(jobOwner.tab.id)).includes("JOB_survived_switching"),
    "Running CLI shell job lost on switch/reload",
  );
  assert.deepEqual(
    (await state()).workspaces.flatMap((w) => w.tabs.map((t) => t.pid)),
    pids,
    "Shell job kept tab PIDs",
  );
  console.log("RUNNING_CLI_SHELL_JOB_SURVIVED_SWITCH_AND_RELOAD");

  const owner = tabs[0],
    other = tabs[3];

  // Permission can settle after release. It must close, not move to selection.
  await select(owner.workspace, owner.tab);
  await page.evaluate(() => {
    window.delayNextMedia = true;
  });
  await page.locator("#audio-toggle").click();
  await page.waitForFunction(() => typeof window.releaseMedia === "function");
  await select(other.workspace, other.tab);
  await page.locator("#audio-toggle").click();
  assert(
    await page.locator("#audio-toggle").isDisabled(),
    "Pending owner must finish release before another can start",
  );
  await page.evaluate(() => {
    window.releaseMedia();
    delete window.releaseMedia;
  });
  await allDevicesReleased();
  await page.waitForFunction(() => document.querySelector("#audio-status")?.textContent === "Voice off");
  console.log("PENDING_MICROPHONE_RELEASED_WITHOUT_TRANSFER");

  await select(owner.workspace, owner.tab);
  await page.locator("#audio-toggle").click();
  await page.waitForFunction(() => document.querySelector("#audio-status")?.textContent?.includes("Mic enabled"));
  const label = await page.locator("#audio-status").innerText();
  assert(label.includes(owner.workspace.name) && label.includes(owner.tab.name), "Voice owner is labeled");

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
  assert.equal(competingVoice.status, 409, "Built server rejects an unrelated audio owner, independent of UI");

  await select(other.workspace, other.tab);
  assert.equal(await page.locator("#audio-status").innerText(), label, "Switching did not move voice");
  await page.screenshot({ path: join(project, "artifacts/web-workspaces-voice-owner.png") });
  assert(
    await page.evaluate(() => window.mediaTracks.some((t) => t.readyState === "live")),
    "Switching kept microphone",
  );
  assert.equal(
    await page.evaluate(() => new URL(window.audioSockets.at(-1).url).searchParams.get("session")),
    owner.tab.id,
  );
  await page.locator("#audio-toggle").click();
  await allDevicesReleased();
  assert.equal(await page.locator("#audio-status").innerText(), "Voice off", "Explicit release before new owner");
  await page.locator("#audio-toggle").click();
  await page.waitForFunction(() => document.querySelector("#audio-status")?.textContent?.includes("Mic enabled"));
  assert.equal(
    await page.evaluate(() => new URL(window.audioSockets.at(-1).url).searchParams.get("session")),
    other.tab.id,
  );
  await paste("/live mic-check");
  await page.keyboard.press("Enter");
  await until(
    async () => (await terminalText(other.tab.id)).includes("Audio crosses the session relay"),
    "No Live browser consent",
  );
  const otherLabel = await page.locator("#audio-status").innerText();
  await select(owner.workspace, owner.tab);
  assert.equal(
    await page.locator("#audio-status").innerText(),
    otherLabel,
    "Consent stays on owner across workspace switch",
  );
  await page.evaluate(
    (id) => window.terminalSockets.get(id).send(JSON.stringify({ type: "input", data: "\r" })),
    other.tab.id,
  );
  await until(
    async () => (await terminalText(other.tab.id)).includes("Audio route ready. Sound quality not measured."),
    "Hidden owner's real /live mic-check failed",
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
  await page.waitForFunction(
    (id) =>
      window.terminalSockets.get(id)?.readyState === WebSocket.OPEN &&
      document.querySelector("#status")?.textContent?.startsWith("Connected"),
    last.tab.id,
  );
  assert.deepEqual(
    (await state()).workspaces.flatMap((w) => w.tabs.map((t) => t.pid)),
    pids,
    "Reconnect kept PIDs",
  );
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#status")?.textContent?.startsWith("Connected"));
  assert.deepEqual(
    (await state()).workspaces.flatMap((w) => w.tabs.map((t) => t.pid)),
    pids,
    "Reload kept PIDs",
  );
  for (const { workspace, tab } of tabs) {
    await select(workspace, tab);
    await page.waitForFunction(
      (id) => document.querySelector('[id="terminal-' + id + '"] .xterm-rows')?.textContent?.includes("draft-" + id),
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
  await page.screenshot({ path: join(project, "artifacts/web-workspaces-narrow.png") });
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.screenshot({ path: join(project, "artifacts/web-workspaces-wide.png") });
  // Arrow navigation is local to this workspace's tab strip.
  await page.locator('[id="tab-' + owner.tab.id + '"]').focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator('[id="tab-' + tabs[1].tab.id + '"]').getAttribute("aria-selected"), "true");

  await select(other.workspace, other.tab);
  await page.locator("#audio-toggle").click();
  await page.waitForFunction(() => document.querySelector("#audio-status")?.textContent?.includes("Mic enabled"));
  const oldCapability = await page.evaluate(
    (id) =>
      window.terminalMessages
        .get(id)
        .filter((m) => m.type === "audio-owner")
        .at(-1).id,
    other.tab.id,
  );
  const replacement = await browser.newPage();
  try {
    await replacement.goto(url);
    await replacement.waitForFunction(() => document.querySelector("#status")?.textContent?.startsWith("Connected"));
    await allDevicesReleased();
    const stale = await fetch(origin + "/api/live/audio?role=browser&session=" + other.tab.id, {
      headers: {
        Origin: origin,
        Authorization: "Bearer " + token,
        "Sec-WebSocket-Protocol": "bruv-audio, bruv-owner." + oldCapability,
      },
    });
    assert.equal(stale.status, 403, "Replaced controlling-browser capability rejected");
    assert.deepEqual(
      (await state()).workspaces.flatMap((w) => w.tabs.map((t) => t.pid)),
      pids,
      "Replacement kept CLIs",
    );
  } finally {
    await replacement.close();
  }
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#status")?.textContent?.startsWith("Connected"));
  await select(owner.workspace, tabs[1].tab);
  console.log("CONTROLLING_BROWSER_REPLACEMENT_RELEASED_VOICE");

  await dialogClick("#close-tab", false);
  assert.deepEqual(
    (await state()).workspaces.flatMap((w) => w.tabs.map((t) => t.pid)),
    pids,
    "Cancel close preserved CLIs",
  );
  await dialogClick("#close-tab", true);
  await until(async () => (await state()).workspaces[0].tabs.length === 1, "Tab close not applied");
  await page.waitForFunction((id) => !document.getElementById("terminal-" + id), tabs[1].tab.id);
  assert.throws(() => process.kill(tabs[1].tab.pid, 0), "Closed CLI gone");
  await select(other.workspace, other.tab);
  await page.locator("#audio-toggle").click();
  await page.waitForFunction(() => document.querySelector("#audio-status")?.textContent?.includes("Mic enabled"));
  await dialogClick("#remove-workspace", false);
  assert.equal((await state()).workspaces.length, 2, "Cancel workspace remove");
  await dialogClick("#remove-workspace", true);
  await until(async () => (await state()).workspaces.length === 1, "Workspace remove not applied");
  await allDevicesReleased();
  await page.waitForFunction(
    (ids) => ids.every((id) => !document.getElementById("terminal-" + id)),
    tabs.slice(2).map(({ tab }) => tab.id),
  );
  for (const { tab } of tabs.slice(2)) assert.throws(() => process.kill(tab.pid, 0), "Workspace CLI gone");
  await access(secondCwd);
  assert.equal((await state()).workspaces[0].tabs[0].pid, owner.tab.pid, "Unrelated CLI survived cleanup");
  console.log("SWITCH_RECONNECT_RELOAD_CLOSE_RESIZE_KEYS_PASTE_OK");
  assert.deepEqual(failures, []);
} catch (error) {
  console.error("WORKSPACES_FAILURE", await page?.locator("body").innerText());
  await page?.screenshot({ path: join(project, "artifacts/web-workspaces-failure.png") });
  throw error;
} finally {
  await browser?.close();
  proc.kill("SIGTERM");
  const exitCode = await proc.exited;
  assert.equal(exitCode, 0, "Web server clean shutdown");
  for (const pid of cliPids) assert.throws(() => process.kill(pid, 0), "Server reaped owned terminal");
  console.log("WEB_EXIT", exitCode, "STDERR", errors, "FIXTURE", root);
}
