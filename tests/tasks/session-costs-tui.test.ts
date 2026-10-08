import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { capturePane, frameContaining as waitForText, shellQuote as quote, tmuxRunner } from "../helpers/tui-helpers";

test("real footer includes nested costs, updates while idle, and restores on resume", async () => {
  const home = await mkdtemp(join(tmpdir(), "bruv-cost-pty-"));
  const socket = "bruv-cost-" + process.pid + "-" + Date.now();
  const tmux = tmuxRunner(socket);
  const frameContaining = (text: string) =>
    waitForText(async () => (await capturePane(tmux, "cost")).stdout, text, 100);
  const append = (session: SessionManager, cost: number) =>
    session.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Cost fixture" }],
      api: "openai-completions",
      provider: "openai",
      model: "gpt-4o",
      stopReason: "stop",
      timestamp: Date.now(),
      usage: {
        input: 10,
        output: 20,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 30,
        cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
      },
    });
  try {
    const root = SessionManager.create(home, join(home, "sessions"));
    append(root, 0.125);
    const child = SessionManager.create(home, join(home, "sessions"), { parentSession: root.getSessionFile() });
    child.appendCustomEntry("bruv-agent", { parentSessionFile: root.getSessionFile(), type: "orchestrator", depth: 1 });
    append(child, 0.25);
    const worker = SessionManager.create(home, join(home, "sessions"), { parentSession: child.getSessionFile() });
    worker.appendCustomEntry("bruv-agent", { parentSessionFile: child.getSessionFile(), type: "fast", depth: 2 });
    append(worker, 0.5);
    const unrelated = SessionManager.create(home, join(home, "sessions"));
    append(unrelated, 9);
    const launch = [
      "env",
      "HOME=" + home,
      "BRUV_CODING_AGENT_DIR=" + join(home, ".bruv", "agent"),
      "OPENAI_API_KEY=offline-test-placeholder",
      resolve(import.meta.dir, "../../dist/bruv"),
      "--offline",
      "--no-approve",
      "--session",
      root.getSessionFile()!,
      "--provider",
      "openai",
      "--model",
      "gpt-4o",
    ]
      .map(quote)
      .join(" ");
    const start = () => tmux("new-session", "-d", "-s", "cost", "-x", "120", "-y", "30", "-c", home, launch);
    expect((await start()).code).toBe(0);
    await frameContaining("$0.875");
    append(worker, 0.125);
    await frameContaining("$1.000");
    await tmux("send-keys", "-t", "cost", "-l", "/status");
    await tmux("send-keys", "-t", "cost", "Enter");
    const detailed = await frameContaining("$1.000 total");
    expect(detailed).toContain("↑10 ↓20");
    await tmux("kill-session", "-t", "cost");
    expect((await start()).code).toBe(0);
    await frameContaining("$1.000");
  } finally {
    await tmux("kill-server");
    await rm(home, { recursive: true, force: true });
  }
}, 20000);
