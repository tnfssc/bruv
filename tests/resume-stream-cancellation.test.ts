import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { text } from "node:stream/consumers";

const root = resolve(import.meta.dir, "..");
const manager = resolve(root, "node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js");
const script = String.raw`import { SessionManager } from __MANAGER__;
import { mkdir, writeFile } from "node:fs/promises";
import { ENV_AGENT_DIR } from __CONFIG__;

async function writeScanFixtures(root, dir) {
  await mkdir(dir, { recursive: true });
  await mkdir(dir + "/unreadable.jsonl"); // A real read error must still skip only this entry.
  const header = JSON.stringify({type: "session", version: 3, id: "fixture", timestamp: "2026-10-01T00:00:00Z", cwd: root});
  const message = JSON.stringify({type: "message", id: "m", parentId: null, message: {role: "user", content: [{type: "text", text: "fixture"}]}});
  // Invalid headers return before EOF. Leave enough data queued to expose late stream errors.
  await writeFile(dir + "/invalid.jsonl", JSON.stringify({type: "message"}) + "\n" + ("x".repeat(4096) + "\n").repeat(300));
  await writeFile(dir + "/valid.jsonl", header + "\n" + message + "\n");
}

async function expectActiveCancellation(scan, controller) {
  try {
    await scan(() => controller.abort());
  } catch (error) {
    if (error.name !== "AbortError" || !controller.signal.aborted) throw error;
    return;
  }
  throw new Error("Expected cancellation");
}

const root = __DIR__;
const all = __ALL__;
const mode = __MODE__;
process.env[ENV_AGENT_DIR] = root;
const dir = all ? root + "/sessions/project" : root;
await writeScanFixtures(root, dir);

const controller = new AbortController();
const scan = (progress) => all
  ? SessionManager.listAll(progress, controller.signal)
  : SessionManager.list(root, dir, progress, controller.signal);
if (mode === "active") {
  await expectActiveCancellation(scan, controller);
} else {
  const sessions = await scan();
  if (sessions.length !== 1 || sessions[0].firstMessage !== "fixture") throw new Error("Wrong session result");
  if (mode === "late") controller.abort();
}
// Give late stream errors time to surface before reporting a clean process exit.
await Bun.sleep(100);
console.log("scan complete");`;

async function runScanProcess(code: string, env: Record<string, string>) {
  const child = spawn(process.execPath, ["--eval", code], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  const [stdout, stderr, exitCode] = await Promise.all([text(child.stdout), text(child.stderr), exited]);
  return { code: exitCode, stdout, stderr };
}

async function scan(mode: "late" | "active" | "normal", all = false) {
  // Retain the owned fixture and environment directories for parent gate inspection.
  const dir = await mkdtemp(join(tmpdir(), "bruv-resume-stream-"));
  const env = {
    HOME: await mkdtemp(join(dir, "home-")),
    XDG_CONFIG_HOME: await mkdtemp(join(dir, "config-")),
    PI_CODING_AGENT_DIR: await mkdtemp(join(dir, "sdk-")),
    TMPDIR: await mkdtemp(join(dir, "tmp-")),
    HERDR_ENV: "0",
  };
  const code = script
    .replace("__MANAGER__", JSON.stringify(manager))
    .replace("__CONFIG__", JSON.stringify(resolve(manager, "../../config.js")))
    .replace("__DIR__", JSON.stringify(env.PI_CODING_AGENT_DIR))
    .replace("__MODE__", JSON.stringify(mode))
    .replace("__ALL__", JSON.stringify(all));
  return await runScanProcess(code, env);
}

for (const all of [false, true]) {
  const scope = all ? "all folders" : "current folder";
  test("resume scan handles late cancellation after an invalid header: " + scope, async () => {
    expect(await scan("late", all)).toEqual({ code: 0, stdout: "scan complete\n", stderr: "" });
  });
  test("resume scan still rejects active cancellation: " + scope, async () => {
    expect(await scan("active", all)).toEqual({ code: 0, stdout: "scan complete\n", stderr: "" });
  });
}
test("resume scan skips invalid headers without losing valid sessions", async () => {
  expect(await scan("normal")).toEqual({ code: 0, stdout: "scan complete\n", stderr: "" });
});
