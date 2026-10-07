import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
export type Change = { status: string; paths: string[] };
export function parseDiff(input: string): Change[] {
  if (!input) return [];
  if (!input.endsWith("\0")) throw new Error("unterminated NUL diff");
  const fields = input.slice(0, -1).split("\0"),
    changes: Change[] = [];
  while (fields.length) {
    const status = fields.shift() ?? "";
    if (!/^(?:[AMDTUXB]|[RC][0-9]{1,3})$/.test(status)) throw new Error("unknown diff status");
    const count = /^[RC]/.test(status) ? 2 : 1,
      paths = fields.splice(0, count);
    if (paths.length !== count || paths.some((p) => !p)) throw new Error("missing diff path");
    changes.push({ status, paths });
  }
  return changes;
}
export function isDoc(path: string): boolean {
  return (
    path === "README.md" ||
    /^wisdom\/(?:ci|quality|remote-workspaces|dependencies|configuration)\/[a-z0-9][a-z0-9-]*\.md$/.test(path)
  );
}
function isReferenceOnlyDiff(changes: Change[]): boolean {
  return changes.length > 0 && changes.every((c) => c.status === "M" && c.paths.length === 1 && isDoc(c.paths[0]!));
}

export function planDiff(changes: Change[], blocker?: string) {
  const docs = isReferenceOnlyDiff(changes);
  const full = !!blocker || !docs;
  const reasons = blocker
    ? [blocker]
    : docs
      ? ["Changes are confined to human-reference documentation; no prompts, runtime, build or version inputs."]
      : [
          !changes.length
            ? "Empty or unavailable diff is not evidence of docs-only."
            : "Executable, non-reference, unknown, or unsafe change requires complete CI.",
        ];
  const mode = full ? "full" : "docs";
  return {
    version: 2,
    mode,
    full,
    changes,
    reasons,
    commands: full ? [["bash", "scripts/ci.sh", "linux"]] : [["bun", "test", "./tests/ci-selective.test.ts"]],
    scope: full
      ? "Complete executable validation required."
      : "Lightweight docs classifier checks only; no executable validation is implied.",
  };
}
function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) throw new Error((r.stderr || "git command failed").trim());
  return r.stdout;
}
function checkoutBlocker(cwd: string, head: string | undefined): string | undefined {
  if (git(cwd, ["rev-parse", "HEAD"]).trim() !== head)
    return "Checkout does not match planned head; full validation required.";
  if (git(cwd, ["status", "--porcelain", "--untracked-files=all"]).trim())
    return "Checkout is not clean; full validation required.";
  return undefined;
}

function referenceFileBlocker(cwd: string, changes: Change[], base: string, head: string): string | undefined {
  let blocker: string | undefined;
  for (const change of changes) {
    for (const revision of [base, head]) {
      if (!git(cwd, ["ls-tree", "-z", revision, "--", change.paths[0]!]).startsWith("100644 "))
        blocker = "Non-regular or executable reference file requires full validation.";
    }
  }
  return blocker;
}

export function plan(
  cwd: string,
  base?: string,
  head?: string,
): ReturnType<typeof planDiff> & { base?: string; head?: string } {
  if (!base || !/^[0-9a-f]{40,64}$/i.test(base))
    return planDiff([], "Missing trustworthy comparison baseline; full validation required.");
  try {
    const headSha = git(cwd, ["rev-parse", "--verify", (head || "HEAD") + "^{commit}"]).trim();
    const baseSha = git(cwd, ["rev-parse", "--verify", base + "^{commit}"]).trim();
    const checkoutProblem = checkoutBlocker(cwd, headSha);
    if (checkoutProblem) return { ...planDiff([], checkoutProblem), base: baseSha, head: headSha };
    git(cwd, ["rev-parse", "--verify", baseSha + "^{tree}"]);
    git(cwd, ["rev-parse", "--verify", headSha + "^{tree}"]);
    const raw = git(cwd, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--name-status",
      "-z",
      "--no-renames",
      baseSha,
      headSha,
      "--",
    ]);
    const changes = parseDiff(raw);
    const blocker = isReferenceOnlyDiff(changes) ? referenceFileBlocker(cwd, changes, baseSha, headSha) : undefined;
    return { ...planDiff(changes, blocker), base: baseSha, head: headSha };
  } catch (error) {
    return planDiff([], error instanceof Error ? error.message : String(error));
  }
}
export function summary(p: ReturnType<typeof planDiff>): string {
  const json = JSON.stringify(p, null, 2).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return "## CI plan: " + p.mode + "\n\n" + p.scope + "\n\n<pre>" + json + "</pre>\n";
}
function publishSelection(selection: ReturnType<typeof plan>): void {
  const json = JSON.stringify(selection, null, 2);
  const markdown = summary(selection);
  mkdirSync("artifacts/ci", { recursive: true });
  writeFileSync("artifacts/ci/selection.json", json + "\n");
  writeFileSync("artifacts/ci/selection-summary.md", markdown);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, "mode=" + selection.mode + "\nfull=" + selection.full + "\n");
  console.log(json);
}

function runDocsChecks(cwd: string, selection: ReturnType<typeof plan>): number {
  if (selection.full) {
    console.error("Complete CI required; refusing docs-only success.");
    process.exit(3);
  }
  if (checkoutBlocker(cwd, selection.head)) throw new Error("runner requires clean checkout at planned head");
  const command = selection.commands[0]!;
  const result = spawnSync(command[0]!, command.slice(1), { stdio: "inherit" });
  return result.status ?? 1;
}

if (import.meta.main) {
  const args = process.argv.slice(2),
    bi = args.indexOf("--base"),
    base = bi < 0 ? undefined : args[bi + 1];
  for (let i = 0; i < args.length; i++)
    if (args[i] === "--base") i++;
    else if (args[i] !== "--run") throw new Error("usage: bun scripts/ci-selective.ts --base SHA [--run]");
  const cwd = process.cwd();
  const selection = plan(cwd, base);
  publishSelection(selection);
  if (args.includes("--run")) process.exitCode = runDocsChecks(cwd, selection);
}
