import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { capturePane, frameContaining, shellQuote, tmuxRunner } from "./tui-helpers";

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

test("long saved thread keeps history, editor input, and native tool details usable", async () => {
  const home = await mkdtemp(join(tmpdir(), "bruv-long-thread-"));
  const socket = "bruv-long-thread-" + process.pid + "-" + Date.now();
  const tmux = tmuxRunner(socket, join(home, "tmux.conf"));
  const artifacts = resolve(import.meta.dir, "../artifacts/tui", socket);
  const capture = async () => (await capturePane(tmux, "long-thread")).stdout;
  const frame = async (name: string, expected: string | string[]) => {
    const text = await frameContaining(capture, expected, 200);
    await writeFile(join(artifacts, name + ".txt"), text);
    return text;
  };
  try {
    await mkdir(artifacts, { recursive: true });
    await writeFile(join(home, "tmux.conf"), "set -g extended-keys on\nset -g extended-keys-format csi-u\n");
    const session = SessionManager.create(home, join(home, "sessions"));
    for (let turn = 0; turn < 100; turn++) {
      session.appendMessage({ role: "user", content: "Saved turn " + turn, timestamp: Date.now() });
      for (let tool = 0; tool < 10; tool++) {
        const id = "saved-" + turn + "-" + tool;
        session.appendMessage({
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id,
              name: "execute",
              arguments: { label: "Read saved file " + id, code: 'console.log("DETAIL_' + id + '")' },
            },
          ],
          api: "openai-completions",
          provider: "openai",
          model: "gpt-4o",
          usage,
          stopReason: "toolUse",
          timestamp: Date.now(),
        });
        session.appendMessage({
          role: "toolResult",
          toolCallId: id,
          toolName: "execute",
          content: [{ type: "text", text: "DETAIL_" + id }],
          details: { exitCode: 0, stdout: "DETAIL_" + id, stderr: "", images: [] },
          isError: false,
          timestamp: Date.now(),
        });
      }
    }
    session.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "LONG_THREAD_READY" }],
      api: "openai-completions",
      provider: "openai",
      model: "gpt-4o",
      usage,
      stopReason: "stop",
      timestamp: Date.now(),
    });
    const launch = [
      "env",
      "HOME=" + home,
      "BRUV_CODING_AGENT_DIR=" + join(home, ".bruv", "agent"),
      "HERDR_ENV=0",
      "OPENAI_API_KEY=offline-test-placeholder",
      resolve(import.meta.dir, "../dist/bruv"),
      "--offline",
      "--no-approve",
      "--session",
      session.getSessionFile()!,
      "--provider",
      "openai",
      "--model",
      "gpt-4o",
    ]
      .map(shellQuote)
      .join(" ");
    expect(
      (await tmux("new-session", "-d", "-s", "long-thread", "-x", "100", "-y", "30", "-c", home, launch)).code,
    ).toBe(0);
    await frame("loaded", "LONG_THREAD_READY");
    // The initial frame can precede shortcut setup.
    await Bun.sleep(500);
    await tmux("send-keys", "-t", "long-thread", "-l", "long-thread-draft");
    await frame("typed", "long-thread-draft");
    await tmux("send-keys", "-t", "long-thread", "Home");
    await frame("oldest", "Saved turn 0");
    await tmux("send-keys", "-t", "long-thread", "End");
    await frame("bottom", "LONG_THREAD_READY");
    await tmux("send-keys", "-t", "long-thread", "C-o");
    await frame("expanded", "DETAIL_saved-99-9");
    await tmux("send-keys", "-t", "long-thread", "C-o");
    const collapsed = await frame("collapsed", "Read saved file saved-99-9");
    expect(collapsed).toContain("Read saved file saved-99-9");
    expect(collapsed).not.toContain("DETAIL_saved-99-9");
    await tmux("resize-window", "-t", "long-thread", "-x", "48", "-y", "30");
    const narrow = await frame("narrow", ["long-thread-draft", "gpt-4o"]);
    for (const line of narrow.trimEnd().split("\n")) expect([...line].length).toBeLessThanOrEqual(48);
    // Frames test real interaction and preservation, not machine-specific timing.
    expect(session.getBranch().filter((entry) => entry.type === "message").length).toBe(2101);
  } finally {
    await tmux("kill-server");
    await rm(home, { recursive: true, force: true });
  }
}, 60000);
