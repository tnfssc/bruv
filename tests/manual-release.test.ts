import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { nextReleaseVersion } from "../scripts/prepare-manual-release";

describe("manual release preparation", () => {
  test("prepares version and notes in an isolated local git fixture without publishing", async () => {
    const root = await mkdtemp(join(tmpdir(), "bruv-manual-release-"));
    const git = (...args: string[]) => {
      const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
    };
    try {
      await mkdir(join(root, "scripts"));
      await mkdir(join(root, "support"));
      await writeFile(
        join(root, "scripts/prepare-manual-release.ts"),
        await Bun.file("scripts/prepare-manual-release.ts").text(),
      );
      await writeFile(join(root, "package.json"), '{"version": "0.15.2"}\n');
      git("init", "-q");
      git("config", "user.name", "Test");
      git("config", "user.email", "test@example.com");
      git(
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "--allow-empty",
        "-qm",
        "Previous release",
      );
      git("-c", "tag.gpgSign=false", "tag", "-a", "-m", "previous", "v0.15.2");
      git(
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "--allow-empty",
        "-qm",
        "Improve update behavior",
      );
      const run = () =>
        spawnSync(process.execPath, ["scripts/prepare-manual-release.ts"], { cwd: root, encoding: "utf8" });
      const first = run();
      expect(first.status, first.stderr).toBe(0);
      expect(first.stdout).toBe("v0.15.3");
      expect(await readFile(join(root, "package.json"), "utf8")).toContain('"version": "0.15.3"');
      expect(await readFile(join(root, "support/release-v0.15.3.md"), "utf8")).toContain("- Improve update behavior");
      const second = run();
      expect(second.status, second.stderr).toBe(0);
      expect(second.stdout).toBe("v0.15.3");
      await writeFile(join(root, "support/release-v0.15.3.md"), "");
      expect(run().status).not.toBe(0);
      await writeFile(join(root, "support/release-v0.15.3.md"), "Reviewed notes\n");
      git("-c", "tag.gpgSign=false", "tag", "-a", "-m", "current", "v0.15.3");
      const third = run();
      expect(third.status).not.toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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
  test("dispatch pins gates and publication to prepared commit without dropping native and updater gates", async () => {
    const workflow = Bun.YAML.parse(await Bun.file(".github/workflows/release.yml").text()) as {
      on: Record<string, unknown>;
      jobs: Record<string, { needs?: string[]; if?: string; steps: { with?: { ref?: string }; run?: string }[] }>;
    };
    expect(workflow.on.workflow_dispatch).toBeNull();
    const jobs = workflow.jobs;
    expect(jobs["prepare-manual"]?.if).toContain("github.ref == 'refs/heads/develop'");
    for (const name of ["mac-helper", "release", "linux-browser-boot", "mac-release-smoke", "publish"]) {
      expect(jobs[name]?.needs).toContain("prepare-manual");
      expect(
        jobs[name]?.steps.some((step) => step.with?.ref === "${{ needs.prepare-manual.outputs.sha || github.sha }}"),
      ).toBe(true);
    }
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
    const native = jobs["linux-browser-boot"]!;
    expect(native.needs).toContain("release");
    expect(native.if).toContain("needs.release.result == 'success'");
    const nativeRuns = native.steps.map((step) => step.run ?? "");
    expect(nativeRuns).toContain("bash scripts/setup-native-release-gate.sh");
    const acceptance = nativeRuns.find((run) => run.includes("node scripts/claude-native-acceptance/run.mjs"))!;
    expect(acceptance).toContain(
      'BRUV_CONNECTOR_EXECUTABLE="$GITHUB_WORKSPACE/dist/release/bruv-claude-compat-linux-x64"',
    );
    expect(acceptance).toContain('BRUV_RUNTIME_BINARY="$GITHUB_WORKSPACE/dist/release/bruv-linux-x64"');
    // Setup exports GITHUB_ENV for the next step; it cannot share a run block.
    expect(acceptance).not.toContain("setup-native-release-gate.sh");
    const mac = jobs["mac-release-smoke"]!.steps.map((step) => step.run ?? "").join("\n");
    expect(mac).toContain("dist/release/bruv-claude-compat-darwin-arm64 --version");
    expect(mac).toContain("bun scripts/verify-update.ts dist/release/bruv-darwin-arm64");
    expect(mac).toContain("--live-self-test");
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
});
