/**
 * Linux/Bun, real compiled web backend + real Chromium, no paid providers.
 * BRUV_ROUTE_PROBE_BINARY=/absolute/dist/bruv
 * BRUV_ROUTE_PROBE_PLAYWRIGHT=/absolute/playwright-core/index.mjs (or "playwright")
 * BRUV_ROUTE_PROBE_CHROMIUM=/absolute/chrome (optional: Playwright's installed Chromium)
 * bun integrations/t3/upstream/browser-route-reload.probe.ts
 * Proof JSON, logs, screenshots and isolated userdata stay in the printed temporary directory.
 * Extracted runtime cache is removed after teardown; TMPDIR can select a roomier temp volume.
 */
import assert from "node:assert/strict";
import { execFile, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

// A small structural surface avoids adding Playwright to the product dependencies.
interface Queries {
  locator(selector: string): Locator;
  getByText(text: string, options?: { exact: boolean }): Locator;
  getByRole(role: string, options?: { name: string; exact: boolean }): Locator;
}
interface Locator extends Queries {
  first(): Locator;
  last(): Locator;
  filter(options: { has: Locator }): Locator;
  count(): Promise<number>;
  isVisible(): Promise<boolean>;
  innerText(): Promise<string>;
  click(): Promise<void>;
  fill(text: string): Promise<void>;
  waitFor(options?: { timeout?: number }): Promise<void>;
}
interface Page extends Queries {
  url(): string;
  goto(url: string, options: { waitUntil: "domcontentloaded" }): Promise<unknown>;
  reload(options: { waitUntil: "domcontentloaded" }): Promise<unknown>;
  screenshot(options: { path: string; fullPage: boolean }): Promise<unknown>;
  on(event: "pageerror", listener: (error: Error) => void): void;
  setDefaultTimeout(timeout: number): void;
}
interface Browser {
  newPage(options: { viewport: { width: number; height: number } }): Promise<Page>;
  close(): Promise<void>;
}
interface Playwright {
  chromium: {
    launch(options: {
      executablePath?: string;
      headless: boolean;
      args: string[];
      env: Record<string, string>;
    }): Promise<Browser>;
  };
}
interface ModelMessage {
  role: string;
  content?: unknown;
  tool_call_id?: string;
}
interface ModelRequest {
  model: string;
  messages: ModelMessage[];
}
interface ProcessRow {
  pid: number;
  ppid: number;
  pgid: number;
  command: string;
}
interface WebRecord {
  launcherPid: number;
  launcherPgid: number;
  port: number;
  web?: ProcessRow;
  exit?: { code: number | null; signal: NodeJS.Signals | null };
  spawnError?: string;
  stopSignal?: NodeJS.Signals;
  webExited?: boolean;
  listenerDown?: boolean;
}
interface Checkpoint {
  name: string;
  url: string;
  model: string;
  mode: string;
  settled: boolean;
  promptCount: number;
  responseCount: number;
  text: string;
}
interface Proof {
  passed: boolean;
  root: string;
  binary: string;
  home: string;
  agent: string;
  workspace: string;
  userdata: string;
  probePid: number;
  runs: WebRecord[];
  checkpoints: Checkpoint[];
  requests: ModelRequest[];
  pageErrors: string[];
  origin?: string;
  modelPort?: number;
  conversationUrl?: string;
  toolResponse?: ModelMessage;
  shellPid?: number;
  error?: string;
  failedUrl?: string;
  failureText?: string;
}
interface WebRun {
  launcher: ChildProcess;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  web?: ProcessRow;
  record: WebRecord;
}

const PROMPT = "Audit isolated browser prompt: return deterministic tool outcome.";
const RESPONSE = "AUDIT_BROWSER_RESPONSE_TOOL_OK";
const TOOL_OUTPUT = "AUDIT_TOOL_OUTCOME";
const exec = promisify(execFile);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function waitFor(check: () => Promise<boolean>, label: string, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  return address.port;
}
async function close(server: Server) {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
async function processes(): Promise<ProcessRow[]> {
  const { stdout } = await exec("/usr/bin/ps", ["-eo", "pid=,ppid=,pgid=,args="]);
  return stdout
    .trim()
    .split("\n")
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
      assert(match, "Unrecognized ps output");
      return { pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), command: match[4] };
    });
}
function signalGroup(pgid: number, signal: NodeJS.Signals) {
  assert(pgid > 1 && pgid !== process.pid, "Only signal an owned detached group");
  try {
    process.kill(-pgid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}
async function listenerDown(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("TCP check timed out"));
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      socket.destroy();
      if (error.code === "ECONNREFUSED") resolve(true);
      else reject(error);
    });
  });
}

assert.equal(process.platform, "linux", "The process-group audit uses Linux /proc and ps");
assert(process.env.BRUV_ROUTE_PROBE_BINARY, "Set BRUV_ROUTE_PROBE_BINARY to the compiled binary");
const binary = await realpath(process.env.BRUV_ROUTE_PROBE_BINARY);
// Keep the probe's own readiness fetch on loopback, regardless of caller proxies.
for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) {
  delete process.env[key];
}
const root = await mkdtemp(join(tmpdir(), "bruv-route-probe-"));
console.log(`Probe artifacts: ${root}`);
const home = join(root, "home");
const agent = join(root, "agent");
const workspace = join(root, "workspace");
const base = join(root, "web");
for (const path of [home, agent, workspace, join(base, "userdata")]) await mkdir(path, { recursive: true });
// Deliberately do not inherit credentials, proxies, web overrides, or user's PATH/HOME.
const env: Record<string, string> = {
  HOME: home,
  TMPDIR: root,
  PATH: "/usr/bin:/bin",
  LANG: "C.UTF-8",
  XDG_CACHE_HOME: join(root, "cache"),
  XDG_STATE_HOME: join(root, "state"),
  XDG_CONFIG_HOME: join(root, "config"),
  XDG_DATA_HOME: join(root, "data"),
  PI_CODING_AGENT_DIR: agent,
  BRUV_CODING_AGENT_DIR: agent,
  BRUV_WEB_BRUV_BINARY: binary,
  HERDR_ENV: "0",
};
const requests: ModelRequest[] = [];
const errors: string[] = [];
const proof: Proof = {
  passed: false,
  root,
  binary,
  home,
  agent,
  workspace,
  userdata: join(base, "userdata"),
  probePid: process.pid,
  runs: [],
  checkpoints: [],
  requests,
  pageErrors: errors,
};
let browser: Browser | undefined;
let page: Page | undefined;
let active: WebRun | undefined;
let serverLog = "";

const model = createServer(async (request, response) => {
  try {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/v1/chat/completions");
    let body = "";
    for await (const chunk of request) body += chunk.toString();
    const payload = JSON.parse(body) as ModelRequest;
    assert(["audit-a", "audit-b"].includes(payload.model), "Only local audit models are allowed");
    assert(Array.isArray(payload.messages));
    requests.push(payload);
    const tool = payload.messages.find((message) => message.role === "tool");
    if (tool) {
      assert.equal(payload.model, "audit-b");
      assert.equal(tool.tool_call_id, "audit-execute");
      assert.equal(typeof tool.content, "string");
      assert.match(String(tool.content), /exitCode: 0/);
      assert(String(tool.content).includes(`output: "${TOOL_OUTPUT}"`));
      assert(String(tool.content).includes(workspace));
      assert.equal(await readFile(join(workspace, "route-probe-tool.txt"), "utf8"), TOOL_OUTPUT);
      proof.toolResponse = tool;
      proof.shellPid = Number(String(tool.content).match(/pid:\s*(\d+)/)?.[1]);
      assert(Number.isInteger(proof.shellPid) && Number(proof.shellPid) > 1);
    }
    const delta = tool
      ? { role: "assistant", content: RESPONSE }
      : {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "audit-execute",
              type: "function",
              function: {
                name: "execute",
                arguments: JSON.stringify({
                  label: "Probe isolated shell",
                  code: 'console.log(await shell("printf AUDIT_TOOL_OUTCOME; printf AUDIT_TOOL_OUTCOME > route-probe-tool.txt", { waitSeconds: 10 }));',
                }),
              },
            },
          ],
        };
    const chunk = { id: "audit", object: "chat.completion.chunk", created: 1, model: payload.model };
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(
      "data: " +
        JSON.stringify({ ...chunk, choices: [{ index: 0, delta, finish_reason: null }] }) +
        "\n\n" +
        "data: " +
        JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: tool ? "stop" : "tool_calls" }] }) +
        "\n\n" +
        "data: [DONE]\n\n",
    );
  } catch (error) {
    errors.push(`Loopback model: ${String(error)}`);
    response.writeHead(500);
    response.end(String(error));
  }
});

async function startWeb(port: number, origin: string): Promise<WebRun> {
  const launcher = spawn(
    binary,
    [
      "web",
      "--no-browser",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--base-dir",
      base,
      "--auto-bootstrap-project-from-cwd",
    ],
    { cwd: workspace, detached: true, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  assert(launcher.pid, "Compiled launcher did not get a PID");
  const record: WebRecord = { launcherPid: launcher.pid, launcherPgid: launcher.pid, port };
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    launcher.once("error", reject);
    launcher.once("exit", (code, signal) => {
      record.exit = { code, signal };
      resolve({ code, signal });
    });
  });
  // Keep spawn errors handled even if HTTP readiness fails first.
  void exited.catch((error) => {
    record.spawnError = String(error);
  });
  const run: WebRun = { launcher, exited, record };
  active = run;
  proof.runs.push(record);
  for (const stream of [launcher.stdout, launcher.stderr])
    stream?.on("data", (data: Buffer) => {
      serverLog += data.toString();
    });
  await waitFor(
    async () => {
      if (launcher.exitCode !== null || launcher.signalCode !== null || record.spawnError) {
        throw new Error(`Compiled web launcher exited before readiness: ${JSON.stringify(record)}`);
      }
      try {
        return (await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok;
      } catch {
        return false;
      }
    },
    "compiled web HTTP readiness",
    60_000,
  );
  const children = (await processes()).filter((row) => row.ppid === launcher.pid && row.pid === row.pgid);
  assert.equal(children.length, 1, "Expected one detached compiled web backend, not only its launcher");
  const web = children[0];
  assert.equal(await realpath(`/proc/${web.pid}/exe`), binary, "Listener backend must be the actual compiled binary");
  run.web = web;
  record.web = web;
  console.log(`Compiled web PID ${web.pid} / PGID ${web.pgid} (launcher ${launcher.pid})`);
  return run;
}
async function stopWeb(run: WebRun, port: number) {
  assert(run.web, "Actual compiled web process must be identified before restart");
  signalGroup(run.web.pgid, "SIGTERM");
  run.record.stopSignal = "SIGTERM";
  try {
    await waitFor(
      async () => !(await processes()).some((row) => row.pid === run.web?.pid),
      "compiled web exit",
      10_000,
    );
  } catch {
    signalGroup(run.web.pgid, "SIGKILL");
    run.record.stopSignal = "SIGKILL";
  }
  await waitFor(
    async () => !(await processes()).some((row) => row.pid === run.web?.pid),
    "compiled web exit after signal",
  );
  await waitFor(async () => run.launcher.exitCode !== null || run.launcher.signalCode !== null, "launcher exit");
  await run.exited;
  await waitFor(() => listenerDown(port), "TCP listener down");
  run.record.webExited = true;
  run.record.listenerDown = true;
  active = undefined;
}
async function checkpoint(name: string, conversationUrl: string) {
  assert(page);
  const current = page;
  const picker = current.locator('[data-chat-provider-model-picker="true"]').first();
  await waitFor(async () => {
    return (
      (await current.getByText(RESPONSE, { exact: true }).first().isVisible()) &&
      (await current.getByText(PROMPT, { exact: true }).first().isVisible()) &&
      (await picker.isVisible()) &&
      (await picker.innerText()) === "Audit Beta" &&
      (await current.getByRole("button", { name: "normal", exact: true }).isVisible()) &&
      (await current.getByRole("button", { name: "Stop generation", exact: true }).count()) === 0
    );
  }, `${name}: retained history/model/mode and settled turn`);
  assert.equal(current.url(), conversationUrl, `${name}: exact conversation URL`);
  assert.equal(await current.getByText(PROMPT, { exact: true }).count(), 1);
  assert.equal(await current.getByText(RESPONSE, { exact: true }).count(), 1);
  assert(proof.toolResponse, "A real successful shell tool response must precede the answer");
  const record = {
    name,
    url: current.url(),
    model: await picker.innerText(),
    mode: "normal",
    settled: true,
    promptCount: 1,
    responseCount: 1,
    text: await current.locator("body").innerText(),
  };
  proof.checkpoints.push(record);
  await current.screenshot({ path: join(root, `${name}.png`), fullPage: true });
  console.log(`${name}: ${current.url()}`);
}

try {
  const git = spawnSync("/usr/bin/git", ["init", "--quiet", workspace], { env });
  assert.equal(git.status, 0, "Initialize only the temporary workspace");
  const modelPort = await listen(model);
  proof.modelPort = modelPort;
  await writeFile(
    join(agent, "models.json"),
    JSON.stringify({
      providers: {
        loopback: {
          baseUrl: `http://127.0.0.1:${modelPort}/v1`,
          api: "openai-completions",
          apiKey: "fixture-only",
          models: [
            { id: "audit-a", name: "Audit Alpha", contextWindow: 32000, maxTokens: 2000 },
            { id: "audit-b", name: "Audit Beta", contextWindow: 32000, maxTokens: 2000 },
          ],
        },
      },
    }),
  );
  await writeFile(
    join(agent, "settings.json"),
    JSON.stringify({
      defaultProvider: "loopback",
      defaultModel: "audit-a",
      defaultThinkingLevel: "off",
    }),
  );
  await writeFile(
    join(base, "userdata/settings.json"),
    JSON.stringify({
      providerInstances: {
        pi: { driver: "pi", config: { binaryPath: binary, customModels: ["loopback/audit-a", "loopback/audit-b"] } },
      },
    }),
  );
  const reserve = createServer();
  const port = await listen(reserve);
  await close(reserve);
  const origin = `http://127.0.0.1:${port}`;
  proof.origin = origin;
  const first = await startWeb(port, origin);
  const moduleName = process.env.BRUV_ROUTE_PROBE_PLAYWRIGHT ?? "playwright";
  const playwright = (await import(isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName)) as Playwright;
  browser = await playwright.chromium.launch({
    executablePath: process.env.BRUV_ROUTE_PROBE_CHROMIUM,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    env,
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15_000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  // Fresh first-run onboarding; do not import real projects or connect computers.
  const setup = page.getByRole("dialog").filter({ has: page.getByText("Set up T3 Code", { exact: true }) });
  const composer = page.locator('[data-chat-provider-model-picker="true"]').first();
  await waitFor(async () => (await setup.isVisible()) || (await composer.isVisible()), "onboarding or composer");
  if (await setup.isVisible()) {
    await setup.getByText("Connect your computers", { exact: true }).waitFor();
    await setup.getByRole("button", { name: "Continue", exact: true }).click();
    await setup.getByRole("button", { name: "Continue", exact: true }).click();
    await setup.getByRole("button", { name: "Do not import projects", exact: true }).click();
  }
  const picker = page.locator('[data-chat-provider-model-picker="true"]').first();
  await picker.waitFor();
  await picker.click();
  await page.getByText("Audit Beta", { exact: true }).last().click();
  await page.getByRole("button", { name: "orchestrator", exact: true }).click();
  await page.getByText("normal", { exact: true }).last().click();
  assert.equal(await picker.innerText(), "Audit Beta");
  assert(await page.getByRole("button", { name: "normal", exact: true }).isVisible());
  await page.locator('[contenteditable="true"]').first().fill(PROMPT);
  await page.locator('button[type="submit"]').last().click();
  await page.getByText(RESPONSE, { exact: true }).first().waitFor({ timeout: 30_000 });
  // Pin the concrete server/thread route once; never replace it with a fallback URL.
  const conversationUrl = page.url();
  const url = new URL(conversationUrl);
  assert.equal(url.origin, origin);
  assert.match(url.pathname, /^\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/i, "Expected server/thread conversation route");
  assert.equal(conversationUrl, origin + url.pathname, "No search/hash or temporary root route");
  proof.conversationUrl = conversationUrl;
  await checkpoint("settled", conversationUrl);
  await page.reload({ waitUntil: "domcontentloaded" });
  await checkpoint("page-reload", conversationUrl);
  await stopWeb(first, port);
  const second = await startWeb(port, origin);
  assert.notEqual(second.web?.pid, first.web?.pid, "Restart must create a new actual web process");
  // Still on the SAME page and exact URL; no root navigation or recreated conversation.
  assert.equal(page.url(), conversationUrl);
  await page.reload({ waitUntil: "domcontentloaded" });
  await checkpoint("process-restart-reload", conversationUrl);
  assert.equal(errors.length, 0, `No browser/model errors: ${errors.join("; ")}`);
  proof.passed = true;
} catch (error) {
  proof.error = error instanceof Error ? error.stack : String(error);
  if (page) {
    proof.failedUrl = page.url();
    proof.failureText = await page
      .locator("body")
      .innerText()
      .catch(() => "<unavailable>");
    await page.screenshot({ path: join(root, "failure.png"), fullPage: true }).catch(() => {});
  }
} finally {
  try {
    await browser?.close();
  } catch (error) {
    errors.push(`Browser cleanup: ${String(error)}`);
  }
  try {
    if (active) {
      if (active.web) await stopWeb(active, active.record.port);
      else {
        // Partial startup: the launcher forwards TERM to its separately owned backend group.
        const run = active;
        assert(run.launcher.pid);
        signalGroup(run.launcher.pid, "SIGTERM");
        await waitFor(
          async () => run.launcher.exitCode !== null || run.launcher.signalCode !== null,
          "partial launcher exit",
        );
        await run.exited;
        active = undefined;
      }
    }
  } catch (error) {
    errors.push(`Web cleanup: ${String(error)}`);
  }
  try {
    await close(model);
  } catch (error) {
    errors.push(`Model cleanup: ${String(error)}`);
  }
  if (!active) {
    // Repeated probes otherwise retain hundreds of MB of identical extracted runtime files.
    await rm(join(root, "cache"), { recursive: true, force: true }).catch((error) => {
      errors.push(`Cache cleanup: ${String(error)}`);
    });
  }
  if (errors.length) proof.passed = false;
  await writeFile(join(root, "server.log"), serverLog);
  await writeFile(join(root, "proof.json"), `${JSON.stringify(proof, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        passed: proof.passed,
        proof: join(root, "proof.json"),
        conversationUrl: proof.conversationUrl,
        error: proof.error,
        errors,
      },
      null,
      2,
    ),
  );
  process.exitCode = proof.passed ? 0 : 1;
}
