import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const fixtures: string[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

function run(lane: "linux" | "macos", fail = "") {
  const root = mkdtempSync(join(tmpdir(), "bruv-ci-runner-"));
  fixtures.push(root);
  const bin = join(root, "bin");
  const parentTmp = join(root, "temp");
  mkdirSync(parentTmp);
  writeFileSync(join(parentTmp, "user-session"), "leave alone");
  mkdirSync(join(root, "scripts"));
  mkdirSync(bin);
  copyFileSync(resolve(import.meta.dir, "../scripts/ci.sh"), join(root, "scripts/ci.sh"));
  const stub = `#!/usr/bin/env bash
printf '%s|%s|%s\n' "$(basename "$0")" "$PWD" "$*" >> "$CALLS"
printf '%s\n' "$TMPDIR" >> "$TEMP_CALLS"
if [[ "$*" == "$FAIL" ]]; then echo intentional-failure; exit 37; fi
if [[ "$*" == "test --parallel=3 ./tests" ]]; then echo "llm=$BRUV_RUN_LLM_TESTS"; fi
echo "completed $*"
`;
  writeFileSync(join(bin, "bun"), stub, { mode: 0o755 });
  const calls = join(root, "calls");
  const result = spawnSync("bash", [join(root, "scripts/ci.sh"), lane], {
    cwd: root,
    env: {
      ...process.env,
      PATH: bin + ":" + process.env.PATH,
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

test("production CI caches downloads only and delegates paired validation to the shared runner", async () => {
  const workflow = await Bun.file(resolve(import.meta.dir, "../.github/workflows/ci.yml")).text();
  expect(workflow).not.toContain("ci-web.ts");
  expect(workflow).not.toContain("PNPM_CONFIG_STORE_DIR");
  expect(workflow).not.toContain("pnpm/action-setup");
  expect(workflow).not.toContain("Compute pinned web producer key");
  const parsed = Bun.YAML.parse(workflow) as {
    jobs: Record<string, { steps: { uses?: string; run?: string; with?: Record<string, string> }[] }>;
  };
  let downloadCaches = 0;
  for (const job of Object.values(parsed.jobs)) {
    for (const step of job.steps.filter((step) => step.uses?.startsWith("actions/cache"))) {
      downloadCaches++;
      expect(step.with?.path).toBe("${{ runner.temp }}/bruv-bun-cache");
      expect(step.with?.key).toContain("bun-1.4.2-");
    }
  }
  expect(downloadCaches).toBeGreaterThan(0);
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
