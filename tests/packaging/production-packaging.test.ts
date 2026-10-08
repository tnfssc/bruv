import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pairedBuildCommand } from "../../scripts/build-pair";
import { assetNames } from "../../scripts/publish-release";

test("default build ships normal CLI and connector without a T3 dependency", async () => {
  const command = pairedBuildCommand([], "/repo", "/bin/bun");
  expect(command).toEqual([
    "/bin/bun",
    "/repo/scripts/build-claude-compat.ts",
    "--outfile=/repo/dist/bruv-claude-compat",
  ]);
  const build = await Bun.file(new URL("../../scripts/build.ts", import.meta.url)).text();
  expect(build).not.toContain("buildWeb");
  expect(build).not.toContain("prepareWebPayload");
  expect(build).not.toContain("reuse-web");
  expect(build).toContain("nativeHelperPlugin");
});

test("release targets compile one normal binary and preserve the target/native helper", () => {
  const command = pairedBuildCommand(
    ["--", "--target=bun-darwin-arm64", "--live-helper=/helper", "--outfile=dist/release/bruv-darwin-arm64"],
    "/repo",
    "/bin/bun",
  );
  expect(command).toEqual([
    "/bin/bun",
    "/repo/scripts/build-claude-compat.ts",
    "--target=bun-darwin-arm64",
    "--live-helper=/helper",
    "--outfile=/repo/dist/release/bruv-claude-compat-darwin-arm64",
  ]);
  expect(() => pairedBuildCommand(["--outfile=/bruv/bin/other"], "/repo", "/bin/bun")).toThrow();
  expect(() => pairedBuildCommand(["--outfile=dist/bruv-claude-compat"], "/repo", "/bin/bun")).toThrow();
});

test("paired build delegates once from its repository root and relays child I/O and exit status", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "bruv-build-pair-"));
  const root = join(temporary, "repo");
  try {
    await mkdir(join(root, "scripts"), { recursive: true });
    await Bun.write(
      join(root, "scripts/build-pair.ts"),
      await Bun.file(new URL("../../scripts/build-pair.ts", import.meta.url)).text(),
    );
    await Bun.write(
      join(root, "scripts/build-claude-compat.ts"),
      "console.log(JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), input: await Bun.stdin.text() }));\n" +
        'console.error("connector stderr");\nprocess.exit(Number(process.env.BRUV_TEST_BUILD_EXIT));\n',
    );
    for (const code of [0, 23]) {
      const child = Bun.spawn(
        [
          process.execPath,
          join(root, "scripts/build-pair.ts"),
          "--",
          "--target=bun-linux-x64",
          "--outfile=dist/bruv-linux-x64",
        ],
        {
          cwd: temporary,
          env: { ...process.env, BRUV_TEST_BUILD_EXIT: String(code) },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      child.stdin.write("build input");
      child.stdin.end();
      expect(await child.exited).toBe(code);
      expect(JSON.parse(await new Response(child.stdout).text())).toEqual({
        cwd: root,
        args: ["--target=bun-linux-x64", "--outfile=" + join(root, "dist/bruv-claude-compat-linux-x64")],
        input: "build input",
      });
      expect(await new Response(child.stderr).text()).toBe("connector stderr\n");
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("every release target ships binary and launcher, checksums and shared licensing/source notices", () => {
  for (const target of ["linux-x64", "linux-arm64", "darwin-arm64", "android-arm64"]) {
    for (const name of ["bruv", "bruv-claude-compat"]) {
      expect(assetNames as readonly string[]).toContain(name + "-" + target);
      expect(assetNames as readonly string[]).toContain(name + "-" + target + ".sha256");
    }
  }
  for (const notice of ["LICENSE", "THIRD_PARTY_NOTICES.md", "THIRD_PARTY_LICENSES.txt", "SOURCE.txt"])
    expect(assetNames as readonly string[]).toContain(notice);
  expect(assetNames.some((asset) => asset.includes("web"))).toBe(false);
  expect(assetNames).toHaveLength(20);
  expect(new Set(assetNames).size).toBe(20);
});

test("external native release gate setup keeps verified upstream layout and env handoff", async () => {
  const script = await Bun.file(new URL("../../scripts/setup-native-release-gate.sh", import.meta.url)).text();
  expect(script).not.toMatch(/[\u0000-\u0008]/);
  expect(script).toContain('root="$RUNNER_TEMP/native-t3"');
  expect(script).toContain("official-2644/fetch-official.mjs");
  expect(script).not.toContain("20261003.2623");
  const fetch = await Bun.file(
    new URL("../../wisdom/claude-compat/proof/official-2644/fetch-official.mjs", import.meta.url),
  ).text();
  expect(fetch).toContain("--strip-components=1");
  expect(fetch).toContain("5f9e29cf2712c87736556c99ea580606b399897cb846c2401a434a0d05c4eeca");
  expect(fetch).toContain("53fbd1c78ab3a01ea91913f65dc17b9d7824f00a81564e06992a73e183054e48");
  expect(fetch).toContain("737993303d36e10674c54b95e5bd3826682c99c7");
  expect(script).toContain("playwright-core");
  expect(script).toContain("claude-agent-sdk-0.3.276.tgz");
  expect(script).toContain("f65a23c8272467ec37da496c5a349b10b3b4d04f052209f239f028c5aabdc3ca");
  expect(script).toContain("BRUV_CLAUDE_SDK_PATH=$sdk/package/sdk.mjs");
  const workflow = Bun.YAML.parse(
    await Bun.file(new URL("../../.github/workflows/release.yml", import.meta.url)).text(),
  ) as any;
  const steps = workflow.jobs["linux-browser-boot"].steps;
  const setup = steps.findIndex((step: any) => step.run === "bash scripts/setup-native-release-gate.sh");
  expect(setup).toBeGreaterThan(0);
  expect(steps[setup + 1].run).toContain("node scripts/run-native-release-gate.mjs");
});
