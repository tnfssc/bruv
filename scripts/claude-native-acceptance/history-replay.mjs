if (!process.env.T3_UPSTREAM || !process.env.BROWSER_PATH)
  throw Error("Set T3_UPSTREAM and BROWSER_PATH explicitly for native acceptance");
import fs from "node:fs/promises";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

// History acceptance always launches the actual connector through a transparent tap.
const integration = await import("./history-driver.mjs");
const config = JSON.parse(await fs.readFile(process.env.BRUV_ACCEPTANCE_CONFIG, "utf8"));
const upstream = path.resolve(process.env.T3_UPSTREAM);
const binary = path.join(upstream, "platform/t3");
const browserPath = process.env.BROWSER_PATH;
const port = Number(process.env.FIXTURE_PORT || "18783");
const url = "http://127.0.0.1:" + port;
const root = config
  ? path.join(path.dirname(config.state), "t3-runtime")
  : path.resolve(".cache/claude-native-ui-replay");
const proof = path.resolve(process.env.PROOF_OUTPUT || ".cache/claude-native-ui-replay-proof-" + Date.now());
const home = path.join(root, "home");
const project = path.join(root, "project");
const base = path.join(root, "t3-base");
const fixture = config?.tap;
// The runner supplies an explicit credential-free environment, never the parent environment.
const env = {
  PATH: [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter),
  HOME: home,
  ...config?.env,
};
const before = await binaryHash();
assert.equal(
  before,
  process.env.T3_EXPECTED_SHA256 ?? "2cc42990ee8ad2ff30bbd43cdcf67686c9ca5aaff5e3ed36b5be40962cc53795",
  "pinned actual T3 artifact",
);
let version;

// Acquisition is exclusive. Only a successfully acquired root enters owned cleanup.
await fs.mkdir(root, { mode: 0o700 });
try {
  await prepareRuntime();
  version = execFileSync(binary, ["--version"], { env, encoding: "utf8" }).trim();
  await replayWithServer();
  console.log("PASS actual native history replay. Proof: " + proof);
} catch (error) {
  await fs.writeFile(
    path.join(proof, "result.json"),
    JSON.stringify(
      {
        integratedAcceptance: true,
        passed: false,
        error: error.message,
        t3Version: version,
        t3BinarySha256: before,
        upstreamUnmodified: (await binaryHash()) === before,
        syntheticConnectorEvents: false,
        realCredentialsUsed: false,
      },
      null,
      2,
    ) + "\n",
  );
  throw error;
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

async function binaryHash() {
  return createHash("sha256")
    .update(await fs.readFile(binary))
    .digest("hex");
}

async function prepareRuntime() {
  await fs.mkdir(home);
  await fs.mkdir(project);
  await fs.writeFile(
    path.join(project, "README.md"),
    "# Isolated native connector acceptance project\nActual Bruv runtime with a deterministic loopback test model.\n",
  );
  await integration.prepare({ base, fixture, config });
  const git = (args) => execFileSync("/usr/bin/git", ["-C", project, ...args], { env, stdio: "pipe" });
  git(["init", "-q"]);
  git(["add", "README.md"]);
  git([
    "-c",
    "user.name=Research fixture",
    "-c",
    "user.email=fixture@localhost",
    "commit",
    "-qm",
    "Initialize fixture project",
  ]);
}

async function replayWithServer() {
  const log = await fs.open(path.join(root, "private-server.log"), "w", 0o600);
  try {
    const server = spawn(
      binary,
      [
        "serve",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--base-dir",
        base,
        "--auto-bootstrap-project-from-cwd",
        project,
      ],
      { env, stdio: ["ignore", log.fd, log.fd] },
    );
    const closed = new Promise((resolve) => server.once("close", resolve));
    try {
      await new Promise((resolve, reject) => {
        server.once("spawn", resolve);
        server.once("error", reject);
      });
      await waitForServer(server);
      await replayWithBrowser();
    } finally {
      await stopServer(server, closed);
    }
  } finally {
    await log.close();
  }
}

async function waitForServer(server) {
  for (let i = 0; i < 200; i++) {
    if (server.exitCode !== null || server.signalCode !== null)
      throw Error("T3 exited before readiness; private log retained only until cleanup");
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(300) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail("T3 local HTTP readiness");
}

async function stopServer(server, closed) {
  if (server.exitCode === null && server.signalCode === null) {
    server.kill("SIGTERM");
    let timer;
    try {
      await Promise.race([
        closed,
        new Promise((resolve) => {
          timer = setTimeout(resolve, 3000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (server.exitCode === null && server.signalCode === null) server.kill("SIGKILL");
  }
  // Wait for actual close before closing its log or deleting private state.
  await closed;
}

async function replayWithBrowser() {
  const { chromium } = await import(
    pathToFileURL(path.join(upstream, "runtime/node_modules/playwright/index.mjs")).href
  );
  const browser = await chromium.launch({
    headless: true,
    executablePath: browserPath,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    const page = await context.newPage();
    try {
      await exerciseHistory(page);
    } catch (error) {
      await capturePageFailure(page);
      throw error;
    }
  } finally {
    await browser.close();
  }
}

async function exerciseHistory(page) {
  page.setDefaultTimeout(10000);
  const paired = execFileSync(binary, ["pair", "--base-dir", base], { env, encoding: "utf8" });
  const token = paired.match(/token=([A-Za-z0-9_-]+)/)?.[1];
  assert.ok(token, "local pairing token (never exported)");
  await page.goto(url + "/pair#token=" + token);
  await page.waitForTimeout(1500);
  // Normal native first-run flow, without external sign-in, installation, or license bypass.
  await page.getByText("Connect your computers", { exact: true }).waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByText("Connect your agents", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Do not import projects", exact: true }).click();
  await page.getByText("Set up T3 Code", { exact: true }).waitFor({ state: "hidden" });
  await page.goto(url + "/settings/providers");
  await page
    .getByRole("button", {
      name: "Select Bruv local deterministic acceptance (not Claude)",
      exact: true,
    })
    .click();
  const name = page.locator("#provider-instance-claudeAgent-display-name");
  await name.fill("Bruv local deterministic acceptance (not Claude)");
  await name.blur();
  await page.waitForTimeout(1500);
  const executable = page.locator("#provider-instance-claudeAgent-binaryPath");
  await executable.fill(fixture);
  await executable.blur();
  await integration.captureIdentity({ page, proof });
  await page.getByText("Authenticated", { exact: true }).first().waitFor();
  const body = () => page.locator("body").innerText();
  const snapshot = async (name) => {
    await fs.writeFile(
      path.join(proof, name + ".txt"),
      (await body()).replaceAll(root, "<RUNTIME>").replaceAll(path.dirname(config.state), "<SCOPED>"),
    );
    await page.screenshot({
      path: path.join(proof, name + ".png"),
      mask: [page.locator("#provider-instance-claudeAgent-binaryPath")],
    });
  };
  await snapshot("readiness");
  await page.goto(url);
  await page.waitForTimeout(1500);
  if (!(await page.getByRole("textbox", { name: "Message", exact: true }).isVisible())) {
    await page.getByRole("button", { name: "Add project", exact: true }).first().click();
    await page.waitForTimeout(500);
    await page.getByRole("option", { name: /Local folder/ }).click();
    const folder = page.getByPlaceholder("Enter path (e.g. ~/projects/my-app)", { exact: true });
    await folder.fill(project);
    await folder.press("Enter");
  }
  await page.getByRole("textbox", { name: "Message", exact: true }).waitFor();
  await integration.exercise({ page, url, snapshot, body, assert, config });
  const wire = (await fs.readFile(config.wire, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
  assert.equal(await binaryHash(), before);
  await integration.verify({ wire, config, proof, t3Version: version, t3BinarySha256: before });
}

async function capturePageFailure(page) {
  try {
    await page.screenshot({ path: path.join(proof, "failure.png") });
    await fs.writeFile(
      path.join(proof, "failure.txt"),
      (await page.locator("body").innerText())
        .replaceAll(root, "<RUNTIME>")
        .replaceAll(path.dirname(config.state), "<FIXTURE>"),
    );
  } catch {}
}
