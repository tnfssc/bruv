import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";

// Deliberately exact inputs. Extending these requires a consumer/contract audit.
export const classes = {
  remote: {
    source: "src/remote/human-rendering.ts",
    tests: [
      "tests/remote-human-rendering.test.ts",
      "tests/remote-extension.test.ts",
      "tests/remote-session-switch.test.ts",
      "tests/live-spoken-tui.test.ts",
    ],
  },
  waveform: {
    source: "src/live/waveform.ts",
    tests: [
      "tests/live-waveform.test.ts",
      "tests/live-extension.test.ts",
      "tests/live-host-access.test.ts",
      "tests/live-notice.test.ts",
      "tests/live-main-integration.test.ts",
      "tests/footer.test.ts",
      "tests/live-picker-tui.test.ts",
      "tests/live-gpt-tui.test.ts",
      "tests/live-spoken-tui.test.ts",
    ],
  },
} as const;
export type Change = { status: string; paths: string[] };
export type Decision = Change & { selected: string; reason: string };
export function parseDiff(input: string): Change[] {
  if (!input) return [];
  if (!input.endsWith("\0")) throw new Error("unterminated NUL diff");
  const fields = input.slice(0, -1).split("\0");
  const changes: Change[] = [];
  while (fields.length) {
    const status = fields.shift() ?? "";
    if (!/^(?:[AMDTUXB]|[RC][0-9]{1,3})$/.test(status)) throw new Error("unknown diff status");
    const count = /^[RC]/.test(status) ? 2 : 1;
    const paths = fields.splice(0, count);
    if (paths.length !== count || paths.some((p) => !p)) throw new Error("missing diff path");
    changes.push({ status, paths });
  }
  return changes;
}
// Only human reference material, never prompts, fixtures, embedded assets or release inputs.
export function isDoc(path: string): boolean {
  return (
    path === "README.md" ||
    /^wisdom\/(?:ci|quality|live|remote-workspaces|dependencies|configuration)\/[a-z0-9][a-z0-9-]*\.md$/.test(path)
  );
}
export function select(changes: Change[], blocker?: string) {
  const decisions: Decision[] = changes.map((change) => {
    const path = change.paths[0];
    if (!["A", "M"].includes(change.status) || change.paths.length !== 1)
      return { ...change, selected: "full", reason: "rename/copy/delete/type/status change requires full validation" };
    if (isDoc(path))
      return { ...change, selected: "docs", reason: "audited human-reference Markdown allowlist; not a runtime input" };
    for (const [name, entry] of Object.entries(classes)) {
      if (path === entry.source || path === entry.tests[0])
        return {
          ...change,
          selected: name,
          reason:
            "exact audited source/test class; select listed direct-consumer and source contracts (not complete CLI/artifact validation)",
        };
    }
    return {
      ...change,
      selected: "full",
      reason: "unknown/shared/dependency/build/workflow/selector/fixture input is not allowlisted",
    };
  });
  const reasons = [
    blocker,
    !changes.length ? "empty or unavailable diff is not evidence of docs-only" : undefined,
    ...decisions.filter((d) => d.selected === "full").map((d) => `${JSON.stringify(d.paths)}: ${d.reason}`),
  ].filter((s): s is string => !!s);
  const full = reasons.length > 0;
  const selected = [...new Set(decisions.map((d) => d.selected).filter((s) => s !== "docs" && s !== "full"))].sort();
  const tests = [...new Set(selected.flatMap((s) => [...classes[s as keyof typeof classes].tests]))].sort();
  const files = [...new Set(changes.flatMap((c) => c.paths).filter((p) => p.endsWith(".ts")))].sort();
  const commands = full
    ? [["bash", "scripts/ci.sh", "linux"]]
    : selected.length
      ? [
          ["bun", "install", "--frozen-lockfile"],
          ["bun", "run", "prepare:assets"],
          ["node_modules/.bin/biome", "format", ...files],
          ["node_modules/.bin/biome", "lint", ...files],
          ["bun", "run", "check"],
          ["bun", "test", "./tests/ci-selective.test.ts"],
          ["bun", "test", ...tests.map((p) => `./${p}`)],
          ["bun", "test", "./tests/pi-host.test.ts", "--test-name-pattern", "^source CLI"],
        ]
      : [["bun", "test", "./tests/ci-selective.test.ts"]];
  return {
    version: 1,
    mode: full ? "full" : selected.length ? "selected" : "docs",
    full,
    selected: full ? [] : selected,
    tests: full ? [] : tests,
    sourceCliContracts:
      !full && selected.length
        ? [
            {
              file: "tests/pi-host.test.ts",
              namePattern: "^source CLI",
              reason: "current source entrypoint only; compiled variants remain full artifact validation",
            },
          ]
        : [],
    decisions,
    reasons,
    commands,
    scope: "Affected source feedback only. Not final artifact, complete premerge, platform or release validation.",
    omitted: full
      ? []
      : [
          "compiled CLI/standalone smoke, full root suite, web build/browser/backend/contracts, native/platform/updater and release gates remain separate full validation",
        ],
  };
}
function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0 || result.error)
    throw new Error(`git ${args[0]} failed: ${result.error?.message ?? result.stderr.trim()}`);
  return result.stdout;
}
export function plan(cwd: string, base?: string, head = "HEAD") {
  let baseSha: string | undefined, headSha: string | undefined;
  let changes: Change[] = [];
  try {
    if (!base || /^0+$/.test(base)) throw new Error("missing/zero base; fetch event base or use full validation");
    if (base.startsWith("-") || head.startsWith("-")) throw new Error("invalid revision");
    baseSha = git(cwd, ["rev-parse", "--verify", `${base}^{commit}`]).trim();
    headSha = git(cwd, ["rev-parse", "--verify", `${head}^{commit}`]).trim();
    changes = parseDiff(
      git(cwd, [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--name-status",
        "-z",
        baseSha,
        headSha,
        "--",
      ]),
    );
    let blocker: string | undefined;
    // Both sides inspected: mode-only edits and symlink docs/source cannot silently skip checks.
    for (const c of changes) {
      if (c.status !== "M" && c.status !== "A") continue;
      const modes = [baseSha, headSha].map((sha) => git(cwd, ["ls-tree", "-z", sha, "--", c.paths[0]]).split(" ")[0]);
      if (!modes.every((m) => m === "" || m === "100644") || (c.status === "M" && modes[0] !== modes[1]))
        blocker = `non-regular file or file mode change: ${JSON.stringify(c.paths[0])}`;
    }
    for (const entry of Object.values(classes)) {
      if (
        !changes.some(
          (c) =>
            (c.status === "A" || c.status === "M") &&
            (c.paths.includes(entry.source) || c.paths.includes(entry.tests[0])),
        )
      )
        continue;
      for (const sha of [baseSha, headSha]) {
        const source = git(cwd, ["show", `${sha}:${entry.source}`]);
        if (
          new Bun.Transpiler({ loader: "ts" }).scanImports(source).length ||
          /\b(?:Bun|process|globalThis)\b|\b(?:fetch|require|eval|Function)\s*\(|\bimport\s*(?:(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)\s*)*\(/.test(
            source,
          )
        )
          blocker = `audited pure leaf gained runtime dependency/IO: ${entry.source}`;
      }
    }
    for (const entry of Object.values(classes)) {
      if (!changes.some((c) => c.paths.includes(entry.tests[0]) && ["A", "M"].includes(c.status))) continue;
      for (const sha of [baseSha, headSha]) {
        const source = git(cwd, ["show", `${sha}:${entry.tests[0]}`]);
        const imports = new Bun.Transpiler({ loader: "ts" }).scanImports(source);
        if (
          imports.some(
            (i) =>
              i.path !== "bun:test" &&
              resolve(dirname(entry.tests[0]), i.path).replace(/\.ts$/, "") !==
                resolve(entry.source).replace(/\.ts$/, ""),
          ) ||
          /\b(?:Bun|process|globalThis)\b|\b(?:fetch|require|eval|Function)\s*\(|\bimport\s*(?:(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)\s*)*\(/.test(
            source,
          )
        )
          blocker = `direct unit test gained unaudited dependency/IO: ${entry.tests[0]}`;
      }
    }
    return { ...select(changes, blocker), base: baseSha, head: headSha };
  } catch (error) {
    return { ...select(changes, error instanceof Error ? error.message : String(error)), base: baseSha, head: headSha };
  }
}
export function summary(p: ReturnType<typeof plan>): string {
  // JSON encoding preserves unusual filenames; HTML escaping avoids Actions summary injection.
  const json = JSON.stringify(p, null, 2).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `## Selective CI: ${p.mode}\n\n${p.scope}\n\n<pre>${json}</pre>\n`;
}
if (import.meta.main) {
  const args = process.argv.slice(2);
  const value = (flag: string) => {
    const i = args.indexOf(flag);
    return i < 0 ? undefined : args[i + 1];
  };
  const allowed = new Set(["--base", "--head", "--run", "--prepared-deps"]);
  for (let i = 0; i < args.length; i++) {
    if (!allowed.has(args[i]))
      throw new Error(
        "usage: bun scripts/ci-selective.ts --base SHA [--head SHA] [--run] [--prepared-deps (local measurements only)]",
      );
    if (args[i] === "--base" || args[i] === "--head") {
      if (!args[++i] || args[i].startsWith("--")) throw new Error("missing revision");
    }
  }
  const p = plan(process.cwd(), value("--base"), value("--head"));
  mkdirSync("artifacts/ci", { recursive: true });
  writeFileSync("artifacts/ci/selection.json", `${JSON.stringify(p, null, 2)}\n`);
  writeFileSync("artifacts/ci/selection-summary.md", summary(p));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(p));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `mode=${p.mode}\nfull=${p.full}\n`);
  console.log(JSON.stringify(p, null, 2));
  if (args.includes("--run")) {
    if (p.full) {
      console.error(
        "Full validation required; run bash scripts/ci.sh linux in the full producer. No selective success.",
      );
      process.exit(3);
    }
    if (
      git(process.cwd(), ["rev-parse", "HEAD"]).trim() !== p.head ||
      git(process.cwd(), ["status", "--porcelain", "--untracked-files=no"]).trim()
    )
      throw new Error("runner requires clean tracked checkout at planned head");
    if (args.includes("--prepared-deps") && process.env.CI) throw new Error("--prepared-deps is forbidden in CI");
    const runTmp = mkdtempSync(join(tmpdir(), "die-selective-"));
    try {
      for (const command of p.commands) {
        if (args.includes("--prepared-deps") && command[1] === "install") continue;
        const started = performance.now();
        console.error(`==> ${JSON.stringify(command)}`);
        const result = spawnSync(command[0], command.slice(1), {
          stdio: "inherit",
          env: {
            ...process.env,
            TMPDIR: runTmp,
            DIE_RUN_LLM_TESTS: "0",
            DIE_PROBE_EXECUTABLE: `${process.cwd()}/tests/fixtures/live-execute-cli.sh`,
          },
        });
        console.error(`elapsed ms: ${Math.round(performance.now() - started)}`);
        if (result.error || result.status !== 0) {
          process.exitCode = result.status || 1;
          break;
        }
      }
    } finally {
      rmSync(runTmp, { recursive: true, force: true });
    }
  }
}
