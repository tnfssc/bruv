import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARTIFACT_CHUNK, getRemoteArtifact, listRemoteArtifacts, syncRemoteArtifacts } from "../src/remote/artifacts";
const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "bruv-artifact-"));
  roots.push(root);
  const remote = join(root, "owner", "task");
  mkdirSync(remote, { recursive: true });
  return { root, remote };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
test("catalog includes entire journal and execute spill, not tool preview; returns exact offline bytes", async () => {
  const { root, remote } = fixture();
  const spill = join(remote, "session.jsonl.artifacts", "execute-123-abc");
  mkdirSync(spill, { recursive: true });
  const full = Buffer.alloc(ARTIFACT_CHUNK + 27, 65);
  writeFileSync(join(remote, "session.jsonl"), "journal full tool text");
  writeFileSync(join(spill, "stdout.log"), full);
  writeFileSync(join(spill, "stderr.log"), "stderr");
  const client = {
    path: join(root, "client", "remote.json"),
    control: async (req: Record<string, unknown>, identity?: { ownerId: string; epoch: string }) => {
      expect(identity).toEqual({ ownerId: "owner", epoch: "epoch" });
      expect(req.taskId).toBe("task1");
      if (req.action === "list") return { artifacts: listRemoteArtifacts(remote) };
      return getRemoteArtifact(remote, req as { name: string; sha256: string; offset: number });
    },
  };
  const task = { taskId: "task1", ownerId: "owner", epoch: "epoch" };
  const manifest = await syncRemoteArtifacts(client, task);
  expect(manifest.complete).toBe(true);
  expect(Object.keys(manifest.files)).toHaveLength(3);
  expect(readFileSync(manifest.files["session.jsonl"]!.path, "utf8")).toBe("journal full tool text");
  expect(readFileSync(manifest.files["session.jsonl.artifacts/execute-123-abc/stdout.log"]!.path)).toEqual(full);
  expect(JSON.parse(readFileSync(join(root, "client", "artifacts", "task1", "manifest.json"), "utf8")).complete).toBe(
    true,
  );
  writeFileSync(join(manifest.files["session.jsonl"]!.path), "corrupt");
  const retried = await syncRemoteArtifacts(client, task);
  expect(readFileSync(retried.files["session.jsonl"]!.path, "utf8")).toBe("journal full tool text");
  writeFileSync(join(remote, "session.jsonl"), "journal grew");
  const changed = await syncRemoteArtifacts(client, task);
  expect(readFileSync(changed.files["session.jsonl"]!.path, "utf8")).toBe("journal grew");
});
test("mid-download change leaves incomplete manifest and retry refetches", async () => {
  const { root, remote } = fixture();
  writeFileSync(join(remote, "session.jsonl"), Buffer.alloc(ARTIFACT_CHUNK + 1, 65));
  const client = {
    path: join(root, "client", "remote.json"),
    control: async (req: Record<string, unknown>) => {
      if (req.action === "list") return { artifacts: listRemoteArtifacts(remote) };
      if (req.offset === ARTIFACT_CHUNK) writeFileSync(join(remote, "session.jsonl"), "changed");
      return getRemoteArtifact(remote, req as { name: string; sha256: string; offset: number });
    },
  };
  const task = { taskId: "task1", ownerId: "owner", epoch: "epoch" };
  await expect(syncRemoteArtifacts(client, task)).rejects.toThrow("refetch catalog");
  expect(JSON.parse(readFileSync(join(root, "client", "artifacts", "task1", "manifest.json"), "utf8")).complete).toBe(
    false,
  );
  const ok = await syncRemoteArtifacts(client, task);
  expect(readFileSync(ok.files["session.jsonl"]!.path, "utf8")).toBe("changed");
});
test("owner rejects path escapes and offsets beyond the artifact", () => {
  const { remote } = fixture();
  writeFileSync(join(remote, "session.jsonl"), "safe");
  expect(() => getRemoteArtifact(remote, { name: "../secret", sha256: "0".repeat(64), offset: 0 })).toThrow();
  const catalog = listRemoteArtifacts(remote);
  expect(() => getRemoteArtifact(remote, { name: "session.jsonl", sha256: catalog[0]!.sha256, offset: 5 })).toThrow();
});

test("owner refuses to catalog an oversized artifact", () => {
  const { remote } = fixture();
  writeFileSync(join(remote, "session.jsonl"), Buffer.alloc(10 * 1024 * 1024 + 1));
  expect(() => listRemoteArtifacts(remote)).toThrow("10 MiB");
});

test("owner refuses to catalog a symlinked journal", () => {
  const { root, remote } = fixture();
  symlinkSync(join(root, "secret"), join(remote, "session.jsonl"));
  expect(() => listRemoteArtifacts(remote)).toThrow();
});

test("owner refuses to catalog a symlinked execute directory", () => {
  const { root, remote } = fixture();
  writeFileSync(join(remote, "session.jsonl"), "abc");
  mkdirSync(join(remote, "session.jsonl.artifacts"));
  symlinkSync(root, join(remote, "session.jsonl.artifacts", "execute-linked"));
  expect(() => listRemoteArtifacts(remote)).toThrow("Unsafe artifact directory");
});

test("client rejects bytes that do not match the catalog digest", async () => {
  const { root, remote } = fixture();
  writeFileSync(join(remote, "session.jsonl"), "safe");
  const client = {
    path: join(root, "client", "remote.json"),
    control: async (req: Record<string, unknown>) =>
      req.action === "list"
        ? { artifacts: listRemoteArtifacts(remote) }
        : { ...getRemoteArtifact(remote, req as { name: string; sha256: string; offset: number }), data: "bm9wZQ==" },
  };
  await expect(syncRemoteArtifacts(client, { taskId: "task1", ownerId: "o", epoch: "e" })).rejects.toThrow(
    "digest mismatch",
  );
});

test("client rejects a noncontiguous page offset", async () => {
  const { root, remote } = fixture();
  writeFileSync(join(remote, "session.jsonl"), "abc");
  const client = {
    path: join(root, "client", "remote.json"),
    control: async (req: Record<string, unknown>) =>
      req.action === "list"
        ? { artifacts: listRemoteArtifacts(remote) }
        : { ...getRemoteArtifact(remote, req as { name: string; sha256: string; offset: number }), offset: 42 },
  };
  await expect(syncRemoteArtifacts(client, { taskId: "task1", ownerId: "owner", epoch: "epoch" })).rejects.toThrow(
    "offset",
  );
});

test("client rejects a task path escape before contacting the owner", async () => {
  const { root } = fixture();
  const client = {
    path: join(root, "client", "remote.json"),
    control: async () => {
      throw Error("Unexpected owner request");
    },
  };
  await expect(syncRemoteArtifacts(client, { taskId: "../other", ownerId: "owner", epoch: "epoch" })).rejects.toThrow(
    "identity",
  );
});

test("rejects the whole catalog before fetching or recording any file", async () => {
  const { root, remote } = fixture();
  writeFileSync(join(remote, "session.jsonl"), "journal");
  const artifact = listRemoteArtifacts(remote)[0]!;
  const requests: string[] = [];
  const client = {
    path: join(root, "client", "remote.json"),
    control: async (req: Record<string, unknown>) => {
      requests.push(String(req.action));
      return { artifacts: [artifact, artifact] };
    },
  };
  await expect(syncRemoteArtifacts(client, { taskId: "task1", ownerId: "owner", epoch: "epoch" })).rejects.toThrow(
    "Invalid artifact catalog entry",
  );
  expect(requests).toEqual(["list"]);
  const manifest = JSON.parse(readFileSync(join(root, "client", "artifacts", "task1", "manifest.json"), "utf8"));
  expect(manifest.complete).toBe(false);
  expect(manifest.files).toEqual({});
});

test("failed file keeps old bytes and verified manifest progress; retry reuses only matching files", async () => {
  const { root, remote } = fixture();
  const name = "session.jsonl.artifacts/execute-spill/stdout.log";
  mkdirSync(join(remote, "session.jsonl.artifacts", "execute-spill"), { recursive: true });
  writeFileSync(join(remote, "session.jsonl"), "current journal");
  writeFileSync(join(remote, name), "current spill");
  const dir = join(root, "client", "artifacts", "task1");
  const path = join(dir, name);
  mkdirSync(join(dir, "session.jsonl.artifacts", "execute-spill"), { recursive: true });
  writeFileSync(path, "previous spill");
  const manifestPath = join(dir, "manifest.json");
  const requests: string[] = [];
  let fail = true;
  const client = {
    path: join(root, "client", "remote.json"),
    control: async (req: Record<string, unknown>, identity?: { ownerId: string; epoch: string }) => {
      expect(identity).toEqual({ ownerId: "owner", epoch: "epoch" });
      requests.push(req.action === "list" ? "list" : String(req.name));
      if (req.action === "list") return { artifacts: listRemoteArtifacts(remote) };
      if (req.name === name) {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        expect(manifest.complete).toBe(false);
        expect(Object.keys(manifest.files)).toEqual(["session.jsonl"]);
        expect(readFileSync(manifest.files["session.jsonl"].path, "utf8")).toBe("current journal");
      }
      const page = getRemoteArtifact(remote, req as { name: string; sha256: string; offset: number });
      if (fail && req.name === name) page.data = Buffer.alloc(page.size, 120).toString("base64");
      return page;
    },
  };
  const task = { taskId: "task1", ownerId: "owner", epoch: "epoch" };
  await expect(syncRemoteArtifacts(client, task)).rejects.toThrow("digest mismatch");
  expect(requests).toEqual(["list", "session.jsonl", name]);
  expect(readFileSync(path, "utf8")).toBe("previous spill");
  const partial = JSON.parse(readFileSync(manifestPath, "utf8"));
  expect(partial.complete).toBe(false);
  expect(Object.keys(partial.files)).toEqual(["session.jsonl"]);

  fail = false;
  requests.length = 0;
  const manifest = await syncRemoteArtifacts(client, task);
  expect(requests).toEqual(["list", name]);
  expect(manifest.complete).toBe(true);
  expect(readFileSync(path, "utf8")).toBe("current spill");
  expect(JSON.parse(readFileSync(manifestPath, "utf8"))).toEqual(manifest);
});
