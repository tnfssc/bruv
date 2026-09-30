import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
export type Change = { status: string; paths: string[] };
export function parseDiff(input: string): Change[] {
  if (!input) return [];
  if (!input.endsWith("\0")) throw new Error("unterminated NUL diff");
  const fields = input.slice(0, -1).split("\0"), changes: Change[] = [];
  while (fields.length) {
    const status = fields.shift() ?? "";
    if (!/^(?:[AMDTUXB]|[RC][0-9]{1,3})$/.test(status)) throw new Error("unknown diff status");
    const count = /^[RC]/.test(status) ? 2 : 1, paths = fields.splice(0, count);
    if (paths.length !== count || paths.some((p) => !p)) throw new Error("missing diff path");
    changes.push({ status, paths });
  }
  return changes;
}
export function isDoc(path: string): boolean {
  return path === "README.md" || /^wisdom\/(?:ci|quality|remote-workspaces|dependencies|configuration)\/[a-z0-9][a-z0-9-]*\.md$/.test(path);
}
export function planDiff(changes: Change[], blocker?: string) {
  const docs = changes.length > 0 && changes.every((c) => c.status === "M" && c.paths.length === 1 && isDoc(c.paths[0]!));
  const full = !!blocker || !docs;
  const reasons = blocker ? [blocker] : docs ? ["Changes are confined to human-reference documentation; no prompts, runtime, build or version inputs."] : [!changes.length ? "Empty or unavailable diff is not evidence of docs-only." : "Executable, non-reference, unknown, or unsafe change requires complete CI."];
  const mode = full ? "full" : "docs";
  return { version: 2, mode, full, changes, reasons, commands: full ? [["bash", "scripts/ci.sh", "linux"]] : [["bun", "test", "./tests/ci-selective.test.ts"]], scope: full ? "Complete executable validation required." : "Lightweight docs classifier checks only; no executable validation is implied." };
}
function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) throw new Error((r.stderr || "git command failed").trim());
  return r.stdout;
}
export function plan(cwd: string, base?: string, head?: string) {
  if (!base || !/^[0-9a-f]{40,64}$/i.test(base)) return planDiff([], "Missing trustworthy comparison baseline; full validation required.");
  try {
    const headSha = git(cwd, ["rev-parse", "--verify", (head || "HEAD") + "^{commit}"]).trim();
    const baseSha = git(cwd, ["rev-parse", "--verify", base + "^{commit}"]).trim();
    if (git(cwd, ["rev-parse", "HEAD"]).trim() !== headSha) return { ...planDiff([], "Checkout does not match planned head; full validation required."), base: baseSha, head: headSha };
    if (git(cwd, ["status", "--porcelain", "--untracked-files=all"]).trim()) return { ...planDiff([], "Checkout is not clean; full validation required."), base: baseSha, head: headSha };
    git(cwd, ["rev-parse", "--verify", baseSha + "^{tree}"]); git(cwd, ["rev-parse", "--verify", headSha + "^{tree}"]);
    const raw = git(cwd, ["diff", "--name-status", "-z", "--find-renames", baseSha, headSha]);
    return { ...planDiff(parseDiff(raw)), base: baseSha, head: headSha };
  } catch (error) { return planDiff([], error instanceof Error ? error.message : String(error)); }
}
export function summary(p: ReturnType<typeof planDiff>): string {
  const json = JSON.stringify(p, null, 2).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return "## CI plan: " + p.mode + "\n\n" + p.scope + "\n\n<pre>" + json + "</pre>\n";
}
if (import.meta.main) {
  const args = process.argv.slice(2), bi = args.indexOf("--base"), base = bi < 0 ? undefined : args[bi + 1];
  for (let i = 0; i < args.length; i++) if (args[i] === "--base") i++; else if (args[i] !== "--run") throw new Error("usage: bun scripts/ci-selective.ts --base SHA [--run]");
  const p = plan(process.cwd(), base);
  mkdirSync("artifacts/ci", { recursive: true }); writeFileSync("artifacts/ci/selection.json", JSON.stringify(p, null, 2) + "\n");
  writeFileSync("artifacts/ci/selection-summary.md", summary(p));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(p));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "mode=" + p.mode + "\nfull=" + p.full + "\n");
  console.log(JSON.stringify(p, null, 2));
  if (args.includes("--run")) {
    if (p.full) { console.error("Complete CI required; refusing docs-only success."); process.exit(3); }
    if (git(process.cwd(), ["rev-parse", "HEAD"]).trim() !== p.head || git(process.cwd(), ["status", "--porcelain", "--untracked-files=all"]).trim()) throw new Error("runner requires clean checkout at planned head");
    const c = p.commands[0]!, result = spawnSync(c[0]!, c.slice(1), { stdio: "inherit" }); process.exitCode = result.status ?? 1;
  }
}
