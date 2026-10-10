// Actual browser bundle, production server, raw PTY. No provider or audio devices.
import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { startWebServer } from "../../src/web/server.ts";
import { loadWebAssets } from "../../src/web/assets.ts";
import { closeProbeBrowser, within } from "./browser-probe.mjs";

const project = resolve(import.meta.dir, "../..");
const tmp = join(project, ".tmp");
await mkdir(tmp, { recursive: true });
const scratch = await mkdtemp(join(tmp, "browser-transport-"));
const input = join(scratch, "input"),
  output = join(scratch, "output");
let app, browser;
const contexts = [];
// biome-ignore lint/suspicious/noControlCharactersInRegex: Private PTY labels contain ESC and BEL.
const inputLabels = /\x1b\]777;bruv-input;([a-f0-9]{32}|-):([a-f0-9]{32})?\x07/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: Match cursor reports emitted by the terminal.
const cursorReplies = /\x1b\[\d+;\d+R/g;
async function until(check, why) {
  const end = Date.now() + 15000;
  while (!(await check())) {
    assert(Date.now() < end, why);
    await Bun.sleep(20);
  }
}
async function rawInput() {
  return readFile(input);
}
function withoutLabels(bytes) {
  return Buffer.from(bytes.toString("latin1").replace(inputLabels, ""), "latin1");
}
async function replyCount() {
  return (
    withoutLabels(await rawInput())
      .toString("latin1")
      .match(cursorReplies) ?? []
  ).length;
}
async function viewer() {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.addInitScript(() => {
    const Native = window.WebSocket;
    window.transportSockets = [];
    window.WebSocket = class extends Native {
      constructor(...args) {
        super(...args);
        window.transportSockets.push(this);
      }
    };
  });
  await page.goto(app.url);
  await page.waitForFunction(() =>
    document.querySelector(".terminal-accessible-output")?.textContent.includes("READY"),
  );
  return page;
}
async function barrier(page, key) {
  const before = (await rawInput()).length;
  await page.locator('.terminal-pane:not([hidden]) [contenteditable="true"]').focus();
  await page.keyboard.type(key);
  await until(
    async () =>
      withoutLabels((await rawInput()).subarray(before))
        .toString()
        .endsWith(key),
    "input barrier",
  );
}
async function state() {
  return fetch(app.origin + "/api/workspaces", { headers: { Authorization: "Bearer " + app.token } }).then((r) =>
    r.json(),
  );
}
try {
  await writeFile(input, "");
  await writeFile(output, "");
  const fixture = join(scratch, "raw.ts");
  await writeFile(
    fixture,
    [
      'import {appendFileSync,readFileSync} from "node:fs";',
      "process.stdin.setRawMode(true);",
      'process.stdin.on("data", data => appendFileSync(process.env.INPUT, data));',
      'process.stdout.write("\\x1b[?2004hREADY\\r\\n");',
      "let offset=0; setInterval(() => { const bytes=readFileSync(process.env.OUTPUT); if(bytes.length>offset){process.stdout.write(bytes.subarray(offset));offset=bytes.length;} },20);",
    ].join("\n"),
  );
  const assets = await loadWebAssets();
  const options = {
    assets,
    cwd: scratch,
    command: [process.execPath, fixture],
    env: { ...process.env, INPUT: input, OUTPUT: output },
  };
  app = startWebServer({ ...options, port: 0 });
  const { chromium } = await import(
    process.env.PLAYWRIGHT_CORE ? pathToFileURL(process.env.PLAYWRIGHT_CORE).href : "playwright-core"
  );
  const browserTmp = process.platform === "linux" ? "/proc/self/cwd/.tmp/" + basename(scratch) : scratch;
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_BIN,
    headless: process.env.HEADLESS !== "0",
    args: ["--no-sandbox"],
    env: { ...process.env, TMPDIR: browserTmp },
  });
  const a = await viewer(),
    b = await viewer();
  const pid = (await state()).workspaces[0].tabs[0].pid;
  await barrier(a, "a");
  await barrier(b, "b");
  await appendFile(output, "LIVE\r\n\x1b[6n");
  await until(async () => (await replyCount()) === 1, "one shared live reply");
  const late = await viewer();
  await barrier(late, "z");
  assert.equal(await replyCount(), 1, "late replay answered twice");
  await a.evaluate(() => {
    for (const ws of window.transportSockets) if (ws.url.includes("/api/terminal")) ws.close(4001, "fixture reconnect");
  });
  await a.waitForFunction(
    () =>
      window.transportSockets.filter((ws) => ws.url.includes("/api/terminal")).length >= 2 &&
      window.transportSockets.at(-1).readyState === 1,
  );
  await barrier(a, "r");
  assert.equal(await replyCount(), 1, "reconnect answered historical query");
  assert.equal((await state()).workspaces[0].tabs[0].pid, pid);
  for (const context of contexts.splice(0)) await context.close();
  // Observe the production terminal after it buffers output, not the fixture's write.
  await until(() => app.terminal.clients.size === 0, "viewers did not detach");
  const terminal = app.terminal,
    send = terminal.send;
  let offlineBytes = "";
  const offlineReceipt = new Promise((resolve) => {
    terminal.send = function (message) {
      send.call(this, message);
      if (message.type !== "output") return;
      assert.equal(this.clients.size, 0, "offline output had an attached viewer");
      offlineBytes += Buffer.from(message.data, "base64").toString("latin1");
      // biome-ignore lint/suspicious/noControlCharactersInRegex: PTY cursor query, with ONLCR newlines.
      if (/OFFLINE\r+\n\x1b\[6n/.test(offlineBytes)) resolve(message.seq);
    };
  });
  let offlineSequence;
  try {
    await appendFile(output, "OFFLINE\r\n\x1b[6n");
    offlineSequence = await within(offlineReceipt, 15000, "Server did not consume offline query");
    assert(
      terminal.chunks.some((chunk) => chunk.seq === offlineSequence),
      "offline receipt was not buffered",
    );
    assert.equal(await replyCount(), 1, "offline query was answered before resume");
  } finally {
    terminal.send = send;
  }
  const resumed = await viewer();
  await barrier(resumed, "s");
  await until(async () => (await replyCount()) === 2, "offline query did not complete exactly once");

  const content = "\u00E9\u{1f9ea}paste\r/live\r".repeat(15000);
  const beforePaste = (await rawInput()).length;
  await resumed.locator('.terminal-pane:not([hidden]) [contenteditable="true"]').evaluate((element, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", text);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, content);
  const expected = Buffer.from("\x1b[200~" + content + "\x1b[201~");
  await until(
    async () => withoutLabels((await rawInput()).subarray(beforePaste)).length >= expected.length,
    "large paste lost bytes",
  );
  const pasted = (await rawInput()).subarray(beforePaste);
  assert.deepEqual(withoutLabels(pasted), expected);
  const packet = pasted.toString("latin1");
  const start = packet.indexOf("\x1b[200~"),
    end = packet.indexOf("\x1b[201~");
  for (const label of packet.matchAll(inputLabels)) {
    assert(label.index < start || label.index > end, "label inserted inside paste");
    assert(!label[2], "paste minted a command ticket");
  }
  await barrier(resumed, "x");
  const port = Number(new URL(app.origin).port);
  await app.stop();
  app = startWebServer({ ...options, port });
  await resumed.getByRole("heading", { name: "Access required", exact: true }).waitFor();
  const socketCount = await resumed.evaluate(() => window.transportSockets.length);
  await resumed.waitForTimeout(2200); // Longer than two retry intervals: there must be no retry.
  assert.equal(await resumed.evaluate(() => window.transportSockets.length), socketCount);
  console.log(
    JSON.stringify({
      pass: true,
      pasteBytes: expected.length,
      sharedReplies: "once",
      offlineQuery: "buffered with zero viewers, then answered once",
      offlineSequence,
      reconnect: "same PID",
      expiredAccess: "stopped",
      scope: "raw PTY; no providers or audio devices",
    }),
  );
} finally {
  try {
    await closeProbeBrowser(browser);
  } finally {
    try {
      if (app) await within(app.stop(), 5000, "Server cleanup timed out");
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}
