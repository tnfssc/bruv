import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { capturePane, frameContaining, shellQuote, tmuxRunner } from "./tui-helpers";

test("compiled CLI keeps a complete megabyte message visible, rich, scrollable and editable", async () => {
  const home = await mkdtemp(join(tmpdir(), "bruv-large-text-"));
  const socket = "bruv-large-text-" + process.pid + "-" + Date.now();
  const tmux = tmuxRunner(socket, join(home, "tmux.conf"));
  const artifacts = resolve(import.meta.dir, "../artifacts/tui", socket);
  const message =
    "# LARGE_TEXT_START\n\n" + "deterministic pasted line\n".repeat(42000) + "\n**LARGE_TEXT_END** and **RICH_BOLD**\n";
  const hash = (text: string) => createHash("sha256").update(text).digest("hex");
  const capture = async () => (await capturePane(tmux, "large-text")).stdout;
  const frame = async (name: string, expected: string | string[]) => {
    const text = await frameContaining(capture, expected, 200);
    await writeFile(join(artifacts, name + ".txt"), text);
    return text;
  };
  try {
    await mkdir(artifacts, { recursive: true });
    await writeFile(join(home, "tmux.conf"), "set -g extended-keys on\nset -g extended-keys-format csi-u\n");
    const session = SessionManager.create(home, join(home, "sessions"));
    session.appendMessage({ role: "user", content: message, timestamp: Date.now() });
    session.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "LARGE_TEXT_READY" }],
      api: "openai-completions",
      provider: "openai",
      model: "gpt-4o",
      stopReason: "stop",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
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
      (await tmux("new-session", "-d", "-s", "large-text", "-x", "100", "-y", "30", "-c", home, launch)).code,
    ).toBe(0);
    await frame("loaded", ["LARGE_TEXT_READY", "LARGE_TEXT_END", "RICH_BOLD"]);
    await Bun.sleep(500);
    await tmux("send-keys", "-t", "large-text", "C-Home");
    await frame("oldest", ["LARGE_TEXT_START", "deterministic pasted line"]);
    await tmux("send-keys", "-t", "large-text", "C-End");
    await frame("bottom", ["LARGE_TEXT_END", "LARGE_TEXT_READY"]);
    await tmux("resize-window", "-t", "large-text", "-x", "46", "-y", "24");
    await frame("narrow", ["LARGE_TEXT_END", "RICH_BOLD"]);
    const ansi = (await tmux("capture-pane", "-e", "-p", "-t", "large-text")).stdout;
    await writeFile(join(artifacts, "narrow-ansi.txt"), ansi);
    expect(ansi).toMatch(/\x1b\[(?:[0-9]+;)*1(?:;[0-9]+)*m/);
    await tmux("send-keys", "-t", "large-text", "-l", "still-editable-draft");
    await frame("typed", ["still-editable-draft", "LARGE_TEXT_READY"]);
    const saved = SessionManager.open(session.getSessionFile()!)
      .getBranch()
      .find((entry) => entry.type === "message" && entry.message.role === "user");
    expect(saved?.type).toBe("message");
    if (saved?.type === "message" && saved.message.role === "user") expect(saved.message.content).toBe(message);
    await writeFile(
      join(artifacts, "evidence.json"),
      JSON.stringify({ bytes: Buffer.byteLength(message), sha256: hash(message) }),
    );
  } finally {
    await tmux("kill-server");
    await rm(home, { recursive: true, force: true });
  }
}, 60000);
