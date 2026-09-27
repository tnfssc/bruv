import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  captureRepository,
  collectRepositoryResult,
  integrateRepositoryResult,
  type RepositorySnapshot,
  type RepositoryResult,
  type RepositoryReturn,
} from "./repository";
import type { RemoteClient, RemoteTask } from "./client";

const MAX = 128 * 1024 * 1024;
const CHUNK = 256 * 1024;
const digest = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const read = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8"));
function atomic(path: string, value: unknown) {
  const tmp = path + "." + randomUUID();
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}
export type RepositoryRequest =
  | {
      op: "repository-upload";
      taskId: string;
      snapshot: string;
      sha256: string;
      total: number;
      offset: number;
      data: string;
    }
  | { op: "repository-result"; taskId: string; offset: number };
type Upload = { snapshot: string; sha256: string; total: number };
/** Called under the owner's control lock and identity fence. Never accepts a path from the peer. */
export function repositoryRequest(dir: string, req: RepositoryRequest, state?: string): unknown {
  if (req.op === "repository-upload") {
    if (
      !/^[a-f0-9]{40,64}$/.test(req.snapshot) ||
      !/^[a-f0-9]{64}$/.test(req.sha256) ||
      !Number.isSafeInteger(req.total) ||
      req.total < 1 ||
      req.total > MAX ||
      !Number.isSafeInteger(req.offset) ||
      req.offset < 0 ||
      typeof req.data !== "string" ||
      req.data.length > Math.ceil(CHUNK / 3) * 4
    )
      throw Error("Invalid or oversized repository upload");
    const data = Buffer.from(req.data, "base64");
    if (
      data.toString("base64") !== req.data ||
      !data.length ||
      data.length > CHUNK ||
      req.offset + data.length > req.total
    )
      throw Error("Invalid repository chunk");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const intent = { snapshot: req.snapshot, sha256: req.sha256, total: req.total };
    const meta = join(dir, "repository-upload.json"),
      bundle = join(dir, "input.bundle"),
      ready = join(dir, "repository-ready.json");
    if (existsSync(meta)) {
      if (JSON.stringify(read(meta)) !== JSON.stringify(intent)) throw Error("Repository upload intent conflict");
    } else {
      if (state) throw Error("Cannot attach repository to an already accepted task");
      atomic(meta, intent);
    }
    if (existsSync(ready)) return read(ready);
    if (state) throw Error("Accepted task has incomplete repository upload; review required");
    const size = existsSync(bundle) ? statSync(bundle).size : 0;
    if (req.offset > size) throw Error("Repository chunk gap");
    if (req.offset < size) {
      if (
        req.offset + data.length > size ||
        !readFileSync(bundle)
          .subarray(req.offset, req.offset + data.length)
          .equals(data)
      )
        throw Error("Repository retry chunk conflict");
    } else {
      const fd = openSync(bundle, "a", 0o600);
      try {
        let done = 0;
        while (done < data.length) done += writeSync(fd, data, done, data.length - done);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    }
    const offset = statSync(bundle).size;
    if (offset !== req.total) return { offset };
    if (digest(readFileSync(bundle)) !== req.sha256) throw Error("Repository bundle digest mismatch");
    const checkout = join(dir, "checkout");
    // A crash during clone can only leave this unaccepted, task-owned directory.
    rmSync(checkout, { recursive: true, force: true });
    const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
    const clone = Bun.spawnSync(["git", "-c", "core.hooksPath=/dev/null", "clone", "-q", bundle, checkout], {
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });
    if (clone.exitCode !== 0) throw Error("Remote snapshot clone failed: " + clone.stderr.toString().slice(0, 1000));
    const head = Bun.spawnSync(["git", "-C", checkout, "rev-parse", "HEAD"], { env });
    if (head.exitCode !== 0 || head.stdout.toString().trim() !== req.snapshot)
      throw Error("Remote snapshot revision mismatch");
    const result = { offset, checkout, snapshot: req.snapshot };
    atomic(ready, result);
    return result;
  }
  if (state !== "done") throw Error("Repository result requires confirmed successful task completion");
  if (!Number.isSafeInteger(req.offset) || req.offset < 0) throw Error("Invalid repository result offset");
  const meta = read<Upload>(join(dir, "repository-upload.json"));
  const resultFile = join(dir, "repository-result.json"),
    patch = join(dir, "result.patch");
  let result: RepositoryResult;
  if (existsSync(resultFile)) result = read(resultFile);
  else {
    if (existsSync(patch)) rmSync(patch);
    result = collectRepositoryResult(join(dir, "checkout"), meta.snapshot, patch);
    atomic(resultFile, result);
  }
  const bytes = readFileSync(patch);
  if (bytes.length > MAX || req.offset > bytes.length) throw Error("Repository result exceeds bounds");
  const data = bytes.subarray(req.offset, req.offset + CHUNK);
  return {
    result: { ...result, patch: undefined },
    total: bytes.length,
    offset: req.offset + data.length,
    data: data.toString("base64"),
  };
}

type Descriptor = {
  root: string;
  prompt: string;
  snapshot: RepositorySnapshot;
  owner: { ownerId: string; epoch: string };
  profile: { model?: string; thinking?: string };
  outcome?: RepositoryReturn;
};
export type RepositoryLaunch = {
  localRoot: string;
  prompt: string;
  taskId?: string;
  approvedUntracked?: string[];
  model?: string;
  thinking?: string;
};
function directory(client: RemoteClient, id: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw Error("Invalid repository task ID");
  return join(dirname(client.path), "repositories", id);
}
/** Human approval for approvedUntracked must be obtained before this call. No history is uploaded. */
export async function launchRepository(client: RemoteClient, args: RepositoryLaunch): Promise<RemoteTask> {
  const root = Bun.spawnSync(["git", "-C", args.localRoot, "rev-parse", "--show-toplevel"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (root.exitCode) throw Error("Current directory is not a Git repository");
  args = { ...args, localRoot: root.stdout.toString().trim() };
  const id = args.taskId ?? randomUUID(),
    dir = directory(client, id),
    file = join(dir, "handoff.json");
  const connection = (await client.status()).connection;
  if (!connection) throw Error("Use /remote connect first");
  const owner = { ownerId: connection.hello.ownerId, epoch: connection.hello.epoch };
  let descriptor: Descriptor;
  if (existsSync(file)) {
    descriptor = read(file);
    if (
      descriptor.root !== realpathSync(args.localRoot) ||
      descriptor.prompt !== args.prompt ||
      JSON.stringify(descriptor.owner) !== JSON.stringify(owner) ||
      JSON.stringify(descriptor.profile) !== JSON.stringify({ model: args.model, thinking: args.thinking }) ||
      JSON.stringify(descriptor.snapshot.selectedUntracked) !== JSON.stringify(args.approvedUntracked ?? [])
    )
      throw Error("Repository launch retry intent conflict");
  } else {
    mkdirSync(dirname(dir), { recursive: true, mode: 0o700 });
    mkdirSync(dir, { mode: 0o700 });
    const snapshot = captureRepository(args.localRoot, join(dir, "snapshot"), args.approvedUntracked);
    descriptor = {
      root: realpathSync(args.localRoot),
      prompt: args.prompt,
      snapshot,
      owner,
      profile: { model: args.model, thinking: args.thinking },
    };
    atomic(file, descriptor);
  }
  const data = readFileSync(descriptor.snapshot.bundle);
  if (!data.length || data.length > MAX)
    throw Error("Repository snapshot exceeds 128 MiB transfer limit; artifacts retained");
  let checkout: string | undefined;
  for (let offset = 0; offset < data.length; offset += CHUNK) {
    const response = (await client.control(
      {
        op: "repository-upload",
        taskId: id,
        snapshot: descriptor.snapshot.snapshot,
        sha256: digest(data),
        total: data.length,
        offset,
        data: data.subarray(offset, offset + CHUNK).toString("base64"),
      },
      owner,
    )) as { checkout?: string };
    if (response.checkout) checkout = response.checkout;
  }
  if (!checkout) throw Error("Remote repository preparation unconfirmed; retry same task ID " + id);
  await client.launch(checkout, args.prompt, id, descriptor.profile);
  await client.updateTask(id, {
    repository: {
      status: "awaiting_remote_result",
      snapshot: descriptor.snapshot.snapshot,
      omittedUntracked: descriptor.snapshot.omittedUntracked,
      selectedUntracked: descriptor.snapshot.selectedUntracked,
      artifact: dir,
    },
  });
  return client.transcript(id);
}
export async function returnRepository(client: RemoteClient, task: RemoteTask): Promise<RepositoryReturn | undefined> {
  const dir = directory(client, task.taskId),
    file = join(dir, "handoff.json");
  if (!existsSync(file)) return;
  const descriptor = read<Descriptor>(file);
  if (descriptor.outcome) return descriptor.outcome;
  if (task.task?.state !== "done") return;
  const parts: Buffer[] = [];
  let offset = 0;
  let result: RepositoryResult | undefined;
  for (let page = 0; page <= MAX / CHUNK; page++) {
    const r = (await client.control({ op: "repository-result", taskId: task.taskId, offset }, descriptor.owner)) as {
      result: RepositoryResult;
      total: number;
      offset: number;
      data: string;
    };
    const bytes = Buffer.from(r.data, "base64");
    if (
      !Number.isSafeInteger(r.total) ||
      r.total < 0 ||
      r.total > MAX ||
      bytes.length > CHUNK ||
      r.offset !== offset + bytes.length ||
      r.offset > r.total ||
      (r.offset < r.total && !bytes.length) ||
      (result && JSON.stringify(result) !== JSON.stringify(r.result))
    )
      throw Error("Invalid repository result page");
    result = r.result;
    parts.push(bytes);
    offset = r.offset;
    if (offset === r.total) break;
  }
  if (!result || digest(Buffer.concat(parts)) !== result.sha256 || result.snapshot !== descriptor.snapshot.snapshot)
    throw Error("Repository result digest or snapshot mismatch");
  const patch = join(dir, "result.patch");
  writeFileSync(patch, Buffer.concat(parts), { mode: 0o600 });
  const lockDir = join(dirname(client.path), "repo-locks");
  mkdirSync(lockDir, { recursive: true, mode: 0o700 });
  const db = new Database(join(lockDir, digest(descriptor.root) + ".sqlite"));
  try {
    db.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE");
    descriptor.outcome = integrateRepositoryResult(
      descriptor.root,
      descriptor.snapshot,
      { ...result, patch },
      join(dir, "receipts"),
    );
    atomic(file, descriptor);
    db.exec("COMMIT");
  } finally {
    db.close();
  }
  return descriptor.outcome;
}

export async function repositoryPreparations(client: RemoteClient) {
  const base = join(dirname(client.path), "repositories"),
    tasks = (await client.status()).tasks;
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((id) => /^[a-zA-Z0-9_-]{1,100}$/.test(id) && !tasks[id])
    .slice(0, 100)
    .map((id) => {
      const file = join(base, id, "handoff.json");
      if (!existsSync(file)) return { taskId: id, state: "snapshot_incomplete", artifact: join(base, id) };
      const descriptor = read<Descriptor>(file);
      return {
        taskId: id,
        state: "prepared_not_confirmed_launched",
        localRoot: descriptor.root,
        prompt: descriptor.prompt,
        artifact: join(base, id),
      };
    });
}
export async function retryRepository(client: RemoteClient, id: string) {
  const descriptor = read<Descriptor>(join(directory(client, id), "handoff.json"));
  return launchRepository(client, {
    localRoot: descriptor.root,
    prompt: descriptor.prompt,
    taskId: id,
    approvedUntracked: descriptor.snapshot.selectedUntracked,
    ...descriptor.profile,
  });
}
