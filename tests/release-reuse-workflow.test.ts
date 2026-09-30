import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

interface Job {
  if?: string;
  needs?: string | string[];
  env?: Record<string, string>;
  steps: { name?: string; env?: Record<string, string>; with?: Record<string, string>; uses?: string; run?: string }[];
}
async function jobs(): Promise<Record<string, Job>> {
  return (
    Bun.YAML.parse(await Bun.file(new URL("../.github/workflows/release.yml", import.meta.url)).text()) as {
      jobs: Record<string, Job>;
    }
  ).jobs;
}
// Evaluate only our checked-in GitHub boolean conditions with controlled context.
function enabled(job: Job, event: string, ref: string, prepared: string, lookup: string, runId: string) {
  const expression = job.if!.slice(3, -3).replace(/needs\.([\w-]+)/g, 'needs["$1"]');
  return new Function("github", "needs", "always", "startsWith", "contains", "return " + expression)(
    { event_name: event, ref, ref_name: ref.replace(/^refs\/(heads|tags)\//, "") },
    {
      "prepare-manual": { result: prepared },
      "reuse-check": { result: lookup, outputs: { run_id: runId } },
      "mac-helper": { result: runId ? "skipped" : "success" },
    },
    () => true,
    (s: string, prefix: string) => s.startsWith(prefix),
    (s: string, part: string) => s.includes(part),
  );
}

test("manual and tag reuse wait for prepared SHA; develop, failed preparation and prerelease do not reuse", async () => {
  const workflow = await jobs();
  const lookup = workflow["reuse-check"]!;
  expect(lookup.needs).toBe("prepare-manual");
  expect(enabled(lookup, "workflow_dispatch", "refs/heads/develop", "success", "success", "123")).toBe(true);
  expect(enabled(lookup, "workflow_dispatch", "refs/heads/develop", "failure", "success", "123")).toBe(false);
  expect(enabled(lookup, "push", "refs/tags/v1.0.0", "skipped", "success", "123")).toBe(true);
  expect(enabled(lookup, "push", "refs/tags/v1.0.0-beta.1", "skipped", "success", "123")).toBe(false);
  expect(enabled(lookup, "push", "refs/heads/develop", "skipped", "success", "123")).toBe(false);
  const ref = "${{ needs.prepare-manual.outputs.sha || github.sha }}";
  expect(await Bun.file(new URL("../scripts/find-release-dry-run.ts", import.meta.url)).text()).toContain(
    'process.env.RELEASE_SHA ?? process.env.GITHUB_SHA ?? ""',
  );
  expect(lookup.steps.find((s) => s.uses?.startsWith("actions/checkout@"))?.with?.ref).toBe(ref);
  expect(lookup.steps.find((s) => s.name === "Look up verified assets")?.env?.RELEASE_SHA).toBe(ref);
  const reuse = workflow["reuse-assets"]!;
  expect(reuse.needs).toEqual(["reuse-check", "prepare-manual"]);
  expect(reuse.env?.RELEASE_SHA).toBe(ref);
  expect(reuse.env?.RELEASE_TAG).toBe("${{ needs.prepare-manual.outputs.tag || github.ref_name }}");
  expect(reuse.steps.find((s) => s.uses?.startsWith("actions/checkout@"))?.with?.ref).toBe(ref);
  expect(enabled(reuse, "push", "refs/tags/v1.0.0", "skipped", "success", "123")).toBe(true);
  expect(enabled(reuse, "workflow_dispatch", "refs/heads/develop", "success", "success", "123")).toBe(true);
  expect(enabled(reuse, "workflow_dispatch", "refs/heads/develop", "success", "success", "")).toBe(false);
  expect(enabled(reuse, "workflow_dispatch", "refs/heads/develop", "success", "failure", "123")).toBe(false);
  for (const event of ["push", "workflow_dispatch"]) {
    const prepared = event === "push" ? "skipped" : "success";
    const ref = event === "push" ? "refs/tags/v1.0.0" : "refs/heads/develop";
    expect(enabled(workflow.release!, event, ref, prepared, "success", "")).toBe(true);
    expect(enabled(workflow.release!, event, ref, prepared, "success", "123")).toBe(false);
    expect(enabled(workflow["mac-helper"]!, event, ref, prepared, "success", "")).toBe(true);
    expect(enabled(workflow["mac-helper"]!, event, ref, prepared, "success", "123")).toBe(false);
  }
});

test("staged asset verification rejects wrong commit, tag, corrupt binaries and missing licenses", async () => {
  const workflow = await jobs();
  const command = workflow["reuse-assets"]!.steps.find((s) => s.name === "Verify downloaded staged files")!.run!;
  const root = await mkdtemp(join(tmpdir(), "die-reuse-assets-"));
  const assets = join(root, "dist/release");
  const sha = "a".repeat(40);
  try {
    await mkdir(assets, { recursive: true });
    for (const name of ["die-linux-x64", "die-linux-arm64", "die-darwin-arm64", "die-android-arm64"]) {
      await writeFile(join(assets, name), "binary-" + name);
      await writeFile(
        join(assets, name + ".sha256"),
        createHash("sha256")
          .update("binary-" + name)
          .digest("hex") +
          "  " +
          name +
          "\n",
      );
    }
    for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md", "THIRD_PARTY_LICENSES.txt"])
      await writeFile(join(assets, name), "license");
    await writeFile(join(assets, "SOURCE.txt"), "Commit: " + sha + "\nTag: v1.0.0\n");
    const run = (commit = sha, tag = "v1.0.0") =>
      Bun.spawnSync({
        cmd: ["bash", "-euo", "pipefail", "-c", command],
        cwd: root,
        env: { ...process.env, RELEASE_SHA: commit, RELEASE_TAG: tag },
        stdout: "pipe",
        stderr: "pipe",
      });
    expect(run().exitCode).toBe(0);
    expect(run("b".repeat(40)).exitCode).not.toBe(0);
    expect(run(sha, "v1.0.1").exitCode).not.toBe(0);
    await writeFile(join(assets, "die-linux-x64"), "corruption");
    expect(run().exitCode).not.toBe(0);
    await writeFile(join(assets, "die-linux-x64"), "binary-die-linux-x64");
    await rm(join(assets, "LICENSE"));
    expect(run().exitCode).not.toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("browser cache cannot restore another version or product build outputs", async () => {
  const browser = (await jobs())["linux-browser-boot"]!;
  const cache = browser.steps.find((s) => s.uses?.startsWith("actions/cache@"))!;
  expect(cache.with?.path).toBe("${{ runner.temp }}/release-browser/chromium");
  expect(cache.with?.key).toBe("playwright-1.60.0-ubuntu24.04-headless-${{ runner.os }}-${{ runner.arch }}");
  expect(cache.with?.["restore-keys"]).toBeUndefined();
  expect(browser.steps.find((s) => s.name === "Require real UI from final Linux binary, then reload")?.run).toContain(
    "bun integrations/t3/gates/release-browser-boot.ts dist/release/die-linux-x64",
  );
});
