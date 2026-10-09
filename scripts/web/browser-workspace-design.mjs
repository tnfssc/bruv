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
const firstCwd = join(root, "bruv");
const secondCwd = join(root, "api-service");
const agent = join(root, "agent");
await Promise.all([firstCwd, secondCwd, agent, join(project, "artifacts")].map((p) => mkdir(p, { recursive: true })));
const proc = Bun.spawn(
  [join(project, "dist/bruv"), "web", "--port", "0", "--", "--offline", "--provider", "openai", "--model", "gpt-4o"],
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
// UI proof uses the compiled app and real PTYs. Inspect the saved frames too.
const proof = join(project, "artifacts/workspace-design");
await mkdir(proof, { recursive: true });
try {
  await until(() => output.includes("#token="), "No server URL");
  const url = output.match(/http:\/\/\S+/)[0];
  const origin = new URL(url).origin;
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get("token");
  async function api(path = "/api/workspaces", method = "GET", body) {
    const response = await fetch(origin + path, {
      method,
      headers: { Authorization: "Bearer " + token, Origin: origin, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert(response.ok);
    return response.json();
  }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN, headless: true, args: ["--no-sandbox"] });
  page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  const failures = [];
  page.on("pageerror", (error) => {
    failures.push(String(error));
    console.error("PAGE_ERROR", error);
  });
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector("#status")?.textContent === "Connected");
  assert.equal(await page.locator(".brand svg").getAttribute("viewBox"), "0 0 530 188", "Canonical Bruv wordmark");
  const favicon = await page.locator('link[rel="icon"]').getAttribute("href");
  assert.equal(
    decodeURIComponent(favicon.slice("data:image/svg+xml,".length)),
    await readFile(join(project, "site/assets/brand/bruv-icon.svg"), "utf8"),
  );
  const initial = await api();
  async function readyToType() {
    await page.waitForFunction(() =>
      document.querySelector('#terminal [role="tabpanel"]:not([hidden])')?.textContent.includes("bruv"),
    );
  }
  async function rename(name) {
    await page.locator("#tab-menu-toggle").click();
    await page.keyboard.press("Enter");
    await page.locator("#dialog-input").fill(name);
    await page.keyboard.press("Enter");
    await until(
      async () => (await api()).workspaces.some((w) => w.tabs.some((t) => t.name === name)),
      "Rename not saved",
    );
  }
  await rename("Terminal");
  await page.locator("#new-tab").click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[role="tab"]').length === 2 &&
      document.querySelector("#status")?.textContent === "Connected",
  );
  await rename("Tests");
  await page.locator("#new-tab").click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[role="tab"]').length === 3 &&
      document.querySelector("#status")?.textContent === "Connected",
  );
  await rename("Review");
  await page.locator("#add-workspace").click();
  await page.locator("#dialog-input").fill(secondCwd);
  await page.locator("#dialog-submit").click();
  await until(async () => (await api()).workspaces.length === 2, "Workspace missing");
  await page.getByRole("button", { name: "Open workspace bruv", exact: true }).click();
  await page.getByRole("tab", { name: "Select tab Terminal", exact: true }).click();
  await readyToType();
  await page.locator("#terminal .xterm-helper-textarea:visible").fill("!uname -s");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("#terminal")?.textContent?.includes("Linux"));
  await page.waitForTimeout(500);
  assert.equal(await page.locator("#audio-toggle").count(), 0, "No permanent mic control");
  await page.mouse.move(600, 400);
  assert.equal(
    await page.locator("#status").evaluate((node) => getComputedStyle(node).opacity),
    "0",
    "Connection detail stays on demand",
  );
  await page.locator(".connection").focus();
  assert.equal(
    await page.locator("#status").evaluate((node) => getComputedStyle(node).opacity),
    "1",
    "Connection detail is keyboard-accessible",
  );
  await page.locator("#terminal .xterm-helper-textarea:visible").focus();
  await page.screenshot({ path: join(proof, "populated-desktop.png") });

  // Menu arrows, Escape, dialog focus, validation, and cancellation.
  await page.locator("#tab-menu-toggle").focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "rename-tab");
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "close-tab");
  await page.screenshot({ path: join(proof, "tab-menu.png") });
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "tab-menu-toggle");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "dialog-input");
  await page.screenshot({ path: join(proof, "rename-dialog.png") });
  await page.locator("#dialog-input").fill("   ");
  await page.keyboard.press("Enter");
  assert(await page.locator("#workspace-dialog").isVisible(), "Blank rename stays open");
  await page.keyboard.press("Escape");
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    "tab-menu-toggle",
    "Dialog returns focus to menu trigger",
  );
  assert.equal((await api()).workspaces[0].tabs[0].name, "Terminal");

  await page.setViewportSize({ width: 390, height: 680 });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const terminalHeight = await page.locator("#terminal").evaluate((el) => el.clientHeight);
  assert(terminalHeight > 620, "Phone terminal keeps most of the screen");
  await page.locator("#terminal .xterm-helper-textarea:visible").focus();
  await page.screenshot({ path: join(proof, "populated-phone.png") });
  await page.locator("#open-drawer").click();
  assert.equal(await page.evaluate(() => document.activeElement?.id), "close-drawer");
  await page.keyboard.press("Shift+Tab");
  assert(await page.evaluate(() => !!document.activeElement?.closest("#workspace-sidebar")), "Drawer traps focus");
  await page.screenshot({ path: join(proof, "populated-drawer.png") });
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "open-drawer");
  await page.locator("#tab-menu-toggle").click();
  await page.locator("#close-tab").click();
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    "dialog-cancel",
    "Destructive dialog focuses cancel",
  );
  await page.screenshot({ path: join(proof, "phone-close-dialog.png") });
  await page.keyboard.press("Escape");

  // Long names do not expand the page; the full name stays accessible.
  await rename("Investigate shared terminal replay and reconnect");
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.locator("#terminal .xterm-helper-textarea:visible").focus();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(proof, "phone-long-tab.png") });
  // Close controls are siblings of tabs. An inactive close never selects it.
  const workspaceId = (await api()).workspaces[0].id;
  for (let i = 0; i < 5; i++) await api("/api/workspaces/" + workspaceId + "/tabs", "POST", {});
  const many = (await api()).workspaces[0].tabs;
  for (const [i, tab] of many.entries())
    await api("/api/tabs/" + tab.id, "PATCH", {
      name:
        i === 0
          ? "Investigate shared terminal replay and reconnect"
          : ["Tests", "Review", "Build", "Logs", "Deploy", "Shell", "Notes"][i - 1],
    });
  await page.waitForFunction(() => document.querySelectorAll('[role="tab"]').length === 8);
  assert.equal(await page.locator("button button").count(), 0);
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.waitForTimeout(300);
  await page.getByRole("tab").first().click();
  const longTitle = await page
    .getByRole("tab")
    .first()
    .evaluate((el) => ({ full: el.title, clipped: el.scrollWidth > el.clientWidth }));
  assert.match(longTitle.full, /shared terminal replay and reconnect/);
  assert(longTitle.clipped, "Long title truncates without losing its full name");
  await page.locator(".tab-close").first().hover();
  await page.screenshot({ path: join(proof, "tabs-desktop-close-hover.png") });
  await page.setViewportSize({ width: 390, height: 680 });
  await page.waitForTimeout(300);
  await page.getByRole("tab").first().focus();
  await page.keyboard.press("End");
  const selectedTab = () => page.locator('[role="tab"][aria-selected="true"]');
  assert.equal(await selectedTab().getAttribute("id"), "tab-" + many.at(-1).id);
  const strip = await page
    .locator("#tab-list")
    .evaluate((el) => ({ width: el.clientWidth, full: el.scrollWidth, scroll: el.scrollLeft }));
  assert(strip.full > strip.width && strip.scroll > 0, "Phone tabs scroll to keyboard selection");
  const tabBox = await selectedTab().boundingBox();
  const listBox = await page.locator("#tab-list").boundingBox();
  assert(tabBox.x >= listBox.x - 1 && tabBox.x + tabBox.width <= listBox.x + listBox.width + 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert((await page.locator("#new-tab").boundingBox()).x < 390, "New tab stays in reach");
  await page.waitForFunction(() => document.querySelector("#status")?.textContent === "Connected");
  await page.locator("#terminal .xterm-helper-textarea:visible").fill("!uname -s");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() =>
    document.querySelector('#terminal [role="tabpanel"]:not([hidden])')?.textContent.includes("Linux"),
  );
  await page.waitForTimeout(500);
  await selectedTab().focus();
  await page.screenshot({ path: join(proof, "tabs-phone-overflow-active.png") });
  await page.locator("#terminal .xterm-helper-textarea:visible").focus();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(proof, "tabs-phone-overflow-terminal.png") });
  await selectedTab().focus();
  await page.keyboard.press("Home");
  await page.waitForTimeout(300);
  const activeBefore = await selectedTab().getAttribute("id");
  const manualScroll = await page.locator("#tab-list").evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
    return el.scrollLeft;
  });
  await api("/api/tabs/" + many[2].id, "PATCH", { name: "Review changes" });
  await page.getByRole("tab", { name: "Select tab Review changes", exact: true }).waitFor();
  assert.equal(
    await page.locator("#tab-list").evaluate((el) => el.scrollLeft),
    manualScroll,
    "Shared rename preserves manual tab scrolling",
  );
  await page.locator("#tab-list").evaluate((el) => {
    el.scrollLeft = 0;
  });
  const target = many[1];
  const closeTarget = page.locator('[id="tab-close-' + target.id + '"]');
  await closeTarget.focus();
  await page.screenshot({ path: join(proof, "tabs-phone-close-focus.png") });
  await closeTarget.press("Enter");
  assert.equal(await selectedTab().getAttribute("id"), activeBefore, "Inactive close leaves local selection alone");
  assert.equal(await page.evaluate(() => document.activeElement.id), "dialog-cancel");
  assert.match(await page.locator("#dialog-description").textContent(), /stop for everyone/);
  // Shared snapshots may rebuild the strip while its dialog is open.
  await api("/api/tabs/" + target.id, "PATCH", { name: "Test watch" });
  await page.getByRole("tab", { name: "Select tab Test watch", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.waitForFunction((id) => document.activeElement?.id === id, "tab-close-" + target.id);
  assert.equal((await api()).workspaces[0].tabs.length, 8, "Cancel keeps running terminals");
  await closeTarget.press("Enter");
  await page.locator("#dialog-submit").click();
  await until(
    async () => !(await api()).workspaces[0].tabs.some((t) => t.id === target.id),
    "Captured close did not finish",
  );
  await page.waitForFunction((id) => document.activeElement?.id === id, activeBefore);
  assert.equal(await selectedTab().getAttribute("id"), activeBefore, "Confirmed inactive close leaves selection alone");
  assert.equal((await api()).workspaces[0].tabs.length, 7);
  await page.locator('[id="tab-close-' + many[0].id + '"]').click();
  await page.locator("#dialog-submit").click();
  await page.waitForFunction(() => document.querySelectorAll('[role="tab"]').length === 6);
  await page.waitForFunction(() => {
    const focused = document.activeElement;
    const panel = focused?.closest('[role="tabpanel"]');
    return (
      focused?.classList.contains("xterm-helper-textarea") &&
      panel?.getAttribute("aria-labelledby") === document.querySelector('[role="tab"][aria-selected="true"]')?.id
    );
  });
  await readyToType();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(proof, "tabs-phone-close-return.png") });
  const remaining = (await api()).workspaces[0].tabs;
  for (const tab of remaining.slice(0, -1)) await api("/api/tabs/" + tab.id, "DELETE", { confirm: true });
  await page.waitForFunction(() => document.querySelectorAll('[role="tab"]').length === 1);
  await page.locator(".tab-close").click();
  await page.locator("#dialog-submit").click();
  await page.waitForFunction(() => document.activeElement?.id === "new-tab");
  await page.getByRole("heading", { name: "Ready when you are." }).waitFor();
  await page.screenshot({ path: join(proof, "empty-tabs-phone.png") });
  await page.locator("#empty-action").click();
  await page.waitForFunction(() => document.querySelector("#status")?.textContent === "Connected");
  for (const workspace of (await api()).workspaces)
    await api("/api/workspaces/" + workspace.id, "DELETE", { confirm: true });
  await page.getByRole("heading", { name: "Your terminal, together." }).waitFor();
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.screenshot({ path: join(proof, "empty-workspaces-desktop.png") });
  assert.deepEqual(failures, []);
  console.log(
    JSON.stringify({
      pass: true,
      viewports: ["1100x720", "390x680"],
      terminalHeight,
      menuKeyboard: true,
      dialogFocus: true,
      cancelSafe: true,
      drawerFocus: true,
      emptyStates: true,
      longNames: true,
      perTabClose: true,
      overflowKeyboard: true,
      sharedUpdateFocusReturn: true,
      proof,
    }),
  );
} catch (error) {
  console.error(
    "DESIGN_FAILURE",
    await page
      ?.locator("body")
      .innerText()
      .catch(() => "Page unavailable"),
  );
  throw error;
} finally {
  await browser?.close();
  proc.kill("SIGTERM");
  assert.equal(await proc.exited, 0);
  console.log("WEB_EXIT 0", "STDERR", errors, "FIXTURE", root);
}
