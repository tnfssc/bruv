import { expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  classifyRemoteChange,
  remoteSourceCommands,
  remoteSources,
  remoteTests,
  remoteReferenceDocs,
  sourceProcessInputs,
  reverseSourceTests,
  processSourceTests,
  fullTierConsumers,
} from "../scripts/ci-remote-source";

const root = resolve(import.meta.dir, "..");
test("explicit ownership: audited additions, modifications; delete/rename/type/unknown fail broad", () => {
  for (const path of [...remoteSources, ...remoteTests, ...sourceProcessInputs]) {
    expect(classifyRemoteChange({ path, status: "M" })).toBe("source");
    expect(classifyRemoteChange({ path, status: "A" })).toBe("source");
    for (const status of ["D", "R100", "C100", "T", "U"]) expect(classifyRemoteChange({ path, status })).toBe("full");
    expect(classifyRemoteChange({ path, status: "M", oldPath: "old" })).toBe("full");
  }
  for (const path of [
    "src/remote/new.ts",
    "tests/remote-new.test.ts",
    "tests/fixtures/remote-e2e/fake-provider.ts",
    "tests/fixtures/remote-e2e/README.md",
    "scripts/build.ts",
    "bun.lock",
    "package.json",
    "src/cli.ts",
    "src/tasks/job-service.ts",
    "src/agent/extension.ts",
    "wisdom/values.md",
    "wisdom/dependencies/new.md",
    ...fullTierConsumers,
  ])
    for (const status of ["A", "M", "D"]) expect(classifyRemoteChange({ path, status })).toBe("full");
  for (const path of remoteReferenceDocs) {
    expect(classifyRemoteChange({ path, status: "M" })).toBe("reference");
    expect(classifyRemoteChange({ path, status: "D" })).toBe("full");
  }
});
test("commands union process/fixture tests with reverse imports, never compiled or web tests", () => {
  const commands = remoteSourceCommands("a".repeat(40), "/bun");
  expect(commands[0]!.argv).toEqual(["/bun", "scripts/prepare-assets.ts"]);
  expect(commands[1]!.argv).toContain("tests/ci-remote-cli-source.test.ts");
  expect(commands[1]!.argv).toContain("tests/live-spoken-tui.test.ts");
  expect(commands[2]!.argv).toContain("tests/subagent-extension.test.ts");
  expect(commands[2]!.argv).toContain("--changed=" + "a".repeat(40));
  for (const path of fullTierConsumers) expect(commands.flatMap((c) => c.argv)).not.toContain(path);
  expect(() => remoteSourceCommands("--help")).toThrow("Resolved base");
  expect(() => remoteSourceCommands("HEAD")).toThrow("Resolved base");
});

// Real source behavior mutation trials: isolated source tree, no dist/build or archive.
// These are helper-policy regressions, not timed ordinary remote feedback tests.
for (const mutation of [
  {
    file: "src/remote/security.ts",
    before: readFileSync(join(root, "src/remote/security.ts"), "utf8"),
    after: "export const sensitiveRepoPath = (_path: string) => false;\n",
    tests: ["tests/remote-repository.test.ts", "tests/remote-capability-runtime.test.ts"],
  },
  {
    file: "src/remote/client.ts",
    before: 'throw new Error("Task ID is pinned to a different owner or intent; refusal to retry");',
    after: "/* mutation: accept conflicting intent */",
    tests: ["tests/remote-client.test.ts"],
  },
  {
    file: "src/remote/entry.ts",
    before:
      'if (Object.keys(request).some((key) => !allowed.includes(key))) throw Error("Unsupported remote request field");',
    after: "/* mutation: accept extra request fields */",
    tests: ["tests/ci-remote-cli-source.test.ts", "--test-name-pattern", "source CLI remote entry"],
  },
])
  test("source consumers kill behavior mutation: " + mutation.file, async () => {
    const dir = mkdtempSync(join(tmpdir(), "die-source-mutation-"));
    try {
      for (const path of ["src", "tests", "scripts"]) cpSync(join(root, path), join(dir, path), { recursive: true });
      cpSync(join(root, "package.json"), join(dir, "package.json"));
      for (const path of ["node_modules", "runtime-assets"]) symlinkSync(join(root, path), join(dir, path), "dir");
      const target = join(dir, mutation.file),
        original = readFileSync(target, "utf8");
      expect(original).toContain(mutation.before);
      writeFileSync(target, original.replace(mutation.before, mutation.after));
      const child = Bun.spawn([process.execPath, "test", ...mutation.tests], {
        cwd: dir,
        env: { ...process.env, SHELL: "/bin/bash" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(code, out + err).not.toBe(0);
      expect(out + err).toContain("(fail)");
      expect(out + err).not.toContain("Cannot find module");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20000);

// Bun's reverse import selection cannot discover an arbitrary fs fixture read.
test("real Git --changed reverse consumer and explicit non-import fixture coverage", async () => {
  const dir = mkdtempSync(join(tmpdir(), "die-changed-contract-"));
  const run = (argv: string[]) => Bun.spawnSync(argv, { cwd: dir, stdout: "pipe", stderr: "pipe" });
  try {
    mkdirSync(join(dir, "src"));
    mkdirSync(join(dir, "tests"));
    writeFileSync(join(dir, "src/leaf.ts"), "export const value = 1;");
    writeFileSync(join(dir, "src/consumer.ts"), 'export { value } from "./leaf";');
    writeFileSync(
      join(dir, "tests/value.test.ts"),
      'import {test,expect} from "bun:test"; import {value} from "../src/consumer"; test("reverse",()=>expect(value).toBe(1));',
    );
    writeFileSync(join(dir, "tests/fixture.txt"), "good");
    writeFileSync(
      join(dir, "tests/fixture.test.ts"),
      'import {test,expect} from "bun:test"; test("fixture",async()=>expect(await Bun.file(import.meta.dir+"/fixture.txt").text()).toBe("good"));',
    );
    for (const args of [
      ["init", "-q"],
      ["config", "user.email", "test@example.invalid"],
      ["config", "user.name", "CI test"],
      ["add", "."],
      ["commit", "-qm", "base"],
    ])
      expect(run(["git", ...args]).exitCode).toBe(0);
    const base = run(["git", "rev-parse", "HEAD"]).stdout.toString().trim();
    writeFileSync(join(dir, "src/leaf.ts"), "export const value = 2;");
    const changed = run([process.execPath, "test", "tests/value.test.ts", "--changed=" + base]);
    expect(changed.exitCode).not.toBe(0);
    expect(changed.stderr.toString()).toContain("(fail)");
    writeFileSync(join(dir, "src/leaf.ts"), "export const value = 1;");
    writeFileSync(join(dir, "tests/fixture.txt"), "broken");
    // Always-running owning test catches filesystem-only input independent of --changed.
    expect(run([process.execPath, "test", "tests/fixture.test.ts"]).exitCode).not.toBe(0);
    run(["git", "mv", "src/leaf.ts", "src/moved.ts"]);
    expect(classifyRemoteChange({ path: "src/remote/client.ts", status: "D" })).toBe("full");
    expect(classifyRemoteChange({ path: "src/remote/client.ts", oldPath: "src/remote/old.ts", status: "R100" })).toBe(
      "full",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Inventory alarm, not a new graph: direct consumers must have an explicit tier owner.
test("direct remote and shared-boundary test consumers have source/full ownership", () => {
  const ownedTests = new Set<string>([
    ...remoteTests,
    ...reverseSourceTests,
    ...processSourceTests,
    ...fullTierConsumers,
  ]);
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  for (const file of readdirSync(join(root, "tests"), { recursive: true })) {
    if (typeof file !== "string" || !file.endsWith(".test.ts")) continue;
    const path = join(root, "tests", file);
    for (const input of transpiler.scanImports(readFileSync(path, "utf8"))) {
      if (!input.path.startsWith(".")) continue;
      const target = resolve(dirname(path), input.path).replace(/\.ts$/, "");
      if (
        target.startsWith(join(root, "src/remote") + "/") ||
        ["src/agent/extension", "src/tasks/job-service", "src/typescript/job-bridge"].some(
          (p) => target === join(root, p),
        )
      )
        expect(ownedTests.has("tests/" + file), "No source/full test owner: " + file).toBe(true);
    }
  }
});
