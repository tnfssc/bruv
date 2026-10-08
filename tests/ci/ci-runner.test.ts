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
  shard,
  nativeSuite = false,
}: {
  lane?: "linux" | "macos";
  failCommand?: string;
  logDirectory?: string;
  shard?: string;
  nativeSuite?: boolean;
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "bruv-ci-runner-"));
  fixtures.push(root);
  const bin = join(root, "bin");
  const parentTmp = join(root, "temp");
  mkdirSync(parentTmp);
  writeFileSync(join(parentTmp, "user-session"), "leave alone");
  mkdirSync(join(root, "scripts/ci"), { recursive: true });
  mkdirSync(bin);
  copyFileSync(resolve(import.meta.dir, "../../scripts/ci/ci.sh"), join(root, "scripts/ci/ci.sh"));
  copyFileSync(resolve(import.meta.dir, "../../package.json"), join(root, "package.json"));
  // Record each gate's working directory and temp ownership alongside its command.
  const stub = `#!/usr/bin/env bash
printf '%s|%s|%s\n' "$PWD" "$TMPDIR" "$*" >> "$CALLS"
test -d "$TMPDIR" || exit 38
printf 'owned transient state' > "$TMPDIR/owned-session"
if [[ "$*" == "$FAIL" ]]; then echo intentional-failure; exit 37; fi
if [[ "$1" == test ]]; then
  echo "llm=$BRUV_RUN_LLM_TESTS"
  if [[ "$NATIVE_SUITE" == 1 ]]; then exec "$REAL_BUN" "$@"; fi
fi
echo "completed $*"
`;
  writeFileSync(join(bin, "bun"), stub, { mode: 0o755 });
  if (nativeSuite) {
    mkdirSync(join(root, "tests"));
    for (let i = 0; i < 12; i++) {
      writeFileSync(
        join(root, "tests", `partition-${i}.test.ts`),
        `import { test, expect } from "bun:test";
import { appendFileSync } from "node:fs";
test("partition-${i}", () => { expect(1 + 1).toBe(2); appendFileSync(process.env.PARTITION_LOG!, "${i}\\n"); });`,
      );
    }
  }
  const callsPath = join(root, "calls");
  const env = { ...process.env };
  delete env.CI_TEST_SHARD;
  if (shard !== undefined) env.CI_TEST_SHARD = shard;
  const result = spawnSync(process.execPath, ["run", lane === "linux" ? "ci" : "ci:macos"], {
    cwd: root,
    env: {
      ...env,
      REAL_BUN: process.execPath,
      NATIVE_SUITE: nativeSuite ? "1" : "0",
      PARTITION_LOG: join(root, "partition.log"),
      PATH: bin + ":" + process.env.PATH,
      CALLS: callsPath,
      FAIL: failCommand,
      TMPDIR: parentTmp,
      CI_LOG_DIR: logDirectory,
      BRUV_RUN_LLM_TESTS: "1",
    },
    encoding: "utf8",
  });
  const calls = (existsSync(callsPath) ? readFileSync(callsPath, "utf8").trim().split("\n") : []).map((line) => {
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
    "run perf:resources --profile ci --out " + join(root, "artifacts/ci/resources"),
    "run perf:resources --profile stress --out " + join(root, "artifacts/ci/resources"),
    "run build",
    "scripts/ci/offline-openai-default-transport.ts",
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
  // Resource outputs belong under the selected log destination; every other argument is identical.
  expect(release.calls.map((call) => call.command)).toEqual(
    ci.calls.map((call) =>
      call.command.replace(join(ci.root, "artifacts/ci/resources"), "artifacts/release/ci/resources"),
    ),
  );
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
    "scripts/ci/offline-openai-default-transport.ts --source-only",
    "test --parallel=3 tests/live/live-*.test.ts",
  ]);
  expect(readFileSync(join(root, "artifacts/ci/macos-live-tests.log"), "utf8")).toContain("completed");
});

test("production CI caches downloads only and delegates paired validation to the shared runner", async () => {
  const workflow = await Bun.file(resolve(import.meta.dir, "../../.github/workflows/ci.yml")).text();
  expect(workflow).not.toContain("ci-web.ts");
  expect(workflow).not.toContain("PNPM_CONFIG_STORE_DIR");
  expect(workflow).not.toContain("pnpm/action-setup");
  expect(workflow).not.toContain("Compute pinned web producer key");
  const cacheWorkflows = ["ci.yml", "release.yml"];
  for (const filename of cacheWorkflows) {
    const text = await Bun.file(resolve(import.meta.dir, "../../.github/workflows/" + filename)).text();
    const parsed = Bun.YAML.parse(text) as {
      jobs: Record<string, { steps: { uses?: string; run?: string; with?: Record<string, string> }[] }>;
    };
    let downloadCaches = 0;
    for (const job of Object.values(parsed.jobs)) {
      if (filename === "ci.yml")
        for (const step of job.steps.filter((step) => step.uses?.startsWith("actions/cache")))
          expect(["${{ runner.temp }}/bruv-bun-cache", "${{ runner.temp }}/bruv-apt-cache/*.deb"]).toContain(
            step.with?.path ?? "",
          );
      for (const step of job.steps.filter(
        (step) => step.uses?.startsWith("actions/cache") && step.with?.path === "${{ runner.temp }}/bruv-bun-cache",
      )) {
        downloadCaches++;
        expect(step.with?.path).toBe("${{ runner.temp }}/bruv-bun-cache");
        expect(step.with?.key).toBe(
          "bun-download-v2-1.4.2-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('bun.lock', 'package.json') }}",
        );
        expect(step.with?.["restore-keys"]).toBe("bun-download-v2-1.4.2-${{ runner.os }}-${{ runner.arch }}-");
        expect(step.with?.key).not.toContain("bun-1.4.2-");
        expect(step.with?.["restore-keys"]).not.toContain("bun-1.4.2-");
      }
    }
    expect(downloadCaches).toBeGreaterThan(0);
  }
  const ci = Bun.YAML.parse(workflow) as { jobs: Record<string, { steps: { run?: string }[] }> };
  expect(ci.jobs.test!.steps.some((step) => step.run === "bun run ci")).toBe(true);
  const runner = await Bun.file(resolve(import.meta.dir, "../../scripts/ci/ci.sh")).text();
  for (const gate of [
    "bun install --frozen-lockfile",
    "bun run format:check",
    "bun run lint",
    "bun run check",
    'bun run perf:resources --profile ci --out "$log_dir/resources"',
    'bun run perf:resources --profile stress --out "$log_dir/resources"',
    "bun run build",
    "bun scripts/ci/offline-openai-default-transport.ts",
    "bun test --parallel=3 ./tests",
    "bun run smoke -- --reuse-build",
  ])
    expect(runner).toContain(gate);
  expect(runner).not.toContain("ci-web-validation.sh");
  expect(runner).not.toContain("--reuse-packed-web");
});

test("both CI lanes install ffmpeg before running PCM conversion tests", async () => {
  const workflow = await Bun.file(resolve(import.meta.dir, "../../.github/workflows/ci.yml")).text();
  const parsed = Bun.YAML.parse(workflow) as {
    jobs: Record<string, { steps: { run?: string }[] }>;
  };
  for (const [job, install, gate] of [
    ["test", "bash scripts/ci/install-ci-linux-tools.sh", "bun run ci"],
    ["live-macos", "brew install ffmpeg", "bun run ci:macos"],
  ] as const) {
    const steps = parsed.jobs[job]!.steps;
    const setup = steps.findIndex((step) => step.run?.includes(install));
    expect(setup).toBeGreaterThanOrEqual(0);
    if (job === "live-macos") {
      expect(steps[setup]!.run).toContain("command -v ffmpeg >/dev/null ||");
      expect(steps[setup]!.run).toContain("ffmpeg -version");
    } else {
      const installer = await Bun.file(resolve(import.meta.dir, "../../scripts/ci/install-ci-linux-tools.sh")).text();
      expect(installer).toContain("ordinary_packages=(tmux ffmpeg)");
      expect(installer).toContain("ffmpeg -version");
    }
    expect(steps.findIndex((step) => step.run === gate)).toBeGreaterThan(setup);
  }
});

for (const shard of ["1/3", "2/3", "3/3"]) {
  test("Linux shard " + shard + " keeps every gate and three bounded workers", () => {
    const complete = runCi();
    const sharded = runCi({ shard });
    expectOwnedTempCleaned(sharded);
    expect(sharded.result.status).toBe(0);
    expect(sharded.calls.map((call) => call.command)).toEqual(
      complete.calls.map((call) =>
        call.command
          .replace(join(complete.root, "artifacts/ci/resources"), join(sharded.root, "artifacts/ci/resources"))
          .replace("test --parallel=3 ./tests", "test --parallel=3 ./tests --shard=" + shard),
      ),
    );
    expect(readFileSync(join(sharded.root, "artifacts/ci/tests.log"), "utf8")).toContain("llm=0");
  });
}

test("failed sharded tests retain logs and prevent smoke", () => {
  const run = runCi({ shard: "2/3", failCommand: "test --parallel=3 ./tests --shard=2/3" });
  expectOwnedTempCleaned(run);
  expect(run.result.status).toBe(37);
  expect(run.calls.at(-1)?.command).toBe("test --parallel=3 ./tests --shard=2/3");
  expect(readFileSync(join(run.root, "artifacts/ci/tests.log"), "utf8")).toContain("intentional-failure");
});

for (const shard of ["", "0/3", "4/3", "1/2", "1", "1/3 --only", "01/3"]) {
  test("invalid shard fails closed before installing: " + JSON.stringify(shard), () => {
    const run = runCi({ shard });
    expect(run.result.status).toBe(2);
    expect(run.calls).toEqual([]);
    expect(run.result.stderr).toContain("CI_TEST_SHARD must be");
  });
}

test("macOS does not silently accept a Linux shard", () => {
  const run = runCi({ lane: "macos", shard: "1/3" });
  expect(run.result.status).toBe(2);
  expect(run.calls).toEqual([]);
});

test("native Bun shards form a disjoint complete partition of the unsharded runner", () => {
  const complete = runCi({ nativeSuite: true });
  expect(complete.result.status).toBe(0);
  const executed = (root: string) => readFileSync(join(root, "partition.log"), "utf8").trim().split("\n").sort();
  const whole = executed(complete.root);
  expect(whole).toHaveLength(12);
  const combined: string[] = [];
  for (const shard of ["1/3", "2/3", "3/3"]) {
    const run = runCi({ shard, nativeSuite: true });
    expect(run.result.status).toBe(0);
    expectOwnedTempCleaned(run);
    const subset = executed(run.root);
    expect(subset.length).toBeGreaterThan(0);
    for (const id of subset) expect(combined).not.toContain(id);
    combined.push(...subset);
  }
  expect(combined.sort()).toEqual(whole);
}, 15_000);
