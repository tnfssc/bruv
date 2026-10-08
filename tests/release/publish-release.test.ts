import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assetNames, findRelease, missingReleaseAssets, tagAction } from "../../scripts/release/publish-release";

// Unit decisions and CLI readbacks describe the same bytes written to the temporary release directory.
const releaseFiles = new Map(assetNames.map((name) => [name, Buffer.from("verified " + name)]));
const assets: { name: string; size: number; digest: string | null }[] = [...releaseFiles].map(([name, bytes]) => ({
  name,
  size: bytes.length,
  digest: "sha256:" + createHash("sha256").update(bytes).digest("hex"),
}));
const expected = new Map(assets.map((asset) => [asset.name, asset]));
const missingNames = ["bruv-linux-x64", "SOURCE.txt"];
const partialAssets = assets.filter((asset) => !missingNames.includes(asset.name));
const draftMissingSource = assets.filter((asset) => asset.name !== "SOURCE.txt");

describe("release retry decisions", () => {
  test("new tag is pushed", () => {
    expect(tagAction(undefined, "a".repeat(40))).toBe("push");
  });
  test("same SHA is reused", () => {
    expect(tagAction("a".repeat(40), "a".repeat(40))).toBe("reuse");
  });
  test("conflicting tag fails", () => {
    expect(() => tagAction("b".repeat(40), "a".repeat(40))).toThrow("Release tag points to a different commit");
  });
  test("complete draft needs no duplicate upload", () => {
    expect(missingReleaseAssets({ draft: true, assets }, expected)).toEqual([]);
  });
  test("complete public release needs no duplicate upload", () => {
    expect(missingReleaseAssets({ draft: false, assets }, expected)).toEqual([]);
  });
  test("partial draft repairs exactly the missing verified assets", () => {
    expect(missingReleaseAssets({ draft: true, assets: partialAssets }, expected)).toEqual(missingNames);
  });
  test("partial public release cannot be repaired", () => {
    expect(() => missingReleaseAssets({ draft: false, assets: partialAssets }, expected)).toThrow(
      "Published release is incomplete; refusing to change it",
    );
  });
  test.each<{ problem: string; invalid: typeof assets }>([
    { problem: "unknown asset", invalid: [...assets, { name: "extra", size: 42, digest: "sha256:abc" }] },
    { problem: "duplicate asset", invalid: [...assets, assets[0]!] },
    { problem: "wrong size", invalid: [{ ...assets[0]!, size: 1 }, ...assets.slice(1)] },
    { problem: "missing digest", invalid: [{ ...assets[0]!, digest: null }, ...assets.slice(1)] },
    { problem: "wrong digest", invalid: [{ ...assets[0]!, digest: "sha256:wrong" }, ...assets.slice(1)] },
  ])("$problem fails closed", ({ invalid }) => {
    expect(() => missingReleaseAssets({ draft: true, assets: invalid }, expected)).toThrow(
      "Release asset differs from verified build",
    );
  });
});

type ReleaseRead = { url: string; status?: number; body?: unknown };

// Own the fetch replacement until the assertion's promise settles, including rejection checks.
async function withReleaseReads(reads: ReleaseRead[], assertion: () => Promise<void>) {
  const original = globalThis.fetch;
  const remaining = [...reads];
  globalThis.fetch = (async (input, options) => {
    const read = remaining.shift();
    if (!read) throw new Error("Unexpected release read: " + String(input));
    expect(String(input)).toBe(read.url);
    expect(options?.headers).toEqual({
      Authorization: "Bearer token",
      Accept: "application/vnd.github+json",
    });
    return Response.json(read.body ?? {}, { status: read.status ?? 200 });
  }) as typeof fetch;
  try {
    await assertion();
    expect(remaining).toEqual([]);
  } finally {
    globalThis.fetch = original;
  }
}

const lookupUrl = "https://api.github.com/repos/tnfssc/bruv/releases/tags/v0.15.3";
const listUrl = "https://api.github.com/repos/tnfssc/bruv/releases?per_page=100&page=1";

describe("release lookup", () => {
  // The failed v0.15.3 job created a draft (gh printed an untagged URL), then
  // /releases/tags/v0.15.3 returned 404. A retry must find it before creating another.
  test("finds an existing draft when tag lookup returns 404", async () => {
    await withReleaseReads(
      [
        { url: lookupUrl, status: 404 },
        { url: listUrl, body: [{ tag_name: "v0.15.3", draft: true, assets }] },
      ],
      async () => {
        expect(await findRelease("tnfssc/bruv", "v0.15.3", "token")).toMatchObject({ draft: true, assets });
      },
    );
  });
  test("fails closed when draft list cannot be read", async () => {
    await withReleaseReads(
      [
        { url: lookupUrl, status: 404 },
        { url: listUrl, status: 403 },
      ],
      async () => {
        await expect(findRelease("tnfssc/bruv", "v0.15.3", "token")).rejects.toThrow("HTTP 403");
      },
    );
  });
});

// Run the shipped CLI, including its subprocesses and API readbacks, without touching a remote.
const tag = "v9.8.7";
const sha = "a".repeat(40);
type Step = { command: string; args: string[]; output?: string; response?: unknown; status?: number };
const command = (name: string, args: string[], output = ""): Step => ({ command: name, args, output });
const refs = (commit = sha, annotated = false) =>
  annotated
    ? "b".repeat(40) + "\trefs/tags/" + tag + "\n" + commit + "\trefs/tags/" + tag + "^{}"
    : commit + "\trefs/tags/" + tag;
const remote = (output = refs()) =>
  command("git", ["ls-remote", "--tags", "origin", "refs/tags/" + tag, "refs/tags/" + tag + "^{}"], output);
const notes = command("bun", ["scripts/release/select-release-notes.ts", tag], "notes.md");
const base = "https://api.github.com/repos/tnfssc/bruv/releases";
const releaseRead = (draft: boolean, releaseAssets = assets): Step => ({
  command: "fetch",
  args: [base + "/tags/" + tag],
  response: { draft, assets: releaseAssets },
});
const draftRead = (releaseAssets = assets) => releaseRead(true, releaseAssets);
const publicRead = (releaseAssets = assets) => releaseRead(false, releaseAssets);
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
    for (const [name, bytes] of releaseFiles) await Bun.write(join(directory, "dist/release", name), bytes);
    const state = join(directory, "state.json");
    await Bun.write(state, JSON.stringify({ steps }));
    // Every command and fetch consumes one expected effect; unexpected effects fail the subprocess.
    await Bun.write(
      join(directory, "consume.ts"),
      `
      import { readFileSync, writeFileSync } from "node:fs";
      export function consume(command, args) {
        const path = process.env.RELEASE_TEST_STATE;
        const state = JSON.parse(readFileSync(path, "utf8"));
        const step = state.steps.shift();
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
      [process.execPath, "--preload", join(directory, "fetch.ts"), resolve("scripts/release/publish-release.ts")],
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
    return { stdout, stderr, exitCode };
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
        draftRead(),
        publish,
        publicRead(),
      ],
      "workflow_dispatch",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Published " + tag + " from " + sha);
  });

  test("annotated tag and complete published release are reused without mutation", async () => {
    // This entire replay contains reads only; any gh mutation is an unexpected effect.
    const result = await runPublication([
      remote(refs(sha, true)),
      remote(refs(sha, true)),
      notes,
      publicRead(),
      publicRead(),
    ]);
    expect(result.exitCode).toBe(0);
  });

  test("repairs only missing draft assets and verifies repair before publishing", async () => {
    const result = await runPublication([
      remote(),
      remote(),
      notes,
      draftRead(draftMissingSource),
      command("gh", ["release", "upload", tag, "dist/release/SOURCE.txt"]),
      draftRead(),
      publish,
      publicRead(),
    ]);
    expect(result.exitCode).toBe(0);
  });

  test("incomplete repair cannot reach publication", async () => {
    const result = await runPublication([
      remote(),
      remote(),
      notes,
      draftRead(draftMissingSource),
      command("gh", ["release", "upload", tag, "dist/release/SOURCE.txt"]),
      draftRead(draftMissingSource),
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Release assets still incomplete");
  });

  test("published release missing assets cannot be repaired", async () => {
    const result = await runPublication([remote(), remote(), notes, publicRead(draftMissingSource)]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Published release is incomplete; refusing to change it");
  });

  test("wrong bytes in an existing draft cannot reach upload or publication", async () => {
    const result = await runPublication([
      remote(),
      remote(),
      notes,
      draftRead([{ ...assets[0]!, digest: null }, ...assets.slice(1)]),
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
    const result = await runPublication([remote(), remote(), notes, draftRead(), publish, draftRead()]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Release publication not verified");
    expect(result.stdout).not.toContain("Published " + tag);
  });
});
