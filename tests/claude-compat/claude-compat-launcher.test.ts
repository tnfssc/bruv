import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, link, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  connectorLauncher,
  normalOutputForConnector,
  writeConnectorLauncher,
} from "../../scripts/build/claude-compat-launcher";

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "bruv launcher spaces "));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});
async function fixture(name = "bruv-claude-compat") {
  const launcher = join(home, name);
  const normal = normalOutputForConnector(launcher);
  await writeConnectorLauncher(launcher);
  await writeFile(normal, '#!/bin/sh\nprintf "<%s>\\n" "$@"\ncat\nprintf "fixture stderr\\n" >&2\nexit 17\n');
  await chmod(normal, 0o755);
  return { launcher, normal };
}
async function run(command: string[], extra: Record<string, string> = {}) {
  const child = Bun.spawn(command, {
    cwd: home,
    env: { PATH: "/usr/bin:/bin", ...extra },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  child.stdin.write("stdin until EOF\n");
  child.stdin.end();
  return {
    code: await child.exited,
    stdout: await new Response(child.stdout).text(),
    stderr: await new Response(child.stderr).text(),
  };
}

test("launcher is tiny executable script; quotes argv and forwards stdin EOF/stdout/stderr/exit", async () => {
  const { launcher } = await fixture();
  expect((await stat(launcher)).size).toBeLessThan(4096);
  expect((await stat(launcher)).mode & 0o111).toBe(0o111);
  const result = await run([launcher, "a b", "", "'\"$;*", "--flag"]);
  expect(result.code).toBe(17);
  expect(result.stdout).toBe("<claude-compat>\n<a b>\n<>\n<'\"$;*>\n<--flag>\nstdin until EOF\n");
  expect(result.stderr).toBe("fixture stderr\n");
});

test("relative and absolute symlink chains find physical sibling, not link directory or PATH bruv", async () => {
  const { launcher } = await fixture();
  await mkdir(join(home, "links with spaces"));
  const alias = join(home, "links with spaces", "another name");
  await symlink("../bruv-claude-compat", alias);
  await symlink(alias, join(home, "outer"));
  for (const path of [join(home, "outer"), "./links with spaces/another name"])
    expect((await run([path, "x"])).stdout).toStartWith("<claude-compat>\n<x>\n");
  expect((await run([launcher], { PATH: "/does-not-exist" })).code).toBe(17);
});

test("release suffix finds suffixed sibling; canonical rename finds canonical sibling", async () => {
  const { launcher } = await fixture("bruv-claude-compat-linux-x64");
  expect((await run([launcher])).code).toBe(17);
});

test("explicit absolute normal binary override is forwarded without evaluation", async () => {
  const { launcher, normal } = await fixture();
  const override = join(home, "override ; executable");
  await symlink(normal, override);
  expect((await run([launcher], { BRUV_CLAUDE_COMPAT_BRUV_PATH: override })).code).toBe(17);
  expect((await run([launcher], { BRUV_CLAUDE_COMPAT_BRUV_PATH: "bruv" })).stderr).toContain(
    "absolute normal bruv path",
  );
  expect((await run([launcher], { BRUV_CLAUDE_COMPAT_BRUV_PATH: launcher })).stderr).toContain(
    "must not point to the connector",
  );
});

test("optional tilde override uses HOME without shell evaluation", async () => {
  const { launcher, normal } = await fixture();
  await symlink(normal, join(home, "normal ; $ executable"));
  const result = await run([launcher, "ok"], {
    HOME: home,
    BRUV_CLAUDE_COMPAT_BRUV_PATH: "~/normal ; $ executable",
  });
  expect(result.code).toBe(17);
  expect(result.stdout).toStartWith("<claude-compat>\n<ok>\n");
  expect((await run([launcher], { HOME: home, BRUV_CLAUDE_COMPAT_BRUV_PATH: "~other/bruv" })).code).not.toBe(17);
});

test("exec preserves PID and SIGTERM reaches normal binary without a forwarding process", async () => {
  const { launcher, normal } = await fixture();
  await writeFile(normal, '#!/bin/sh\ntrap \'exit 143\' TERM\nprintf "%s\\n" "$$"\nwhile :; do :; done\n');
  const child = Bun.spawn([launcher], { env: { PATH: "/usr/bin:/bin" }, stdout: "pipe", stderr: "pipe" });
  const reader = child.stdout.getReader();
  const first = await reader.read();
  expect(Number(new TextDecoder().decode(first.value).trim())).toBe(child.pid);
  child.kill("SIGTERM");
  expect(await child.exited).toBe(143);
  reader.releaseLock();
});

test("Linux/macOS use system /bin/sh, Android uses system /system/bin/sh, never env or Bun", async () => {
  for (const target of ["bun-linux-x64-baseline", "bun-linux-arm64", "bun-darwin-arm64", "bun-android-arm64"]) {
    const script = await connectorLauncher(target);
    expect(script.split("\n")[0]).toBe(target.includes("android") ? "#!/system/bin/sh" : "#!/bin/sh");
    const child = Bun.spawn(["/bin/sh", "-n"], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    child.stdin.write(script);
    child.stdin.end();
    expect(await child.exited).toBe(0);
    expect(script).not.toContain("/usr/bin/env");
  }
  expect(connectorLauncher("bun-windows-x64")).rejects.toThrow("Unsupported");
});

test("generator refuses ambiguous names and links that could overwrite normal binary", async () => {
  const { launcher, normal } = await fixture();
  expect(() => normalOutputForConnector(normal)).toThrow("must not overwrite");
  const bytes = await readFile(normal);
  await rm(launcher);
  await symlink(normal, launcher);
  await expect(writeConnectorLauncher(launcher)).rejects.toThrow("symlink or hardlink");
  await rm(launcher);
  await link(normal, launcher);
  await expect(writeConnectorLauncher(launcher)).rejects.toThrow("symlink or hardlink");
  expect(await readFile(normal)).toEqual(bytes);
});

test("0.16.3 staged version probe uses truthful legacy product label only until rename", async () => {
  const stage = join(home, ".bruv-update-legacy");
  await mkdir(stage);
  const launcher = join(stage, "bruv-claude-compat");
  const normal = join(stage, "bruv");
  await writeConnectorLauncher(launcher);
  await writeFile(
    normal,
    '#!/bin/sh\nif [ "$1" = "--version" ]; then echo 0.17.0; elif [ "$2" = "--bruv-version" ]; then echo "bruv-claude-compat 0.17.0"; else echo "Bruv connector"; fi\n',
  );
  await chmod(normal, 0o755);
  expect((await run([launcher, "--version"])).stdout).toBe("bruv-claude-compat 0.17.0\n");
  expect((await run([launcher, "--bruv-version"])).stdout).toBe("bruv-claude-compat 0.17.0\n");
  // Installation renames both staged files, removing the compatibility context.
  const { rename } = await import("node:fs/promises");
  await rename(normal, join(home, "bruv"));
  await rename(launcher, join(home, "bruv-claude-compat"));
  expect((await run([join(home, "bruv-claude-compat"), "--version"])).stdout).toBe("Bruv connector\n");
});
