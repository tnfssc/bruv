import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { RemoteClient, RemoteTask } from "./client";
export const ARTIFACT_CHUNK = 256 * 1024,
  ARTIFACT_FILE_LIMIT = 10 * 1024 * 1024,
  ARTIFACT_TOTAL_LIMIT = 128 * 1024 * 1024,
  ARTIFACT_COUNT_LIMIT = 256;
export type RemoteArtifact = { name: string; remotePath: string; size: number; sha256: string };
export type ArtifactPage = { name: string; sha256: string; offset: number; size: number; data: string };
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const validName = (s: string) =>
  s === "session.jsonl" || /^session\.jsonl\.artifacts\/execute-[a-zA-Z0-9_-]{1,128}\/(stdout|stderr)\.log$/.test(s);
const validHash = (s: unknown) => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
function safeDir(path: string) {
  if (!lstatSync(path).isDirectory()) throw Error("Unsafe artifact directory");
}
function pathFor(dir: string, name: string) {
  if (!validName(name)) throw Error("Invalid artifact name");
  safeDir(dir);
  let path = dir;
  const parts = name.split("/");
  for (const part of parts.slice(0, -1)) {
    path = join(path, part);
    safeDir(path);
  }
  return join(path, parts[parts.length - 1]!);
}
function readArtifact(dir: string, name: string): Buffer {
  const path = pathFor(dir, name);
  if (!lstatSync(path).isFile()) throw Error("Unsafe artifact file");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const size = fstatSync(fd).size;
    if (!fstatSync(fd).isFile() || size > ARTIFACT_FILE_LIMIT) throw Error("Artifact exceeds 10 MiB or is not regular");
    const data = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const count = readSync(fd, data, offset, size - offset, offset);
      if (!count) throw Error("Artifact changed during read");
      offset += count;
    }
    if (fstatSync(fd).size !== size) throw Error("Artifact changed during read");
    return data;
  } finally {
    closeSync(fd);
  }
}
/** Strictly task-owned session and execute capture files. No caller-provided paths. */
export function listRemoteArtifacts(taskDir: string): RemoteArtifact[] {
  safeDir(taskDir);
  const names: string[] = [];
  if (readdirSync(taskDir).includes("session.jsonl")) names.push("session.jsonl");
  const root = join(taskDir, "session.jsonl.artifacts");
  if (readdirSync(taskDir).includes("session.jsonl.artifacts")) {
    safeDir(root);
    for (const entry of readdirSync(root).sort()) {
      if (!/^execute-[a-zA-Z0-9_-]{1,128}$/.test(entry)) continue;
      safeDir(join(root, entry));
      for (const stream of ["stdout", "stderr"]) {
        const name = "session.jsonl.artifacts/" + entry + "/" + stream + ".log";
        if (readdirSync(join(root, entry)).includes(stream + ".log")) names.push(name);
      }
    }
  }
  if (names.length > ARTIFACT_COUNT_LIMIT) throw Error("Artifact catalog exceeds 256 files");
  let total = 0;
  return names.map((name) => {
    const data = readArtifact(taskDir, name);
    total += data.length;
    if (total > ARTIFACT_TOTAL_LIMIT) throw Error("Artifact catalog exceeds 128 MiB");
    return { name, remotePath: name, size: data.length, sha256: hash(data) };
  });
}
/** A changed active file refuses the old digest; callers must refetch catalog. */
export function getRemoteArtifact(
  taskDir: string,
  request: { name: string; sha256: string; offset: number },
): ArtifactPage {
  if (!validHash(request.sha256) || !Number.isSafeInteger(request.offset) || request.offset < 0)
    throw Error("Invalid artifact request");
  const data = readArtifact(taskDir, request.name);
  if (hash(data) !== request.sha256 || request.offset > data.length) throw Error("Artifact changed; refetch catalog");
  const chunk = data.subarray(request.offset, request.offset + ARTIFACT_CHUNK);
  return {
    name: request.name,
    sha256: request.sha256,
    size: data.length,
    offset: request.offset + chunk.length,
    data: chunk.toString("base64"),
  };
}
function directory(path: string) {
  if (dirname(path) !== path) directory(dirname(path));
  if (existsSync(path)) safeDir(path);
  else mkdirSync(path, { mode: 0o700 });
}
function save(path: string, data: Buffer) {
  const tmp = path + "." + randomUUID(),
    fd = openSync(tmp, "wx", 0o600);
  try {
    let offset = 0;
    while (offset < data.length) {
      const n = writeSync(fd, data, offset, data.length - offset);
      if (!n) throw Error("Short artifact write");
      offset += n;
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, path);
    const dir = openSync(dirname(path), "r");
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
  } catch (e) {
    if (existsSync(tmp)) unlinkSync(tmp);
    throw e;
  }
}
export type ArtifactManifest = {
  taskId: string;
  ownerId: string;
  epoch: string;
  complete: boolean;
  files: Record<string, { path: string; remotePath: string; size: number; sha256: string }>;
};
function validateArtifactCatalog(artifacts: RemoteArtifact[]) {
  if (!Array.isArray(artifacts) || artifacts.length > ARTIFACT_COUNT_LIMIT) throw Error("Invalid artifact catalog");
  let total = 0;
  const seen = new Set<string>();
  for (const item of artifacts) {
    if (
      !item ||
      typeof item.name !== "string" ||
      !validName(item.name) ||
      item.remotePath !== item.name ||
      seen.has(item.name) ||
      !Number.isSafeInteger(item.size) ||
      item.size < 0 ||
      item.size > ARTIFACT_FILE_LIMIT ||
      !validHash(item.sha256)
    )
      throw Error("Invalid artifact catalog entry");
    seen.add(item.name);
    total += item.size;
    if (total > ARTIFACT_TOTAL_LIMIT) throw Error("Artifact catalog exceeds 128 MiB");
  }
}

/** Reuses verified cached bytes or downloads, verifies, and atomically saves a replacement. */
async function syncArtifactFile(
  client: Pick<RemoteClient, "control">,
  taskId: string,
  identity: Pick<RemoteTask, "ownerId" | "epoch">,
  dir: string,
  item: RemoteArtifact,
): Promise<string> {
  const path = join(dir, item.name);
  directory(dirname(path));
  if (existsSync(path)) {
    const cached = readArtifact(dir, item.name);
    if (cached.length === item.size && hash(cached) === item.sha256) return path;
  }
  const parts: Buffer[] = [];
  let offset = 0;
  do {
    const page = (await client.control(
      { op: "artifact", taskId, action: "get", name: item.name, sha256: item.sha256, offset },
      identity,
    )) as ArtifactPage;
    if (
      !page ||
      page.name !== item.name ||
      page.sha256 !== item.sha256 ||
      page.size !== item.size ||
      typeof page.data !== "string" ||
      !Number.isSafeInteger(page.offset)
    )
      throw Error("Artifact identity or size changed; refetch catalog");
    const chunk = Buffer.from(page.data, "base64");
    if (
      chunk.toString("base64") !== page.data ||
      chunk.length > ARTIFACT_CHUNK ||
      page.offset !== offset + chunk.length ||
      page.offset > item.size ||
      (offset < item.size && !chunk.length)
    )
      throw Error("Invalid artifact chunk offset or encoding");
    parts.push(chunk);
    offset = page.offset;
  } while (offset < item.size);
  const data = Buffer.concat(parts);
  if (data.length !== item.size || hash(data) !== item.sha256) throw Error("Artifact digest mismatch; refetch catalog");
  save(path, data);
  return path;
}

/** Manifest remains incomplete across failure; verified files can be reused on retry. */
export async function syncRemoteArtifacts(
  client: Pick<RemoteClient, "control" | "path">,
  task: Pick<RemoteTask, "taskId" | "ownerId" | "epoch">,
): Promise<ArtifactManifest> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(task.taskId) || !task.ownerId || !task.epoch)
    throw Error("Invalid artifact identity");
  const root = join(dirname(client.path), "artifacts");
  directory(root);
  const dir = join(root, task.taskId);
  directory(dir);
  const manifestPath = join(dir, "manifest.json");
  const result: ArtifactManifest = {
    taskId: task.taskId,
    ownerId: task.ownerId,
    epoch: task.epoch,
    complete: false,
    files: {},
  };
  save(manifestPath, Buffer.from(JSON.stringify(result)));
  const identity = { ownerId: task.ownerId, epoch: task.epoch };
  const catalog = (await client.control({ op: "artifact", taskId: task.taskId, action: "list" }, identity)) as {
    artifacts: RemoteArtifact[];
  };
  validateArtifactCatalog(catalog.artifacts);
  for (const item of catalog.artifacts) {
    const path = await syncArtifactFile(client, task.taskId, identity, dir, item);
    result.files[item.name] = { path, remotePath: item.remotePath, size: item.size, sha256: item.sha256 };
    save(manifestPath, Buffer.from(JSON.stringify(result)));
  }
  result.complete = true;
  save(manifestPath, Buffer.from(JSON.stringify(result)));
  return result;
}
