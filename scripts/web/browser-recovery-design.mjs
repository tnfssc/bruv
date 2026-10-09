// Compiled app, real offline PTYs and Chromium touch emulation. No physical-device claims.
// Reuses the prior recovery recipe; captures must still be viewed for terminal paint.
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_CORE ? pathToFileURL(process.env.PLAYWRIGHT_CORE).href : "playwright"
);
const project = resolve(import.meta.dir, "../..");
const out = join(project, "artifacts/ghostty/spacing-states");
await mkdir(out, { recursive: true });
const root = await mkdtemp(join(tmpdir(), "bruv-spacing-recovery-"));
const cwd = join(root, "bruv"),
  apiCwd = join(root, "api-service"),
  docsCwd = join(root, "docs");
for (const d of [cwd, apiCwd, docsCwd, join(root, "agent")]) await mkdir(d, { recursive: true });
const proc = Bun.spawn(
  [join(project, "dist/bruv"), "web", "--port", "0", "--", "--offline", "--provider", "openai", "--model", "gpt-4o"],
  {
    cwd,
    env: {
      PATH: process.env.PATH,
      TMPDIR: "/var/tmp",
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
let output = "",
  errors = "",
  browser,
  page;
let state;
const observations = { screens: [], pageErrors: [], fixture: root };
void (async () => {
  for await (const c of proc.stdout) output += new TextDecoder().decode(c);
})();
void (async () => {
  for await (const c of proc.stderr) errors += new TextDecoder().decode(c);
})();
const until = async (fn) => {
  const end = Date.now() + 30000;
  while (!(await fn())) {
    if (Date.now() > end) throw Error("wait timeout");
    await Bun.sleep(50);
  }
};
try {
  await until(() => output.includes("#token="));
  const url = output.match(/http:\/\/\S+/)[0];
  const origin = new URL(url).origin,
    token = new URLSearchParams(new URL(url).hash.slice(1)).get("token");
  const api = async (path = "/api/workspaces", method = "GET", body) => {
    const r = await fetch(origin + path, {
      method,
      headers: { Authorization: "Bearer " + token, Origin: origin, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw Error(await r.text());
    return r.json();
  };
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_BIN,
    headless: process.env.HEADLESS === "1",
    args: [
      "--no-sandbox",
      "--ozone-platform=x11",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
    ],
    env: { ...process.env, DISPLAY: ":0", TMPDIR: "/var/tmp" },
  });
  const context = await browser.newContext({ viewport: { width: 1100, height: 720 }, hasTouch: true });
  page = await context.newPage();
  page.on("pageerror", (e) => observations.pageErrors.push(String(e)));
  await page.addInitScript(() => {
    const WS = window.WebSocket;
    window.terminalSockets = new Map();
    window.forceReplayGap = false;
    window.WebSocket = class extends WS {
      constructor(url, protocols) {
        const parsed = new URL(url);
        if (window.forceReplayGap && parsed.pathname === "/api/terminal") {
          parsed.searchParams.set("after", "900000");
          window.forceReplayGap = false;
        }
        super(parsed.href, protocols);
        if (parsed.pathname === "/api/terminal") window.terminalSockets.set(parsed.searchParams.get("tab"), this);
      }
    };
  });
  await page.goto(url);
  await page.waitForTimeout(1000);
  console.log("INITIAL", await page.locator("body").innerText());
  await page.waitForFunction(() => document.querySelector("#status")?.textContent === "Connected");
  const ready = async () => {
    await page.waitForFunction(() =>
      document.querySelector(".terminal-pane:not([hidden]) .terminal-accessible-output")?.textContent.includes("bruv"),
    );
    await page.waitForTimeout(700);
  };
  const shot = async (name) => {
    await page.waitForTimeout(500);
    const geometry = await page.evaluate(() => {
      const strips = [...document.querySelectorAll("#terminal-status:not([hidden]), #voice-status:not([hidden])")];
      return {
        phone: innerWidth <= 700,
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        strips: strips.map((el) => ({
          gap: getComputedStyle(el).gap,
          padding: getComputedStyle(el).paddingLeft,
          buttons: [...el.querySelectorAll("button:not([hidden])")].map((button) => ({
            rect: button.getBoundingClientRect().toJSON(),
            library: button.classList.contains("btn"),
          })),
        })),
      };
    });
    assert.equal(geometry.scrollWidth, geometry.width, name + ": no viewport overflow");
    for (const strip of geometry.strips) {
      assert.equal(strip.gap, "8px");
      assert.equal(strip.padding, geometry.phone ? "8px" : "12px");
      for (const button of strip.buttons) {
        assert.equal(button.rect.height, geometry.phone ? 44 : 32);
        assert(button.library);
        assert(button.rect.right <= geometry.width);
      }
    }
    await Bun.write(join(out, name + "-geometry.json"), JSON.stringify(geometry, null, 2));
    await page.screenshot({ path: join(out, name + ".png"), caret: "initial" });
    observations.screens.push({ name, viewport: page.viewportSize(), body: await page.locator("body").innerText() });
    console.log("CAPTURE", name);
  };
  console.log("WAIT_READY");
  await ready();
  console.log("READY");
  if (
    await page
      .locator(".terminal-pane:not([hidden]) .terminal-accessible-output")
      .textContent()
      .then((s) => s.includes("Trust project folder?"))
  ) {
    await page.locator(".terminal-pane:not([hidden]) textarea").focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () =>
        !document
          .querySelector(".terminal-pane:not([hidden]) .terminal-accessible-output")
          ?.textContent.includes("Trust project folder?"),
    );
  }
  console.log("TRUSTED");
  state = await api();
  const w = state.workspaces[0];
  await api("/api/tabs/" + w.tabs[0].id, "PATCH", { name: "Terminal" });
  for (const name of ["Tests", "Build", "Review", "Server logs", "Long-running investigation"]) {
    state = await api("/api/workspaces/" + w.id + "/tabs", "POST", {});
    await api("/api/tabs/" + state.workspaces[0].tabs.at(-1).id, "PATCH", { name });
  }
  await api("/api/workspaces", "POST", { cwd: apiCwd });
  await api("/api/workspaces", "POST", { cwd: docsCwd });
  await page.getByRole("tab", { name: "Select tab Terminal", exact: true }).click();
  await ready();
  await page.locator(".terminal-pane:not([hidden]) textarea").focus();
  await page.keyboard.type('!printf "Spacing proof: actual shell output\\nReady for input\\n"');
  await page.keyboard.press("Enter");
  await page.waitForFunction(() =>
    document
      .querySelector(".terminal-pane:not([hidden]) .terminal-accessible-output")
      ?.textContent.includes("Spacing proof"),
  );
  await page.waitForTimeout(1000);
  await page.waitForFunction(() =>
    document
      .querySelector(".terminal-pane:not([hidden]) .terminal-accessible-output")
      ?.textContent.includes("Spacing proof"),
  );
  observations.accessibility = {
    visibleTrees: await page.locator(".terminal-pane:not([hidden]) .terminal-accessible-output").count(),
    hiddenTrees: await page.locator(".terminal-pane[hidden] .terminal-accessible-output").count(),
    text: await page.locator(".terminal-pane:not([hidden]) .terminal-accessible-output").textContent(),
  };
  await shot("populated-desktop");
  await page.getByRole("tab", { name: "Select tab Terminal", exact: true }).press("F2");
  await page.getByRole("textbox", { name: "Tab name", exact: true }).fill("Draft name");
  await shot("edit-desktop");

  await api("/api/tabs/" + (await api()).workspaces[0].tabs[1].id, "PATCH", { name: "Checks" });
  await page.waitForTimeout(150);
  if ((await page.locator(".tab-name-input").inputValue()) !== "Draft name") throw Error("rename draft lost");
  await page.keyboard.press("Escape");
  await page.locator("#tab-close-" + w.tabs[0].id).click();
  await shot("close-desktop");
  await page.locator("#dialog-cancel").click();
  await page.locator("#add-workspace").click();
  await page.locator("#folder-input").fill("/no/such/folder");
  await page.locator("#open-folder").click();
  await page.locator("#folder-error").waitFor();
  await shot("path-error-desktop");
  await page.locator("#cancel-folder").click();
  await page.setViewportSize({ width: 390, height: 780 });
  await shot("populated-phone");
  await page.locator(".terminal-pane:not([hidden]) textarea").focus();
  await page.keyboard.type("!seq 1 140");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1200);
  await page.keyboard.press("Control+o");
  await page.waitForTimeout(700);
  const rows = () => page.locator(".terminal-pane:not([hidden]) .terminal-accessible-output").textContent();
  const beforeSwipe = await rows();
  const touchSession = await context.newCDPSession(page);
  const box = await page.locator(".terminal-pane:not([hidden]) canvas").boundingBox();
  await touchSession.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height - 100 }],
  });
  for (let i = 1; i <= 8; i++) {
    await touchSession.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height - 100 - i * 30 }],
    });
    await page.waitForTimeout(30);
  }
  await touchSession.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(400);
  const afterSwipe = await rows();
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.wheel(0, 240);
  await page.waitForTimeout(400);
  const afterWheel = await rows();
  const firstNumber = (text) =>
    text
      .split("\n")
      .map((line) => line.replace(/[┃│]/g, "").trim())
      .find((line) => /^\d+$/.test(line));
  observations.touch = {
    fixture: "real CLI !seq 1 140 expanded with Ctrl+O",
    before: beforeSwipe,
    afterSwipe,
    afterWheel,
    swipeChanged: beforeSwipe !== afterSwipe,
    wheelChanged: afterSwipe !== afterWheel,
    firstBefore: firstNumber(beforeSwipe),
    firstAfterSwipe: firstNumber(afterSwipe),
    firstAfterWheel: firstNumber(afterWheel),
  };
  if (!observations.touch.swipeChanged || !observations.touch.wheelChanged)
    throw Error("Expanded CLI history did not move for swipe and wheel");
  assert.notEqual(
    observations.touch.firstBefore,
    observations.touch.firstAfterSwipe,
    "Swipe recalled input instead of scrolling numbered CLI history",
  );
  assert.notEqual(
    observations.touch.firstAfterSwipe,
    observations.touch.firstAfterWheel,
    "Wheel did not scroll numbered CLI history",
  );
  await shot("touch-history-phone");
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.waitForFunction(() => document.querySelector(".terminal-pane:not([hidden]) canvas").clientWidth > 700);
  const originalId = await page
    .locator(".terminal-pane:not([hidden])")
    .getAttribute("id")
    .then((id) => id.slice("terminal-".length));
  const original = (await api()).workspaces.flatMap((item) => item.tabs).find((tab) => tab.id === originalId);
  await page.evaluate((id) => {
    window.forceReplayGap = true;
    window.terminalSockets.get(id).close(4000, "Fixture reconnect");
  }, originalId);
  await page.locator("#status").filter({ hasText: "View lost" }).waitFor();
  await shot("view-lost-desktop");
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(500);
  observations.lostView = {
    originalId,
    pid: original.pid,
    phoneScrollWidth: await page.evaluate(() => document.documentElement.scrollWidth),
    viewport: 390,
  };
  await shot("view-lost-phone");
  await page.locator("#lost-new-tab").click();
  await page.waitForFunction(() => document.querySelector("#status").textContent === "Connected");
  observations.lostView.originalAfterNewTerminal = (await api()).workspaces
    .flatMap((item) => item.tabs)
    .find((tab) => tab.id === originalId);
  if (observations.lostView.originalAfterNewTerminal?.pid !== original.pid)
    throw Error("New terminal removed original work");

  await page.locator("#open-drawer").click();
  await shot("drawer-phone");
  await page.locator("#add-workspace").click();
  await page.locator("#folder-input").fill("/no/such/folder");
  await page.locator("#open-folder").click();
  await page.locator("#folder-error").waitFor();
  await shot("path-error-phone");
  await page.locator("#cancel-folder").click();
  await page.locator("#close-drawer").click();
  const viewer = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  await viewer.goto(url);
  await viewer.waitForFunction(() => document.querySelector("#status")?.textContent === "Connected");
  await viewer.locator("#workspace-list .workspace").filter({ hasText: "api-service" }).click();
  observations.independentNavigation = {
    phone: await page.locator("#current-workspace").textContent(),
    viewer: await viewer.locator('.workspace[aria-pressed="true"]').textContent(),
  };
  if (
    observations.independentNavigation.phone !== "bruv" ||
    !observations.independentNavigation.viewer.includes("api-service")
  )
    throw Error("viewer navigation moved");
  await viewer.close();
  for (const t of (await api()).workspaces[0].tabs) await api("/api/tabs/" + t.id, "DELETE", { confirm: true });
  await page.getByRole("heading", { name: "No terminals in bruv" }).waitFor();
  await shot("empty-tabs-phone");
  await page.setViewportSize({ width: 1100, height: 720 });
  await shot("empty-tabs-desktop");
  for (const item of (await api()).workspaces) await api("/api/workspaces/" + item.id, "DELETE", { confirm: true });
  await page.getByRole("heading", { name: "Open a folder" }).waitFor();
  await page.locator("#folder-input").fill("");
  await shot("empty-folders-desktop");
  await page.setViewportSize({ width: 390, height: 780 });
  await shot("empty-folders-phone");
  await page.locator("#folder-input").fill("/still/no/folder");
  await page.locator("#open-folder").click();
  await page.locator("#folder-error").waitFor();
  await shot("empty-path-error-phone");
  const deniedContext = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const denied = await deniedContext.newPage();
  await denied.goto(origin + "/#token=bad");
  await denied.getByRole("heading", { name: "Access required" }).waitFor();
  await denied.screenshot({ path: join(out, "access-phone.png"), caret: "initial" });
  await denied.setViewportSize({ width: 1100, height: 720 });
  await denied.screenshot({ path: join(out, "access-desktop.png"), caret: "initial" });
  await deniedContext.close();
  await page.locator("#folder-input").fill(cwd);
  await page.locator("#open-folder").click();
  await page.waitForFunction(() =>
    document.querySelector(".terminal-pane:not([hidden]) .terminal-accessible-output")?.textContent.includes("bruv"),
  );
  observations.accessibility.reopenedVisibleTrees = await page
    .locator(".terminal-pane:not([hidden]) .terminal-accessible-output")
    .count();
  observations.accessibility.reopenedHiddenTrees = await page
    .locator(".terminal-pane[hidden] .terminal-accessible-output")
    .count();
  observations.accessibility.reopenedText = await page
    .locator(".terminal-pane:not([hidden]) .terminal-accessible-output")
    .textContent();

  // Emulated list outage in a second browser, not a server/provider change.
  const retryContext = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const retryPage = await retryContext.newPage();
  let listUnavailable = true;
  await retryPage.route("**/api/workspaces", (route) =>
    listUnavailable
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Fixture list outage" }),
        })
      : route.continue(),
  );
  await retryPage.routeWebSocket("**/api/events", (socket) =>
    listUnavailable ? socket.close({ code: 1013, reason: "Fixture list outage" }) : socket.connectToServer(),
  );
  await retryPage.goto(url);
  await retryPage.getByRole("heading", { name: "Workspace list unavailable" }).waitFor();
  for (const viewport of [
    { width: 390, height: 780 },
    { width: 1100, height: 720 },
  ]) {
    await retryPage.setViewportSize(viewport);
    await retryPage.getByRole("button", { name: "Retry", exact: true }).waitFor();
    const geometry = await retryPage.locator("#empty-action").evaluate((el) => ({
      rect: el.getBoundingClientRect().toJSON(),
      library: el.classList.contains("btn"),
      sectionGap: getComputedStyle(document.querySelector("#empty-content > p")).marginBottom,
    }));
    assert.equal(geometry.rect.height, viewport.width <= 700 ? 44 : 32);
    assert.equal(await retryPage.locator("#sync-status").isVisible(), false);
    assert.equal(await retryPage.locator("#notice").isVisible(), false);
    assert(geometry.library);
    assert.equal(geometry.sectionGap, "16px");
    await retryPage.screenshot({
      caret: "initial",
      path: join(out, viewport.width <= 700 ? "retry-phone.png" : "retry-desktop.png"),
    });
  }
  listUnavailable = false;
  await retryPage.getByRole("button", { name: "Retry", exact: true }).click();
  await retryPage.getByRole("heading", { name: "Workspace list unavailable" }).waitFor({ state: "hidden" });
  await retryPage.waitForFunction(() =>
    document.querySelector(".terminal-pane:not([hidden]) .terminal-accessible-output")?.textContent.includes("bruv"),
  );
  observations.listRetry = true;
  await retryContext.close();
} catch (e) {
  observations.error = String(e);
  if (page) {
    observations.errorBody = await page.locator("body").innerText();
    await page.screenshot({ path: join(out, "failure.png"), caret: "initial" });
  }
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  proc.kill("SIGTERM");
  observations.exitCode = await proc.exited;
  observations.stderr = errors;
  await Bun.write(join(out, "observations.json"), JSON.stringify(observations, null, 2));
  console.log("OWNED_FIXTURE_EXIT", observations.exitCode, "OUTPUT", out);
  assert.equal(observations.exitCode, 0);
  assert.deepEqual(observations.pageErrors, []);
}
