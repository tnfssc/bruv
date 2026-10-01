import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "./helpers";

const root = resolve(import.meta.dir, "..");
const manager = resolve(root, "node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js");
const script = String.raw`import { SessionManager } from __MANAGER__;
import { mkdir, writeFile } from "node:fs/promises";
import { ENV_AGENT_DIR } from __CONFIG__;
const root = __DIR__;
const all = __ALL__;
const mode = __MODE__;
process.env[ENV_AGENT_DIR] = root;
const dir = all ? root + "/sessions/project" : root;
await mkdir(dir, { recursive: true });
await mkdir(dir + "/unreadable.jsonl"); // A real read error must still skip only this entry.
const header = JSON.stringify({type: "session", version: 3, id: "fixture", timestamp: "2026-10-01T00:00:00Z", cwd: root});
const message = JSON.stringify({type: "message", id: "m", parentId: null, message: {role: "user", content: [{type: "text", text: "fixture"}]}});
// Invalid headers return before EOF. Leave enough data queued to expose late stream errors.
await writeFile(dir + "/invalid.jsonl", JSON.stringify({type: "message"}) + "\n" + ("x".repeat(4096) + "\n").repeat(300));
await writeFile(dir + "/valid.jsonl", header + "\n" + message + "\n");
const controller = new AbortController();
const progress = mode === "active" ? () => controller.abort() : undefined;
try {
  const sessions = await (all ? SessionManager.listAll(progress, controller.signal) : SessionManager.list(root, dir, progress, controller.signal));
  if (mode === "active") throw new Error("Expected cancellation");
  if (sessions.length !== 1 || sessions[0].firstMessage !== "fixture") throw new Error("Wrong session result");
} catch (error) {
  if (mode !== "active" || error.name !== "AbortError" || !controller.signal.aborted) throw error;
}
if (mode === "late") controller.abort();
await Bun.sleep(100);
console.log("scan complete");`;

async function scan(mode: "late" | "active" | "normal", all = false) {
  const dir = await mkdtemp(join(tmpdir(), "die-resume-stream-"));
  try {
    const code = script
      .replace("__MANAGER__", JSON.stringify(manager))
      .replace("__CONFIG__", JSON.stringify(resolve(manager, "../../config.js")))
      .replace("__DIR__", JSON.stringify(dir))
      .replace("__MODE__", JSON.stringify(mode))
      .replace("__ALL__", JSON.stringify(all));
    return await run([process.execPath, "--eval", code], { cwd: root });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
