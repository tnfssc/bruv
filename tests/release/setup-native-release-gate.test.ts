import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ownedFixtureEnv } from "../helpers/helpers";

const existingEnv = "EXISTING=value\n";
type Failure = "fetch-failure" | "download-failure" | "checksum-failure" | "extraction-failure" | "api-failure";

// Stub downloads and extraction, but execute the real setup and its SDK API probe.
function setup({ failure, browserCount = 1 }: { failure?: Failure; browserCount?: number } = {}) {
  const root = mkdtempSync(join(tmpdir(), "native setup "));
  const paths = {
    upstream: join(root, "native-t3"),
    runtime: join(root, "native-browser-runtime"),
    playwrightCore: join(root, "release-browser/node_modules/playwright-core"),
    browser: join(root, "browsers/0/chrome-headless-shell"),
    sdkDirectory: join(root, "native-claude-sdk"),
    sdkArchive: join(root, "native-claude-sdk/sdk.tgz"),
    sdkModule: join(root, "native-claude-sdk/package/sdk.mjs"),
  };
  const fixtureEnv = ownedFixtureEnv(root);
  const bin = join(root, "bin");
  const browsers = join(root, "browsers");
  const envFile = join(root, "env");
  const callsFile = join(root, "calls.ndjson");
  const checksumFile = join(root, "checksum-input");
  mkdirSync(bin);
  mkdirSync(browsers);
  mkdirSync(paths.playwrightCore, { recursive: true });
  for (let i = 0; i < browserCount; i++) {
    const directory = join(browsers, String(i));
    mkdirSync(directory);
    writeFileSync(join(directory, i === 0 ? "chrome-headless-shell" : "headless_shell"), "fixture");
  }
  writeFileSync(envFile, existingEnv);
  writeFileSync(callsFile, "");
  writeFileSync(checksumFile, "");
  const stubs = {
    node: `
if [[ "$1" == wisdom/claude-compat/proof/official-2644/fetch-official.mjs ]]; then
  [[ "$FAILURE" != fetch-failure ]] || exit 31
  mkdir "$2"
  ln -s "$3" "$2/runtime"
else
  exec "$REAL_NODE" "$@"
fi`,
    curl: `
[[ "$FAILURE" != download-failure ]] || exit 32
touch "$RUNNER_TEMP/native-claude-sdk/sdk.tgz"`,
    sha256sum: `
cat > "$RUNNER_TEMP/checksum-input"
[[ "$FAILURE" != checksum-failure ]] || exit 33`,
    tar: `
[[ "$FAILURE" != extraction-failure ]] || exit 34
mkdir "$RUNNER_TEMP/native-claude-sdk/package"
if [[ "$FAILURE" == api-failure ]]; then
  echo "export const unavailable = true;"
else
  echo "export function getSubagentMessages() {}"
fi > "$RUNNER_TEMP/native-claude-sdk/package/sdk.mjs"`,
  };
  // Keep argv boundaries: the fixture deliberately uses a path containing spaces.
  for (const [command, body] of Object.entries(stubs)) {
    writeFileSync(
      join(bin, command),
      `#!/bin/bash
set -euo pipefail
"$REAL_NODE" -e 'require("node:fs").appendFileSync(process.env.RUNNER_TEMP + "/calls.ndjson", JSON.stringify(process.argv.slice(1)) + "\\n")' "${command}" "$@"
${body}
`,
      { mode: 0o755 },
    );
  }
  const result = spawnSync("/bin/bash", [join(import.meta.dir, "../../scripts/setup-native-release-gate.sh")], {
    encoding: "utf8",
    cwd: join(import.meta.dir, "../.."),
    env: {
      ...fixtureEnv,
      PATH: bin + ":" + fixtureEnv.PATH,
      RUNNER_TEMP: root,
      GITHUB_ENV: envFile,
      PLAYWRIGHT_BROWSERS_PATH: browsers,
      REAL_NODE: Bun.which("node")!,
      FAILURE: failure ?? "",
    },
  });
  return {
    paths,
    result,
    env: readFileSync(envFile, "utf8"),
    calls: readFileSync(callsFile, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[]),
    checksumInput: readFileSync(checksumFile, "utf8"),
    playwright: readlinkSync(join(paths.runtime, "node_modules/playwright")),
  };
}

test("native setup verifies pinned inputs before handing off all three gate paths", () => {
  const { paths, result, env, calls, checksumInput, playwright } = setup();
  expect(result.status).toBe(0);
  expect(playwright).toBe(paths.playwrightCore);
  expect(calls).toEqual([
    ["node", "wisdom/claude-compat/proof/official-2644/fetch-official.mjs", paths.upstream, paths.runtime],
    [
      "curl",
      "-fL",
      "--retry",
      "3",
      "https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/-/claude-agent-sdk-0.3.276.tgz",
      "-o",
      paths.sdkArchive,
    ],
    ["sha256sum", "-c", "-"],
    ["tar", "-xzf", paths.sdkArchive, "-C", paths.sdkDirectory],
    [
      "node",
      "--input-type=module",
      "-e",
      expect.stringContaining('typeof sdk.getSubagentMessages !== "function"'),
      paths.sdkModule,
    ],
  ]);
  expect(checksumInput).toBe(`f65a23c8272467ec37da496c5a349b10b3b4d04f052209f239f028c5aabdc3ca  ${paths.sdkArchive}\n`);
  expect(env).toBe(
    existingEnv +
      `T3_UPSTREAM=${paths.upstream}\nBROWSER_PATH=${paths.browser}\nBRUV_CLAUDE_SDK_PATH=${paths.sdkModule}\n`,
  );
});

for (const [failure, status, commands] of [
  ["fetch-failure", 31, ["node"]],
  ["download-failure", 32, ["node", "curl"]],
  ["checksum-failure", 33, ["node", "curl", "sha256sum"]],
  ["extraction-failure", 34, ["node", "curl", "sha256sum", "tar"]],
  ["api-failure", 1, ["node", "curl", "sha256sum", "tar", "node"]],
] as const) {
  test(`native setup stops at ${failure} without a partial environment handoff`, () => {
    const { result, env, calls } = setup({ failure });
    expect(result.status).toBe(status);
    expect(env).toBe(existingEnv);
    expect(calls.map(([command]) => command)).toEqual([...commands]);
    if (failure === "api-failure") expect(result.stderr).toContain("Pinned SDK history API missing");
  });
}

for (const browserCount of [0, 2]) {
  test(`native setup rejects ${browserCount} headless shells before SDK setup`, () => {
    const { result, env, calls } = setup({ browserCount });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Expected exactly one pinned Chromium headless shell");
    expect(env).toBe(existingEnv);
    expect(calls.map(([command]) => command)).toEqual(["node"]);
  });
}
