import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "../helpers/helpers";

const root = resolve(import.meta.dir, "../..");
const binary = join(root, "dist/bruv");
const packageVersion = ((await Bun.file(join(root, "package.json")).json()) as { version: string }).version;
let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "bruv-cli-test-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function isolatedEnv(): Record<string, string> {
  return { HOME: home, PATH: "/nonexistent" };
}

describe("compiled bruv CLI", () => {
  test("is standalone and reports the product version", async () => {
    const result = await run([binary, "--version"], { env: isolatedEnv() });

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(packageVersion);
  });

  test("connector subcommand enters lazily without bootstrapping normal CLI state", async () => {
    const result = await run([binary, "claude-compat", "--help"], { env: isolatedEnv() });
    expect(result.code).toBe(0);
    expect(result.stdout).toStartWith("bruv-claude-compat");
    expect(await Bun.file(join(home, ".bruv", "runtime", packageVersion, "package.json")).exists()).toBe(false);
    const wrapper = await run([join(root, "dist/bruv-claude-compat"), "--help"], { env: isolatedEnv() });
    expect(wrapper.code).toBe(0);
    expect(wrapper.stdout).toBe(result.stdout);
  });

  test("a compiled binary symlink alone still starts normal CLI, so launcher must pass subcommand", async () => {
    const alias = join(home, "bruv-claude-compat");
    await symlink(binary, alias);
    const result = await run([alias, "--help"], { env: isolatedEnv() });
    expect(result.code).toBe(0);
    expect(result.stdout).toStartWith("bruv - AI coding assistant");
  });

  test("exposes branded help and uses ~/.bruv instead of ~/.pi", async () => {
    const result = await run([binary, "--help"], { env: isolatedEnv() });

    expect(result.code).toBe(0);
    expect(result.stdout).toStartWith("bruv - AI coding assistant");
    expect(result.stdout).not.toContain("bash, edit, write tools");
    expect(result.stdout).not.toContain("--no-tools");
    expect(result.stdout).not.toContain("--no-builtin-tools");
    expect(result.stdout).not.toContain("--exclude-tools");
    expect(result.stdout).not.toContain("--tools,");
    expect(result.stdout).not.toContain(" update [source|self|pi]");
    expect(await Bun.file(join(home, ".bruv", "runtime", packageVersion, "package.json")).exists()).toBe(true);
    expect(await Bun.file(join(home, ".pi", "agent", "settings.json")).exists()).toBe(false);
  });

  test("bundled offline catalog offers GPT-6.1 Sol for OpenAI without a model request", async () => {
    const result = await run([binary, "--list-models", "gpt-6.1-sol"], {
      env: { ...isolatedEnv(), PI_OFFLINE: "1", OPENAI_API_KEY: "offline-catalog-only" },
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/openai\s+gpt-6\.1-sol\s+272K\s+128K\s+yes\s+yes/);
  });

  test("does not rewrite materialized runtime assets on later launches", async () => {
    const runtime = join(home, ".bruv", "runtime", packageVersion);
    expect((await run([binary, "--version"], { env: isolatedEnv() })).code).toBe(0);
    const files = (await readdir(runtime, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name));
    const before = await Promise.all(files.map(async (file) => [file, (await stat(file)).mtimeMs] as const));

    await Bun.sleep(20);
    expect((await run([binary, "--version"], { env: isolatedEnv() })).code).toBe(0);
    const after = await Promise.all(before.map(async ([file]) => (await stat(file)).mtimeMs));

    expect(after).toEqual(before.map(([, mtime]) => mtime));
  });

  test("rejects removed generic tool-selection options", async () => {
    for (const option of ["--no-tools", "--no-builtin-tools", "--tools=read", "--exclude-tools=bash"]) {
      const result = await run([binary, option], { env: isolatedEnv() });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("not supported. Bruv fixes its core tool set.");
    }
  });

  test("self-update help and argument errors never invoke the SDK updater", async () => {
    const help = await run([binary, "update", "--help"], { env: isolatedEnv() });
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Usage: bruv update [--check]");
    expect(help.stdout).toContain("bruv-claude-compat together");
    expect(help.stdout).toContain("Does not install Claude or T3");
    expect(help.stdout).not.toContain("manually");
    const invalid = await run([binary, "update", "self"], { env: isolatedEnv() });
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toContain("Usage: bruv update");
  });

  test("installs the verified pair into the requested local bin directory", async () => {
    const installDir = join(home, ".local", "bin");
    const result = await run([join(root, "scripts/release/install-local.sh")], {
      cwd: root,
      env: {
        ...process.env,
        HOME: home,
        BRUV_INSTALL_DIR: installDir,
        BRUV_SKIP_BUILD: "1",
      },
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`Installed bruv to ${join(installDir, "bruv")}`);
    const installed = await run([join(installDir, "bruv"), "--version"], { env: isolatedEnv() });
    expect(installed.code).toBe(0);
    expect(installed.stdout.trim()).toBe(packageVersion);
    const connector = await run([join(installDir, "bruv-claude-compat"), "--bruv-version"], { env: isolatedEnv() });
    expect(connector.code).toBe(0);
    expect(connector.stdout.trim()).toBe("bruv-claude-compat " + packageVersion);
  });
});

// These startup paths need no compiled binary, network, provider, or TTY.
describe("source bruv startup boundaries", () => {
  const source = [process.execPath, join(root, "src/cli.ts")];
  const runtime = () => join(home, ".bruv", "runtime", packageVersion);
  const invoke = (args: string[]) => run([...source, ...args], { cwd: home, env: isolatedEnv() });

  test("paired-update aliases exit before runtime preparation", async () => {
    const direct = await invoke(["update", "--help"]);
    expect(direct.code).toBe(0);
    expect(direct.stdout).toContain("bruv-claude-compat together");
    const alias = await invoke(["claude-compat", "update", "--help"]);
    expect(alias).toEqual(direct);
    expect(await Bun.file(join(runtime(), "package.json")).exists()).toBe(false);
  });

  test("connector and web commands do not enter normal CLI bootstrap", async () => {
    const connector = await invoke(["claude-compat", "--help"]);
    expect(connector.code).toBe(0);
    expect(connector.stdout).toStartWith("bruv-claude-compat");
    const web = await invoke(["web"]);
    expect(web.code).toBe(0);
    expect(web.stdout).toContain("Setup guide only");
    expect(await Bun.file(join(runtime(), "package.json")).exists()).toBe(false);
  });

  test("tool-policy and offline-probe gates reject before runtime preparation", async () => {
    const removed = await invoke(["--tools=read"]);
    expect(removed.code).toBe(1);
    expect(removed.stderr).toContain("not supported. Bruv fixes its core tool set.");
    const probe = await invoke(["--offline-openai-transport-probe"]);
    expect(probe.code).toBe(1);
    expect(probe.stderr).toContain("explicit loopback test gate");
    expect(await Bun.file(join(runtime(), "package.json")).exists()).toBe(false);
  });

  test("normal startup configures branded metadata and reuses immutable assets", async () => {
    const first = await invoke(["--version"]);
    expect(first.code).toBe(0);
    expect(first.stdout.trim()).toBe(packageVersion);
    const metadata = join(runtime(), "package.json");
    const before = (await stat(metadata)).mtimeMs;
    await Bun.sleep(20);
    expect(await invoke(["--version"])).toEqual(first);
    expect((await stat(metadata)).mtimeMs).toBe(before);
    expect(await Bun.file(join(home, ".pi", "agent", "settings.json")).exists()).toBe(false);
  });

  test("local placement reaches the same branded local help", async () => {
    const help = await invoke(["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toStartWith("bruv - AI coding assistant");
    expect(help.stdout).toContain("--place <name>");
    expect(help.stdout).not.toContain("--no-tools");
    expect(help.stdout).not.toContain(" update [source|self|pi]");
    expect(await invoke(["--place", "local", "--help"])).toEqual(help);
  });

  test("internal and remote-placement errors stop before local conversation", async () => {
    for (const [args, diagnostic] of [
      [["--remote-control", "extra"], "Usage: bruv --remote-control"],
      [["--remote-owner"], "Usage: bruv --remote-owner <taskId>"],
      [["--remote-root-control", "extra"], "Usage: bruv --remote-root-control"],
      [["--remote-root-owner"], "Usage: bruv --remote-root-owner <sessionId>"],
      [["--place", "fixture", "--help"], "Unsupported remote main-session argument"],
    ] as const) {
      const result = await invoke([...args]);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(diagnostic);
    }
    expect(await Bun.file(join(runtime(), "package.json")).exists()).toBe(true);
    expect(await Bun.file(join(home, ".bruv", "agent", "settings.json")).exists()).toBe(false);
  });
});
