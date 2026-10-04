import { expect, test } from "bun:test";
import { pairedBuildCommands } from "../scripts/build-pair";
import { assetNames } from "../scripts/publish-release";

test("default build ships normal CLI and connector without a T3 dependency", async () => {
  const commands = pairedBuildCommands([], "/repo", "/bin/bun");
  expect(commands).toEqual([
    ["/bin/bun", "/repo/scripts/build.ts", "--outfile=/repo/dist/bruv"],
    ["/bin/bun", "/repo/scripts/build-claude-compat.ts", "--outfile=/repo/dist/bruv-claude-compat"],
  ]);
  const build = await Bun.file(new URL("../scripts/build.ts", import.meta.url)).text();
  expect(build).not.toContain("buildWeb");
  expect(build).not.toContain("prepareWebPayload");
  expect(build).not.toContain("reuse-web");
  expect(build).toContain("nativeHelperPlugin");
});

test("release targets preserve matched names, target and native helper in BOTH builds", () => {
  const commands = pairedBuildCommands(
    ["--", "--target=bun-darwin-arm64", "--live-helper=/helper", "--outfile=dist/release/bruv-darwin-arm64"],
    "/repo",
    "/bin/bun",
  );
  expect(commands.map((command) => command.at(-1))).toEqual([
    "--outfile=/repo/dist/release/bruv-darwin-arm64",
    "--outfile=/repo/dist/release/bruv-claude-compat-darwin-arm64",
  ]);
  for (const command of commands) {
    expect(command).toContain("--target=bun-darwin-arm64");
    expect(command).toContain("--live-helper=/helper");
  }
  expect(() => pairedBuildCommands(["--outfile=/bruv/bin/other"], "/repo", "/bin/bun")).toThrow();
  expect(() => pairedBuildCommands(["--outfile=dist/bruv-claude-compat"], "/repo", "/bin/bun")).toThrow();
});

test("every release target ships both binaries, checksums and shared licensing/source notices", () => {
  for (const target of ["linux-x64", "linux-arm64", "darwin-arm64", "android-arm64"]) {
    for (const name of ["bruv", "bruv-claude-compat"]) {
      expect(assetNames as readonly string[]).toContain(name + "-" + target);
      expect(assetNames as readonly string[]).toContain(name + "-" + target + ".sha256");
    }
  }
  for (const notice of ["LICENSE", "THIRD_PARTY_NOTICES.md", "THIRD_PARTY_LICENSES.txt", "SOURCE.txt"])
    expect(assetNames as readonly string[]).toContain(notice);
  expect(assetNames.some((asset) => asset.includes("web"))).toBe(false);
});

test("external native release gate setup keeps verified upstream layout and env handoff", async () => {
  const script = await Bun.file(new URL("../scripts/setup-native-release-gate.sh", import.meta.url)).text();
  expect(script).not.toMatch(/[\u0000-\u0008]/);
  expect(script).toContain('root="$RUNNER_TEMP/native-t3"');
  expect(script).toContain("official-2644/fetch-official.mjs");
  expect(script).not.toContain("20261003.2623");
  const fetch = await Bun.file(
    new URL("../wisdom/claude-compat/proof/official-2644/fetch-official.mjs", import.meta.url),
  ).text();
  expect(fetch).toContain("--strip-components=1");
  expect(fetch).toContain("5f9e29cf2712c87736556c99ea580606b399897cb846c2401a434a0d05c4eeca");
  expect(fetch).toContain("53fbd1c78ab3a01ea91913f65dc17b9d7824f00a81564e06992a73e183054e48");
  expect(fetch).toContain("737993303d36e10674c54b95e5bd3826682c99c7");
  expect(script).toContain("playwright-core");
  const workflow = Bun.YAML.parse(
    await Bun.file(new URL("../.github/workflows/release.yml", import.meta.url)).text(),
  ) as any;
  const steps = workflow.jobs["linux-browser-boot"].steps;
  const setup = steps.findIndex((step: any) => step.run === "bash scripts/setup-native-release-gate.sh");
  expect(setup).toBeGreaterThan(0);
  expect(steps[setup + 1].run).toContain("node scripts/run-native-release-gate.mjs");
});
