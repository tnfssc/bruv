import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const fixtures: string[] = [];
afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

const readyLibraries = "libc.so => /lib/libc.so\n";
const missingLibraries = "libmissing.so => not found\n";

// Run the real setup script with fake Bun/ldd commands, not a real browser download.
function runSetup({
  shellCount = 1,
  downloadExit = 0,
  dependencyExit = 0,
  lddExit = 0,
  libraryReports = [readyLibraries, readyLibraries],
}: {
  shellCount?: number;
  downloadExit?: number;
  dependencyExit?: number;
  lddExit?: number;
  libraryReports?: [string, string];
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "bruv-browser-setup-"));
  fixtures.push(root);
  const bin = join(root, "bin");
  mkdirSync(bin);
  copyFileSync(resolve(import.meta.dir, "../scripts/setup-release-browser.sh"), join(root, "setup.sh"));
  writeFileSync(join(root, "libraries-before"), libraryReports[0]);
  writeFileSync(join(root, "libraries-after"), libraryReports[1]);
  writeFileSync(
    join(bin, "bun"),
    `#!/usr/bin/env bash
set -eu
printf 'bun %s\n' "$*" >> "$RUNNER_TEMP/calls"
if [[ "$*" == *'install --only-shell chromium' ]]; then
  [[ "$DOWNLOAD_EXIT" == 0 ]] || exit "$DOWNLOAD_EXIT"
  for ((i=0; i<SHELL_COUNT; i++)); do
    shell="$PLAYWRIGHT_BROWSERS_PATH/chromium_headless_shell-$i/chrome-headless-shell-linux64"
    mkdir -p "$shell"
    touch "$shell/chrome-headless-shell"
  done
fi
if [[ "$*" == *'install-deps chromium' ]]; then
  exit "$DEPENDENCY_EXIT"
fi
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(bin, "ldd"),
    `#!/usr/bin/env bash
set -eu
printf 'ldd %s\n' "$*" >> "$RUNNER_TEMP/calls"
[[ "$LDD_EXIT" == 0 ]] || exit "$LDD_EXIT"
if [[ -e "$RUNNER_TEMP/libraries-checked" ]]; then
  cat "$RUNNER_TEMP/libraries-after"
else
  cat "$RUNNER_TEMP/libraries-before"
  touch "$RUNNER_TEMP/libraries-checked"
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
      SHELL_COUNT: String(shellCount),
      DOWNLOAD_EXIT: String(downloadExit),
      DEPENDENCY_EXIT: String(dependencyExit),
      LDD_EXIT: String(lddExit),
    },
  });
  return {
    root,
    result,
    calls: readFileSync(join(root, "calls"), "utf8").trim().split("\n"),
  };
}

test("ready hosted libraries avoid apt; harness stays pinned and isolated", () => {
  const { root, result, calls } = runSetup();
  expect(result.status).toBe(0);
  const shell = `${root}/release-browser/chromium/chromium_headless_shell-0/chrome-headless-shell-linux64/chrome-headless-shell`;
  expect(calls).toEqual([
    "bun add --cwd " + root + "/release-browser playwright-core@1.63.0",
    "bun " + root + "/release-browser/node_modules/playwright-core/cli.js install --only-shell chromium",
    "ldd " + shell,
    "ldd " + shell,
  ]);
  expect(readFileSync(join(root, "env"), "utf8")).toBe(
    `PLAYWRIGHT_BROWSERS_PATH=${root}/release-browser/chromium\n` +
      `RELEASE_BOOT_PLAYWRIGHT=${root}/release-browser/node_modules/playwright-core/index.mjs\n`,
  );
  expect(readFileSync(join(root, "release-browser/package.json"), "utf8")).toBe('{"private":true}\n');
});

test("missing shared libraries install dependencies between the two checks", () => {
  const { root, result, calls } = runSetup({ libraryReports: [missingLibraries, readyLibraries] });
  expect(result.status).toBe(0);
  const shell = `${root}/release-browser/chromium/chromium_headless_shell-0/chrome-headless-shell-linux64/chrome-headless-shell`;
  expect(calls.slice(2)).toEqual([
    "ldd " + shell,
    "bun " + root + "/release-browser/node_modules/playwright-core/cli.js install-deps chromium",
    "ldd " + shell,
  ]);
});

test("dependency installation failure stops before the library recheck", () => {
  const { result, calls } = runSetup({ dependencyExit: 37, libraryReports: [missingLibraries, readyLibraries] });
  expect(result.status).toBe(37);
  expect(calls.at(-1)).toEndWith("install-deps chromium");
  expect(calls.filter((call) => call.startsWith("ldd "))).toHaveLength(1);
});

test("browser download failure stops before library inspection", () => {
  const { result, calls } = runSetup({ downloadExit: 38 });
  expect(result.status).toBe(38);
  expect(calls).toHaveLength(2);
  expect(calls.at(-1)).toEndWith("install --only-shell chromium");
});

for (const shellCount of [0, 2]) {
  test(shellCount + " headless shells fail the exactly-one requirement", () => {
    const { result, calls } = runSetup({ shellCount });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Expected exactly one pinned Chromium headless shell");
    expect(calls).toHaveLength(2);
  });
}

test("ldd failure is fatal, not a reason to install dependencies", () => {
  const { result, calls } = runSetup({ lddExit: 19 });
  expect(result.status).toBe(19);
  expect(calls).toHaveLength(3);
  expect(calls.at(-1)).toStartWith("ldd ");
});

test("libraries still missing after dependency installation fail with the report", () => {
  const { result, calls } = runSetup({ libraryReports: [missingLibraries, missingLibraries] });
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(missingLibraries);
  expect(calls.at(-2)).toEndWith("install-deps chromium");
  expect(calls.at(-1)).toStartWith("ldd ");
});
