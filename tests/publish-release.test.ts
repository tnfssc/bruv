import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assetNames, findRelease, missingReleaseAssets, tagAction } from "../scripts/publish-release";

const expected = new Map(assetNames.map((name) => [name, { name, size: 42, digest: "sha256:abc" }]));
const assets = [...expected.values()];

describe("release retry decisions", () => {
  test("new tag is pushed, same SHA reused, conflicting tag fails", () => {
    expect(tagAction(undefined, "a".repeat(40))).toBe("push");
    expect(tagAction("a".repeat(40), "a".repeat(40))).toBe("reuse");
    expect(() => tagAction("b".repeat(40), "a".repeat(40))).toThrow();
  });
  test("complete published or draft release needs no duplicate upload", () => {
    expect(missingReleaseAssets({ draft: false, assets }, expected)).toEqual([]);
    expect(missingReleaseAssets({ draft: true, assets }, expected)).toEqual([]);
  });
  test("partial draft repairs only missing verified assets", () => {
    expect(missingReleaseAssets({ draft: true, assets: assets.slice(0, 9) }, expected)).toEqual(assetNames.slice(9));
    expect(() => missingReleaseAssets({ draft: false, assets: assets.slice(0, 9) }, expected)).toThrow();
  });
  test("unknown, duplicate, wrong size or digest fails closed", () => {
    for (const bad of [
      [...assets, { name: "extra", size: 42, digest: "sha256:abc" }],
      [...assets, assets[0]!],
      [{ ...assets[0]!, size: 1 }, ...assets.slice(1)],
      [{ ...assets[0]!, digest: null }, ...assets.slice(1)],
    ])
      expect(() => missingReleaseAssets({ draft: true, assets: bad }, expected)).toThrow();
  });
});

// The failed v0.15.3 job created a draft (gh printed an untagged URL), then
// /releases/tags/v0.15.3 returned 404. A retry must find it before creating another.
test("finds an existing draft when tag lookup returns 404", async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    urls.push(String(input));
    if (urls.length === 1) return new Response(null, { status: 404 });
    return Response.json([{ tag_name: "v0.15.3", draft: true, assets }]);
  }) as unknown as typeof fetch;
  try {
    expect((await findRelease("tnfssc/bruv", "v0.15.3", "token"))?.assets).toEqual(assets);
    expect(urls).toEqual([
      "https://api.github.com/repos/tnfssc/bruv/releases/tags/v0.15.3",
      "https://api.github.com/repos/tnfssc/bruv/releases?per_page=100&page=1",
    ]);
  } finally {
    globalThis.fetch = original;
  }
});

test("fails closed when draft list cannot be read", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => new Response(null, { status: ++calls === 1 ? 404 : 403 })) as unknown as typeof fetch;
  try {
    expect(findRelease("tnfssc/bruv", "v0.15.3", "token")).rejects.toThrow("HTTP 403");
  } finally {
    globalThis.fetch = original;
  }
});

// Run the shipped CLI, including its subprocesses and API readbacks, without touching a remote.
const tag = "v9.8.7";
const sha = "a".repeat(40);
const cliAssets: { name: string; size: number; digest: string | null }[] = assetNames.map((name) => {
  const bytes = Buffer.from("verified " + name);
  return { name, size: bytes.length, digest: "sha256:" + createHash("sha256").update(bytes).digest("hex") };
});
type Step = { command: string; args: string[]; output?: string; response?: unknown; status?: number };
const command = (name: string, args: string[], output = ""): Step => ({ command: name, args, output });
const refs = (commit = sha, annotated = false) =>
  annotated
    ? "b".repeat(40) + "\trefs/tags/" + tag + "\n" + commit + "\trefs/tags/" + tag + "^{}"
    : commit + "\trefs/tags/" + tag;
const remote = (output = refs()) =>
  command("git", ["ls-remote", "--tags", "origin", "refs/tags/" + tag, "refs/tags/" + tag + "^{}"], output);
const notes = command("bun", ["scripts/select-release-notes.ts", tag], "notes.md");
const base = "https://api.github.com/repos/tnfssc/bruv/releases";
const lookup = (draft: boolean, assets = cliAssets): Step => ({
  command: "fetch",
  args: [base + "/tags/" + tag],
  response: { draft, assets },
});
const publish = command("gh", ["release", "edit", tag, "--draft=false"]);
const create = command("gh", [
  "release",
  "create",
  tag,
  "--verify-tag",
  "--draft",
  "--generate-notes",
  "--notes-file",
  "notes.md",
  "--title",
  tag,
  ...assetNames.map((name) => join("dist/release", name)),
]);

async function runPublication(steps: Step[], event = "push") {
  const directory = await mkdtemp(join(tmpdir(), "bruv-publish-"));
  try {
    await mkdir(join(directory, "bin"));
    await mkdir(join(directory, "dist/release"), { recursive: true });
    for (const name of assetNames) await Bun.write(join(directory, "dist/release", name), "verified " + name);
    const state = join(directory, "state.json");
    await Bun.write(state, JSON.stringify({ steps, calls: [] }));
    // Every command and fetch consumes one expected effect; unexpected effects fail the subprocess.
    await Bun.write(
      join(directory, "consume.ts"),
      `
      import { readFileSync, writeFileSync } from "node:fs";
      export function consume(command, args) {
        const path = process.env.RELEASE_TEST_STATE;
        const state = JSON.parse(readFileSync(path, "utf8"));
        const step = state.steps.shift();
        state.calls.push({ command, args });
        writeFileSync(path, JSON.stringify(state));
        if (!step || step.command !== command || JSON.stringify(step.args) !== JSON.stringify(args))
          throw new Error("Unexpected release effect: " + JSON.stringify({ command, args, step }));
        return step;
      }
    `,
    );
    for (const name of ["git", "gh", "bun"]) {
      const path = join(directory, "bin", name);
      await Bun.write(
        path,
        `#!${process.execPath}
        import { consume } from "../consume.ts";
        process.stdout.write(consume("${name}", process.argv.slice(2)).output ?? "");
      `,
      );
      await chmod(path, 0o755);
    }
    await Bun.write(
      join(directory, "fetch.ts"),
      `
      import { consume } from "./consume.ts";
      globalThis.fetch = async (url, options) => {
        if (options.headers.Authorization !== "Bearer token") throw new Error("Missing release token");
        const step = consume("fetch", [String(url)]);
        return Response.json(step.response ?? {}, { status: step.status ?? 200 });
      };
    `,
    );
    const child = Bun.spawn(
      [process.execPath, "--preload", join(directory, "fetch.ts"), resolve("scripts/publish-release.ts")],
      {
        cwd: directory,
        env: {
          ...process.env,
          PATH: join(directory, "bin") + ":" + process.env.PATH,
          RELEASE_TEST_STATE: state,
          RELEASE_TAG: tag,
          RELEASE_SHA: sha,
          GH_TOKEN: "token",
          GITHUB_REPOSITORY: "tnfssc/bruv",
          GITHUB_EVENT_NAME: event,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    const remaining = await Bun.file(state).json();
    expect(stderr).not.toContain("Unexpected release effect");
    expect(remaining.steps).toEqual([]);
    return { stdout, stderr, exitCode, calls: remaining.calls };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("release CLI authority and publication", () => {
  test("manual release confirms pushed tag, creates draft, verifies bytes, then publishes and rechecks", async () => {
    const result = await runPublication(
      [
        remote(""),
        command("git", ["fetch", "origin", "develop"]),
        command("git", ["rev-parse", "origin/develop"], sha),
        command("git", ["push", "origin", sha + ":refs/tags/" + tag]),
        remote(),
        notes,
        { command: "fetch", args: [base + "/tags/" + tag], status: 404 },
        { command: "fetch", args: [base + "?per_page=100&page=1"], response: [] },
        create,
        lookup(true),
        publish,
        lookup(false),
      ],
      "workflow_dispatch",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Published " + tag + " from " + sha);
  });

  test("annotated tag and complete published release are reused without mutation", async () => {
    const result = await runPublication([
      remote(refs(sha, true)),
      remote(refs(sha, true)),
      notes,
      lookup(false),
      lookup(false),
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.calls.filter((call: Step) => call.command === "gh")).toEqual([]);
  });

  test("repairs only missing draft assets and verifies repair before publishing", async () => {
    const result = await runPublication([
      remote(),
      remote(),
      notes,
      lookup(true, cliAssets.slice(0, -1)),
      command("gh", ["release", "upload", tag, "dist/release/SOURCE.txt"]),
      lookup(true),
      publish,
      lookup(false),
    ]);
    expect(result.exitCode).toBe(0);
  });

  test("incomplete repair cannot reach publication", async () => {
    const partial = cliAssets.slice(0, -1);
    const result = await runPublication([
      remote(),
      remote(),
      notes,
      lookup(true, partial),
      command("gh", ["release", "upload", tag, "dist/release/SOURCE.txt"]),
      lookup(true, partial),
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Release assets still incomplete");
  });

  test("published release missing assets cannot be repaired", async () => {
    const result = await runPublication([remote(), remote(), notes, lookup(false, cliAssets.slice(0, -1))]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Published release is incomplete; refusing to change it");
  });

  test("wrong bytes in an existing draft cannot reach upload or publication", async () => {
    const result = await runPublication([
      remote(),
      remote(),
      notes,
      lookup(true, [{ ...cliAssets[0]!, digest: null }, ...cliAssets.slice(1)]),
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Release asset differs from verified build");
  });

  test("stale develop cannot push a tag or touch the release API", async () => {
    const result = await runPublication(
      [
        remote(""),
        command("git", ["fetch", "origin", "develop"]),
        command("git", ["rev-parse", "origin/develop"], "c".repeat(40)),
      ],
      "workflow_dispatch",
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("develop advanced during verification");
  });

  test("push event requires the remote tag", async () => {
    const result = await runPublication([remote("")]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Push-triggered release requires the remote tag");
  });

  test("conflicting confirmation cannot touch the release API", async () => {
    const result = await runPublication([remote(), remote(refs("c".repeat(40)))]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Release tag points to a different commit");
  });

  test("publication is not success until its final remote snapshot is public", async () => {
    const result = await runPublication([remote(), remote(), notes, lookup(true), publish, lookup(true)]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Release publication not verified");
    expect(result.stdout).not.toContain("Published " + tag);
  });
});
