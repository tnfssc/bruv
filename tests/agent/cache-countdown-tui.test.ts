import { expect, test } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { capturePane, frameContaining as waitForText, shellQuote as quote, tmuxRunner } from "../helpers/tui-helpers";

test("real PTY shows unknown estimate and /cache-ttl persists a validated value", async () => {
  const home = await mkdtemp(join(tmpdir(), "bruv-cache-pty-"));
  const socket = "bruv-cache-" + process.pid + "-" + Date.now(),
    session = "cache";
  const tmux = tmuxRunner(socket);
  const capture = () => capturePane(tmux, session, true);
  const waitFor = (text: string) => waitForText(async () => (await capture()).stdout, text);
  try {
    const binary = resolve(import.meta.dir, "../../dist/bruv");
    const launch = [
      "env",
      "HOME=" + home,
      "BRUV_CODING_AGENT_DIR=" + join(home, ".bruv", "agent"),
      "OPENAI_API_KEY=offline",
      binary,
      "--offline",
      "--no-approve",
      "--no-session",
      "--provider",
      "openai",
      "--model",
      "gpt-4o",
    ]
      .map(quote)
      .join(" ");
    expect((await tmux("new-session", "-d", "-s", session, "-x", "140", "-y", "35", "-c", home, launch)).code).toBe(0);
    expect(await waitFor("cache est ?")).toContain("· cache est ?");
    await tmux("send-keys", "-t", session, "-l", "/cache-ttl 30m");
    await tmux("send-keys", "-t", session, "Enter");
    expect(await waitFor("Cache TTL estimate set to 30m")).toContain(
      "does not guarantee provider cache retention or hits",
    );
    expect(JSON.parse(await readFile(join(home, ".bruv", "cache-settings.json"), "utf8"))).toEqual({
      cacheTtlMs: 1_800_000,
    });
  } finally {
    await tmux("kill-server").catch(() => ({ code: 1, stdout: "", stderr: "" }));
    await rm(home, { recursive: true, force: true });
  }
}, 15_000);
