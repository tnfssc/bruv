import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readlink } from "node:fs/promises";
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
async function checkAlignment(label) {
  const metrics = await page.evaluate(() => {
    const rect = (selector) => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, centerY: r.y + r.height / 2 };
    };
    return {
      tab: rect(".tab-close"),
      plus: rect("#new-tab"),
      menu: rect("#tab-menu-toggle"),
      status: rect(".connection"),
      folder: rect(".workspace-mark"),
      copy: rect(".workspace-copy"),
      header: rect(".brand-row"),
      terminal: rect("#terminal"),
      screen: rect(".terminal-pane:not([hidden]) .xterm-screen"),
      rows: document.querySelector(".terminal-pane:not([hidden]) .xterm-rows").childElementCount,
    };
  });
  for (const name of ["plus", "menu", "status"])
    assert(Math.abs(metrics[name].centerY - metrics.tab.centerY) < 0.6, label + ": " + name + " aligns with tabs");
  assert(metrics.status.width >= 28 && metrics.status.height >= 28, "Status keeps a usable focus frame");
  assert(Math.abs(metrics.folder.centerY - metrics.copy.centerY) < 0.6, "Folder aligns with workspace text");
  if (metrics.header.height > 0) {
    const denseHeight = await page.evaluate(() => {
      const list = document.querySelector("#workspace-list");
      const copies = Array.from({ length: 20 }, () => list.firstElementChild.cloneNode(true));
      list.append(...copies);
      const height = document.querySelector(".brand-row").getBoundingClientRect().height;
      for (const copy of copies) copy.remove();
      return height;
    });
    assert(Math.abs(denseHeight - metrics.header.height) < 0.6, "Workspace overflow must not shrink the brand header");
  }
  await Bun.write(join(proof, "alignment-" + label + ".json"), JSON.stringify(metrics, null, 2));
}

// UI proof uses the compiled app and real PTYs. Inspect the saved frames too.
// Preserve caret styling: Playwright caret hiding corrupts focused xterm DOM captures in Chromium.
const screenshot = (options) => page.screenshot({ caret: "initial", ...options });
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
  page = await browser.newPage({ viewport: { width: 1100, height: 720 }, hasTouch: true });
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
    await page.locator('[role="tab"][aria-selected="true"]').dblclick();
    await page.getByRole("textbox", { name: "Tab name", exact: true }).fill(name);
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
  await checkAlignment("desktop");
  await screenshot({ path: join(proof, "populated-desktop.png") });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(250);
  await checkAlignment("desktop-wide");
  await screenshot({ path: join(proof, "alignment-desktop-wide.png") });
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.waitForTimeout(250);

  // Direct editing, keyboard access and safe cancellation; close stays in the menu.
  await page.locator("#tab-menu-toggle").focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "close-tab");
  assert.equal(await page.locator("#rename-tab").count(), 0);
  await screenshot({ path: join(proof, "tab-menu.png") });
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "tab-menu-toggle");
  const firstTab = initial.workspaces[0].tabs[0];
  const title = page.locator('[id="tab-' + firstTab.id + '"]');
  const editor = page.getByRole("textbox", { name: "Tab name", exact: true });
  const titleBox = await title.boundingBox();
  await title.dblclick();
  const editBox = await editor.boundingBox();
  for (const key of ["x", "y", "width", "height"])
    assert(Math.abs(editBox[key] - titleBox[key]) < 0.6, "Inline edit keeps title geometry: " + key);
  await editor.fill("Unsubmitted draft");
  await screenshot({ path: join(proof, "inline-rename-desktop.png") });
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "tab-" + firstTab.id);
  assert.equal((await api()).workspaces[0].tabs[0].name, "Terminal");
  await title.press("F2");
  await editor.fill("   ");
  await page.keyboard.press("Enter");
  assert.equal((await api()).workspaces[0].tabs[0].name, "Terminal");
  await title.press("F2");
  await editor.fill("Cancelled on blur");
  await page.getByRole("tab", { name: "Select tab Tests", exact: true }).click();
  assert.equal(await editor.count(), 0);
  assert.equal((await api()).workspaces[0].tabs[0].name, "Terminal");
  await page.getByRole("tab", { name: "Select tab Tests", exact: true }).press("Home");
  await title.press("F2");
  await editor.fill("  Terminal keyboard  ");
  // A snapshot must not replace the node, focus, draft or text selection.
  await editor.evaluate((el) => {
    window.renameInput = el;
    el.setSelectionRange(4, 10);
  });
  await api("/api/tabs/" + firstTab.id, "PATCH", { name: "Remote title" });
  await page.waitForFunction(() => document.querySelector(".tab-close")?.title === "Close tab Remote title");
  assert(await editor.evaluate((el) => el === window.renameInput && document.activeElement === el));
  assert.equal(await editor.inputValue(), "  Terminal keyboard  ");
  assert.deepEqual(await editor.evaluate((el) => [el.selectionStart, el.selectionEnd]), [4, 10]);
  await page.keyboard.press("Enter");
  await until(async () => (await api()).workspaces[0].tabs[0].name === "Terminal keyboard", "Keyboard rename missing");
  await rename("Terminal");

  await page.setViewportSize({ width: 390, height: 680 });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const terminalHeight = await page.locator("#terminal").evaluate((el) => el.clientHeight);
  assert(terminalHeight > 620, "Phone terminal keeps most of the screen");
  await page.locator("#terminal .xterm-helper-textarea:visible").focus();
  await checkAlignment("phone");
  await screenshot({ path: join(proof, "populated-phone.png") });
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(250);
  await checkAlignment("phone-tall");
  await screenshot({ path: join(proof, "alignment-phone-tall.png") });
  await page.setViewportSize({ width: 390, height: 680 });
  await page.waitForTimeout(250);
  await page.locator("#open-drawer").click();
  assert.equal(await page.evaluate(() => document.activeElement?.id), "close-drawer");
  await page.keyboard.press("Shift+Tab");
  assert(await page.evaluate(() => !!document.activeElement?.closest("#workspace-sidebar")), "Drawer traps focus");
  await checkAlignment("phone-drawer");
  const drawerAlignment = await page.evaluate(() => ({
    close: document.querySelector("#close-drawer").getBoundingClientRect().right,
    row: document.querySelector(".workspace").getBoundingClientRect().right,
  }));
  assert(Math.abs(drawerAlignment.close - drawerAlignment.row) < 0.6, "Drawer close shares the workspace action edge");
  await screenshot({ path: join(proof, "populated-drawer.png") });
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "open-drawer");
  await page.locator("#tab-menu-toggle").click();
  await page.locator("#close-tab").click();
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    "dialog-cancel",
    "Destructive dialog focuses cancel",
  );
  await screenshot({ path: join(proof, "phone-close-dialog.png") });
  await page.keyboard.press("Escape");

  // Use real touchscreen taps on the phone layout, not a synthetic dblclick.
  await title.tap();
  await title.tap();
  await editor.waitFor();
  await editor.fill("Phone draft");
  await screenshot({ path: join(proof, "inline-rename-phone.png") });
  await page.keyboard.press("Escape");
  await title.tap();
  await title.tap();
  await editor.fill("Phone saved");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.keyboard.press("Enter");
  await until(async () => (await api()).workspaces[0].tabs[0].name === "Phone saved", "Double-tap rename missing");

  // Long names do not expand the page; the full name stays accessible.
  await rename("Investigate shared terminal replay and reconnect");
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.locator("#terminal .xterm-helper-textarea:visible").focus();
  await page.waitForTimeout(300);
  await screenshot({ path: join(proof, "phone-long-tab.png") });
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
  await screenshot({ path: join(proof, "tabs-desktop-close-hover.png") });
  await page.setViewportSize({ width: 390, height: 680 });
  await page.waitForTimeout(300);
  await page.getByRole("tab").first().focus();
  for (let step = 0; step < 3; step++) {
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => {
      const shell = document.querySelector('[role="tab"][aria-selected="true"]').parentElement.getBoundingClientRect();
      const list = document.querySelector("#tab-list").getBoundingClientRect();
      return shell.left >= list.left - 1 && shell.right <= list.right + 1;
    });
  }
  await screenshot({ path: join(proof, "alignment-phone-intermediate-tab.png") });
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
  await screenshot({ path: join(proof, "tabs-phone-overflow-active.png") });
  await page.locator("#terminal .xterm-helper-textarea:visible").focus();
  await page.waitForTimeout(300);
  await screenshot({ path: join(proof, "tabs-phone-overflow-terminal.png") });
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
  await screenshot({ path: join(proof, "tabs-phone-close-focus.png") });
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
  await screenshot({ path: join(proof, "tabs-phone-close-return.png") });
  const remaining = (await api()).workspaces[0].tabs;
  for (const tab of remaining.slice(0, -1)) await api("/api/tabs/" + tab.id, "DELETE", { confirm: true });
  await page.waitForFunction(() => document.querySelectorAll('[role="tab"]').length === 1);
  await page.locator(".tab-close").click();
  await page.locator("#dialog-submit").click();
  await page.waitForFunction(() => document.activeElement?.id === "new-tab");
  await page.getByRole("heading", { name: "Ready when you are." }).waitFor();
  await screenshot({ path: join(proof, "empty-tabs-phone.png") });
  await page.locator("#empty-action").click();
  await page.waitForFunction(() => document.querySelector("#status")?.textContent === "Connected");
  for (const workspace of (await api()).workspaces)
    await api("/api/workspaces/" + workspace.id, "DELETE", { confirm: true });
  await page.getByRole("heading", { name: "Your terminal, together." }).waitFor();
  await page.setViewportSize({ width: 1100, height: 720 });
  await screenshot({ path: join(proof, "empty-workspaces-desktop.png") });
  assert.deepEqual(failures, []);
  console.log(
    JSON.stringify({
      pass: true,
      viewports: ["1100x720", "390x680"],
      terminalHeight,
      menuKeyboard: true,
      inlineRename: true,
      touchRename: true,
      sharedEditFocus: true,
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
