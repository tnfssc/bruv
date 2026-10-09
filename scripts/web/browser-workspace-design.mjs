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
  page.on("pageerror", (error) => failures.push(String(error)));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector("#status")?.textContent === "Connected");
  assert.equal(await page.locator(".brand svg").getAttribute("viewBox"), "0 0 530 188", "Canonical Bruv wordmark");
  const favicon = await page.locator('link[rel="icon"]').getAttribute("href");
  assert.equal(
    decodeURIComponent(favicon.slice("data:image/svg+xml,".length)),
    await readFile(join(project, "site/assets/brand/bruv-icon.svg"), "utf8"),
  );
  const initial = await api();
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
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: join(proof, "phone-long-tab.png") });
  for (const tab of (await api()).workspaces[0].tabs) await api("/api/tabs/" + tab.id, "DELETE", { confirm: true });
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
      proof,
    }),
  );
} finally {
  await browser?.close();
  proc.kill("SIGTERM");
  assert.equal(await proc.exited, 0);
  console.log("WEB_EXIT 0", "STDERR", errors, "FIXTURE", root);
}
