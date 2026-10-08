import { test, expect } from "bun:test";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "./helpers";
import { capturePane, frameContaining as waitForText } from "./tui-helpers";

type Tmux = (...args: string[]) => ReturnType<typeof run>;

// The fixture owns the server, HOME, configuration and SDK state. Its files stay
// available after the parent gate; shutdown only targets this fixture's socket.
async function withProfileTerminal(interact: (tmux: Tmux, home: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "bruv-profile-pty-"));
  const home = join(root, "home");
  const config = join(root, "config");
  const cache = join(root, "cache");
  const data = join(root, "data");
  const sdk = join(root, "sdk");
  const temporary = join(root, "tmp");
  await Promise.all([home, config, cache, data, sdk, temporary].map((path) => mkdir(path)));
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    XDG_CONFIG_HOME: config,
    XDG_CACHE_HOME: cache,
    XDG_DATA_HOME: data,
    BRUV_CODING_AGENT_DIR: sdk,
    TMPDIR: temporary,
    SHELL: "/bin/sh",
    TERM: "xterm-256color",
    LANG: "C.UTF-8",
    HERDR_ENV: "0",
    OPENAI_API_KEY: "offline-test-placeholder",
  };
  const socket = join(root, "tmux.sock");
  const tmux: Tmux = (...args) => run(["tmux", "-S", socket, "-f", "/dev/null", ...args], { env, cwd: home });
  try {
    const binary = resolve(import.meta.dir, "../dist/bruv");
    // Multiple command arguments let tmux execute the binary directly, without a shell.
    expect(
      (
        await tmux(
          "new-session",
          "-d",
          "-s",
          "profiles",
          "-x",
          "120",
          "-y",
          "40",
          "-c",
          home,
          binary,
          "--offline",
          "--no-approve",
          "--no-session",
          "--provider",
          "openai",
          "--model",
          "gpt-4o",
        )
      ).code,
    ).toBe(0);
    await waitForText(async () => (await capturePane(tmux, "profiles")).stdout, "gpt-4o", 80);
    // The footer is painted before startup binds extension commands.
    await Bun.sleep(1000);
    await interact(tmux, home);
  } finally {
    await tmux("kill-server");
  }
}

test(
  "real TUI searches profile models, keeps selection, and saves",
  async () =>
    withProfileTerminal(async (tmux, home) => {
      const frameContaining = (text: string) =>
        waitForText(async () => (await capturePane(tmux, "profiles")).stdout, text, 80);
      const key = (...keys: string[]) => tmux("send-keys", "-t", "profiles", ...keys);
      await tmux("send-keys", "-t", "profiles", "-l", "/subagents");
      await key("Enter");
      await frameContaining("Sub-agent profiles");
      await key("Enter");
      await frameContaining("fast · model");
      await tmux("send-keys", "-t", "profiles", "-l", "openai gpt-4o");
      // Wait for the entire query, not an item already visible in the unfiltered list.
      const searchFrame = await frameContaining("openai gpt-4o");
      await key("Enter");
      await frameContaining("Sub-agent profiles");
      await key("Down", "Enter");
      await frameContaining("fast · thinking");
      await key("Down", "Enter");
      await frameContaining("Sub-agent profiles");
      // Returning from thinking keeps row 1 selected. Five downs reaches Save.
      await key("Down", "Down", "Down", "Down", "Down", "Enter");
      await frameContaining("Saved");
      const saved = JSON.parse(await readFile(join(home, ".bruv", "subagents.json"), "utf8"));
      if (saved.fast.model !== "openai/gpt-4o") console.log(searchFrame);
      expect(saved.fast.model).toBe("openai/gpt-4o");
      expect(saved.fast.thinking).toBe("off");
    }),
  15000,
);
