import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateThirdPartyNotices } from "../../scripts/dependencies/generate-third-party-notices";
import { selectReleaseNotes } from "../../scripts/release/select-release-notes";
import { validateReleaseTag } from "../../scripts/release/validate-release-tag";

const root = resolve(import.meta.dir, "../..");
const read = (path: string) => Bun.file(resolve(root, path)).text();

type WorkflowStep = {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  id?: string;
  "timeout-minutes"?: number;
  env?: Record<string, string>;
  with?: Record<string, string | number | boolean>;
};
type WorkflowJob = {
  name?: string;
  "runs-on"?: string;
  if?: string;
  needs?: string | string[];
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  steps: WorkflowStep[];
};
type Workflow = {
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs: Record<string, WorkflowJob>;
};

const readWorkflow = async (name: string): Promise<Workflow> =>
  Bun.YAML.parse(await read(`.github/workflows/${name}.yml`)) as Workflow;
const commands = (job: WorkflowJob) => job.steps.map((step) => step.run ?? "").join("\n");

function namedStep(job: WorkflowJob, name: string): WorkflowStep {
  const step = job.steps.find((step) => step.name === name);
  expect(step, `Missing workflow step: ${name}`).toBeDefined();
  return step!;
}

type FixturePackage = { manifest: Record<string, unknown>; license?: string };

async function writeNoticeFixture(
  directory: string,
  dependencies: string[],
  packages: Record<string, FixturePackage>,
): Promise<void> {
  await mkdir(join(directory, "licenses/third-party/pi"), { recursive: true });
  await mkdir(join(directory, "licenses/third-party/bun"), { recursive: true });
  await Bun.write(
    join(directory, "package.json"),
    JSON.stringify({ dependencies: Object.fromEntries(dependencies.map((name) => [name, "1.0.0"])) }),
  );
  await Bun.write(join(directory, "licenses/third-party/pi/LICENSE"), "Pi license\n");
  await Bun.write(join(directory, "licenses/third-party/bun/LICENSE.md"), "Bun license\n");
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
    expect(await read("scripts/ci/ci.sh")).toContain("bun test --parallel=3 tests/live/live-*.test.ts");
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
      const workflow = await readWorkflow(path);
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
    const notices = await read("scripts/dependencies/generate-third-party-notices.ts");
    expect(notices).toContain("Bun 1.4.2 runtime");
    expect(notices).toContain("oven-sh/bun/tree/bun-v1.4.2");
  });

  test("CI and release cache downloads only with pinned dependency and source inputs", async () => {
    for (const path of ["ci", "release"]) {
      const workflow = await readWorkflow(path);
      const job = workflow.jobs[path === "ci" ? "test" : "release"]!;
      expect(await read(`.github/workflows/${path}.yml`)).toContain(
        'echo "BUN_INSTALL_CACHE_DIR=$RUNNER_TEMP/bruv-bun-cache"',
      );

      const allCaches = job.steps.filter((step) => step.uses?.startsWith("actions/cache@"));
      expect(allCaches).toHaveLength(2);
      const apt = allCaches.find((step) => step.with?.path === "${{ runner.temp }}/bruv-apt-cache/*.deb");
      expect(apt?.with?.key).toBe(
        "ubuntu-24.04-apt-v1-${{ runner.arch }}-${{ hashFiles('scripts/ci/install-ci-linux-tools.sh') }}",
      );
      expect(apt?.with?.["restore-keys"]).toBeUndefined();
      const caches = allCaches.filter((step) => step.with?.path === "${{ runner.temp }}/bruv-bun-cache");
      expect(caches).toHaveLength(1);
      expect(caches[0]?.with?.path).toBe("${{ runner.temp }}/bruv-bun-cache");
      expect(caches[0]?.with?.key).toBe(
        "bun-download-v2-1.4.2-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('bun.lock', 'package.json') }}",
      );
      for (const cache of caches) {
        expect(cache.with?.key).toContain("${{ runner.os }}-${{ runner.arch }}");
        expect(cache.with?.["restore-keys"]).toBe("bun-download-v2-1.4.2-${{ runner.os }}-${{ runner.arch }}-");
        expect(cache.with?.path).not.toMatch(/node_modules|dist|HOME/);
      }
    }
  });

  test("Linux native validation overlaps the ordinary gate without duplicate large setup", async () => {
    const workflow = await readWorkflow("ci");
    expect(Object.keys(workflow.jobs)).toEqual(["feedback", "test", "native-linux", "live-macos", "required"]);
    const ordinary = workflow.jobs.test!;
    const native = workflow.jobs["native-linux"]!;
    expect(native["runs-on"]).toBe(ordinary["runs-on"]);
    expect(native.needs).toBe("feedback");
    expect(native.if).toBe(ordinary.if);
    expect(namedStep(ordinary, "Install Linux test tooling").run).toBe("bash scripts/ci/install-ci-linux-tools.sh");
    expect(namedStep(native, "Install Linux native tooling").run).toBe(
      "bash scripts/ci/install-ci-linux-tools.sh --native-audio-only",
    );
    expect(commands(ordinary)).toContain("bun run ci");
    expect(commands(ordinary)).not.toMatch(/fsanitize|capture-protocol|webrtc-audio-processing/);
    expect(commands(native)).not.toMatch(/bun |node |tmux|ffmpeg/);
    expect(native.steps.filter((step) => step.uses).map((step) => step.uses!.split("@")[0])).toEqual([
      "actions/checkout",
      "actions/cache",
    ]);
    const cache = namedStep(native, "Cache Linux native package downloads");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub expression
    expect(cache.with?.path).toBe("${{ runner.temp }}/bruv-apt-cache/*.deb");
    expect(cache.with?.key).toBe(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub expression
      "ubuntu-24.04-apt-native-v1-${{ runner.arch }}-${{ hashFiles('scripts/ci/install-ci-linux-tools.sh') }}",
    );
    expect(cache.with?.["restore-keys"]).toBeUndefined();
    const installer = await read("scripts/ci/install-ci-linux-tools.sh");
    expect(installer).toContain("ordinary_packages=(tmux ffmpeg)");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal Bash expansion
    expect(installer).toContain('--native-audio-only) packages=("${native_packages[@]}")');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal Bash expansion
    expect(installer).toContain('"") packages=("${ordinary_packages[@]}")');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal Bash expansion
    expect(installer).toContain('if [[ "${1:-}" != --native-audio-only ]]; then');
  });

  test("CI is deterministic, locked, credential-free, and retains failure logs", async () => {
    const workflow = await read(".github/workflows/ci.yml");
    expect(() => Bun.YAML.parse(workflow)).not.toThrow();
    expect(workflow).toContain("bun-version: 1.4.2");
    expect(workflow).not.toContain("pnpm/action-setup");
    expect(workflow).toContain("bash scripts/ci/install-ci-linux-tools.sh");
    expect(workflow).toContain("run: bun run ci");
    const runner = await read("scripts/ci/ci.sh");
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
    const workflow = await readWorkflow("ci");
    const job = workflow.jobs["live-macos"]!;
    expect(job["runs-on"]).toBe("macos-15");
    const jobCommands = commands(job);
    expect(jobCommands).toContain("brew install tmux");
    expect(jobCommands).toContain("bun run ci:macos");
    const runner = await read("scripts/ci/ci.sh");
    const lane = runner.split('if [[ "$lane" == macos ]]; then')[1]!.split("\nfi")[0]!;
    expect(lane).toContain("bun run prepare:assets");
    expect(lane).toContain("bun test --parallel=3 tests/live/live-*.test.ts");
    expect(lane).not.toMatch(/API_KEY|live.env|SoxAudioAdapter|\b(rec|play) /);
    expect(jobCommands).not.toContain("sox");
    expect(jobCommands).not.toContain("checkAudioCapabilities");
    expect(jobCommands).not.toContain("acceptance");
    expect(jobCommands).not.toMatch(/API_KEY|live.env|SoxAudioAdapter|\b(rec|play) /);
  });

  test("release installs ffmpeg before the shared ordinary Linux gate", async () => {
    const workflow = await readWorkflow("release");
    const release = workflow.jobs.release!;
    const prerequisites = namedStep(release, "Install Linux test tooling");
    const ordinaryGate = namedStep(release, "Shared ordinary Linux gate");
    expect(prerequisites.run).toBe("bash scripts/ci/install-ci-linux-tools.sh");
    expect(release.steps.indexOf(prerequisites)).toBeLessThan(release.steps.indexOf(ordinaryGate));
  });

  test("admitted tag releases validate the version before building the four supported targets", async () => {
    const workflow = await readWorkflow("release");
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch", "push"]);
    expect(workflow.on.push).toEqual({ tags: ["v*"] });
    expect(workflow.jobs["release-source"]!.if).toContain("!contains(github.ref_name, '-')");
    const release = workflow.jobs.release!;
    expect(release.needs).toEqual(["release-source", "mac-helper"]);
    const validation = namedStep(release, "Validate tag matches package version");
    const gate = namedStep(release, "Shared ordinary Linux gate");
    const build = namedStep(release, "Build one binary and thin connector launcher per target without bundled T3");
    expect(validation.run).toContain('validate-release-tag.ts "$RELEASE_TAG"');
    expect(gate.run).toBe("bun run ci");
    expect(release.steps.indexOf(validation)).toBeLessThan(release.steps.indexOf(gate));
    expect(release.steps.indexOf(gate)).toBeLessThan(release.steps.indexOf(build));
    expect(build.run).toContain(
      "bun run build -- --target=bun-linux-x64-baseline --outfile=./dist/release/bruv-linux-x64",
    );
    expect(build.run).toContain("bun run build -- --target=bun-linux-arm64 --outfile=./dist/release/bruv-linux-arm64");
    expect(build.run).toContain(
      "bun run build -- --live-helper=./artifacts/release/mac-helper/live-audio --target=bun-darwin-arm64 --outfile=./dist/release/bruv-darwin-arm64",
    );
    expect(build.run).toContain(
      "bun run build -- --target=bun-android-arm64 --outfile=./dist/release/bruv-android-arm64",
    );
    expect(build.run).toContain('test "$(./dist/release/bruv-linux-x64 --version)" = "$(bun -p');
    expect(await read(".github/workflows/release.yml")).not.toMatch(/bun-(windows|darwin-x64|linux-arm32)/);
  });

  test("Mac supplies a sanitized native helper artifact for release packaging", async () => {
    const workflow = await readWorkflow("release");
    const helper = workflow.jobs["mac-helper"]!;
    expect(commands(helper)).toContain("-fsanitize=address,undefined");
    const compile = namedStep(helper, "Compile helper and check device-free protocol");
    expect(compile.run).toContain("scripts/live/build-helper.sh");
    expect(compile.run).toContain("Mach-O 64-bit (executable arm64|arm64 executable)");
    const download = workflow.jobs.release!.steps.find((step) => step.uses?.startsWith("actions/download-artifact@"));
    expect(download?.with?.name).toBe("release-mac-arm64-helper");
    expect(download?.with?.path).toBe("artifacts/release/mac-helper");
  });

  test("staged assets include paired checksums, licenses and source information, not a bundled web sidecar", async () => {
    const workflow = await readWorkflow("release");
    const release = workflow.jobs.release!;
    expect(namedStep(release, "Generate production dependency notices").run).toContain("bun run generate:notices");
    expect(namedStep(release, "Document native audio licensing").run).toContain("THIRD_PARTY_LICENSES.txt");
    const provenance = namedStep(release, "Create checksums and source information").run;
    expect(provenance).toContain('sha256sum "$binary" > "$binary.sha256"');
    expect(provenance).toContain("bruv-claude-compat");
    expect(provenance).toContain("THIRD_PARTY_NOTICES.md");
    expect(provenance).toContain("SOURCE.txt");
    expect(namedStep(release, "Stage verified release assets").with?.name).toBe("stable-release-assets");
    const source = await read(".github/workflows/release.yml");
    expect(source).not.toContain("EMBEDDED T3 CODE BACKEND LICENSING");
    expect(source).not.toContain("src/terminal/BunPtyAdapter.test.ts");
    expect(source).not.toContain("dist/bruv-web/LICENSE-T3CODE");
    expect(source).not.toContain("Embedded T3 Code source:");
    expect(source).not.toContain("Patch-SHA256:");
    expect(source).not.toContain("bruv-web-linux-x64.tar.gz");
    expect(source).not.toContain("Package web sidecar");
  });

  test("stable publication waits for actual browser and Mac payload gates and retains raw assets", async () => {
    const workflow = await readWorkflow("release");
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch", "push"]);
    expect(workflow.on.push).toEqual({ tags: ["v*"] });
    expect(workflow.jobs.publish!.if).toBe(
      "${{ !cancelled() && needs.release-source.result == 'success' && needs.linux-browser-boot.result == 'success' && needs.mac-release-smoke.result == 'success' && needs.release.result == 'success' }}",
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
    const browserCommands = commands(workflow.jobs["linux-browser-boot"]!);
    expect(browserCommands).toContain("bash scripts/release/setup-release-browser.sh");
    const setup = await read("scripts/release/setup-release-browser.sh");
    expect(setup).toContain("playwright-core@1.63.0");
    expect(await read(".github/workflows/release.yml")).toContain("playwright-1.63.0-ubuntu24.04-headless-");
    expect(setup).toContain("install --only-shell chromium");
    expect(setup).toContain("install-deps chromium");
    expect(browserCommands).toContain("bash scripts/release/setup-native-release-gate.sh");
    expect(browserCommands).toContain("node scripts/release/run-native-release-gate.mjs");
    expect(browserCommands).toContain("dist/release/bruv-claude-compat-linux-x64");
    const macCommands = commands(workflow.jobs["mac-release-smoke"]!);
    expect(macCommands).toContain("bun scripts/release/verify-update.ts dist/release/bruv-darwin-arm64");
    expect(macCommands).toContain("--live-self-test");
    expect(macCommands).not.toContain('"type":"start"');
  });

  test("release validator handles mismatch and prerelease versions without a real tag", () => {
    expect(validateReleaseTag("v2.3.4-beta.1", "2.3.4-beta.1")).toBeUndefined();
    expect(validateReleaseTag("v2.3.4", "2.3.5")).toContain("does not match package.json version");
    expect(validateReleaseTag("v2.3.4", "not-semver")).toContain("unsupported version");
  });

  test("publish selects only notes for the validated tag and fails closed", async () => {
    const workflow = await readWorkflow("release");
    const publish = namedStep(workflow.jobs.publish!, "Publish GitHub release");
    expect(publish.run).toContain("bun scripts/release/publish-release.ts");
    expect(publish.env?.GH_TOKEN).toBe("${{ github.token }}");
    const implementation = await read("scripts/release/publish-release.ts");
    expect(implementation).toContain("scripts/release/select-release-notes.ts");
    expect(implementation).toContain('"--notes-file",');
    expect(implementation).not.toContain("--notes-file docs/releases/release-v0.11.1.md");
    expect(implementation.indexOf("scripts/release/select-release-notes.ts")).toBeLessThan(
      implementation.indexOf('"create",'),
    );
    const directory = await mkdtemp(join(tmpdir(), "bruv-release-notes-"));
    try {
      await mkdir(join(directory, "docs/releases"), { recursive: true });
      await Bun.write(join(directory, "docs/releases/release-v9.8.7.md"), "current release\n");
      await Bun.write(join(directory, "docs/releases/release-v0.11.1.md"), "stale release\n");
      expect(await selectReleaseNotes("v9.8.7", "9.8.7", directory)).toBe(
        join(directory, "docs/releases/release-v9.8.7.md"),
      );
      await expect(selectReleaseNotes("v9.8.8", "9.8.7", directory)).rejects.toThrow("does not match");
      await expect(selectReleaseNotes("v9.8.6", "9.8.6", directory)).rejects.toThrow("Missing or empty release notes");
      await Bun.write(join(directory, "docs/releases/release-v9.8.6.md"), "");
      await expect(selectReleaseNotes("v9.8.6", "9.8.6", directory)).rejects.toThrow("Missing or empty release notes");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("CLI release validator derives the expected tag from package.json", async () => {
    const pkg = (await Bun.file(resolve(root, "package.json")).json()) as { version: string };
    const run = (tag: string) =>
      Bun.spawnSync({
        cmd: [process.execPath, "scripts/release/validate-release-tag.ts", tag],
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
        cmd: [process.execPath, "scripts/dependencies/generate-third-party-notices.ts", output],
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      const notices = await Bun.file(output).text();
      for (const name of ["pi-coding-agent", "pi-codemode", "pi-mcp"]) {
        expect(notices).toContain(`@earendil-works/${name}@1.1.0`);
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
  const workflow = await readWorkflow("release");
  const job = workflow.jobs.release!;
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
  const runner = await read("scripts/ci/ci.sh");
  const workflow = await read(".github/workflows/release.yml");
  expect(runner).not.toContain("ci-web-validation.sh");
  expect(runner).not.toContain("ci-web.ts");
  expect(workflow).not.toContain("BRUV_T3_SOURCE");
  expect(workflow).not.toContain("reuse-packed-web");
  expect(workflow).toContain("run: bun run ci");
  expect(runner).toContain("bun scripts/ci/offline-openai-default-transport.ts");
  expect(runner).toContain("env BRUV_RUN_LLM_TESTS=0 bun test --parallel=3 ./tests");
  expect(runner).toContain("bun run smoke -- --reuse-build");
});

test("Linux needs no retired migration history; feedback retains its baseline history", async () => {
  const workflow = await readWorkflow("ci");
  const checkout = (job: WorkflowJob) => {
    const step = job.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
    expect(step, "Missing checkout action").toBeDefined();
    return step!;
  };
  expect(checkout(workflow.jobs.test!).with?.["fetch-depth"] ?? 1).toBe(1);
  expect(checkout(workflow.jobs.feedback!).with?.["fetch-depth"]).toBe(0);
  expect(namedStep(workflow.jobs.test!, "Install Linux test tooling").run).toBe(
    "bash scripts/ci/install-ci-linux-tools.sh",
  );
});

test("release verifies thin launcher dispatch and the actual Android interpreter before staging", async () => {
  const workflow = await readWorkflow("release");
  const release = workflow.jobs.release!;
  const gate = namedStep(release, "Verify release launcher packaging and Android runtime target");
  const staging = namedStep(release, "Stage verified release assets");
  expect(release.steps.indexOf(gate)).toBeGreaterThan(0);
  expect(gate.run).toContain("bun scripts/release/verify-release-launchers.ts dist/release");
  expect(gate.run).toContain("readelf -l dist/release/bruv-android-arm64");
  expect(gate.run).toContain("/system/bin/linker64");
  expect(release.steps.indexOf(gate)).toBeLessThan(release.steps.indexOf(staging));
  for (const name of ["linux-browser-boot", "mac-release-smoke"]) {
    const jobCommands = commands(workflow.jobs[name]!);
    expect(jobCommands).toContain("--bruv-version");
    expect(jobCommands).toContain('= "bruv-claude-compat $version"');
    expect(jobCommands).toContain("Bruv connector");
  }
});

test("CI and Release share one ordinary Linux gate before final release packaging", async () => {
  const ci = await readWorkflow("ci");
  const workflow = await readWorkflow("release");
  const release = workflow.jobs.release!;
  const gate = namedStep(release, "Shared ordinary Linux gate");
  const validation = namedStep(release, "Validate tag matches package version");
  const helper = namedStep(release, "Verify native helper from Mac runner");
  expect(release.steps.indexOf(gate)).toBeGreaterThan(0);
  expect(gate.run).toBe("bun run ci");
  expect(ci.jobs.test!.steps.filter((step) => step.run === gate.run)).toHaveLength(1);
  expect(release.steps.filter((step) => step.run === gate.run)).toHaveLength(1);
  expect(gate.env).toEqual({ CI_LOG_DIR: "artifacts/release/ci" });
  expect(release.steps.indexOf(validation)).toBeLessThan(release.steps.indexOf(gate));
  expect(release.steps.indexOf(gate)).toBeLessThan(release.steps.indexOf(helper));
  expect(commands(release)).not.toMatch(
    /bun test\b|bun run (format:check|lint|check|smoke)\b|offline-openai-default-transport/,
  );
  const upload = namedStep(release, "Upload failure logs");
  expect(upload.if).toBe("failure()");
  expect(upload.with?.path).toBe("artifacts/release/");
  expect(gate.env?.CI_LOG_DIR).toStartWith("artifacts/release/");
  expect(namedStep(release, "Document native audio licensing").run).toContain("NATIVE LIVE AUDIO HELPER");
  expect(namedStep(release, "Document native audio licensing").run).toContain("repository MIT LICENSE");
});

test("release reuses only proven exact-SHA full CI and bounds the identical fallback gate", async () => {
  const workflow = await readWorkflow("release");
  const release = workflow.jobs.release!;
  const evidence = namedStep(release, "Find successful full CI for the exact release SHA");
  const install = namedStep(release, "Install locked dependencies after CI reuse");
  const gate = namedStep(release, "Shared ordinary Linux gate");
  expect(release.permissions).toEqual({ contents: "read", actions: "read" });
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub expression
  expect(release.env?.RELEASE_SHA).toBe("${{ needs.release-source.outputs.sha }}");
  expect(evidence.id).toBe("ci-evidence");
  expect(evidence.run).toBe("bun scripts/release/find-release-ci.ts");
  expect(evidence["timeout-minutes"]).toBe(1);
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub expression
  expect(evidence.env).toEqual({ GH_TOKEN: "${{ github.token }}" });
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub expression
  expect(install.if).toBe("${{ steps.ci-evidence.outputs.reused == 'true' }}");
  expect(install.run).toBe("bun install --frozen-lockfile");
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub expression
  expect(gate.if).toBe("${{ steps.ci-evidence.outputs.reused != 'true' }}");
  expect(gate["timeout-minutes"]).toBe(6);
  expect(gate.run).toBe("bun run ci");
  expect(release.steps.indexOf(evidence)).toBeLessThan(release.steps.indexOf(install));
  expect(release.steps.indexOf(install)).toBeLessThan(release.steps.indexOf(gate));
  const ci = await readWorkflow("ci");
  const lookup = await read("scripts/release/find-release-ci.ts");
  const { releaseCiJobNames } = await import("../../scripts/release/find-release-ci");
  expect(releaseCiJobNames).toEqual([
    ci.jobs.feedback!.name!,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub matrix expression
    ...[1, 2, 3].map((shard) => ci.jobs.test!.name!.replace("${{ matrix.shard }}", String(shard))),
    ci.jobs["native-linux"]!.name!,
    ci.jobs["live-macos"]!.name!,
    ci.jobs.required!.name!,
  ]);
  expect(lookup).toContain(
    JSON.stringify(namedStep(ci.jobs.test!, "Shared Linux CI gate (paired binaries, external T3)").name),
  );
});
