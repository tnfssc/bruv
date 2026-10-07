import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// Execute the real setup without downloads. The final SDK API probe uses real Node.
function setup(mode = "ready", browserCount = 1) {
  const root = mkdtempSync(join(tmpdir(), "native setup "));
  try {
    const bin = join(root, "bin");
    const browsers = join(root, "browsers");
    mkdirSync(bin);
    mkdirSync(browsers);
    mkdirSync(join(root, "release-browser/node_modules/playwright-core"), { recursive: true });
    for (let i = 0; i < browserCount; i++) {
      const directory = join(browsers, String(i));
      mkdirSync(directory);
      writeFileSync(join(directory, i === 0 ? "chrome-headless-shell" : "headless_shell"), "fixture");
    }
    const envFile = join(root, "env");
    writeFileSync(envFile, "EXISTING=value\n");
    const stubs: Record<string, string[]> = {
      node: [
        'if [[ "$1" == wisdom/claude-compat/proof/official-2644/fetch-official.mjs ]]; then',
        '  [[ "$MODE" != fetch-failure ]] || exit 31',
        '  mkdir "$2"; ln -s "$3" "$2/runtime"',
        "else",
        '  exec "$REAL_NODE" "$@"',
        "fi",
      ],
      curl: ['[[ "$MODE" != download-failure ]] || exit 32', 'touch "$RUNNER_TEMP/native-claude-sdk/sdk.tgz"'],
      sha256sum: ['cat >> "$RUNNER_TEMP/calls"', '[[ "$MODE" != checksum-failure ]] || exit 33'],
      tar: [
        '[[ "$MODE" != extraction-failure ]] || exit 34',
        'mkdir "$RUNNER_TEMP/native-claude-sdk/package"',
        'if [[ "$MODE" == api-failure ]]; then',
        '  echo "export const unavailable = true;"',
        "else",
        '  echo "export function getSubagentMessages() {}"',
        'fi > "$RUNNER_TEMP/native-claude-sdk/package/sdk.mjs"',
      ],
    };
    for (const [command, body] of Object.entries(stubs)) {
      writeFileSync(
        join(bin, command),
        [
          "#!/bin/bash",
          "set -euo pipefail",
          'printf "%s\\n" "' + command + ' $*" >> "$RUNNER_TEMP/calls"',
          ...body,
          "",
        ].join("\n"),
        { mode: 0o755 },
      );
    }
    const result = spawnSync("/bin/bash", [join(import.meta.dir, "../scripts/setup-native-release-gate.sh")], {
      encoding: "utf8",
      cwd: join(import.meta.dir, ".."),
      env: {
        ...process.env,
        PATH: bin + ":" + process.env.PATH,
        RUNNER_TEMP: root,
        GITHUB_ENV: envFile,
        PLAYWRIGHT_BROWSERS_PATH: browsers,
        REAL_NODE: Bun.which("node")!,
        MODE: mode,
      },
    });
    return {
      root,
      result,
      env: readFileSync(envFile, "utf8"),
      calls: readFileSync(join(root, "calls"), "utf8"),
      playwright: readlinkSync(join(root, "native-browser-runtime/node_modules/playwright")),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const existingEnv = "EXISTING=value\n";

test("native setup verifies pinned inputs before handing off all three gate paths", () => {
  const { root, result, env, calls, playwright } = setup();
  expect(result.status).toBe(0);
  expect(playwright).toBe(join(root, "release-browser/node_modules/playwright-core"));
  expect(calls).toContain(
    "node wisdom/claude-compat/proof/official-2644/fetch-official.mjs " +
      root +
      "/native-t3 " +
      root +
      "/native-browser-runtime",
  );
  expect(calls).toContain(
    "curl -fL --retry 3 https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/-/claude-agent-sdk-0.3.276.tgz -o " +
      root +
      "/native-claude-sdk/sdk.tgz",
  );
  expect(calls).toContain(
    "sha256sum -c -\nf65a23c8272467ec37da496c5a349b10b3b4d04f052209f239f028c5aabdc3ca  " +
      root +
      "/native-claude-sdk/sdk.tgz\n",
  );
  expect(calls).toContain("tar -xzf " + root + "/native-claude-sdk/sdk.tgz -C " + root + "/native-claude-sdk");
  expect(env).toBe(
    existingEnv +
      "T3_UPSTREAM=" +
      root +
      "/native-t3\nBROWSER_PATH=" +
      root +
      "/browsers/0/chrome-headless-shell\nBRUV_CLAUDE_SDK_PATH=" +
      root +
      "/native-claude-sdk/package/sdk.mjs\n",
  );
});

test("native setup failures leave the existing environment handoff untouched", () => {
  for (const [mode, status] of [
    ["fetch-failure", 31],
    ["download-failure", 32],
    ["checksum-failure", 33],
    ["extraction-failure", 34],
    ["api-failure", 1],
  ] as const) {
    const { result, env, calls } = setup(mode);
    expect(result.status).toBe(status);
    expect(env).toBe(existingEnv);
    if (mode === "checksum-failure") expect(calls).not.toContain("tar -xzf");
    if (mode === "api-failure") expect(result.stderr).toContain("Pinned SDK history API missing");
  }
});

test("native setup rejects absent or ambiguous headless shells before SDK setup", () => {
  for (const count of [0, 2]) {
    const { result, env, calls } = setup("ready", count);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Expected exactly one pinned Chromium headless shell");
    expect(env).toBe(existingEnv);
    expect(calls).not.toContain("curl ");
  }
});
