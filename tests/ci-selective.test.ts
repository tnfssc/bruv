import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readdirSync,
  readFileSync,
  chmodSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { classes, isDoc, parseDiff, plan, select, summary } from "../scripts/ci-selective";
const change = (path: string, status = "M") => ({ status, paths: [path] });
const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function repo() {
  const cwd = mkdtempSync(join(tmpdir(), "die-selector-"));
  temps.push(cwd);
  const git = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (r.status) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  const put = (path: string, body = "reference\n") => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), body);
  };
  git("init", "-q");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  put("README.md");
  put(".gitignore", "artifacts/\n");
  for (const c of Object.values(classes)) put(c.source, readFileSync(c.source, "utf8"));
  const commit = () => {
    git("add", "-A");
    git("commit", "-qm", "fixture");
    return git("rev-parse", "HEAD");
  };
  return { cwd, git, put, commit, base: commit() };
}
describe("conservative union selection", () => {
  test("audited docs only, not arbitrary Markdown", () => {
    expect(select([change("README.md"), change("wisdom/quality/ci-selective.md")]).mode).toBe("docs");
    for (const p of [
      "src/prompts/wisdom.md",
      "CHANGELOG.md",
      "wisdom/values.md",
      "wisdom/dependencies/hosted-pr-fixture/README.md",
      "support/release-v0.15.14.md",
      "tests/fixtures/README.md",
      "integrations/t3/README.md",
      "wisdom/quality/sub/fixture.md",
      "README.md.ts",
      "README.md\n",
      "wisdom/quality/../values.md",
    ])
      expect(isDoc(p)).toBe(false);
  });
  test("mixed classes union, docs do not mask source, duplicates deduplicate", () => {
    const p = select([
      change("README.md"),
      change(classes.remote.source),
      change(classes.waveform.source),
      change(classes.remote.source),
    ]);
    expect(p.mode).toBe("selected");
    expect(p.selected).toEqual(["remote", "waveform"]);
    expect(p.tests).toEqual([...new Set([...classes.remote.tests, ...classes.waveform.tests])].sort());
    expect(p.decisions).toHaveLength(4);
    expect(p.commands.some((c) => c.includes("--frozen-lockfile"))).toBe(true);
    expect(p.commands.some((c) => c.includes("check"))).toBe(true);
  });
  test("only audited direct or subsystem test changes are fast", () => {
    for (const c of Object.values(classes)) expect(select([change(c.tests[0])]).mode).toBe("selected");
    expect(select([change("tests/remote-extension.test.ts")]).selected).toEqual(["remote-source"]);
    expect(select([change("tests/remote-new.test.ts")]).full).toBe(true);
  });
  test("unknowns, fixtures, shared, build, dependencies, workflow and selector always override", () => {
    for (const path of [
      "src/remote/new.ts",
      "src/live/extension.ts",
      "src/new.ts",
      "src/ui/footer.ts",
      "package.json",
      "bun.lock",
      "tsconfig.json",
      "biome.json",
      "mise.toml",
      "scripts/build.ts",
      "scripts/prepare-assets.ts",
      "scripts/ci-selective.ts",
      "tests/ci-selective.test.ts",
      "tests/fixtures/live-execute-cli.sh",
      "tests/fixtures/live-picker-tui.ts",
      ".github/workflows/ci.yml",
      "-README.md",
      "λ.md",
      "notes with spaces.md",
      "x\ny.ts",
      "x\ty.ts",
    ]) {
      const p = select([change("README.md"), change(classes.remote.source), change(path)]);
      expect(p.full).toBe(true);
      expect(p.tests).toEqual([]);
      expect(p.reasons.length).toBeGreaterThan(0);
    }
  });
  test("every unsafe status falls back including rename between fast classes", () => {
    for (const status of ["D", "T", "U", "X", "B", "R100", "C100"])
      expect(select([change("README.md", status)]).full).toBe(true);
    expect(select([{ status: "R100", paths: [classes.remote.source, "README.md"] }]).full).toBe(true);
    expect(select([]).full).toBe(true);
    expect(select([change("README.md")], "missing base").full).toBe(true);
  });
  test("NUL paths preserve whitespace, unicode, quotes, newlines and rename endpoints", () => {
    const paths = ["a b.ts", "a\nb.ts", "a\tb.ts", 'a"b.ts', "日本語.ts", "-x.ts"];
    expect(parseDiff(paths.map((p) => "M\0" + p + "\0").join(""))).toEqual(paths.map((p) => change(p)));
    expect(parseDiff("R099\0old\0new\0")).toEqual([{ status: "R099", paths: ["old", "new"] }]);
    for (const input of ["M\0path", "Z\0path\0", "R100\0old\0", "M\0\0"]) expect(() => parseDiff(input)).toThrow();
  });
});
describe("real git base/head safety", () => {
  test("missing/unavailable/zero base and empty diff fall back", () => {
    const r = repo();
    for (const base of [undefined, "0000000", "not-present", "--help", r.base])
      expect(plan(r.cwd, base).full).toBe(true);
    expect(plan(r.cwd, r.base, "missing-head").full).toBe(true);
  });
  test("docs and pure leaves use actual two commits; changed runtime import falls back", () => {
    const r = repo();
    r.put("README.md", "changed");
    const docs = r.commit();
    expect(plan(r.cwd, r.base, docs).mode).toBe("docs");
    r.put(classes.waveform.source, readFileSync(classes.waveform.source, "utf8") + "\n// changed\n");
    const source = r.commit();
    expect(plan(r.cwd, docs, source).selected).toEqual(["waveform"]);
    r.put(classes.waveform.source, 'import "node:fs";\nexport const value = 1;');
    const imported = r.commit();
    expect(plan(r.cwd, source, imported).full).toBe(true);
    // Also inspect old side: removing a formerly shared/runtime dependency is not fast.
    expect(plan(r.cwd, imported, source).full).toBe(true);
  });
  test("rename/delete cannot hide old executable input under a doc name", () => {
    const r = repo();
    mkdirSync(join(r.cwd, "wisdom/quality"), { recursive: true });
    r.git("mv", classes.remote.source, "wisdom/quality/renamed.md");
    const renamed = r.commit();
    const p = plan(r.cwd, r.base, renamed);
    expect(p.full).toBe(true);
    expect(p.decisions.some((d) => d.paths.includes(classes.remote.source))).toBe(true);
    r.git("rm", "README.md");
    expect(plan(r.cwd, renamed, r.commit()).full).toBe(true);
  });
  test("actual hostile filenames do not split or disappear", () => {
    const r = repo();
    const names = ["space name.md", "line\nbreak.md", "tab\tname.ts", "日本語.md", "-option.md"];
    for (const n of names) r.put(n);
    const p = plan(r.cwd, r.base, r.commit());
    expect(p.full).toBe(true);
    expect(p.decisions.flatMap((d) => d.paths).sort()).toEqual(names.sort());
  });
  test("mode-only changes and symlink docs fall back", () => {
    const r = repo();
    chmodSync(join(r.cwd, "README.md"), 0o755);
    expect(plan(r.cwd, r.base, r.commit()).full).toBe(true);
    const q = repo();
    symlinkSync("README.md", join(q.cwd, "wisdom-link.md"));
    expect(plan(q.cwd, q.base, q.commit()).full).toBe(true);
    const z = repo();
    rmSync(join(z.cwd, "README.md"));
    symlinkSync(classes.remote.source, join(z.cwd, "README.md"));
    expect(plan(z.cwd, z.base, z.commit()).full).toBe(true);
  });
  test("summary escapes HTML and exposes omissions", () => {
    const p = { ...select([change("<script>.ts")]), base: "base", head: "head" };
    expect(summary(p)).not.toContain("<script>");
    expect(summary({ ...select([change("README.md")]), base: "base", head: "head" })).toContain("Not final artifact");
  });
});
function tsFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsFiles(join(directory, e.name)) : e.name.endsWith(".ts") ? [join(directory, e.name)] : [],
  );
}
test("dependency audit: pure leaves and complete direct source/test consumers remain explicit", () => {
  const scan = new Bun.Transpiler({ loader: "ts" });
  const consumers = (target: string) =>
    tsFiles("src")
      .concat(tsFiles("tests"))
      .filter((p) =>
        scan
          .scanImports(readFileSync(p, "utf8").replace(/^#![^\n]*\n/, ""))
          .some(
            (i) =>
              i.path.startsWith(".") &&
              resolve(dirname(p), i.path).replace(/\.ts$/, "") === resolve(target).replace(/\.ts$/, ""),
          ),
      )
      .sort();
  expect(consumers(classes.remote.source)).toEqual([
    "src/remote/extension.ts",
    "tests/remote-extension.test.ts",
    "tests/remote-human-rendering.test.ts",
  ]);
  expect(consumers(classes.waveform.source)).toEqual([
    "src/live/extension.ts",
    "tests/footer.test.ts",
    "tests/live-waveform.test.ts",
  ]);
  for (const entry of Object.values(classes)) expect(scan.scanImports(readFileSync(entry.source, "utf8"))).toEqual([]);
  // Contract/extension regressions select all three remote boundaries, not merely leaf tests.
  expect(classes.remote.tests).toContain("tests/remote-session-switch.test.ts");
  expect(classes.waveform.tests).toContain("tests/live-main-integration.test.ts");
  expect(classes.waveform.tests).toContain("tests/live-gpt-tui.test.ts");
});

const runner = resolve("scripts/ci-selective.ts");
function cli(cwd: string, args: string[], extra: Record<string, string> = {}) {
  const env = { ...process.env, ...extra, PATH: dirname(process.execPath) + ":" + process.env.PATH };
  return spawnSync(process.execPath, [runner, ...args], { cwd, env, encoding: "utf8" });
}
describe("runner fail-closed contract", () => {
  test("full is never reported as selective success", () => {
    const r = repo();
    const result = cli(r.cwd, ["--base", "missing", "--run"]);
    expect(result.status).toBe(3);
    expect(result.stderr).toContain("Full validation required");
    expect(JSON.parse(readFileSync(join(r.cwd, "artifacts/ci/selection.json"), "utf8")).full).toBe(true);
  });
  test("docs runs a real check; missing selected test is failure, not a skip", () => {
    const r = repo();
    r.put("README.md", "updated");
    const head = r.commit();
    expect(cli(r.cwd, ["--base", r.base, "--head", head, "--run"]).status).not.toBe(0);
    r.put(
      "tests/ci-selective.test.ts",
      'import { test, expect } from "bun:test"; test("runner fixture", () => expect(1).toBe(1));',
    );
    // The runner doesn't accept uncommitted tracked input; commit fixture before docs diff.
    const base = r.commit();
    r.put("README.md", "updated again");
    r.commit();
    const success = cli(r.cwd, ["--base", base, "--run"]);
    expect(success.status).toBe(0);
    r.put("README.md", "dirty");
    expect(cli(r.cwd, ["--base", base, "--run"]).status).not.toBe(0);
  });
  test("wrong checkout, missing arguments and install bypass in CI fail", () => {
    const r = repo();
    r.put("README.md", "updated");
    r.commit();
    expect(cli(r.cwd, ["--base", r.base, "--head", r.base, "--run"]).status).not.toBe(0);
    expect(cli(r.cwd, ["--base"]).status).not.toBe(0);
    r.put(classes.waveform.source, readFileSync(classes.waveform.source, "utf8") + "\n// fixture");
    r.commit();
    expect(cli(r.cwd, ["--base", r.base, "--run", "--prepared-deps"], { CI: "true" }).stderr).toContain(
      "forbidden in CI",
    );
  });
  test("a failed selected command stops execution (no mocked source success)", () => {
    const r = repo();
    r.put(classes.waveform.source, readFileSync(classes.waveform.source, "utf8") + "\n// fixture");
    r.commit();
    const result = cli(r.cwd, ["--base", r.base, "--run", "--prepared-deps"], { CI: "" });
    expect(result.status).not.toBe(0); // no prepare-assets in isolated fixture, so never reaches tests
    expect(result.stderr).toContain("prepare:assets");
    expect(result.stderr).not.toContain('==> ["bun","test"');
  });
});
test("real source mutations produce selected leaf regression failures without dist or dependencies", () => {
  for (const entry of Object.values(classes)) {
    const r = repo();
    r.put(entry.tests[0], readFileSync(entry.tests[0], "utf8"));
    const base = r.commit();
    const source = readFileSync(entry.source, "utf8");
    const mutated =
      entry === classes.waveform
        ? source.replace("const raw =", 'return ""; const raw =')
        : source.replace('String(value ?? "")', 'String("UNSAFE")');
    expect(mutated).not.toBe(source);
    r.put(entry.source, mutated);
    const head = r.commit();
    const p = plan(r.cwd, base, head);
    expect(p.mode).toBe("selected");
    expect(p.tests).toContain(entry.tests[0]);
    const run = spawnSync(process.execPath, ["test", "./" + entry.tests[0]], { cwd: r.cwd, encoding: "utf8" });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("(fail)");
  }
});
test("test dependency/source-contract drift triggers full fallback on both sides", () => {
  const r = repo();
  const entry = classes.waveform;
  r.put(entry.tests[0], readFileSync(entry.tests[0], "utf8"));
  const base = r.commit();
  r.put(entry.tests[0], readFileSync(entry.tests[0], "utf8") + '\nimport "node:fs";');
  const head = r.commit();
  expect(plan(r.cwd, base, head).full).toBe(true);
  expect(plan(r.cwd, head, base).full).toBe(true);
});

test("real current direct-unit-test edits qualify on both audited classes", () => {
  for (const entry of Object.values(classes)) {
    const r = repo();
    r.put(entry.tests[0], readFileSync(entry.tests[0], "utf8"));
    const base = r.commit();
    r.put(entry.tests[0], readFileSync(entry.tests[0], "utf8") + "\n// narrow test-only fixture\n");
    const p = plan(r.cwd, base, r.commit());
    expect(p.mode).toBe("selected");
    expect(p.tests).toContain(entry.tests[0]);
  }
});

test("computed dynamic imports, including comment-separated syntax, force full on base and head", () => {
  for (const expression of [
    'import(["node", "fs"].join(":"))',
    'import /* gap */ (["node", "fs"].join(":"))',
    'import // gap\n (["node", "fs"].join(":"))',
  ]) {
    const r = repo();
    r.put(
      classes.waveform.source,
      "const fs = await " + expression + '; export const x = fs.readFileSync("README.md", "utf8");',
    );
    const head = r.commit();
    expect(plan(r.cwd, r.base, head).full).toBe(true);
    expect(plan(r.cwd, head, r.base).full).toBe(true);
  }
});
test("actual merge candidate includes target-branch unknown changes and cannot inherit head-only fast selection", () => {
  const r = repo();
  r.git("checkout", "-qb", "feature");
  r.put(classes.waveform.source, readFileSync(classes.waveform.source, "utf8") + "\n// feature\n");
  const feature = r.commit();
  expect(plan(r.cwd, r.base, feature).mode).toBe("selected");
  r.git("checkout", "-qb", "target", r.base);
  r.put("shared-runtime.ts", "export const target = 1;");
  const target = r.commit();
  r.git("checkout", "feature");
  r.git("merge", "--no-ff", "-m", "merged fixture", target);
  const merge = r.git("rev-parse", "HEAD");
  const cumulative = plan(r.cwd, r.base, merge);
  expect(cumulative.full).toBe(true);
  expect(cumulative.decisions.some((d) => d.paths.includes("shared-runtime.ts"))).toBe(true);
  // Current target baseline correctly isolates integrated feature delta.
  expect(plan(r.cwd, target, merge).mode).toBe("selected");
});
test("source CLI contracts explicitly exclude compiled pi-host variants", () => {
  const p = select([change(classes.waveform.source)]);
  expect(p.commands).toContainEqual(["bun", "test", "./tests/pi-host.test.ts", "--test-name-pattern", "^source CLI"]);
  expect(p.tests).toContain("tests/live-spoken-tui.test.ts");
  const runnerSource = readFileSync(runner, "utf8");
  expect(runnerSource).toContain("DIE_PROBE_EXECUTABLE:");
  expect(runnerSource).toContain("/tests/fixtures/live-execute-cli.sh");
  const source = readFileSync("tests/live-main-integration.test.ts", "utf8");
  expect(source).toContain("process.env.DIE_PROBE_EXECUTABLE ??");
});

test("unresolved merge conflicts cannot run a green docs candidate", () => {
  const r = repo();
  r.git("checkout", "-qb", "feature");
  r.put("README.md", "feature version\n");
  r.commit();
  r.git("checkout", "-qb", "target", r.base);
  r.put("README.md", "target version\n");
  const target = r.commit();
  r.git("checkout", "feature");
  expect(() => r.git("merge", "--no-ff", target)).toThrow();
  const result = cli(r.cwd, ["--base", r.base, "--run"]);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("clean tracked checkout");
});

test("a valid non-full explicit head different from checkout is refused", () => {
  const r = repo();
  r.put("README.md", "candidate one");
  const candidate = r.commit();
  r.put("README.md", "candidate two");
  r.commit();
  expect(plan(r.cwd, r.base, candidate).mode).toBe("docs");
  const result = cli(r.cwd, ["--base", r.base, "--head", candidate, "--run"]);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("clean tracked checkout at planned head");
});

test("direct unit tests reject opaque imports on both base and head", () => {
  for (const entry of Object.values(classes)) {
    for (const expression of [
      'import(["node", "fs"].join(":"))',
      'import /* gap */ (["node", "fs"].join(":"))',
      'import // gap\n (["node", "fs"].join(":"))',
    ]) {
      const r = repo();
      const original = readFileSync(entry.tests[0], "utf8");
      r.put(entry.tests[0], original);
      const base = r.commit();
      r.put(
        entry.tests[0],
        original + "\nconst fs = await " + expression + '; const reference = fs.readFileSync("README.md", "utf8");',
      );
      const head = r.commit();
      expect(plan(r.cwd, base, head).full).toBe(true);
      expect(plan(r.cwd, head, base).full).toBe(true);
    }
  }
});

test("remote subsystem commands use the resolved cumulative base and preserve full exclusions", () => {
  const base = "a".repeat(40);
  const p = select([change("src/remote/client.ts"), change("README.md")], undefined, base);
  expect(p.mode).toBe("selected");
  expect(p.selected).toEqual(["remote-source"]);
  expect(p.tests).toContain("tests/ci-remote-cli-source.test.ts");
  expect(p.commands.some((c) => c.includes("--changed=" + base))).toBe(true);
  expect(p.commands.some((c) => c.includes("./tests/ci-remote-source.test.ts"))).toBe(true);
  expect(p.fullTierRemoteConsumers).toContain("tests/remote-e2e.test.ts");
  expect(p.commands.flat()).not.toContain("tests/remote-e2e.test.ts");
  expect(select([change("src/remote/client.ts"), change("src/cli.ts")], undefined, base).full).toBe(true);
  for (const status of ["D", "R100", "T"])
    expect(select([change("src/remote/client.ts", status)], undefined, base).full).toBe(true);
  const union = select([change("src/remote/client.ts"), change(classes.waveform.source)], undefined, base);
  expect(union.selected).toEqual(["remote-source", "waveform"]);
  expect(union.commands.some((c) => c.includes("./tests/live-waveform.test.ts"))).toBe(true);
});

test("remote plan resolves symbolic base before affected-test execution", () => {
  const r = repo();
  r.put("src/remote/client.ts", "export const state = 1;");
  const base = r.commit();
  r.put("src/remote/client.ts", "export const state = 2;");
  const head = r.commit();
  const p = plan(r.cwd, "HEAD^", "HEAD");
  expect(p.base).toBe(base);
  expect(p.head).toBe(head);
  expect(p.selected).toEqual(["remote-source"]);
  expect(p.commands.some((c) => c.includes("--changed=" + base))).toBe(true);
  expect(p.commands.flat()).not.toContain("--changed=HEAD^");
  expect(p.affectedSourcePopulation).toContain("tests/job-service.test.ts");
});
