import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateThirdPartyNotices } from "../scripts/generate-third-party-notices";
import { selectReleaseNotes } from "../scripts/select-release-notes";
import { validateReleaseTag } from "../scripts/validate-release-tag";

const root = resolve(import.meta.dir, "..");
const read = (path: string) => Bun.file(resolve(root, path)).text();

type FixturePackage = { manifest: Record<string, unknown>; license?: string };

async function writeNoticeFixture(
  directory: string,
  dependencies: string[],
  packages: Record<string, FixturePackage>,
): Promise<void> {
  await mkdir(join(directory, "third_party/pi"), { recursive: true });
  await mkdir(join(directory, "third_party/bun"), { recursive: true });
  await Bun.write(
    join(directory, "package.json"),
    JSON.stringify({ dependencies: Object.fromEntries(dependencies.map((name) => [name, "1.0.0"])) }),
  );
  await Bun.write(join(directory, "third_party/pi/LICENSE"), "Pi license\n");
  await Bun.write(join(directory, "third_party/bun/LICENSE.md"), "Bun license\n");
  for (const [name, fixture] of Object.entries(packages)) {
    const packageDirectory = join(directory, "node_modules", name);
    await mkdir(packageDirectory, { recursive: true });
    await Bun.write(
      join(packageDirectory, "package.json"),
      JSON.stringify({ name, version: "1.0.0", ...fixture.manifest }),
    );
    if (fixture.license !== undefined) await Bun.write(join(packageDirectory, "LICENSE"), fixture.license);
  }
}

describe("release automation", () => {
  test("native Live CI has no legacy SoX or candidate bundle path", async () => {
    const ci = await read(".github/workflows/ci.yml");
    const native = await read(".github/workflows/live.yml");
    expect(ci).not.toContain("brew install sox");
    expect(ci).toContain("bun run ci:macos");
    expect(await read("scripts/ci.sh")).toContain("bun test --parallel=3 tests/live-*.test.ts");
    expect(native).not.toContain("inputs.bundle");
    expect(native).not.toContain("live-candidate");
  });
  test("all workflow actions use audited immutable commits and tool versions stay aligned", async () => {
    const pins = new Map([
      ["actions/cache", "55cc8345863c7cc4c66a329aec7e433d2d1c52a9"],
      ["actions/cache/restore", "55cc8345863c7cc4c66a329aec7e433d2d1c52a9"],
      ["actions/cache/save", "55cc8345863c7cc4c66a329aec7e433d2d1c52a9"],
      ["actions/checkout", "3d3c42e5aac5ba805825da76410c181273ba90b1"],
      ["actions/setup-node", "820762786026740c76f36085b0efc47a31fe5020"],
      ["actions/upload-artifact", "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a"],
      ["actions/download-artifact", "3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c"],
      ["pnpm/action-setup", "ea17c68df8912ef543352723c149a84f56e3d413"],
      ["oven-sh/setup-bun", "0c5077e51419868618aeaa5fe8019c62421857d6"],
    ]);
    for (const path of ["ci", "live", "release"]) {
      const workflow = Bun.YAML.parse(await read(`.github/workflows/${path}.yml`)) as {
        permissions?: Record<string, string>;
        jobs: Record<
          string,
          { permissions?: Record<string, string>; steps: { uses?: string; with?: Record<string, unknown> }[] }
        >;
      };
      expect(workflow.permissions).toEqual({ contents: "read" });
      for (const [jobName, job] of Object.entries(workflow.jobs)) {
        if (jobName === "publish" || jobName === "prepare-manual")
          expect(job.permissions).toEqual({ contents: "write" });
        else expect(job.permissions?.contents).not.toBe("write");
        for (const step of job.steps) {
          if (!step.uses) continue;
          const [repo, sha] = step.uses.split("@");
          expect(pins.has(repo!)).toBe(true);
          expect(sha!).toMatch(/^[a-f0-9]{40}$/);
          expect(sha!).toBe(pins.get(repo!)!);
          if (repo === "actions/setup-node") expect(step.with?.["node-version"]).toBe("24.21.0");
          if (repo === "pnpm/action-setup") expect(step.with?.version).toBe("11.27.1");
          if (repo === "oven-sh/setup-bun") expect(step.with?.["bun-version"]).toBe("1.4.2");
        }
      }
    }
    expect(await read("mise.toml")).toContain('bun = "1.4.2"');
    const notices = await read("scripts/generate-third-party-notices.ts");
    expect(notices).toContain("Bun 1.4.2 runtime");
    expect(notices).toContain("oven-sh/bun/tree/bun-v1.4.2");
  });

  test("CI and release cache downloads only with pinned dependency and source inputs", async () => {
    for (const path of ["ci", "release"]) {
      const workflow = Bun.YAML.parse(await read(`.github/workflows/${path}.yml`)) as {
        jobs: Record<
          string,
          { env?: Record<string, string>; steps: { uses?: string; with?: Record<string, string> }[] }
        >;
      };
      const job = workflow.jobs[path === "ci" ? "test" : "release"]!;
      expect(await read(`.github/workflows/${path}.yml`)).toContain(
        'echo "BUN_INSTALL_CACHE_DIR=$RUNNER_TEMP/bruv-bun-cache"',
      );

      const caches = job.steps.filter((step) => step.uses?.startsWith("actions/cache@"));
      expect(caches).toHaveLength(1);
      expect(caches[0]?.with?.path).toBe("${{ runner.temp }}/bruv-bun-cache");
      expect(caches[0]?.with?.key).toContain("hashFiles('bun.lock', 'package.json')");
      for (const cache of caches) {
        expect(cache.with?.key).toContain("${{ runner.os }}-${{ runner.arch }}");
        expect(cache.with?.["restore-keys"]).toMatch(
          /^(bun-1\.4\.2|pnpm-11\.10\.0)-\$\{\{ runner.os \}\}-\$\{\{ runner.arch \}\}-$/,
        );
        expect(cache.with?.path).not.toMatch(/node_modules|dist|HOME/);
      }
    }
  });

  test("CI is deterministic, locked, credential-free, and retains failure logs", async () => {
    const workflow = await read(".github/workflows/ci.yml");
    expect(() => Bun.YAML.parse(workflow)).not.toThrow();
    expect(workflow).toContain("bun-version: 1.4.2");
    expect(workflow).not.toContain("pnpm/action-setup");
    expect(workflow).toContain("apt-get install -y tmux");
    expect(workflow).toContain("run: bun run ci");
    const runner = await read("scripts/ci.sh");
    expect(runner).toContain("bun install --frozen-lockfile");
    expect(runner).toContain("bun run lint");
    expect(runner).toContain("bun run check");
    expect(runner).toContain("bun run build");
    expect(runner).toContain("env BRUV_RUN_LLM_TESTS=0 bun test --parallel=3 ./tests");
    expect(runner).toContain("bun run smoke");
    expect(workflow).toContain("if: failure()");
    expect(workflow).toContain("actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a");
    expect(workflow).not.toContain('BRUV_RUN_LLM_TESTS: "1"');
    expect(workflow).not.toMatch(/API_KEY|AUTH_TOKEN/);
  });

  test("macOS Live CI checks native runtime without opening devices or using credentials", async () => {
    const workflow = Bun.YAML.parse(await read(".github/workflows/ci.yml")) as {
      jobs: Record<string, { "runs-on": string; steps: { run?: string }[] }>;
    };
    const job = workflow.jobs["live-macos"]!;
    expect(job["runs-on"]).toBe("macos-15");
    const commands = job.steps.map((step) => step.run ?? "").join("\n");
    expect(commands).toContain("brew install tmux");
    expect(commands).toContain("bun run ci:macos");
    const runner = await read("scripts/ci.sh");
    const lane = runner.split('if [[ "$lane" == macos ]]; then')[1]!.split("\nfi")[0]!;
    expect(lane).toContain("bun run prepare:assets");
    expect(lane).toContain("bun test --parallel=3 tests/live-*.test.ts");
    expect(lane).not.toMatch(/API_KEY|live.env|SoxAudioAdapter|\b(rec|play) /);
    expect(commands).not.toContain("sox");
    expect(commands).not.toContain("checkAudioCapabilities");
    expect(commands).not.toContain("acceptance");
    expect(commands).not.toMatch(/API_KEY|live.env|SoxAudioAdapter|\b(rec|play) /);
  });

  test("release installs ffmpeg before the shared ordinary Linux gate", async () => {
    const workflow = Bun.YAML.parse(await read(".github/workflows/release.yml")) as {
      jobs: Record<string, { steps: { name?: string; run?: string }[] }>;
    };
    const steps = workflow.jobs.release!.steps;
    const prerequisites = steps.findIndex((step) => step.run?.includes("apt-get install -y tmux ffmpeg"));
    const ordinaryGate = steps.findIndex((step) => step.run === "bun run ci");
    expect(prerequisites).toBeGreaterThanOrEqual(0);
    expect(ordinaryGate).toBeGreaterThan(prerequisites);
  });

  test("tag release is version-gated and builds Linux x64/arm64, macOS arm64, and Android binaries", async () => {
    const workflow = await read(".github/workflows/release.yml");
    expect(() => Bun.YAML.parse(workflow)).not.toThrow();
    expect(workflow).toContain('- "v*"');
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("!contains(github.ref_name, '-')");
    expect(workflow).toContain("needs: [release-source, mac-helper]");
    expect(workflow).toContain("scripts/build-live-helper.sh");
    expect(workflow).toContain("Mach-O 64-bit (executable arm64|arm64 executable)");
    expect(workflow).toContain("-fsanitize=address,undefined");
    expect(workflow).toContain("actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c");
    expect(workflow).toContain("--live-helper=./artifacts/release/mac-helper/live-audio");
    expect(workflow).toContain("stable-release-assets");
    expect(workflow).toContain("needs: [release, linux-browser-boot, mac-release-smoke, release-source]");
    expect(workflow).toContain("bun scripts/verify-update.ts dist/release/bruv-darwin-arm64");
    expect(workflow).toContain("--live-self-test");
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain('validate-release-tag.ts "$RELEASE_TAG"');
    expect(workflow).toContain("apt-get install -y tmux");
    expect(workflow).toContain("run: bun run ci");
    expect(workflow.indexOf("run: bun run ci")).toBeLessThan(workflow.indexOf("bun run build -- --target="));
    expect(workflow).toContain("--target=bun-linux-x64-baseline");
    expect(workflow).toContain("--target=bun-linux-arm64");
    expect(workflow).toContain("--target=bun-darwin-arm64");
    expect(workflow).toContain("--target=bun-android-arm64");
    expect(workflow).toContain('test "$(./dist/release/bruv-linux-x64 --version)" = "$(bun -p');
    expect(workflow).toContain("GH_TOKEN: ${{ github.token }}");
    expect(workflow).toContain('sha256sum "$binary" > "$binary.sha256"');
    expect(workflow).toContain("THIRD_PARTY_NOTICES.md");
    expect(workflow).toContain("bun run generate:notices");
    expect(workflow).toContain("THIRD_PARTY_LICENSES.txt");
    expect(workflow).not.toContain("EMBEDDED T3 CODE BACKEND LICENSING");
    expect(workflow).not.toContain("src/terminal/BunPtyAdapter.test.ts");
    expect(workflow).not.toContain("dist/bruv-web/LICENSE-T3CODE");
    expect(workflow).toContain("bruv-claude-compat");
    expect(workflow).toContain("SOURCE.txt");
    expect(workflow).not.toContain("Embedded T3 Code source:");
    expect(workflow).not.toContain("Patch-SHA256:");
    expect(workflow).toContain(
      "bun run build -- --target=bun-linux-x64-baseline --outfile=./dist/release/bruv-linux-x64",
    );
    expect(workflow).toContain("bun run build -- --target=bun-linux-arm64 --outfile=./dist/release/bruv-linux-arm64");
    expect(workflow).toContain(
      "bun run build -- --live-helper=./artifacts/release/mac-helper/live-audio --target=bun-darwin-arm64 --outfile=./dist/release/bruv-darwin-arm64",
    );
    expect(workflow).toContain(
      "bun run build -- --target=bun-android-arm64 --outfile=./dist/release/bruv-android-arm64",
    );
    expect(workflow).not.toContain("bruv-web-linux-x64.tar.gz");
    expect(workflow).not.toContain("Package web sidecar");
    expect(workflow).not.toMatch(/bun-(windows|darwin-x64|linux-arm32)/);
  });

  test("stable publication waits for actual browser and Mac payload gates and retains raw assets", async () => {
    const workflow = Bun.YAML.parse(await read(".github/workflows/release.yml")) as {
      on: Record<string, unknown>;
      jobs: Record<
        string,
        { if?: string; needs?: string | string[]; permissions?: Record<string, string>; steps: { run?: string }[] }
      >;
    };
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch", "push"]);
    expect(workflow.on.push).toEqual({ tags: ["v*"] });
    expect(workflow.jobs.publish!.if).toBe(
      "${{ always() && needs.release-source.result == 'success' && needs.linux-browser-boot.result == 'success' && needs.mac-release-smoke.result == 'success' && needs.release.result == 'success' }}",
    );
    expect(workflow.jobs.publish!.needs).toEqual([
      "release",
      "linux-browser-boot",
      "mac-release-smoke",
      "release-source",
    ]);
    expect(workflow.jobs["mac-release-smoke"]!.needs).toEqual(["release", "release-source"]);
    expect(workflow.jobs["mac-release-smoke"]!.if).toContain("needs.release.result == 'success'");
    expect(workflow.jobs.release!.permissions?.contents).not.toBe("write");
    expect(workflow.jobs.publish!.permissions?.contents).toBe("write");
    expect(workflow.jobs["linux-browser-boot"]!.needs).toEqual(["release", "release-source"]);
    expect(workflow.jobs["linux-browser-boot"]!.if).toContain("needs.release.result == 'success'");
    const browserCommands = workflow.jobs["linux-browser-boot"]!.steps.map((step) => step.run ?? "").join("\n");
    expect(browserCommands).toContain("bash scripts/setup-release-browser.sh");
    const setup = await read("scripts/setup-release-browser.sh");
    expect(setup).toContain("playwright-core@1.63.0");
    expect(await read(".github/workflows/release.yml")).toContain("playwright-1.63.0-ubuntu24.04-headless-");
    expect(setup).toContain("install --only-shell chromium");
    expect(setup).toContain("install-deps chromium");
    expect(browserCommands).toContain("bash scripts/setup-native-release-gate.sh");
    expect(browserCommands).toContain("node scripts/run-native-release-gate.mjs");
    expect(browserCommands).toContain("dist/release/bruv-claude-compat-linux-x64");
    const macCommands = workflow.jobs["mac-release-smoke"]!.steps.map((step) => step.run ?? "").join("\n");
    expect(macCommands).toContain("verify-update.ts");
    expect(macCommands).toContain("--live-self-test");
    expect(macCommands).not.toContain('"type":"start"');
  });

  test("release validator handles mismatch and prerelease versions without a real tag", () => {
    expect(validateReleaseTag("v2.3.4-beta.1", "2.3.4-beta.1")).toBeUndefined();
    expect(validateReleaseTag("v2.3.4", "2.3.5")).toContain("does not match package.json version");
    expect(validateReleaseTag("v2.3.4", "not-semver")).toContain("unsupported version");
  });

  test("publish selects only notes for the validated tag and fails closed", async () => {
    const workflow = await read(".github/workflows/release.yml");
    const publish = workflow.slice(workflow.indexOf("  publish:"));
    expect(publish).toContain("bun scripts/publish-release.ts");
    const implementation = await read("scripts/publish-release.ts");
    expect(implementation).toContain("scripts/select-release-notes.ts");
    expect(implementation).toContain('"--notes-file",');
    expect(implementation).not.toContain("--notes-file support/release-v0.11.1.md");
    expect(implementation.indexOf("scripts/select-release-notes.ts")).toBeLessThan(implementation.indexOf('"create",'));
    const directory = await mkdtemp(join(tmpdir(), "bruv-release-notes-"));
    try {
      await mkdir(join(directory, "support"));
      await Bun.write(join(directory, "support/release-v9.8.7.md"), "current release\n");
      await Bun.write(join(directory, "support/release-v0.11.1.md"), "stale release\n");
      expect(await selectReleaseNotes("v9.8.7", "9.8.7", directory)).toBe(join(directory, "support/release-v9.8.7.md"));
      await expect(selectReleaseNotes("v9.8.8", "9.8.7", directory)).rejects.toThrow("does not match");
      await expect(selectReleaseNotes("v9.8.6", "9.8.6", directory)).rejects.toThrow("Missing or empty release notes");
      await Bun.write(join(directory, "support/release-v9.8.6.md"), "");
      await expect(selectReleaseNotes("v9.8.6", "9.8.6", directory)).rejects.toThrow("Missing or empty release notes");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("CLI release validator derives the expected tag from package.json", async () => {
    const pkg = (await Bun.file(resolve(root, "package.json")).json()) as { version: string };
    const run = (tag: string) =>
      Bun.spawnSync({
        cmd: [process.execPath, "scripts/validate-release-tag.ts", tag],
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
    expect(run("v" + pkg.version).exitCode).toBe(0);
    expect(run("v999.0.0").stderr.toString()).toContain("does not match package.json version");
  });

  test("generated attribution bundle contains full Pi and Bun license notices", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bruv-notices-"));
    const output = join(directory, "THIRD_PARTY_LICENSES.txt");
    try {
      const result = Bun.spawnSync({
        cmd: [process.execPath, "scripts/generate-third-party-notices.ts", output],
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      const notices = await Bun.file(output).text();
      for (const name of ["pi-coding-agent", "pi-codemode", "pi-mcp"]) {
        expect(notices).toContain(`@earendil-works/${name}@1.0.3`);
      }
      expect(notices).toContain("proxy-agent-negotiate@1.1.0");
      expect(notices).toContain("Nathan Rajlich");
      expect(notices).toContain("PI UPSTREAM LICENSE");
      expect(notices).toContain("Copyright (c) 2025 Mario Zechner");
      expect(notices).toContain("Permission is hereby granted, free of charge");
      expect(notices).toContain("BUN RUNTIME UPSTREAM LICENSING");
      expect(notices).toContain("JavaScriptCore");
      expect(notices.length).toBeGreaterThan(100_000);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("attribution generation fails when a required transitive dependency is missing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bruv-notices-required-"));
    try {
      await writeNoticeFixture(directory, ["present"], {
        present: { manifest: { dependencies: { missing: "1.0.0" } }, license: "MIT\n" },
      });
      await expect(generateThirdPartyNotices(directory, join(directory, "notices.txt"))).rejects.toThrow(
        "production dependency missing could not be resolved",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("Pi fallback fails closed for unknown packages and unpinned versions", async () => {
    for (const [name, version] of [
      ["@earendil-works/not-pi", "0.99.1"],
      ["@earendil-works/pi-ai", "0.85.1"],
    ]) {
      const directory = await mkdtemp(join(tmpdir(), "bruv-notices-fallback-"));
      try {
        await writeNoticeFixture(directory, [name], { [name]: { manifest: { version } } });
        await expect(generateThirdPartyNotices(directory, join(directory, "notices.txt"))).rejects.toThrow(
          `${name}@${version} has no packaged or curated LICENSE`,
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });

  test("license input budget is checked before an oversized file is read", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bruv-notices-budget-"));
    try {
      await writeNoticeFixture(directory, ["large-license"], {
        "large-license": { manifest: {}, license: "x".repeat(512) },
      });
      await expect(generateThirdPartyNotices(directory, join(directory, "notices.txt"), 128)).rejects.toThrow(
        /byte budget before reading .*LICENSE/,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("embedded vendor license banners are preserved", async () => {
    const highlight = await read(
      "node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/vendor/highlight.min.js",
    );
    const marked = await read(
      "node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/vendor/marked.min.js",
    );
    expect(highlight.slice(0, 250)).toContain("License: BSD-3-Clause");
    expect(marked.slice(0, 300)).toContain("MIT License");
  });
});

test("release cache environment retains source identity variables", async () => {
  const workflow = Bun.YAML.parse(await read(".github/workflows/release.yml")) as {
    jobs: Record<string, { name?: string; env?: Record<string, string> }>;
  };
  const job = Object.values(workflow.jobs).find((job) => job.name === "Linux, macOS, and Android release")!;
  expect(job.env?.RELEASE_SHA).toContain("needs.release-source.outputs.sha");
  expect(job.env?.RELEASE_TAG).toContain("needs.release-source.outputs.tag");
  const source = await read(".github/workflows/release.yml");
  expect(source).toContain('echo "BUN_INSTALL_CACHE_DIR=$RUNNER_TEMP/bruv-bun-cache"');
  expect(source).not.toContain("PNPM_CONFIG_STORE_DIR");
  for (const job of Object.values(workflow.jobs)) {
    expect(JSON.stringify(job.env ?? {})).not.toContain("runner.temp");
  }
});

test("CI and release build the binary and launcher without a patched web dependency", async () => {
  const runner = await read("scripts/ci.sh");
  const workflow = await read(".github/workflows/release.yml");
  expect(runner).not.toContain("ci-web-validation.sh");
  expect(runner).not.toContain("ci-web.ts");
  expect(workflow).not.toContain("BRUV_T3_SOURCE");
  expect(workflow).not.toContain("reuse-packed-web");
  expect(workflow).toContain("run: bun run ci");
  expect(runner).toContain("bun scripts/offline-openai-default-transport.ts");
  expect(runner).toContain("env BRUV_RUN_LLM_TESTS=0 bun test --parallel=3 ./tests");
  expect(runner).toContain("bun run smoke -- --reuse-build");
});

test("Linux needs no retired migration history; feedback retains its baseline history", async () => {
  const workflow = Bun.YAML.parse(await read(".github/workflows/ci.yml")) as any;
  const checkout = (job: any) => job.steps.find((step: any) => step.uses?.startsWith("actions/checkout@"));
  expect(checkout(workflow.jobs.test).with["fetch-depth"] ?? 1).toBe(1);
  expect(checkout(workflow.jobs.feedback).with["fetch-depth"]).toBe(0);
  expect(workflow.jobs.test.steps.find((step: any) => step.name === "Install required PTY tooling").run).toContain(
    "command -v tmux >/dev/null ||",
  );
});

test("release verifies thin launcher dispatch and the actual Android interpreter before staging", async () => {
  const workflow = Bun.YAML.parse(await read(".github/workflows/release.yml")) as any;
  const steps = workflow.jobs.release.steps;
  const gate = steps.findIndex(
    (step: any) => step.name === "Verify release launcher packaging and Android runtime target",
  );
  expect(gate).toBeGreaterThan(0);
  expect(steps[gate].run).toContain("bun scripts/verify-release-launchers.ts dist/release");
  expect(steps[gate].run).toContain("readelf -l dist/release/bruv-android-arm64");
  expect(steps[gate].run).toContain("/system/bin/linker64");
  expect(gate).toBeLessThan(steps.findIndex((step: any) => step.name === "Stage verified release assets"));
  for (const name of ["linux-browser-boot", "mac-release-smoke"]) {
    const commands = workflow.jobs[name].steps.map((step: any) => step.run ?? "").join("\n");
    expect(commands).toContain("--bruv-version");
    expect(commands).toContain('= "bruv-claude-compat $version"');
    expect(commands).toContain("Bruv connector");
  }
});

test("CI and Release share one ordinary Linux gate before final release packaging", async () => {
  const ci = Bun.YAML.parse(await read(".github/workflows/ci.yml")) as any;
  const release = Bun.YAML.parse(await read(".github/workflows/release.yml")) as any;
  const steps = release.jobs.release.steps;
  const gate = steps.findIndex((step: any) => step.name === "Shared ordinary Linux gate");
  expect(gate).toBeGreaterThan(0);
  expect(steps[gate].run).toBe("bun run ci");
  expect(ci.jobs.test.steps.filter((step: any) => step.run === steps[gate].run)).toHaveLength(1);
  expect(steps.filter((step: any) => step.run === steps[gate].run)).toHaveLength(1);
  expect(steps[gate].env).toEqual({ CI_LOG_DIR: "artifacts/release/ci" });
  expect(gate).toBeGreaterThan(steps.findIndex((step: any) => step.name === "Validate tag matches package version"));
  expect(gate).toBeLessThan(steps.findIndex((step: any) => step.name === "Verify native helper from Mac runner"));
  const commands = steps.map((step: any) => step.run ?? "").join("\n");
  expect(commands).not.toMatch(
    /bun (install|test)\b|bun run (format:check|lint|check|smoke)\b|offline-openai-default-transport/,
  );
  const upload = steps.find((step: any) => step.name === "Upload failure logs");
  expect(upload.if).toBe("failure()");
  expect(upload.with.path).toBe("artifacts/release/");
  expect(steps[gate].env.CI_LOG_DIR).toStartWith(upload.with.path);
  expect(commands).toContain("NATIVE LIVE AUDIO HELPER");
  expect(commands).toContain("repository MIT LICENSE");
});
