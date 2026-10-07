import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const fixtures: string[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

function runCi({
  lane = "linux",
  failCommand = "",
  logDirectory = "",
}: {
  lane?: "linux" | "macos";
  failCommand?: string;
  logDirectory?: string;
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "bruv-ci-runner-"));
  fixtures.push(root);
  const bin = join(root, "bin");
  const parentTmp = join(root, "temp");
  mkdirSync(parentTmp);
  writeFileSync(join(parentTmp, "user-session"), "leave alone");
  mkdirSync(join(root, "scripts"));
  mkdirSync(bin);
  copyFileSync(resolve(import.meta.dir, "../scripts/ci.sh"), join(root, "scripts/ci.sh"));
  copyFileSync(resolve(import.meta.dir, "../package.json"), join(root, "package.json"));
  // Record each gate's working directory and temp ownership alongside its command.
  const stub = `#!/usr/bin/env bash
printf '%s|%s|%s\n' "$PWD" "$TMPDIR" "$*" >> "$CALLS"
test -d "$TMPDIR" || exit 38
printf 'owned transient state' > "$TMPDIR/owned-session"
if [[ "$*" == "$FAIL" ]]; then echo intentional-failure; exit 37; fi
if [[ "$*" == "test --parallel=3 ./tests" ]]; then echo "llm=$BRUV_RUN_LLM_TESTS"; fi
echo "completed $*"
`;
  writeFileSync(join(bin, "bun"), stub, { mode: 0o755 });
  const callsPath = join(root, "calls");
  const result = spawnSync(process.execPath, ["run", lane === "linux" ? "ci" : "ci:macos"], {
    cwd: root,
    env: {
      ...process.env,
      PATH: bin + ":" + process.env.PATH,
      CALLS: callsPath,
      FAIL: failCommand,
      TMPDIR: parentTmp,
      CI_LOG_DIR: logDirectory,
      BRUV_RUN_LLM_TESTS: "1",
    },
    encoding: "utf8",
  });
  const calls = readFileSync(callsPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const [cwd, tempDirectory, command] = line.split("|");
      return { cwd: cwd!, tempDirectory: tempDirectory!, command: command! };
    });
  return { root, parentTmp, result, calls };
}

function expectOwnedTempCleaned({ parentTmp, calls }: ReturnType<typeof runCi>) {
  const temps = new Set(calls.map((call) => call.tempDirectory));
  expect(temps.size).toBe(1);
  const [temp] = temps;
  expect(temp).toStartWith(parentTmp + "/bruv-ci.");
  expect(existsSync(temp!)).toBe(false);
  expect(readFileSync(join(parentTmp, "user-session"), "utf8")).toBe("leave alone");
}

test("Linux builds the pair without preparing or validating bundled web", () => {
  const run = runCi();
  expectOwnedTempCleaned(run);
  const { root, result, calls } = run;
  expect(result.status).toBe(0);
  expect(calls.map((call) => call.command)).toEqual([
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

test("failed root tests prevent smoke", () => {
  const run = runCi({ failCommand: "test --parallel=3 ./tests" });
  expectOwnedTempCleaned(run);
  const { result, calls } = run;
  expect(result.status).toBe(37);
  expect(calls.some((call) => call.command.includes("run smoke"))).toBe(false);
});

test("a failed gate stops immediately and preserves its output", () => {
  const run = runCi({ failCommand: "run lint" });
  expectOwnedTempCleaned(run);
  const { root, result, calls } = run;
  expect(result.status).toBe(37);
  expect(calls.at(-1)?.command).toBe("run lint");
  expect(readFileSync(join(root, "artifacts/ci/lint.log"), "utf8")).toContain("intentional-failure");
});

test("Release log destination uses the same Linux commands, env and owned temp", () => {
  const ci = runCi();
  const release = runCi({ logDirectory: "artifacts/release/ci" });
  expectOwnedTempCleaned(ci);
  expectOwnedTempCleaned(release);
  expect(release.result.status).toBe(0);
  expect(release.calls.map((call) => call.command)).toEqual(ci.calls.map((call) => call.command));
  for (const { root, calls } of [ci, release]) {
    expect(calls.every((call) => call.cwd === root)).toBe(true);
  }
  for (const log of ["install", "format", "lint", "typecheck", "build", "openai-transport", "tests", "smoke"]) {
    expect(readFileSync(join(release.root, "artifacts/release/ci", log + ".log"), "utf8")).toEqual(
      readFileSync(join(ci.root, "artifacts/ci", log + ".log"), "utf8"),
    );
  }
  expect(readFileSync(join(release.root, "artifacts/release/ci/tests.log"), "utf8")).toContain("llm=0");
  expect(existsSync(join(release.root, "artifacts/ci"))).toBe(false);
});

test("Release test failure propagates its exact exit, retains logs, cleans temp and prevents smoke", () => {
  const run = runCi({ failCommand: "test --parallel=3 ./tests", logDirectory: "artifacts/release/ci" });
  expectOwnedTempCleaned(run);
  const { root, result, calls } = run;
  expect(result.status).toBe(37);
  expect(calls.at(-1)?.command).toBe("test --parallel=3 ./tests");
  expect(existsSync(join(root, "artifacts/release/ci/smoke.log"))).toBe(false);
  expect(readFileSync(join(root, "artifacts/release/ci/tests.log"), "utf8")).toContain("intentional-failure");
});

test("macOS lane runs only its device-free source and Live checks", () => {
  const run = runCi({ lane: "macos" });
  expectOwnedTempCleaned(run);
  const { root, result, calls } = run;
  expect(result.status).toBe(0);
  expect(calls.map((call) => call.command)).toEqual([
    "install --frozen-lockfile",
    "run prepare:assets",
    "scripts/offline-openai-default-transport.ts --source-only",
    "test --parallel=3 tests/live-*.test.ts",
  ]);
  expect(readFileSync(join(root, "artifacts/ci/macos-live-tests.log"), "utf8")).toContain("completed");
});

test("production CI caches downloads only and delegates paired validation to the shared runner", async () => {
  const workflow = await Bun.file(resolve(import.meta.dir, "../.github/workflows/ci.yml")).text();
  expect(workflow).not.toContain("ci-web.ts");
  expect(workflow).not.toContain("PNPM_CONFIG_STORE_DIR");
  expect(workflow).not.toContain("pnpm/action-setup");
  expect(workflow).not.toContain("Compute pinned web producer key");
  const parsed = Bun.YAML.parse(workflow) as {
    jobs: Record<string, { steps: { uses?: string; run?: string; with?: Record<string, string> }[] }>;
  };
  const downloadCaches = Object.values(parsed.jobs).flatMap((job) =>
    job.steps.filter((step) => step.uses?.startsWith("actions/cache")),
  );
  expect(downloadCaches.length).toBeGreaterThan(0);
  for (const cache of downloadCaches) {
    expect(cache.with?.path).toBe("${{ runner.temp }}/bruv-bun-cache");
    expect(cache.with?.key).toContain("bun-1.4.2-");
  }
  expect(parsed.jobs.test!.steps.some((step) => step.run === "bun run ci")).toBe(true);
  const runner = await Bun.file(resolve(import.meta.dir, "../scripts/ci.sh")).text();
  for (const gate of [
    "bun install --frozen-lockfile",
    "bun run format:check",
    "bun run lint",
    "bun run check",
    "bun run build",
    "bun scripts/offline-openai-default-transport.ts",
    "bun test --parallel=3 ./tests",
    "bun run smoke -- --reuse-build",
  ])
    expect(runner).toContain(gate);
  expect(runner).not.toContain("ci-web-validation.sh");
  expect(runner).not.toContain("--reuse-packed-web");
});

test("both CI lanes install ffmpeg before running PCM conversion tests", async () => {
  const workflow = await Bun.file(resolve(import.meta.dir, "../.github/workflows/ci.yml")).text();
  const parsed = Bun.YAML.parse(workflow) as {
    jobs: Record<string, { steps: { run?: string }[] }>;
  };
  for (const [job, install, gate] of [
    ["test", "sudo apt-get update && sudo apt-get install -y ffmpeg", "bun run ci"],
    ["live-macos", "brew install ffmpeg", "bun run ci:macos"],
  ] as const) {
    const steps = parsed.jobs[job]!.steps;
    const setup = steps.findIndex((step) => step.run?.includes(install));
    expect(setup).toBeGreaterThanOrEqual(0);
    expect(steps[setup]!.run).toContain("command -v ffmpeg >/dev/null ||");
    expect(steps[setup]!.run).toContain("ffmpeg -version");
    expect(steps.findIndex((step) => step.run === gate)).toBeGreaterThan(setup);
  }
});
