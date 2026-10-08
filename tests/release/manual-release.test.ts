import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { nextReleaseVersion } from "../../scripts/prepare-manual-release";

function git(root: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

function prepare(root: string) {
  return spawnSync(process.execPath, ["scripts/prepare-manual-release.ts"], { cwd: root, encoding: "utf8" });
}

// Each scenario starts one commit beyond v0.15.2; only its own release state can affect it.
async function withReleaseRepository(scenario: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "bruv-manual-release-"));
  try {
    await mkdir(join(root, "scripts"));
    await mkdir(join(root, "support/releases"), { recursive: true });
    await writeFile(
      join(root, "scripts/prepare-manual-release.ts"),
      await Bun.file("scripts/prepare-manual-release.ts").text(),
    );
    await writeFile(join(root, "package.json"), '{"version": "0.15.2"}\n');
    git(root, "init", "-q");
    git(root, "config", "user.name", "Test");
    git(root, "config", "user.email", "test@example.com");
    git(root, "commit", "--allow-empty", "-qm", "Previous release");
    git(root, "-c", "tag.gpgSign=false", "tag", "-a", "-m", "previous", "v0.15.2");
    git(root, "commit", "--allow-empty", "-qm", "Improve update behavior");
    await scenario(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("manual release preparation", () => {
  test("prepares version and notes idempotently without committing or tagging", async () => {
    await withReleaseRepository(async (root) => {
      const head = git(root, "rev-parse", "HEAD");
      const notesPath = join(root, "support/releases/release-v0.15.3.md");
      const first = prepare(root);
      expect(first.status, first.stderr).toBe(0);
      expect(first.stdout).toBe("v0.15.3");
      const pkg = await readFile(join(root, "package.json"), "utf8");
      const notes = await readFile(notesPath, "utf8");
      expect(pkg).toContain('"version": "0.15.3"');
      expect(notes).toContain("- Improve update behavior");

      const repeated = prepare(root);
      expect(repeated.status, repeated.stderr).toBe(0);
      expect(repeated.stdout).toBe("v0.15.3");
      expect(await readFile(join(root, "package.json"), "utf8")).toBe(pkg);
      expect(await readFile(notesPath, "utf8")).toBe(notes);
      expect(git(root, "rev-parse", "HEAD")).toBe(head);
      expect(git(root, "tag", "-l")).toBe("v0.15.2");
    });
  });

  test("keeps reviewed notes instead of regenerating them", async () => {
    await withReleaseRepository(async (root) => {
      const notesPath = join(root, "support/releases/release-v0.15.3.md");
      await writeFile(notesPath, "Reviewed notes\n");
      const result = prepare(root);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe("v0.15.3");
      expect(await readFile(notesPath, "utf8")).toBe("Reviewed notes\n");
    });
  });

  test.each(["unprepared", "prepared"] as const)(
    "refuses empty notes without changing the %s package",
    async (state) => {
      await withReleaseRepository(async (root) => {
        if (state === "prepared") {
          const result = prepare(root);
          expect(result.status, result.stderr).toBe(0);
        }
        const pkg = await readFile(join(root, "package.json"), "utf8");
        await writeFile(join(root, "support/releases/release-v0.15.3.md"), "");
        const result = prepare(root);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("release notes are empty");
        expect(await readFile(join(root, "package.json"), "utf8")).toBe(pkg);
      });
    },
  );

  test("refuses another release with no commits beyond the latest tag", async () => {
    await withReleaseRepository(async (root) => {
      const prepared = prepare(root);
      expect(prepared.status, prepared.stderr).toBe(0);
      git(root, "-c", "tag.gpgSign=false", "tag", "-a", "-m", "current", "v0.15.3");
      const result = prepare(root);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("no changes since last release");
      expect(await readFile(join(root, "package.json"), "utf8")).toContain('"version": "0.15.3"');
    });
  });

  test("bumps patch by default, including when package lags behind latest tag", () => {
    expect(nextReleaseVersion("0.15.2", "v0.15.2")).toBe("0.15.3");
    expect(nextReleaseVersion("0.14.7", "v0.15.2")).toBe("0.15.3");
    expect(nextReleaseVersion("0.15.2")).toBe("0.15.3");
  });
  test("preserves a version already prepared on develop", () => {
    expect(nextReleaseVersion("0.16.0", "v0.15.2")).toBe("0.16.0");
  });
  test("refuses prerelease and malformed versions", () => {
    expect(() => nextReleaseVersion("0.16.0-beta", "v0.15.2")).toThrow();
    expect(() => nextReleaseVersion("0.15.2", "vbroken")).toThrow();
  });
});

interface ReleaseStep {
  id?: string;
  env?: Record<string, string>;
  with?: { ref?: string };
  run?: string;
}

interface ReleaseJob {
  if: string;
  needs?: string | string[];
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  steps: ReleaseStep[];
}

const workflow = Bun.YAML.parse(await Bun.file(".github/workflows/release.yml").text()) as {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: Record<string, ReleaseJob>;
};
const { jobs } = workflow;

// These workflow predicates use the shared JS/Actions boolean subset, not a full Actions emulator.
function releaseExpression(expression: string, github: object, needs: object, cancelled = false): unknown {
  const body = expression.slice(3, -2).replace(/needs\.([a-z-]+)/g, 'needs["$1"]');
  return new Function("github", "needs", "always", "cancelled", "startsWith", "contains", "return " + body)(
    github,
    needs,
    () => true,
    () => cancelled,
    (value: string, prefix: string) => value.startsWith(prefix),
    (value: string, part: string) => value.includes(part),
  );
}

describe("release workflow", () => {
  test("dispatch pins every build, gate and publication checkout to the admitted commit", () => {
    expect(workflow.on.workflow_dispatch).toBeNull();
    expect(jobs["prepare-manual"]?.if).toContain("github.ref == 'refs/heads/develop'");
    expect(jobs["release-source"]?.needs).toEqual("prepare-manual");
    expect(jobs["mac-helper"]!.needs).toBe("release-source");
    expect(jobs.release!.needs).toEqual(["release-source", "mac-helper"]);
    for (const name of ["mac-helper", "release", "linux-browser-boot", "mac-release-smoke", "publish"]) {
      expect(jobs[name]?.needs).toContain("release-source");
      expect(jobs[name]?.steps.some((step) => step.with?.ref === `\${{ needs.release-source.outputs.sha }}`)).toBe(
        true,
      );
    }
  });

  test("builds paired target assets with checksums, native helper and updater checks", () => {
    const release = jobs.release!.steps.map((step) => step.run ?? "").join("\n");
    expect(release).toContain('"$RELEASE_SHA"');
    expect(release).toContain('"$RELEASE_TAG"');
    expect(release).toContain('sha256sum "$binary" > "$binary.sha256"');
    expect(release).toContain("bruv-{linux-x64,linux-arm64,darwin-arm64,android-arm64}");
    expect(release).toContain("bruv-claude-compat-{linux-x64,linux-arm64,darwin-arm64,android-arm64}");
    for (const target of ["bun-linux-x64-baseline", "bun-linux-arm64", "bun-darwin-arm64", "bun-android-arm64"]) {
      expect(release).toContain("--target=" + target);
    }
    expect(release).toContain("--live-helper=./artifacts/release/mac-helper/live-audio");
    expect(release).toContain("bun scripts/verify-update.ts dist/release/bruv-linux-x64");
    expect(release).toContain("--legacy-updater");
  });

  test("separates Linux native setup from the acceptance step", () => {
    const native = jobs["linux-browser-boot"]!;
    expect(native.needs).toContain("release");
    expect(native.if).toContain("needs.release.result == 'success'");
    const nativeRuns = native.steps.map((step) => step.run ?? "");
    expect(nativeRuns).toContain("bash scripts/setup-native-release-gate.sh");
    const acceptance = nativeRuns.find((run) => run.includes("node scripts/run-native-release-gate.mjs"))!;
    expect(acceptance).toContain(
      'BRUV_CONNECTOR_EXECUTABLE="$GITHUB_WORKSPACE/dist/release/bruv-claude-compat-linux-x64"',
    );
    expect(acceptance).toContain('BRUV_RUNTIME_BINARY="$GITHUB_WORKSPACE/dist/release/bruv-linux-x64"');
    expect(acceptance).toContain("dist/release/bruv-claude-compat-linux-x64 --version");
    expect(acceptance).toContain("dist/release/bruv-claude-compat-linux-x64 --bruv-version");
    expect(acceptance).toContain("Bruv connector");
    // Setup exports GITHUB_ENV for the next step; it cannot share a run block.
    expect(acceptance).not.toContain("setup-native-release-gate.sh");
  });

  test("keeps paired Mac version checks and both updater modes", () => {
    const mac = jobs["mac-release-smoke"]!.steps.map((step) => step.run ?? "").join("\n");
    expect(mac).toContain("dist/release/bruv-claude-compat-darwin-arm64 --version");
    expect(mac).toContain("dist/release/bruv-claude-compat-darwin-arm64 --bruv-version");
    expect(mac).toContain("Bruv connector");
    expect(mac).toContain("bun scripts/verify-update.ts dist/release/bruv-darwin-arm64");
    expect(mac).toContain("--legacy-updater");
    expect(mac).toContain("--live-self-test");
  });

  test("publishes only after gates pass, with verified tags, Android checksums and notices", async () => {
    for (const gate of ["release", "linux-browser-boot", "mac-release-smoke"]) {
      expect(jobs.publish!.needs).toContain(gate);
      expect(jobs.publish!.if).toContain("needs." + gate + ".result == 'success'");
    }
    const publish = jobs.publish!.steps.map((step) => step.run ?? "").join("\n");
    expect(publish).toContain("bun scripts/publish-release.ts");
    const implementation = await Bun.file("scripts/publish-release.ts").text();
    expect(implementation).toContain('git("push"');
    expect(implementation).toContain("--verify-tag");
    expect(implementation).toContain("bruv-android-arm64.sha256");
    expect(implementation).toContain("THIRD_PARTY_LICENSES.txt");
  });

  test("only preparation and publication have write permissions", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(Object.keys(jobs).filter((name) => jobs[name]!.permissions?.contents === "write")).toEqual([
      "prepare-manual",
      "publish",
    ]);
  });

  test.each([
    ["workflow_dispatch", "refs/heads/develop", "success", true],
    ["workflow_dispatch", "refs/heads/develop", "failure", false],
    ["workflow_dispatch", "refs/heads/develop", "cancelled", false],
    ["workflow_dispatch", "refs/heads/main", "skipped", false],
    ["push", "refs/tags/v1.2.3", "skipped", true],
    ["push", "refs/tags/v1.2.3-beta.1", "skipped", false],
    ["push", "refs/heads/develop", "skipped", false],
  ] as const)("admission: %s on %s after %s", (event, ref, preparation, admitted) => {
    const github = { event_name: event, ref, ref_name: ref.split("/").at(-1) };
    expect(releaseExpression(jobs["release-source"]!.if, github, { "prepare-manual": { result: preparation } })).toBe(
      admitted,
    );
  });

  test.each([
    ["mac-helper", ["release-source"]],
    ["release", ["release-source", "mac-helper"]],
    ["linux-browser-boot", ["release"]],
    ["mac-release-smoke", ["release"]],
    ["publish", ["release-source", "release", "linux-browser-boot", "mac-release-smoke"]],
  ] as const)("%s remains blocked by every failed, cancelled or skipped prerequisite", (name, required) => {
    const successful = Object.fromEntries(Object.keys(jobs).map((name) => [name, { result: "success" }]));
    const job = jobs[name]!;
    expect(releaseExpression(job.if, {}, successful)).toBe(true);
    // Every prerequisite that can block this job must stay blocking while evaluating after failures.
    for (const prerequisite of required) {
      for (const result of ["failure", "cancelled", "skipped"]) {
        expect(releaseExpression(job.if, {}, { ...successful, [prerequisite]: { result } })).toBe(false);
      }
    }
  });

  test("a cancelled run stops admission, build, artifact checks and publish", () => {
    const github = { event_name: "push", ref: "refs/tags/v1.2.3" };
    const successful = Object.fromEntries(Object.keys(jobs).map((name) => [name, { result: "success" }]));
    for (const name of [
      "release-source",
      "mac-helper",
      "release",
      "linux-browser-boot",
      "mac-release-smoke",
      "publish",
    ]) {
      expect(releaseExpression(jobs[name]!.if, github, successful, true)).toBe(false);
    }
  });

  test.each([
    ["prepared dispatch", { sha: "prepared-sha", tag: "v1.2.4" }, "sha=prepared-sha\ntag=v1.2.4\n"],
    ["tag push", {}, "sha=pushed-sha\ntag=v1.2.3\n"],
  ] as const)("release source emits the %s identity unchanged", async (_name, prepared, expected) => {
    const source = jobs["release-source"]!;
    const step = source.steps[0]!;
    expect(source.outputs).toEqual({
      sha: `\${{ steps.source.outputs.sha }}`,
      tag: `\${{ steps.source.outputs.tag }}`,
    });
    expect(step.id).toBe("source");
    const directory = await mkdtemp(join(tmpdir(), "bruv-release-source-"));
    try {
      const github = { sha: "pushed-sha", ref_name: "v1.2.3" };
      const needs = { "prepare-manual": { outputs: prepared } };
      const output = join(directory, "output");
      const env = Object.fromEntries(
        Object.entries(step.env!).map(([name, expression]) => [
          name,
          String(releaseExpression(expression, github, needs)),
        ]),
      );
      const result = spawnSync("bash", ["-e", "-c", step.run!], {
        env: { ...process.env, ...env, GITHUB_OUTPUT: output },
        encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(0);
      expect(await readFile(output, "utf8")).toBe(expected);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
