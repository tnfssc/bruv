import { afterEach, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const fixtures: string[] = [];
afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup(mode: string) {
  const root = mkdtempSync(join(tmpdir(), "bruv-browser-setup-"));
  fixtures.push(root);
  const bin = join(root, "bin");
  mkdirSync(bin);
  copyFileSync(resolve(import.meta.dir, "../scripts/setup-release-browser.sh"), join(root, "setup.sh"));
  writeFileSync(
    join(bin, "bun"),
    `#!/usr/bin/env bash
set -eu
printf '%s
' "$*" >> "$RUNNER_TEMP/calls"
if [[ "$*" == *'install --only-shell chromium' ]]; then
  [[ "$MODE" != download-failure ]] || exit 38
  [[ "$MODE" != no-shell ]] || exit 0
  mkdir -p "$PLAYWRIGHT_BROWSERS_PATH/chromium_headless_shell-1223/chrome-headless-shell-linux64"
  touch "$PLAYWRIGHT_BROWSERS_PATH/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell"
fi
if [[ "$*" == *'install-deps chromium' ]]; then
  [[ "$MODE" != installer-failure ]] || exit 37
  touch "$RUNNER_TEMP/deps-installed"
fi
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(bin, "ldd"),
    `#!/usr/bin/env bash
[[ "$MODE" != ldd-failure ]] || exit 19
if [[ "$MODE" != ready && (! -e "$RUNNER_TEMP/deps-installed" || "$MODE" == still-missing) ]]; then
  echo 'libmissing.so => not found'
else
  echo 'libc.so => /lib/libc.so'
fi
`,
    { mode: 0o755 },
  );
  const result = spawnSync("bash", [join(root, "setup.sh")], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: bin + ":" + process.env.PATH,
      RUNNER_TEMP: root,
      GITHUB_ENV: join(root, "env"),
      MODE: mode,
    },
  });
  return { root, result, calls: readFileSync(join(root, "calls"), "utf8") };
}

test("ready hosted libraries avoid apt; harness stays pinned and isolated", () => {
  const { root, result, calls } = setup("ready");
  expect(result.status).toBe(0);
  expect(calls).toContain("playwright-core@1.60.0");
  expect(calls).toContain("install --only-shell chromium");
  expect(calls).not.toContain("install-deps");
  expect(readFileSync(join(root, "env"), "utf8")).toContain(
    "RELEASE_BOOT_PLAYWRIGHT=" + root + "/release-browser/node_modules/playwright-core/index.mjs",
  );
});

test("missing shared libraries install dependencies then recheck", () => {
  const { result, calls } = setup("missing");
  expect(result.status).toBe(0);
  expect(calls).toContain("install-deps chromium");
});

test("failed dependency setup and ldd failures are not swallowed", () => {
  expect(setup("installer-failure").result.status).toBe(37);
  expect(setup("download-failure").result.status).toBe(38);
  const absent = setup("no-shell");
  expect(absent.result.status).toBe(1);
  expect(absent.result.stderr).toContain("Expected exactly one pinned Chromium headless shell");
  const ldd = setup("ldd-failure");
  expect(ldd.result.status).toBe(19);
  expect(ldd.calls).not.toContain("install-deps");
  const unresolved = setup("still-missing");
  expect(unresolved.result.status).toBe(1);
  expect(unresolved.result.stderr).toContain("not found");
});
