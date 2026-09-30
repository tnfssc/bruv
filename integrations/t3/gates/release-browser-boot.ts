#!/usr/bin/env bun
// Black-box boot check: no source server, user state, or provider credentials.
// RELEASE_BOOT_PLAYWRIGHT may point to playwright-core/index.mjs.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const binary = resolve(process.argv[2] || "dist/release/die-linux-x64");
const proofPath = resolve(process.env.RELEASE_BOOT_PROOF || "artifacts/release/browser-boot.json");
const temp = await mkdtemp(join(tmpdir(), "die-release-boot-"));
const errors: string[] = [];
const canceledTelemetry: string[] = [];
const passes: { navigation: string; surface: string }[] = [];
let output = "";
let backend: ChildProcess | undefined;
let browser: any;
let page: any;
let binarySha256: string | undefined;
let failure: string | undefined;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
async function waitFor(fn: () => Promise<boolean>, label: string) {
  const deadline = Date.now() + 45000;
  do {
    check(!errors.length, errors.join("\n"));
    check(!backend || (backend.exitCode === null && backend.signalCode === null), "release binary exited before " + label);
    if (await fn()) return;
    await sleep(100);
  } while (Date.now() < deadline);
  throw new Error("timed out waiting for " + label);
}
try {
  binarySha256 = createHash("sha256").update(await readFile(binary)).digest("hex");
  const home = join(temp, "home");
  const workspace = join(temp, "workspace");
  const agent = join(temp, "agent");
  for (const dir of [home, workspace, agent]) await mkdir(dir, { recursive: true });
  check(spawnSync("/usr/bin/git", ["init", "--quiet", workspace]).status === 0, "temporary git init failed");
  const reserve = createServer();
  reserve.listen(0, "127.0.0.1");
  await once(reserve, "listening");
  const port = (reserve.address() as { port: number }).port;
  await new Promise<void>((r) => reserve.close(() => r()));
  const origin = "http://127.0.0.1:" + port;
  backend = spawn(binary, ["web", "--no-browser", "--host", "127.0.0.1", "--port", String(port),
    "--base-dir", join(temp, "web"), "--auto-bootstrap-project-from-cwd"], {
    cwd: workspace, detached: true, stdio: ["ignore", "pipe", "pipe"],
    env: {
      HOME: home, TMPDIR: temp, PATH: "/usr/bin:/bin", LANG: "C.UTF-8",
      XDG_CACHE_HOME: join(temp, "cache"), XDG_STATE_HOME: join(temp, "state"),
      XDG_CONFIG_HOME: join(temp, "config"), XDG_DATA_HOME: join(temp, "data"),
      PI_CODING_AGENT_DIR: agent, DIE_CODING_AGENT_DIR: agent,
      DIE_WEB_DIE_BINARY: binary, HERDR_ENV: "0",
    },
  });
  backend.on("error", (e) => errors.push("binary launch: " + e.message));
  for (const stream of [backend.stdout!, backend.stderr!])
    stream.on("data", (data) => { output = (output + data.toString()).slice(-100000); });
  await waitFor(async () => {
    try { return (await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok; }
    catch { return false; }
  }, "packaged HTTP listener");
  const { chromium } = await import(process.env.RELEASE_BOOT_PLAYWRIGHT || "playwright-core");
  browser = await chromium.launch({
    headless: true, executablePath: process.env.RELEASE_BOOT_CHROMIUM || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  // Attach BEFORE goto, including failed module/chunk loads during the first boot.
  page.on("pageerror", (e: Error) => errors.push("pageerror: " + e.message));
  page.on("console", (msg: any) => { if (msg.type() === "error") errors.push("console: " + msg.text()); });
  page.on("requestfailed", (req: any) => {
    const error = req.failure()?.errorText;
    // Telemetry cancels in-flight exports during cleanup/reload. This is not a
    // missing app asset. Keep every other failed request fatal.
    if (error === "net::ERR_ABORTED" && new URL(req.url()).pathname === "/api/observability/v1/traces") {
      canceledTelemetry.push(req.url());
      return;
    }
    errors.push("requestfailed: " + req.url() + " " + error);
  });
  page.on("response", (res: any) => {
    if (res.status() >= 400) errors.push("HTTP " + res.status() + ": " + res.url());
  });
  for (const navigation of ["initial", "reload"]) {
    if (navigation === "initial") await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 45000 });
    else await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 });
    let surface = "";
    const ready = async () => {
      surface = "";
      const text = await page.locator("body").innerText();
      check(!/T3 Code could not load|failed to load|something went wrong/i.test(text), "visible boot failure: " + text);
      check(!(await page.locator("#boot-error").isVisible()), "boot error is visible");
      if (await page.locator("#boot-shell").count()) return false;
      const setup = page.getByRole("dialog").filter({ has: page.getByText("Set up T3 Code", { exact: true }) });
      if (await setup.isVisible() && await setup.getByRole("button", { name: "Continue", exact: true }).isVisible())
        surface = "setup";
      else if (await page.getByText("New thread", { exact: true }).first().isVisible()
        || await page.locator('[data-chat-provider-model-picker="true"]').first().isVisible())
        surface = "app";
      return !!surface;
    };
    await waitFor(ready, navigation + " real setup/app with splash removed");
    // Let startup effects report errors; don't pass at the first paint alone.
    await sleep(1500);
    check(!errors.length, errors.join("\n"));
    check(await ready(), navigation + " setup/app disappeared after paint");
    check(backend.exitCode === null && backend.signalCode === null, "release binary exited after paint");
    passes.push({ navigation, surface });
  }
  console.log("release browser boot: PASS " + binarySha256);
} catch (e) {
  failure = String(e);
  console.error("release browser boot: FAIL " + failure);
  console.error(output);
  process.exitCode = 1;
} finally {
  await mkdir(dirname(proofPath), { recursive: true });
  const visibleText = page ? await page.locator("body").innerText().catch(() => "") : "";
  if (page && failure) await page.screenshot({ path: proofPath + ".png" }).catch(() => {});
  await writeFile(proofPath, JSON.stringify({ passed: !failure, binary, binarySha256, passes,
    errors, canceledTelemetry, failure, visibleText, serverOutput: output }, null, 2) + "\n");
  if (browser) await browser.close().catch(() => {});
  if (backend?.pid) {
    try { process.kill(-backend.pid, "SIGTERM"); } catch {}
    await Promise.race([once(backend, "exit"), sleep(3000)]).catch(() => {});
    try { process.kill(-backend.pid, "SIGKILL"); } catch {}
  }
  await rm(temp, { recursive: true, force: true });
}
