// Run with Bun, PLAYWRIGHT_CORE, CHROMIUM_BIN and HEADLESS=1 in CI.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { prepareWebAssets } from "../build/web-assets.ts";
import { initialState, startFixture } from "./browser-ui-fixture.mjs";

const project = resolve(import.meta.dir, "../..");
const tmp = join(project, ".tmp");
await mkdir(tmp, { recursive: true });
const scratch = await mkdtemp(join(tmp, "browser-ui-"));
let fixture, browser;
const checks = [],
  errors = [];
try {
  const assets = new Map();
  // The shipping build path, including controls CSS, font and pinned Ghostty WASM.
  await prepareWebAssets(project, async (target, content) => {
    assets.set(basename(target), content);
    await writeFile(join(scratch, basename(target)), content);
  });
  fixture = startFixture(assets);
  fixture.missingControl = process.argv.includes("--missing-control");
  // Chromium Unix sockets need a short path even in a long worktree.
  const browserTmp = process.platform === "linux" ? "/proc/self/cwd/.tmp/" + basename(scratch) : scratch;
  process.env.TMPDIR = browserTmp;
  const { chromium } = await import(
    process.env.PLAYWRIGHT_CORE ? pathToFileURL(process.env.PLAYWRIGHT_CORE).href : "playwright-core"
  );
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_BIN,
    headless: process.env.HEADLESS !== "0",
    args: ["--no-sandbox"],
    env: { ...process.env, TMPDIR: browserTmp },
  });
  async function run(name, phone, work, state = initialState(), init) {
    fixture.reset(state);
    const context = await browser.newContext({
      viewport: phone ? { width: 390, height: 844 } : { width: 1100, height: 720 },
      hasTouch: phone,
      isMobile: phone,
    });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(7000);
      page.on("pageerror", (error) => errors.push(String(error)));
      if (init) await page.addInitScript(init);
      await page.goto(fixture.origin + "/#token=fixture");
      // A missing required HTML control must fail, even if the app never boots.
      assert.equal(await page.locator("#new-tab").count(), 1, "missing required HTML control: new-tab");
      await work(page, context);
      assert.deepEqual(errors, [], "uncaught browser errors");
      checks.push(name);
      console.log("PASS " + name);
    } catch (error) {
      const page = context.pages()[0];
      console.error(name, await page.locator("body").innerText(), fixture.messages.slice(-6));
      throw error;
    } finally {
      await context.close();
    }
  }
  const focused = async (page, selector) => {
    await page.waitForFunction((selector) => document.activeElement === document.querySelector(selector), selector);
  };
  const terminalFocus = async (page, id) => focused(page, "#terminal-" + id + ' [contenteditable="true"]');
  const ready = async (page) => {
    await page.getByRole("tabpanel", { name: "One", exact: true }).waitFor();
    await page.waitForFunction(() =>
      document.querySelector("#terminal-t1 .terminal-accessible-output")?.textContent.includes("READY t1"),
    );
    assert(await page.locator("#terminal-t1 canvas").count(), "Ghostty canvas missing");
  };
  const rename = async (page, id) => {
    await page.locator("#tab-" + id).focus();
    await page.keyboard.press("F2");
    await focused(page, "#tab-name-" + id);
  };
  const deleted = (id) => fixture.requests.filter((r) => r.method === "DELETE" && r.path.endsWith("/" + id));

  await run("native focus, shared drafts and accessible names", false, async (page) => {
    await ready(page);
    await page.screenshot({ path: join(tmp, "browser-ui-desktop.png") });
    await page.locator("#tab-t2").focus();
    await page.keyboard.press("Enter");
    await terminalFocus(page, "t2");
    await rename(page, "t2");
    const input = await page.locator("#tab-name-t2").elementHandle();
    await input.fill("Build");
    await input.evaluate((element) => element.setSelectionRange(1, 3));
    fixture.update((s) => {
      s.workspaces[0].tabs.shift();
      s.workspaces[0].tabs[0].name = "Shared name";
    });
    await page.locator("#tab-t1").waitFor({ state: "detached" });
    assert(
      await input.evaluate(
        (element) =>
          element === document.activeElement &&
          element.isConnected &&
          element.value === "Build" &&
          element.selectionStart === 1 &&
          element.selectionEnd === 3,
      ),
    );
    await page.getByRole("tabpanel", { name: "Shared name", exact: true }).waitFor();
    assert.match(await page.locator("#terminal-t2").ariaSnapshot(), /tabpanel "Shared name"/);
    fixture.fail("/api/tabs/t2", "Rename failed");
    await page.keyboard.press("Enter");
    await page.getByRole("alert").filter({ hasText: "Rename failed" }).waitFor();
    await focused(page, "#tab-name-t2");
    assert.equal(await input.inputValue(), "Build");
    await page.keyboard.press("Enter");
    await page.getByRole("tabpanel", { name: "Build", exact: true }).waitFor();
    await terminalFocus(page, "t2");
    assert.equal(fixture.requests.filter((r) => r.method === "PATCH").at(-1).path, "/api/tabs/t2");
    fixture.stale();
    await page.waitForTimeout(80); // Let the actual socket event reach Chromium.
    assert.equal(await page.locator("#tab-t2").textContent(), "Build");
    const patchCount = fixture.requests.filter((r) => r.method === "PATCH").length;
    await rename(page, "t2");
    await page.locator("#tab-name-t2").fill("   ");
    await page.keyboard.press("Enter");
    await rename(page, "t2");
    await page.locator("#tab-name-t2").fill("Discard");
    await page.keyboard.press("Escape");
    await focused(page, "#tab-t2");
    await page.locator("#tab-t2").dblclick();
    await focused(page, "#tab-name-t2");
    await page.locator("#new-tab").focus();
    await page.locator("#tab-name-t2").waitFor({ state: "detached" });
    assert.equal(fixture.requests.filter((r) => r.method === "PATCH").length, patchCount);
    // AX uses a stable panel name, not the temporarily replaced tab button.
    assert.match(await page.locator("#terminal-t2").ariaSnapshot(), /tabpanel "Build"/);
    assert.equal(await page.locator("#terminal-t3 .terminal-accessible-output").isVisible(), false);
    assert.equal(await page.getByRole("region", { name: "Terminal output", exact: true }).count(), 1);
  });

  await run("native confirmation cancel, reopen and captured inactive tab", false, async (page) => {
    await ready(page);
    await page.locator("#tab-close-t2").click();
    await page.getByRole("dialog", { name: "Close “Two”?" }).waitFor();
    await focused(page, "#dialog-cancel");
    assert.match(await page.locator("#dialog-description").textContent(), /everyone/);
    await page.keyboard.press("Escape");
    await focused(page, "#tab-close-t2");
    assert.equal(deleted("t2").length, 0);
    // Native close queues an event; cancel and reopen in the same browser task.
    await page.locator("#tab-close-t2").click();
    await page.evaluate(() => {
      document.querySelector("#dialog-cancel").click();
      document.querySelector("#tab-close-t2").click();
    });
    await focused(page, "#dialog-cancel");
    await page.getByRole("button", { name: "Close tab", exact: true }).click();
    await page.locator("#tab-t2").waitFor({ state: "detached" });
    assert.equal(deleted("t2").length, 1);
    assert.deepEqual(deleted("t2")[0].body, { confirm: true });
    await terminalFocus(page, "t1");
    await rename(page, "t1");
    fixture.update((s) => {
      s.workspaces[0].tabs = [];
    });
    await page.locator("#tab-name-t1").waitFor({ state: "detached" });
    await page.getByRole("heading", { name: "No terminals in alpha" }).waitFor();
    await page.getByRole("button", { name: "New terminal", exact: true }).click();
    await page.locator('[role="tab"][aria-selected="true"]').waitFor();
  });

  await run("phone drawer wrap, shared row focus and deletion", true, async (page) => {
    await ready(page);
    await page.locator("#open-drawer").tap();
    await focused(page, "#close-drawer");
    assert.equal(await page.locator("main").evaluate((e) => e.inert), true);
    await page.locator("#add-workspace").tap();
    await page.locator("#cancel-folder").tap();
    await page.keyboard.press("Shift+Tab");
    await focused(page, "#workspace-remove-w2");
    await page.keyboard.press("Tab");
    await focused(page, "#add-workspace");
    await page.locator("#workspace-remove-w2").focus();
    const remove = await page.locator("#workspace-remove-w2").elementHandle();
    fixture.update((s) => {
      s.workspaces[0].name = "Remote alpha";
    });
    await page.getByRole("button", { name: "Open workspace Remote alpha · /alpha", exact: true }).waitFor();
    assert(await remove.evaluate((e) => e === document.activeElement));
    fixture.update((s) => {
      s.workspaces.shift();
    });
    await page.locator("#workspace-row-w1").waitFor({ state: "detached" });
    assert(await remove.evaluate((e) => e === document.activeElement));
    await remove.click();
    await focused(page, "#dialog-cancel");
    fixture.update((s) => {
      s.workspaces.push({ id: "w4", name: "delta", cwd: "/delta", tabs: [] });
    });
    await page.locator("#workspace-row-w4").waitFor();
    await focused(page, "#dialog-cancel");
    await page.getByRole("button", { name: "Remove workspace", exact: true }).click();
    await page.locator("#workspace-row-w2").waitFor({ state: "detached" });
    await focused(page, "#workspace-w4");
    await page.locator("#workspace-remove-w4").tap();
    await focused(page, "#dialog-cancel");
    await page.getByRole("button", { name: "Remove workspace", exact: true }).tap();
    await page.getByRole("heading", { name: "Open a folder", exact: true }).waitFor();
    await focused(page, "#folder-input");
    assert.equal(await page.locator("main").evaluate((e) => e.inert), false);
  });

  await run("remote drawer removal restores focus without stealing a dialog", true, async (page) => {
    await ready(page);
    await page.locator("#open-drawer").tap();
    await page.locator("#workspace-remove-w2").focus();
    fixture.update((s) => {
      s.workspaces.pop();
    });
    await page.locator("#workspace-row-w2").waitFor({ state: "detached" });
    await focused(page, "#workspace-w1");
    fixture.update((s) => {
      s.workspaces.push(initialState().workspaces[1]);
    });
    await page.locator("#workspace-remove-w2").tap();
    await focused(page, "#dialog-cancel");
    fixture.update((s) => {
      s.workspaces.pop();
    });
    await page.locator("#workspace-row-w2").waitFor({ state: "detached" });
    await focused(page, "#dialog-cancel");
    await page.keyboard.press("Escape");
    await focused(page, "#workspace-w1");
    assert.equal(deleted("w2").length, 0);
    await page.keyboard.press("Escape");
    await focused(page, "#open-drawer");
    assert.equal(await page.locator("main").evaluate((e) => e.inert), false);
  });

  await run("phone touch rename, 16px input and folder retry draft", true, async (page) => {
    await ready(page);
    await page.locator("#tab-t1").tap();
    await page.locator("#tab-t1").tap();
    await focused(page, "#tab-name-t1");
    assert.equal(await page.locator("#tab-name-t1").evaluate((e) => getComputedStyle(e).fontSize), "16px");
    await page.locator("#tab-name-t1").fill("A long phone rename draft with its caret at the end");
    await page.keyboard.press("End");
    assert(await page.locator("#tab-name-t1").evaluate((e) => e.scrollLeft > 0 && e.selectionStart === e.value.length));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "phone page overflows");
    await page.screenshot({ path: join(tmp, "browser-ui-phone-rename.png") });
    await page.keyboard.press("Escape");
    await page.locator("#open-drawer").tap();
    await page.locator("#add-workspace").tap();
    await page.locator("#folder-input").fill("/missing");
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    fixture.fail("/api/workspaces", "Folder not found", 400, pending);
    await page.locator("#open-folder").tap();
    await page.locator("#close-drawer").tap();
    release();
    await page.locator("#folder-error").filter({ hasText: "Folder not found" }).waitFor();
    await focused(page, "#folder-input");
    assert.equal(await page.locator("body").getAttribute("data-drawer"), "open");
    assert.equal(await page.locator("#folder-input").inputValue(), "/missing");
    assert.equal(await page.locator("#folder-input").getAttribute("aria-invalid"), "true");
    await page.screenshot({ path: join(tmp, "browser-ui-phone.png") });
    await page.locator("#folder-input").fill("/beta");
    assert.equal(await page.locator("#folder-error").textContent(), "");
    await page.locator("#open-folder").tap();
    await page.locator("#tab-t3").waitFor();
    await terminalFocus(page, "t3");
    assert.equal(fixture.state.workspaces.length, 2, "resolved folder must select its existing identity");
  });

  await run("phone overflow cues and native swipe update the Ghostty viewport", true, async (page, context) => {
    await ready(page);
    fixture.update((s) => {
      for (let i = 4; i <= 9; i++) s.workspaces[0].tabs.push({ id: "t" + i, name: "Long terminal " + i });
    });
    await page.waitForFunction(() => document.querySelector("#tab-list").dataset.endClipped === "true");
    await page.locator("#tab-t9").tap();
    await page.waitForFunction(() => document.querySelector("#tab-list").dataset.startClipped === "true");
    assert.equal(await page.locator("#tab-close-t9").isVisible(), true);
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      "phone tabs overflow the page",
    );
    fixture.terminal("t9", {
      type: "output",
      seq: 2,
      data: Buffer.from(Array.from({ length: 100 }, (_, i) => "History line " + i).join("\r\n")).toString("base64"),
    });
    const output = page.locator("#terminal-t9 .terminal-accessible-output");
    await page.waitForFunction(() =>
      document.querySelector("#terminal-t9 .terminal-accessible-output").textContent.includes("History line 99"),
    );
    const before = await output.textContent();
    const box = await page.locator("#terminal-t9 canvas").boundingBox();
    const touch = await context.newCDPSession(page);
    const x = box.x + box.width / 2,
      y = box.y + 150;
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let i = 1; i <= 6; i++)
      await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + i * 30 }] });
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForFunction(
      (before) => document.querySelector("#terminal-t9 .terminal-accessible-output").textContent !== before,
      before,
    );
    assert.match(await output.textContent(), /History line/);
    await page.screenshot({ path: join(tmp, "browser-ui-phone-scroll.png") });
    await touch.detach();
  });

  await run("socket recovery, view loss and ended output", false, async (page) => {
    await ready(page);
    const canvas = await page.locator("#terminal-t1 canvas").elementHandle();
    fixture.disconnect("/api/terminal");
    await page.locator("#status").filter({ hasText: "retrying" }).waitFor();
    await page.locator("#terminal-status").waitFor({ state: "hidden" });
    assert(await canvas.evaluate((e) => e.isConnected), "reconnect replaced terminal");
    fixture.disconnect("/api/events");
    await page.locator("#sync-status").filter({ hasText: "out of date" }).waitFor();
    await page.waitForFunction(() => document.querySelector("#sync-status").textContent === "");
    fixture.terminal("t1", { type: "gap", message: "View lost · original work still runs" });
    await page.locator("#status").filter({ hasText: "View lost" }).waitFor();
    assert.match(await page.locator("#tab-t1").textContent(), /view lost/);
    assert.doesNotMatch(await page.locator("#tab-t1").textContent(), /ended/);
    await page.getByRole("button", { name: "New terminal", exact: true }).click();
    await page.locator("#tab-t4").waitFor();
    fixture.terminal("t4", { type: "exit", code: 0 });
    await page.locator("#status").filter({ hasText: "CLI ended" }).waitFor();
    await page.getByRole("button", { name: "Remove tab New terminal", exact: true }).waitFor();
    await page.locator("#tab-t1").click();
    await page.waitForFunction(() =>
      document.querySelector("#terminal-t1 .terminal-accessible-output").textContent.includes("READY t1"),
    );
  });

  await run(
    "shared voice label and device denial UI",
    false,
    async (page) => {
      await ready(page);
      fixture.update((s) => {
        s.voice = { tabId: "t2", ownerId: "another-browser" };
      });
      await page.locator("#audio-status").filter({ hasText: "Voice in another browser · alpha / Two" }).waitFor();
      assert.equal(await page.locator("#cancel-voice").isVisible(), false);
      fixture.update((s) => {
        s.voice = null;
      });
      await page.locator("#tab-t1").click(); // Native user activation for AudioContext.
      fixture.terminal("t1", { type: "audio-request", request: "denied" });
      await page.locator("#audio-status").filter({ hasText: "Microphone permission denied" }).waitFor();
      await page.locator("#dismiss-voice").click();
      await page.locator("#voice-status").waitFor({ state: "hidden" });
    },
    initialState(),
    () => {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        value: async () => {
          throw new DOMException("fixture permission denied", "NotAllowedError");
        },
      });
    },
  );

  await run(
    "pending microphone Cancel follows its owner, not selection",
    false,
    async (page) => {
      await ready(page);
      await page.locator("#tab-t1").click();
      fixture.terminal("t1", { type: "audio-request", request: "pending" });
      await page.locator("#audio-status").filter({ hasText: "Requesting microphone" }).waitFor();
      await page.locator("#tab-t2").click();
      await page.locator("#audio-status").filter({ hasText: "alpha / One" }).waitFor();
      await page.locator("#cancel-voice").click();
      await page.locator("#voice-status").waitFor({ state: "hidden" });
      // Device is the only injected browser API; sockets and event delivery are native.
      await page.waitForTimeout(80);
      assert(
        fixture.messages.some((m) => m.tab === "t1" && m.data.type === "audio-error" && m.data.request === "pending"),
      );
      assert(!fixture.messages.some((m) => m.tab === "t2" && m.data.type === "audio-error"));
    },
    initialState(),
    () => {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: () => new Promise(() => {}) });
    },
  );

  await run(
    "empty workspace uses folder entry, then new terminal",
    false,
    async (page) => {
      await page.getByRole("heading", { name: "Open a folder", exact: true }).waitFor();
      assert.equal(await page.locator("#cancel-folder").isVisible(), false);
      await page.locator("#folder-input").fill("/delta");
      await page.locator("#open-folder").click();
      await page.getByRole("heading", { name: "No terminals in delta", exact: true }).waitFor();
      await page.getByRole("button", { name: "New terminal", exact: true }).click();
      await page.getByRole("tabpanel", { name: "New terminal", exact: true }).waitFor();
    },
    { ...initialState(), workspaces: [] },
  );

  fixture.reset();
  fixture.eventsMuted = true; // Initial REST failure must not be healed by a state event.
  const recovery = await browser.newContext();
  try {
    const page = await recovery.newPage();
    page.setDefaultTimeout(7000);
    fixture.fail("/api/workspaces", "offline");
    await page.goto(fixture.origin + "/#token=fixture");
    await page.getByRole("heading", { name: "Workspace list unavailable", exact: true }).waitFor();
    assert.equal(await page.locator("#notice").isVisible(), false, "recovery must not stack notices");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await ready(page);
    checks.push("initial REST failure has one recovery view and retries");
  } finally {
    await recovery.close();
  }
  const invalid = await browser.newContext();
  try {
    const page = await invalid.newPage();
    fixture.fail("/api/workspaces", "expired", 403);
    await page.goto(fixture.origin + "/#token=fixture");
    await page.getByRole("heading", { name: "Access required", exact: true }).waitFor();
    assert.equal(await page.locator("#empty-action").isVisible(), false);
    assert.equal(await page.locator("#folder-form").isVisible(), false);
    checks.push("known-invalid access is not a retry or empty workspace");
  } finally {
    await invalid.close();
    fixture.eventsMuted = false;
  }

  // No token: a separate context must not inherit sessionStorage from prior pages.
  const access = await browser.newContext();
  try {
    const page = await access.newPage();
    await page.goto(fixture.origin);
    await page.getByRole("heading", { name: "Access required", exact: true }).waitFor();
    assert.equal(await page.locator("#folder-form").isVisible(), false);
    assert.equal(await page.locator("#empty-action").isVisible(), false);
    checks.push("missing access is not an empty workspace");
  } finally {
    await access.close();
  }
  console.log(
    JSON.stringify({
      pass: true,
      checks,
      captures: [
        "browser-ui-desktop.png",
        "browser-ui-phone.png",
        "browser-ui-phone-rename.png",
        "browser-ui-phone-scroll.png",
      ],
    }),
  );
} finally {
  try {
    await browser?.close();
  } finally {
    try {
      fixture?.stop();
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}
