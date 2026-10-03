import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const fixtures: string[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

function run(lane: "linux" | "macos", fail = "", cache = false) {
  const root = mkdtempSync(join(tmpdir(), "bruv-ci-runner-"));
  fixtures.push(root);
  const bin = join(root, "bin");
  const web = join(root, "web-source");
  const parentTmp = join(root, "temp");
  mkdirSync(parentTmp);
  writeFileSync(join(parentTmp, "user-session"), "leave alone");
  mkdirSync(join(root, "scripts"));
  mkdirSync(bin);
  copyFileSync(resolve(import.meta.dir, "../scripts/ci.sh"), join(root, "scripts/ci.sh"));
  copyFileSync(resolve(import.meta.dir, "../scripts/ci-web-validation.sh"), join(root, "scripts/ci-web-validation.sh"));
  for (const subdir of ["apps/server", "apps/web", "packages/contracts", "packages/client-runtime"]) {
    const dir = join(web, subdir);
    mkdirSync(join(dir, "../../node_modules/.bin"), { recursive: true });
    mkdirSync(dir, { recursive: true });
  }
  const stub = `#!/usr/bin/env bash
printf '%s|%s|%s\n' "$(basename "$0")" "$PWD" "$*" >> "$CALLS"
printf '%s\n' "$TMPDIR" >> "$TEMP_CALLS"
if [[ "$(basename "$0")" == bun && "$1" == -e ]]; then echo pinned-revision; exit 0; fi
if [[ "$*" == "$FAIL" ]]; then echo intentional-failure; exit 37; fi
if [[ "$*" == "test --parallel=3 ./tests" ]]; then echo "llm=$BRUV_RUN_LLM_TESTS"; fi
echo "completed $*"
`;
  writeFileSync(join(bin, "bun"), stub, { mode: 0o755 });
  for (const subdir of ["apps/server", "apps/web", "packages/contracts", "packages/client-runtime"]) {
    writeFileSync(join(web, subdir, "../../node_modules/.bin/vp"), stub, { mode: 0o755 });
    writeFileSync(join(web, subdir, "../../node_modules/.bin/tsc"), stub, { mode: 0o755 });
  }
  const calls = join(root, "calls");
  const result = spawnSync("bash", [join(root, "scripts/ci.sh"), lane], {
    cwd: root,
    env: {
      ...process.env,
      PATH: bin + ":" + process.env.PATH,
      BRUV_T3_SOURCE: web,
      BRUV_CI_WEB_CACHE: cache ? "1" : "0",
      CALLS: calls,
      FAIL: fail,
      TMPDIR: parentTmp,
      TEMP_CALLS: join(root, "temp-calls"),
    },
    encoding: "utf8",
  });
  const temps = readFileSync(join(root, "temp-calls"), "utf8").trim().split("\n");
  expect(new Set(temps).size).toBe(1);
  expect(temps[0]).toStartWith(parentTmp + "/bruv-ci.");
  expect(existsSync(temps[0]!)).toBe(false);
  expect(readFileSync(join(parentTmp, "user-session"), "utf8")).toBe("leave alone");
  return { root, result, calls: readFileSync(calls, "utf8").trim().split("\n") };
}

test("Linux builds the pair without preparing or validating bundled web", () => {
  const { root, result, calls } = run("linux");
  expect(result.status).toBe(0);
  expect(calls.map((line) => line.split("|")[2])).toEqual([
    "install --frozen-lockfile",
    "run format:check",
    "run lint",
    "run check",
    "run build",
    "scripts/offline-openai-default-transport.ts",
    "test --parallel=3 ./tests",
    "run smoke -- --reuse-build",
  ]);
  expect(readFileSync(join(root, "artifacts/ci/tests.log"), "utf8")).toContain("llm=0");
});

test("legacy web cache environment cannot re-enable bundled web production", () => {
  const { result, calls } = run("linux", "", true);
  expect(result.status).toBe(0);
  expect(calls.some((line) => line.includes("ci-web.ts"))).toBe(false);
  expect(calls.some((line) => line.includes("run build"))).toBe(true);
});

test("failed root tests prevent smoke", () => {
  const { result, calls } = run("linux", "test --parallel=3 ./tests");
  expect(result.status).not.toBe(0);
  expect(calls.some((line) => line.includes("run smoke"))).toBe(false);
});

test("a failed gate stops immediately and preserves its output", () => {
  const { root, result, calls } = run("linux", "run lint");
  expect(result.status).toBe(37);
  expect(calls.at(-1)).toContain("run lint");
  expect(readFileSync(join(root, "artifacts/ci/lint.log"), "utf8")).toContain("intentional-failure");
});

test("macOS lane runs only its device-free source and Live checks", () => {
  const { root, result, calls } = run("macos");
  expect(result.status).toBe(0);
  expect(calls.map((line) => line.split("|")[2])).toEqual([
    "install --frozen-lockfile",
    "run prepare:assets",
    "scripts/offline-openai-default-transport.ts --source-only",
    "test --parallel=3 tests/live-*.test.ts",
  ]);
  expect(readFileSync(join(root, "artifacts/ci/macos-live-tests.log"), "utf8")).toContain("completed");
});
