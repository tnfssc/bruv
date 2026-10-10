import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(
  process.env.PLAYWRIGHT_CORE ? pathToFileURL(process.env.PLAYWRIGHT_CORE).href : "playwright"
);
const project = resolve(import.meta.dir, "../..");
await mkdir(join(project, ".tmp"), { recursive: true });
const root = await mkdtemp(join(project, ".tmp/browser-workspaces-"));
const firstCwd = join(root, "bruv");
const secondCwd = join(root, "api-service");
const agent = join(root, "agent");
await Promise.all([firstCwd, secondCwd, agent, join(project, ".tmp")].map((p) => mkdir(p, { recursive: true })));
const proc = Bun.spawn(
  [join(project, "dist/bruv"), "web", "--port", "0", "--", "--offline", "--provider", "openai", "--model", "gpt-4o"],
  {
    cwd: firstCwd,
    env: {
      PATH: process.env.PATH,
      TMPDIR: join(project, ".tmp"),
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
      const el = document.querySelector(selector);
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, centerY: r.y + r.height / 2 };
    };
    const drawer = document.body.dataset.drawer === "open";
    return {
      phone: innerWidth <= 700,
      tab: rect('.terminal-tab:has([aria-selected="true"]) .tab-close'),
      select: rect('[role="tab"][aria-selected="true"]'),
      plus: rect("#new-tab"),
      drawer: innerWidth <= 700 ? rect("#open-drawer") : null,
      closeDrawer: drawer ? rect("#close-drawer") : null,
      header: rect(".brand-row"),
      workspace: innerWidth > 700 || drawer ? rect(".workspace") : null,
      remove: innerWidth > 700 || drawer ? rect(".workspace-remove") : null,
      add: innerWidth > 700 || drawer ? rect("#add-workspace") : null,
      terminal: rect("#terminal"),
      screen: rect(".terminal-pane:not([hidden]) canvas"),
      outputLines: document
        .querySelector(".terminal-pane:not([hidden]) .terminal-accessible-output")
        .textContent.split("\n").length,
    };
  });
  const minimum = metrics.phone ? 44 : 32;
  for (const name of ["tab", "select", "plus", "drawer", "closeDrawer", "workspace", "remove", "add"]) {
    if (!metrics[name]) continue;
    assert(
      metrics[name].width >= minimum && metrics[name].height >= minimum,
      label + ": " + name + " target >= " + minimum,
    );
  }
  for (const name of ["plus", "drawer", "add", "closeDrawer"]) {
    if (metrics[name])
      assert(Math.abs(metrics[name].centerY - metrics.tab.centerY) < 0.6, label + ": " + name + " aligns with tabs");
  }
  if (metrics.remove)
    assert(Math.abs(metrics.workspace.centerY - metrics.remove.centerY) < 0.6, "Row remove aligns with workspace");
  if (metrics.workspace) {
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
  await checkSpacing(label);
  await Bun.write(join(proof, "alignment-" + label + ".json"), JSON.stringify(metrics, null, 2));
}

async function checkSpacing(label) {
  const spacing = await page.evaluate(() => {
    const style = (selector) => getComputedStyle(document.querySelector(selector));
    const rect = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
    const root = getComputedStyle(document.documentElement);
    return {
      scale: [1, 2, 3, 4, 5, 6].map((n) => root.getPropertyValue("--space-" + n).trim()),
      phone: innerWidth <= 700,
      header: rect(".tab-bar"),
      brand: rect(".brand-row"),
      control: rect("#new-tab"),
      title: rect('[role="tab"][aria-selected="true"]'),
      activeShell: rect('.terminal-tab[data-active="true"]'),
      close: rect(".tab-close"),
      gutter: style("#terminal").marginLeft,
      headerPadding: style(".tab-bar").paddingLeft,
      labelGap: style("#folder-form label").marginBottom,
      sectionGap: style(".folder-actions").marginTop,
      actionGap: style(".folder-actions").gap,
      logo: rect(".brand svg"),
      logoRatio:
        document.querySelector(".brand svg").viewBox.baseVal.width /
        document.querySelector(".brand svg").viewBox.baseVal.height,
      controlsUseLibrary: [...document.querySelectorAll("button:not(#drawer-backdrop), input")].every((el) =>
        el.classList.contains(el.tagName === "BUTTON" ? "btn" : "input"),
      ),
    };
  });
  assert.deepEqual(spacing.scale, ["4px", "8px", "12px", "16px", "24px", "32px"]);
  assert.equal(spacing.header.height, spacing.phone ? 48 : 40, label + ": shared header height");
  assert.equal(spacing.brand.height, spacing.header.height, label + ": rail and terminal headers");
  assert.equal(spacing.activeShell.bottom, spacing.header.bottom, label + ": active tab meets the terminal edge");
  for (const name of ["control", "title", "close"])
    assert.equal(spacing[name].height, spacing.phone ? 44 : 32, label + ": " + name + " shared height");
  assert.equal(spacing.gutter, spacing.phone ? "8px" : "12px");
  assert.equal(spacing.headerPadding, spacing.gutter, label + ": shared content gutter");
  assert.equal(spacing.labelGap, "4px");
  assert.equal(spacing.sectionGap, "16px");
  assert.equal(spacing.actionGap, "8px");
  assert(Math.abs(spacing.logo.width / spacing.logo.height - spacing.logoRatio) < 0.01, "Logo keeps its optical ratio");
  assert(spacing.controlsUseLibrary, label + ": native controls use daisyUI");
  await Bun.write(join(proof, "spacing-" + label + ".json"), JSON.stringify(spacing, null, 2));
}
async function checkFormSpacing(selector, label) {
  const form = await page.locator(selector).evaluate((el) => {
    const field = el.querySelector("input");
    const label = el.querySelector("label");
    const actions = el.querySelector(".folder-actions, .dialog-actions");
    const error = el.querySelector("#folder-error");
    const rect = (node) => node.getBoundingClientRect().toJSON();
    return {
      phone: innerWidth <= 700,
      field: field && rect(field),
      fieldFont: field && getComputedStyle(field).fontSize,
      label: label && rect(label),
      actions: rect(actions),
      buttons: [...actions.querySelectorAll("button:not([hidden])")].map(rect),
      error: error && { color: getComputedStyle(error).color, marginTop: getComputedStyle(error).marginTop },
      actionGap: getComputedStyle(actions).gap,
      sectionGap: getComputedStyle(actions).marginTop,
      dialogPadding: el.closest("dialog") && getComputedStyle(el.closest("dialog")).padding,
    };
  });
  const height = form.phone ? 44 : 32;
  if (form.field?.height) {
    assert.equal(form.field.height, height, label + ": field uses shared control height");
    assert.equal(form.fieldFont, form.phone ? "16px" : "13px", label + ": form field text size");
    assert.equal(form.field.y - form.label.bottom, 4, label + ": label gap");
  }
  for (const button of form.buttons) assert.equal(button.height, height, label + ": actions use shared control height");
  assert.equal(form.actionGap, "8px");
  assert.equal(form.sectionGap, "16px");
  if (form.dialogPadding) assert.equal(form.dialogPadding, "16px");
  if (form.error) {
    assert.equal(form.error.color, "rgb(245, 161, 145)", label + ": same inline error color in rail and empty form");
    assert.equal(form.error.marginTop, "4px", label + ": same field-to-error gap");
  }
  await Bun.write(join(proof, "spacing-" + label + ".json"), JSON.stringify(form, null, 2));
}

async function connected() {
  await page.waitForFunction(() => {
    const id = document.querySelector('[role="tab"][aria-selected="true"]')?.id.slice(4);
    const socket = window.terminalSockets.get(id);
    return (
      socket?.readyState === WebSocket.OPEN && socket.probeReady && document.querySelector("#terminal-status")?.hidden
    );
  });
}

// Feature guidance: wisdom/web/workspace-design.md and wisdom/web/live-command-microphone.md.
// These probes need the integrated compiled frontend; syntax checks are not browser proof.
// UI proof uses the compiled app and real PTYs. Inspect the saved frames too.
// Keep the input caret visible in focused terminal captures.
const screenshot = (options) => page.screenshot({ caret: "initial", ...options });
const proof = join(project, ".tmp/ghostty/workspace-design");
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
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_BIN,
    headless: process.env.HEADLESS !== "0",
    args: [
      "--no-sandbox",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      ...(process.env.HEADLESS === "0" ? ["--ozone-platform=x11"] : []),
    ],
  });
  page = await browser.newPage({ viewport: { width: 1100, height: 720 }, hasTouch: true });
  const failures = [];
  page.on("pageerror", (error) => {
    failures.push(String(error));
    console.error("PAGE_ERROR", error);
  });
  await page.addInitScript(() => {
    window.touchTrace = [];
    for (const name of ["pointerup", "click", "dblclick", "focusin", "focusout"])
      document.addEventListener(
        name,
        (event) => {
          if (event.target.closest?.("#tab-list"))
            window.touchTrace.push({
              type: name,
              target: event.target.id,
              time: event.timeStamp,
              active: document.activeElement?.id,
            });
        },
        true,
      );
    window.terminalSockets = new Map();
    const WS = window.WebSocket;
    window.WebSocket = class extends WS {
      constructor(url, protocols) {
        super(url, protocols);
        const parsed = new URL(url);
        if (parsed.pathname === "/api/terminal") {
          window.terminalSockets.set(parsed.searchParams.get("tab"), this);
          this.addEventListener("message", ({ data }) => {
            if (JSON.parse(data).type === "ready") this.probeReady = true;
          });
        }
      }
    };
  });
  await page.goto(url);
  await connected();
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
      document.querySelector('[role="tab"][aria-selected="true"]') === document.querySelectorAll('[role="tab"]')[1] &&
      window.terminalSockets.get(document.querySelector('[role="tab"][aria-selected="true"]')?.id.slice(4))
        ?.probeReady &&
      document.querySelector("#terminal-status")?.hidden,
  );
  await rename("Tests");
  await page.locator("#new-tab").click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[role="tab"]').length === 3 &&
      document.querySelector('[role="tab"][aria-selected="true"]') === document.querySelectorAll('[role="tab"]')[2] &&
      window.terminalSockets.get(document.querySelector('[role="tab"][aria-selected="true"]')?.id.slice(4))
        ?.probeReady &&
      document.querySelector("#terminal-status")?.hidden,
  );
  await rename("Review");
  await page.locator("#add-workspace").click();
  await page.locator("#rail-entry #folder-form").waitFor({ state: "visible" });
  assert.equal(await page.locator("#folder-form").count(), 1);
  await page.locator("#folder-input").fill(join(root, "missing-folder"));
  await page.locator("#open-folder").click();
  await page.locator('#folder-input[aria-invalid="true"]').waitFor();
  assert.match(await page.locator("#folder-error").innerText(), /Directory not found/);
  assert.equal(await page.evaluate(() => document.activeElement?.id), "folder-input");
  await checkFormSpacing("#folder-form", "folder-error-desktop");
  await screenshot({ path: join(proof, "folder-error-desktop.png") });
  await page.locator("#cancel-folder").click();
  await page.locator("#folder-form").waitFor({ state: "hidden" });
  assert.equal((await api()).workspaces.length, 1, "Cancel does not create a workspace");
  await page.locator("#add-workspace").click();
  await page.locator("#folder-input").fill(secondCwd);
  assert.equal(await page.locator("#folder-error").isVisible(), false, "Editing clears folder error");
  const creation = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/workspaces" && r.request().method() === "POST",
  );
  await page.locator("#open-folder").click();
  const createdResponse = await creation;
  assert.equal(createdResponse.status(), 200);
  const created = await createdResponse.json();
  assert.equal(created.created, true);
  assert.equal(created.workspaces.find((w) => w.id === created.workspaceId)?.cwd, secondCwd);
  await page.locator('[id="workspace-' + created.workspaceId + '"][aria-pressed="true"]').waitFor();
  await until(async () => (await api()).workspaces.length === 2, "Workspace missing");
  for (const workspace of (await api()).workspaces) {
    const row = page.locator('[id="workspace-row-' + workspace.id + '"]');
    assert.equal(
      await row.locator('[id="workspace-' + workspace.id + '"]').getAttribute("aria-label"),
      "Open workspace " + workspace.name + " · " + workspace.cwd,
    );
    assert.equal(
      await row.locator('[id="workspace-remove-' + workspace.id + '"]').getAttribute("aria-label"),
      "Remove workspace " + workspace.name + " · " + workspace.cwd,
    );
  }
  // Opening an existing folder selects its returned ID, without another PTY.
  const beforeReopen = await api();
  await page.locator("#add-workspace").click();
  await page.locator("#folder-input").fill(firstCwd);
  const reopening = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/workspaces" && r.request().method() === "POST",
  );
  await page.locator("#open-folder").click();
  const reopenedResponse = await reopening;
  assert.equal(reopenedResponse.status(), 200);
  const reopened = await reopenedResponse.json();
  assert.equal(reopened.created, false);
  assert.equal(reopened.workspaceId, initial.workspaces[0].id);
  await page.locator('[id="workspace-' + reopened.workspaceId + '"][aria-pressed="true"]').waitFor();
  assert.deepEqual(
    reopened.workspaces.map((w) => [w.id, w.tabs.map((t) => t.id)]),
    beforeReopen.workspaces.map((w) => [w.id, w.tabs.map((t) => t.id)]),
  );
  await page.getByRole("button", { name: "Open workspace bruv · " + firstCwd, exact: true }).click();
  await page.getByRole("tab", { name: "Select tab Terminal", exact: true }).click();
  await readyToType();
  await page.locator("#terminal textarea:visible").focus();
  await page.keyboard.type("!uname -s");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("#terminal")?.textContent?.includes("Linux"));
  await page.waitForTimeout(500);
  assert.equal(await page.locator("#audio-toggle").count(), 0, "No permanent mic control");
  await page.mouse.move(600, 400);
  assert.equal(await page.locator("#status").isVisible(), false, "Healthy PTY has no status banner");
  assert.equal(await page.locator("#voice-status").isVisible(), false, "No voice banner when idle");
  await checkAlignment("desktop");
  await screenshot({ path: join(proof, "populated-desktop.png") });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(250);
  await checkAlignment("desktop-wide");
  await screenshot({ path: join(proof, "alignment-desktop-wide.png") });
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.waitForTimeout(250);

  // Direct editing and close controls keep keyboard access and safe cancellation.
  const firstTab = initial.workspaces[0].tabs[0];
  const title = page.locator('[id="tab-' + firstTab.id + '"]');
  const editor = page.getByRole("textbox", { name: "Tab name", exact: true });
  const accessibility = await page.context().newCDPSession(page);
  async function panelNamed(name) {
    await page.getByRole("tabpanel", { name, exact: true }).waitFor();
    const tree = await accessibility.send("Accessibility.getFullAXTree");
    assert(
      tree.nodes.some((node) => node.role?.value === "tabpanel" && node.name?.value === name),
      "Panel name survives edit: " + name,
    );
  }
  async function titleStyle(locator) {
    return locator.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        paddingLeft: style.paddingLeft,
        textX: el.getBoundingClientRect().x + parseFloat(style.paddingLeft),
      };
    });
  }
  const desktopTitleStyle = await titleStyle(title);
  assert(parseFloat(desktopTitleStyle.paddingLeft) >= 4, "Title ink clears the inset focus outline");
  const titleBox = await title.boundingBox();
  const renameShell = page.locator("#tab-shell-" + firstTab.id);
  const shellBeforeRename = await renameShell.boundingBox();
  await title.dblclick();
  await panelNamed("Terminal");
  const editBox = await editor.boundingBox();
  assert.deepEqual(await titleStyle(editor), desktopTitleStyle, "Desktop edit preserves text size and inset");
  for (const key of ["x", "y", "height"])
    assert(Math.abs(editBox[key] - titleBox[key]) < 0.6, "Inline edit keeps title geometry: " + key);
  assert(editBox.width > titleBox.width, "Rename uses the close control space");
  assert.deepEqual(
    await renameShell.boundingBox(),
    shellBeforeRename,
    "Editing keeps the tab shell and neighbors in place",
  );
  assert.equal(
    await page.locator("#tab-close-" + firstTab.id).isVisible(),
    false,
    "Close is not offered during rename",
  );
  await editor.fill("Unsubmitted draft");
  await screenshot({ path: join(proof, "inline-rename-desktop.png") });
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "tab-" + firstTab.id);
  assert.equal((await api()).workspaces[0].tabs[0].name, "Terminal");
  await panelNamed("Terminal");
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
  assert.equal(await page.locator("#terminal-" + firstTab.id).getAttribute("aria-label"), "Remote title");
  await panelNamed("Remote title");
  assert.equal(await editor.inputValue(), "  Terminal keyboard  ");
  assert.deepEqual(await editor.evaluate((el) => [el.selectionStart, el.selectionEnd]), [4, 10]);
  await page.keyboard.press("Enter");
  await until(async () => (await api()).workspaces[0].tabs[0].name === "Terminal keyboard", "Keyboard rename missing");
  await panelNamed("Terminal keyboard");
  await rename("Terminal");

  await page.setViewportSize({ width: 390, height: 680 });
  await page.waitForTimeout(300);
  // Shared PTY size returns over the socket after the viewport changes.
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const terminalHeight = await page.locator("#terminal").evaluate((el) => el.clientHeight);
  assert.equal(terminalHeight, 616, "Phone: 48px header and two 8px terminal gutters");
  await page.locator("#terminal textarea:visible").focus();
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
  assert.equal(await page.evaluate(() => document.activeElement?.id), "add-workspace");
  await page.locator("#add-workspace").click();
  await page.locator("#cancel-folder").click();
  const lastDrawerControl = await page.locator(".workspace-remove").last().getAttribute("id");
  await page.keyboard.press("Shift+Tab");
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    lastDrawerControl,
    "Hidden folder form cannot break backward wrap",
  );
  await page.keyboard.press("Tab");
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    "add-workspace",
    "Forward boundary wraps inside drawer",
  );
  await checkAlignment("phone-drawer");
  const drawerAlignment = await page.evaluate(() => ({
    close: document.querySelector("#close-drawer").getBoundingClientRect().right,
    row: document.querySelector(".workspace-row").getBoundingClientRect().right,
  }));
  assert(Math.abs(drawerAlignment.close - drawerAlignment.row) < 0.6, "Drawer close shares the workspace action edge");
  await screenshot({ path: join(proof, "populated-drawer.png") });
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "open-drawer");
  await page.locator('[id="tab-close-' + firstTab.id + '"]').click();
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    "dialog-cancel",
    "Destructive dialog focuses cancel",
  );
  await checkFormSpacing("#dialog-form", "close-dialog-phone");
  await screenshot({ path: join(proof, "phone-close-dialog.png") });
  await page.keyboard.press("Escape");

  const phoneTitleStyle = await titleStyle(title);
  assert.equal(phoneTitleStyle.fontSize, "13px");
  // Chromium touch emulation, not a physical phone. Dispatch both taps in one
  // short gesture; locator waits can turn them into two unrelated touches.
  const touch = await page.context().newCDPSession(page);
  async function doubleTouch(locator) {
    const rect = await locator.boundingBox();
    const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    await page.bringToFront();
    // Explicit device timestamps model a 150ms double tap. Headed CDP delivery
    // can be throttled for seconds; that is not the user's gesture timing.
    const time = Date.now() / 1000;
    for (let i = 0; i < 2; i++) {
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [point],
        timestamp: time + i * 0.15,
      });
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
        timestamp: time + i * 0.15 + 0.03,
      });
    }
  }
  await doubleTouch(title);
  await editor.waitFor();
  const phoneEditorStyle = await titleStyle(editor);
  assert.equal(phoneEditorStyle.fontSize, "16px", "Phone rename uses the field size, not title size");
  assert.equal(phoneEditorStyle.paddingLeft, phoneTitleStyle.paddingLeft);
  assert.equal(phoneEditorStyle.textX, phoneTitleStyle.textX);
  assert.equal(await page.locator("#terminal-" + firstTab.id).getAttribute("aria-label"), "Terminal");
  await editor.fill("Phone draft with a long unbroken suffix " + "x".repeat(80));
  await editor.press("End");
  assert(
    await editor.evaluate(
      (el) => document.activeElement === el && el.selectionStart === el.value.length && el.scrollLeft > 0,
    ),
    "Long draft keeps its caret in view",
  );
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await screenshot({ path: join(proof, "inline-rename-phone.png") });
  await page.keyboard.press("Escape");
  await doubleTouch(title);
  await editor.fill("Phone saved");
  // Shared PTY size returns over the socket after the viewport changes.
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.keyboard.press("Enter");
  await until(async () => (await api()).workspaces[0].tabs[0].name === "Phone saved", "Double-tap rename missing");

  // A destructive target must stay fully visible, even without word boundaries.
  const unbrokenName = "integration_release_verification_api_service";
  await rename(unbrokenName);
  await page.locator('[id="tab-close-' + firstTab.id + '"]').click();
  assert((await page.locator("#dialog-title").textContent()).includes(unbrokenName));
  assert(
    await page.locator("#dialog-title").evaluate((el) => el.scrollWidth <= el.clientWidth),
    "Long target wraps inside heading",
  );
  assert(
    await page.locator("dialog").evaluate((el) => el.scrollWidth <= el.clientWidth),
    "Long target does not overflow dialog",
  );
  await screenshot({ path: join(proof, "phone-long-target-dialog.png") });
  await page.keyboard.press("Escape");

  // Long names do not expand the page; the full name stays accessible.
  await rename("Investigate shared terminal replay and reconnect");
  await page.waitForTimeout(300);
  // Shared PTY size returns over the socket after the viewport changes.
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.locator("#terminal textarea:visible").focus();
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
  // Shared PTY size returns over the socket after the viewport changes.
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert((await page.locator("#new-tab").boundingBox()).x < 390, "New tab stays in reach");
  await connected();
  await page.locator("#terminal textarea:visible").focus();
  await page.keyboard.type("!uname -s");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() =>
    document.querySelector('#terminal [role="tabpanel"]:not([hidden])')?.textContent.includes("Linux"),
  );
  await page.waitForTimeout(500);
  await selectedTab().focus();
  await screenshot({ path: join(proof, "tabs-phone-overflow-active.png") });
  await page.locator("#terminal textarea:visible").focus();
  await page.waitForTimeout(300);
  await screenshot({ path: join(proof, "tabs-phone-overflow-terminal.png") });
  await selectedTab().focus();
  await page.keyboard.press("Home");
  await page.waitForFunction(() => {
    const shell = document.querySelector('[role="tab"][aria-selected="true"]').parentElement.getBoundingClientRect();
    const list = document.querySelector("#tab-list").getBoundingClientRect();
    return shell.left >= list.left - 1 && shell.right <= list.right + 1;
  });
  const activeBefore = await selectedTab().getAttribute("id");
  // Home queues a reveal. Let that action paint before testing a later manual scroll.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
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
  // A partial tab has no orphan close target. Reveal its whole shell without selecting it.
  await closeTarget.evaluate(
    (el) =>
      (document.querySelector("#tab-list").scrollLeft +=
        el.parentElement.getBoundingClientRect().left -
        document.querySelector("#tab-list").getBoundingClientRect().left),
  );
  await closeTarget.waitFor({ state: "visible" });
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
  await page.waitForFunction(() => {
    const pane = document.querySelector(".terminal-pane:not([hidden])");
    const focused = document.activeElement;
    return focused === pane?.querySelector(".terminal-renderer") || focused === pane?.querySelector("textarea");
  });
  assert.equal(await selectedTab().getAttribute("id"), activeBefore, "Confirmed inactive close leaves selection alone");
  assert.equal((await api()).workspaces[0].tabs.length, 7);
  const firstClose = page.locator('[id="tab-close-' + many[0].id + '"]');
  await firstClose.evaluate(
    (el) =>
      (document.querySelector("#tab-list").scrollLeft +=
        el.parentElement.getBoundingClientRect().left -
        document.querySelector("#tab-list").getBoundingClientRect().left),
  );
  await firstClose.waitFor({ state: "visible" });
  await firstClose.click();
  await page.locator("#dialog-submit").click();
  await page.waitForFunction(() => document.querySelectorAll('[role="tab"]').length === 6);
  await page.waitForFunction(() => {
    const focused = document.activeElement;
    const panel = focused?.closest('[role="tabpanel"]');
    return (
      (focused?.matches('.terminal-renderer[role="textbox"]') || focused?.tagName === "TEXTAREA") &&
      panel?.id === document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("aria-controls")
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
  await page.waitForFunction(() => document.activeElement?.id === "empty-action");
  await page.getByRole("heading", { name: "No terminals in bruv" }).waitFor();
  await page.locator("#empty-action:not([disabled])").waitFor();
  await page.waitForTimeout(300); // Let the library enabled-state color transition settle.
  await screenshot({ path: join(proof, "empty-tabs-phone.png") });
  await page.locator("#empty-action").click();
  await connected();
  await page.locator("#open-drawer").click();
  const removedWorkspace = (await api()).workspaces[0];
  await page.locator('[id="workspace-remove-' + removedWorkspace.id + '"]').click();
  await page.locator("#dialog-submit").click();
  await page.waitForFunction(() => document.activeElement?.matches('.workspace[aria-pressed="true"]'));
  assert.equal(await page.evaluate(() => document.body.dataset.drawer), "open");
  // A focused remote row disappears without a local dialog.
  const remoteWorkspace = (await api()).workspaces[0];
  const extra = await api("/api/workspaces", "POST", { cwd: firstCwd });
  await page.locator('[id="workspace-' + extra.workspaceId + '"]').waitFor();
  const remoteRemove = page.locator('[id="workspace-remove-' + remoteWorkspace.id + '"]');
  await remoteRemove.focus();
  await api("/api/workspaces/" + remoteWorkspace.id, "DELETE", { confirm: true });
  await page.waitForFunction(() => document.activeElement?.matches('.workspace[aria-pressed="true"]'));
  // Escape must recover even when another attachment removes the invoker.
  const dialogWorkspace = (await api()).workspaces[0];
  await api("/api/workspaces", "POST", { cwd: secondCwd });
  await page.locator('[id="workspace-remove-' + dialogWorkspace.id + '"]').click();
  await api("/api/workspaces/" + dialogWorkspace.id, "DELETE", { confirm: true });
  await page.locator('[id="workspace-row-' + dialogWorkspace.id + '"]').waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => document.activeElement?.id), "dialog-cancel");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.activeElement?.matches('.workspace[aria-pressed="true"]'));
  for (const workspace of (await api()).workspaces)
    await api("/api/workspaces/" + workspace.id, "DELETE", { confirm: true });
  await page.getByRole("heading", { name: "Open a folder" }).waitFor();
  await page.locator("#empty-entry #folder-form").waitFor({ state: "visible" });
  assert.equal(await page.locator("#folder-form").count(), 1, "Empty view owns the same form");
  assert.equal(await page.locator("#cancel-folder").isVisible(), false, "Empty view needs no reveal or cancel");
  await page.setViewportSize({ width: 1100, height: 720 });
  await checkFormSpacing("#folder-form", "empty-desktop");
  assert.equal(await page.locator("#workspace-sidebar").isVisible(), false, "Empty list has no vacant rail");
  const emptyAlignment = await page.evaluate(() => ({
    title: document.querySelector("#empty-content h1").getBoundingClientRect().left,
    field: document.querySelector("#folder-input").getBoundingClientRect().left,
  }));
  assert.equal(emptyAlignment.title, emptyAlignment.field, "Empty title and field share one left anchor");
  await screenshot({ path: join(proof, "empty-workspaces-desktop.png") });
  await page.setViewportSize({ width: 390, height: 680 });
  await checkFormSpacing("#folder-form", "empty-phone");
  await screenshot({ path: join(proof, "empty-workspaces-phone.png") });
  assert.deepEqual(failures, []);
  console.log(
    JSON.stringify({
      pass: true,
      viewports: ["1100x720", "390x680"],
      terminalHeight,
      directCloseKeyboard: true,
      inlineRename: true,
      touchRename: true,
      sharedEditFocus: true,
      cancelSafe: true,
      drawerFocus: true,
      emptyStates: true,
      directFolderForm: true,
      existingFolderSelection: true,
      longNames: true,
      perTabClose: true,
      overflowKeyboard: true,
      sharedUpdateFocusReturn: true,
      proof,
    }),
  );
} catch (error) {
  if (page) {
    await screenshot({ path: join(proof, "failure.png") });
    await Bun.write(
      join(proof, "failure-geometry.json"),
      JSON.stringify(
        await page.evaluate(() => ({
          touchTrace: window.touchTrace,
          viewport: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          overflowing: Array.from(document.querySelectorAll("body *"))
            .map((el) => ({
              tag: el.tagName,
              id: el.id,
              className: el.className,
              rect: el.getBoundingClientRect().toJSON(),
              scrollWidth: el.scrollWidth,
              clientWidth: el.clientWidth,
            }))
            .filter((el) => el.rect.right > innerWidth + 1),
        })),
        null,
        2,
      ),
    );
  }
  console.error(
    "DESIGN_FAILURE",
    error,
    await page
      ?.locator("body")
      .innerText()
      .catch(() => "Page unavailable"),
  );
  throw error;
} finally {
  await browser?.close();
  proc.kill("SIGTERM");
  const exit = await proc.exited;
  console.log("WEB_EXIT", exit, "STDERR", errors, "FIXTURE", root);
  assert.equal(exit, 0);
}
