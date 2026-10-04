/** Optional offline reference capture. Requires tmux, unshare and an already built Bruv. */
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const binary = process.env.BRUV_BINARY,
  sdk = process.env.PI_SDK_ENTRY;
if (!binary || !sdk) throw new Error("Set BRUV_BINARY and PI_SDK_ENTRY to reviewed local files");
const { SessionManager } = await import(pathToFileURL(sdk).href);
const home = await mkdtemp(join(tmpdir(), "bruv-demo-reference-"));
const socket = "bruv-site-" + process.pid;
const run = (args: string[]) => {
  const p = Bun.spawnSync(["tmux", "-L", socket, ...args]);
  if (p.exitCode) throw new Error(p.stderr.toString());
  return p.stdout.toString();
};
const q = (s: string) => "'" + s.replaceAll("'", "'\"'\"'") + "'";
const out = resolve(import.meta.dir, "../../wisdom/landing-page/validation/animated-features/source");
await mkdir(out, { recursive: true });
try {
  await mkdir(join(home, ".bruv/agent"), { recursive: true });
  await Bun.write(join(home, ".bruv/agent/settings.json"), JSON.stringify({ theme: "dark" }));
  const session = SessionManager.create(home, join(home, "sessions"));
  const usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  const assistant = (content: any[]) =>
    session.appendMessage({
      role: "assistant",
      content,
      api: "openai-completions",
      provider: "openai",
      model: "gpt-4o",
      usage,
      stopReason: "stop",
      timestamp: 0,
    });
  session.appendMessage({
    role: "user",
    content: "Fix CSV imports in a worktree. I'll keep working on export.",
    timestamp: 0,
  });
  assistant([{ type: "text", text: "I'll give the CSV fix its own Git worktree." }]);
  session.appendCustomMessageEntry("task-complete", "1 asynchronous task completed.\ntask_demo completed", true, {
    tasks: [{ id: "task_demo", title: "Fix CSV import", status: "completed", exitCode: 0 }],
    attention: [],
    omittedTasks: 0,
    omittedAttention: 0,
  });
  assistant([
    {
      type: "toolCall",
      id: "review",
      name: "execute",
      arguments: { label: "Review helper diff", code: "// Offline UI fixture; no command executed" },
    },
  ]);
  session.appendMessage({
    role: "toolResult",
    toolCallId: "review",
    toolName: "execute",
    content: [{ type: "text", text: "Execution completed with exit code 0." }],
    details: { exitCode: 0, stdout: "", stderr: "", images: [] },
    isError: false,
    timestamp: 0,
  });
  assistant([
    {
      type: "text",
      text: "CSV import now streams rows. Regression tests pass. The fix is on its own branch; review the diff before merging.",
    },
  ]);
  const command = [
    "env",
    "-i",
    "HOME=" + home,
    "PATH=/usr/bin:/bin",
    "TERM=xterm-256color",
    "COLORTERM=truecolor",
    "LANG=C.UTF-8",
    "BRUV_CODING_AGENT_DIR=" + join(home, ".bruv/agent"),
    "unshare",
    "--user",
    "--map-root-user",
    "--net",
    binary,
    "--tui-mode",
    "fullscreen",
    "--offline",
    "--no-approve",
    "--session",
    session.getSessionFile(),
    "--provider",
    "openai",
    "--model",
    "gpt-4o",
  ]
    .map(q)
    .join(" ");
  run(["new-session", "-d", "-s", "demo", "-x", "80", "-y", "32", "-c", home, command]);
  await Bun.sleep(1800);
  for (const cols of [80, 38]) {
    run(["resize-window", "-t", "demo", "-x", String(cols), "-y", "32"]);
    await Bun.sleep(300);
    const raw = run(["capture-pane", "-t", "demo", "-p", "-e"]);
    if (!raw.includes("1 tool called")) throw new Error("Expected reference UI did not load: " + raw);
    await Bun.write(join(out, "offline-" + cols + ".ansi"), raw.replaceAll(home, "/demo-project").replaceAll(home.split("/").at(-1)!, "csv-app"));
  }
  await Bun.write(
    join(out, "provenance.json"),
    JSON.stringify(
      {
        script: "site/scripts/capture-demo-source.ts",
        binarySha256: new Bun.CryptoHasher("sha256").update(await Bun.file(binary).arrayBuffer()).digest("hex"),
        kind: "Offline scripted session replay in the real compiled TUI",
        network: "unshare network namespace; --offline; empty environment and isolated HOME",
        commandsExecuted: false,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("Saved real offline UI reference at " + out);
} finally {
  try {
    run(["kill-server"]);
  } catch {}
  await rm(home, { recursive: true, force: true });
}
