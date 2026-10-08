import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "./helpers";

async function createHarnessFixture() {
  const sourceRoot = resolve(import.meta.dir, "..");
  const root = await mkdtemp(join(tmpdir(), "bruv-tui-harness-"));
  const home = join(root, "home");
  const config = join(root, "config");
  const sdk = join(root, "sdk");
  const temporary = join(root, "tmp");
  for (const path of [home, config, sdk, temporary, join(root, "scripts")]) {
    await mkdir(path, { mode: 0o700 });
  }
  // The harness locates state/artifacts beside its script. Copy that small entry
  // point, but reuse the parent's built dist read-only; never run a build here.
  const harness = join(root, "scripts", "tui-harness.ts");
  await copyFile(join(sourceRoot, "scripts", "tui-harness.ts"), harness);
  await copyFile(join(sourceRoot, "scripts", "tmux.conf"), join(root, "scripts", "tmux.conf"));
  await symlink(join(sourceRoot, "dist"), join(root, "dist"), "dir");
  const socket = "bruv-test-" + process.pid + "-" + Date.now();
  const env = {
    PATH: process.env.PATH,
    TERM: "xterm-256color",
    HOME: home,
    XDG_CONFIG_HOME: config,
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_STATE_HOME: join(root, "state"),
    PI_CODING_AGENT_DIR: sdk,
    BRUV_CODING_AGENT_DIR: sdk,
    TMPDIR: temporary,
    TMUX_TMPDIR: temporary,
    BRUV_TUI_SOCKET: socket,
    BRUV_TUI_TIMEOUT_SECONDS: "1",
  };
  const tmux = (...args: string[]) => run(["tmux", "-L", socket, ...args], { env, cwd: root });
  // Retain the fixture, including HOME/config/SDK and transcripts, for audit.
  console.info("TUI harness fixture retained at " + root + "; source: " + sourceRoot);
  return {
    command: (...args: string[]) => run([process.execPath, harness, ...args], { env, cwd: root }),
    hasSession: async (name: string) => (await tmux("has-session", "-t", name)).code === 0,
    createSession: (name: string) => tmux("new-session", "-d", "-s", name, "sleep 60"),
    stopServer: () => tmux("kill-server"),
  };
}

let harness: Awaited<ReturnType<typeof createHarnessFixture>>;
beforeAll(async () => {
  harness = await createHarnessFixture();
});
afterAll(async () => {
  if (harness) await harness.stopServer();
});

describe("interactive TUI harness", () => {
  test("provides its inspection and interaction commands", async () => {
    const result = await harness.command("--help");

    expect(result.code).toBe(0);
    for (const command of ["frame", "history", "send", "followup", "key", "record", "stop"]) {
      expect(result.stdout).toContain(command);
    }
  });

  test("duplicate start refuses an existing session without replacing it", async () => {
    expect((await harness.createSession("existing")).code).toBe(0);
    const duplicate = await harness.command("start", "existing", "--offline", "--no-session");
    expect(duplicate.code).not.toBe(0);
    expect(duplicate.stderr).toContain("Session already exists: existing");
    expect(await harness.hasSession("existing")).toBe(true);
    expect((await harness.command("stop", "existing")).code).toBe(0);
  });

  test("invalid session names are rejected", async () => {
    const invalid = await harness.command("start", "bad.name", "--offline");
    expect(invalid.code).not.toBe(0);
    expect(invalid.stderr).toContain("Session names may contain");
    expect(await harness.hasSession("bad.name")).toBe(false);
  });

  test("auto-kills only the session named demo", async () => {
    const demo = await harness.command("start", "demo", "--offline", "--no-session");
    expect(demo.code).toBe(0);
    expect(demo.stdout).toContain("Auto-kill:");

    const regular = await harness.command("start", "regular", "--offline", "--no-session");
    expect(regular.code).toBe(0);
    expect(regular.stdout).not.toContain("Auto-kill:");

    await Bun.sleep(1_500);
    expect(await harness.hasSession("demo")).toBe(false);
    expect(await harness.hasSession("regular")).toBe(true);

    const stopped = await harness.command("stop", "regular");
    expect(stopped.code).toBe(0);
  }, 10_000);
});
