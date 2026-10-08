import { scrubT3BridgeEnvironment } from "../delegation-environment";
import { downloadRepositoryResult, type RepositoryResultPage } from "./repository-download";
import { durableJsonReplace } from "./durable-json";
import { validatePlacement, validateWorkspace, type RemotePlacement, type RemoteWorkspace } from "./placement";
import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
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

function sameChunk(path: string, offset: number, data: Buffer) {
  const fd = openSync(path, "r");
  try {
    const current = Buffer.alloc(data.length);
    let n = 0;
    while (n < current.length) {
      const read = readSync(fd, current, n, current.length - n, offset + n);
      if (!read) break;
      n += read;
    }
    return n === data.length && current.equals(data);
  } finally {
    closeSync(fd);
  }
}
export type RepositoryRequest =
  | {
      op: "repository-upload";
      taskId: string;
      snapshot: string;
      workspace?: RemoteWorkspace;
      sha256: string;
      total: number;
      offset: number;
      data: string;
    }
  | { op: "repository-result"; taskId: string; offset: number };
type Upload = { snapshot: string; sha256: string; total: number; workspace?: RemoteWorkspace };
type UploadRequest = Extract<RepositoryRequest, { op: "repository-upload" }>;
type ResultRequest = Extract<RepositoryRequest, { op: "repository-result" }>;

/** Called under the owner's control lock and identity fence. Never accepts a path from the peer. */
export function repositoryRequest(dir: string, req: RepositoryRequest, state?: string): unknown {
  return req.op === "repository-upload"
    ? receiveRepositoryUpload(dir, req, state)
    : repositoryResultPage(dir, req, state);
}

function receiveRepositoryUpload(dir: string, req: UploadRequest, state?: string) {
  if (req.workspace !== undefined) validateWorkspace(req.workspace);
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
  const intent = { snapshot: req.snapshot, sha256: req.sha256, total: req.total, workspace: req.workspace };
  const meta = join(dir, "repository-upload.json"),
    bundle = join(dir, "input.bundle"),
    ready = join(dir, "repository-ready.json");
  if (existsSync(meta)) {
    if (JSON.stringify(read(meta)) !== JSON.stringify(intent)) throw Error("Repository upload intent conflict");
  } else {
    if (state) throw Error("Cannot attach repository to an already accepted task");
    durableJsonReplace(meta, intent);
  }
  if (existsSync(ready)) return read(ready);
  if (state) throw Error("Accepted task has incomplete repository upload; review required");
  const size = existsSync(bundle) ? statSync(bundle).size : 0;
  if (req.offset > size) throw Error("Repository chunk gap");
  if (req.offset < size) {
    if (req.offset + data.length > size || !sameChunk(bundle, req.offset, data))
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
  const checkout = prepareRepositoryCheckout(dir, intent);
  const result = { offset, checkout, snapshot: req.snapshot, workspace: req.workspace };
  durableJsonReplace(ready, result);
  return result;
}

/** Only complete, unaccepted uploads reach checkout replacement. */
function prepareRepositoryCheckout(dir: string, upload: Upload): string {
  const bundle = join(dir, "input.bundle");
  if (digest(readFileSync(bundle)) !== upload.sha256) throw Error("Repository bundle digest mismatch");
  const checkout = join(dir, "checkout");
  // A crash during clone can only leave this unaccepted, task-owned directory.
  rmSync(checkout, { recursive: true, force: true });
  const env = {
    ...scrubT3BridgeEnvironment(process.env),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  };
  const clone = Bun.spawnSync(
    ["git", "-c", "core.hooksPath=/dev/null", "clone", "--no-checkout", "-q", bundle, checkout],
    {
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    },
  );
  if (clone.exitCode !== 0) throw Error("Remote snapshot clone failed: " + clone.stderr.toString().slice(0, 1000));
  // The bundle is a transfer artifact, not a configured source remote or history promise.
  const detachedSource = Bun.spawnSync(["git", "-C", checkout, "remote", "remove", "origin"], { env });
  if (detachedSource.exitCode !== 0) throw Error("Cannot remove snapshot transfer remote");
  const head = Bun.spawnSync(["git", "-C", checkout, "rev-parse", "HEAD"], { env });
  if (head.exitCode !== 0 || head.stdout.toString().trim() !== upload.snapshot)
    throw Error("Remote snapshot revision mismatch");
  const tree = Bun.spawnSync(["git", "-C", checkout, "ls-tree", "-rlz", "HEAD"], {
    env,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 10_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const entries = tree.stdout.toString().split("\0").filter(Boolean);
  let expanded = 0;
  for (const row of entries) {
    const [mode, type, _oid, size] = row.split("\t")[0]!.trim().split(/\s+/);
    if (!["100644", "100755"].includes(mode!) || type !== "blob" || !Number.isSafeInteger(Number(size)))
      throw Error("Unsupported remote snapshot tree entry");
    expanded += Number(size);
  }
  if (tree.exitCode !== 0 || expanded > MAX) throw Error("Remote checkout exceeds 128 MiB limit");
  const history = Bun.spawnSync(["git", "-C", checkout, "rev-list", "--count", "HEAD"], { env, timeout: 10_000 });
  if (history.exitCode !== 0 || history.stdout.toString().trim() !== "1")
    throw Error("Repository upload must be an orphan snapshot without history");
  const checkoutResult = Bun.spawnSync(
    ["git", "-c", "core.hooksPath=/dev/null", "-C", checkout, "checkout", "--force", "HEAD"],
    { env, stdout: "pipe", stderr: "pipe", timeout: 60_000, maxBuffer: 1024 * 1024 },
  );
  if (checkoutResult.exitCode !== 0) throw Error("Remote snapshot checkout failed");
  if (upload.workspace?.kind === "worktree" && upload.workspace.branch) {
    const branch = upload.workspace.branch;
    const valid = Bun.spawnSync(["git", "check-ref-format", "--branch", branch], {
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (valid.exitCode !== 0 || valid.stdout.toString().trim() !== branch)
      throw Error("Invalid requested workspace branch");
    const switched = Bun.spawnSync(["git", "-C", checkout, "checkout", "-B", branch, upload.snapshot], {
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (switched.exitCode !== 0) throw Error("Cannot preserve requested workspace branch");
  }
  return checkout;
}

function repositoryResultPage(dir: string, req: ResultRequest, state?: string) {
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
    durableJsonReplace(resultFile, result);
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
  jobSessionFile?: string;
  jobQuestionOwner?: { sessionId: string; branchId: string };
  root: string;
  prompt: string;
  title?: string;
  snapshot: RepositorySnapshot;
  owner: { ownerId: string; epoch: string };
  profile: { model?: string; thinking?: string };
  placement?: RemotePlacement;
  outcome?: RepositoryReturn;
};
export type RepositoryLaunch = {
  /** Local parent attribution only; never sent to the SSH worker. */
  jobSessionFile?: string;
  jobQuestionOwner?: { sessionId: string; branchId: string };
  localRoot: string;
  placement?: RemotePlacement;
  prompt: string;
  title?: string;
  taskId?: string;
  approvedUntracked?: string[];
  model?: string;
  thinking?: string;
  /** Trusted internal human-source approval receipt. Never accepted from the agent launch schema. */
  preparedSnapshot?: RepositorySnapshot;
  preparedSnapshotSha256?: string;
};
function validatePreparedSnapshot(args: RepositoryLaunch): RepositorySnapshot {
  const snapshot = args.preparedSnapshot;
  if (
    snapshot?.version !== 1 ||
    snapshot.localRoot !== realpathSync(args.localRoot) ||
    !snapshot.bundleSha256 ||
    !/^[a-f0-9]{64}$/.test(snapshot.bundleSha256)
  )
    throw Error("Prepared repository snapshot lacks pinned source identity/digest");
  if (args.preparedSnapshotSha256 !== snapshot.bundleSha256)
    throw Error("Prepared repository snapshot differs from the human-approved transfer digest");
  const manifest = read(snapshot.manifest);
  if (
    JSON.stringify(manifest) !== JSON.stringify(snapshot) ||
    digest(readFileSync(snapshot.bundle)) !== snapshot.bundleSha256
  )
    throw Error("Prepared repository snapshot manifest or bytes changed after human approval");
  if (JSON.stringify(snapshot.selectedUntracked) !== JSON.stringify(args.approvedUntracked ?? []))
    throw Error("Prepared repository snapshot does not match human-approved paths");
  const requestedRef = args.placement?.workspace.kind === "worktree" ? args.placement.workspace.baseRef : undefined;
  if (snapshot.source?.requestedRef !== requestedRef || snapshot.source?.history !== "orphan-baseline")
    throw Error("Prepared repository snapshot source does not match requested workspace");
  return snapshot;
}
/** Trusted handoff for the normal human-source permission adapter; no recapture after approval. */
export async function launchPreparedRepository(
  client: RemoteClient,
  args: RepositoryLaunch & { preparedSnapshot: RepositorySnapshot; preparedSnapshotSha256: string },
): Promise<RemoteTask> {
  validatePreparedSnapshot(args);
  return launchRepository(client, args);
}
function directory(client: RemoteClient, id: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw Error("Invalid repository task ID");
  return join(dirname(client.path), "repositories", id);
}
function pinRepositoryLaunch(file: string, args: RepositoryLaunch, owner: Descriptor["owner"]): Descriptor {
  const dir = dirname(file);
  if (existsSync(file)) {
    const descriptor = read<Descriptor>(file);
    if (
      (args.jobSessionFile !== undefined && descriptor.jobSessionFile !== args.jobSessionFile) ||
      JSON.stringify(descriptor.jobQuestionOwner) !== JSON.stringify(args.jobQuestionOwner) ||
      descriptor.root !== realpathSync(args.localRoot) ||
      descriptor.prompt !== args.prompt ||
      descriptor.title !== args.title ||
      (args.preparedSnapshot !== undefined &&
        JSON.stringify(descriptor.snapshot) !== JSON.stringify(args.preparedSnapshot)) ||
      JSON.stringify(descriptor.placement) !== JSON.stringify(args.placement) ||
      JSON.stringify(descriptor.owner) !== JSON.stringify(owner) ||
      JSON.stringify(descriptor.profile) !== JSON.stringify({ model: args.model, thinking: args.thinking }) ||
      JSON.stringify(descriptor.snapshot.selectedUntracked) !== JSON.stringify(args.approvedUntracked ?? [])
    )
      throw Error("Repository launch retry intent conflict");
    return descriptor;
  }
  mkdirSync(dirname(dir), { recursive: true, mode: 0o700 });
  mkdirSync(dir, { mode: 0o700 });
  const snapshot =
    args.preparedSnapshot ??
    captureRepository(args.localRoot, join(dir, "snapshot"), args.approvedUntracked, {
      baseRef: args.placement?.workspace.kind === "worktree" ? args.placement.workspace.baseRef : undefined,
    });
  const descriptor: Descriptor = {
    jobSessionFile: args.jobSessionFile,
    jobQuestionOwner: args.jobQuestionOwner,
    root: realpathSync(args.localRoot),
    prompt: args.prompt,
    title: args.title,
    snapshot,
    owner,
    profile: { model: args.model, thinking: args.thinking },
    placement: args.placement,
  };
  durableJsonReplace(file, descriptor);
  return descriptor;
}

async function uploadRepositorySnapshot(client: RemoteClient, id: string, descriptor: Descriptor): Promise<string> {
  const data = readFileSync(descriptor.snapshot.bundle);
  if (!data.length || data.length > MAX)
    throw Error("Repository snapshot exceeds 128 MiB transfer limit; artifacts retained");
  const sha256 = digest(data);
  let checkout: string | undefined;
  for (let offset = 0; offset < data.length; offset += CHUNK) {
    const response = (await client.control(
      {
        op: "repository-upload",
        taskId: id,
        snapshot: descriptor.snapshot.snapshot,
        workspace: descriptor.placement?.workspace,
        sha256,
        total: data.length,
        offset,
        data: data.subarray(offset, offset + CHUNK).toString("base64"),
      },
      descriptor.owner,
    )) as { checkout?: string };
    if (response.checkout) checkout = response.checkout;
  }
  if (!checkout) throw Error("Remote repository preparation unconfirmed; retry same task ID " + id);
  return checkout;
}

/** Human approval for approvedUntracked must be obtained before this call. No history is uploaded. */
export async function launchRepository(client: RemoteClient, args: RepositoryLaunch): Promise<RemoteTask> {
  if (args.placement !== undefined) validatePlacement(args.placement);
  if (args.preparedSnapshot) validatePreparedSnapshot(args);
  const root = Bun.spawnSync(["git", "-C", args.localRoot, "rev-parse", "--show-toplevel"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (root.exitCode) throw Error("Current directory is not a Git repository");
  args = { ...args, localRoot: root.stdout.toString().trim() };
  if (!args.taskId) {
    const state = await client.status();
    const base = join(dirname(client.path), "repositories");
    if (existsSync(base))
      for (const priorId of readdirSync(base)) {
        const priorFile = join(base, priorId, "handoff.json");
        if (!existsSync(priorFile)) continue;
        const prior = read<Descriptor>(priorFile);
        const task = state.tasks?.[priorId];
        if (
          prior.root === realpathSync(args.localRoot) &&
          prior.prompt === args.prompt &&
          (!task || task.outcome === "unknown" || !["done", "cancelled"].includes(task.task?.state ?? ""))
        )
          throw Error(
            "Repository launch is prepared, active or uncertain: " +
              priorId +
              ". Retry that same task ID; no new snapshot sent.",
          );
      }
  }
  const id = args.taskId ?? randomUUID(),
    dir = directory(client, id),
    file = join(dir, "handoff.json");
  const connection = (await client.status()).connection;
  if (!connection) throw Error("Use /remote connect first");
  const owner = { ownerId: connection.hello.ownerId, epoch: connection.hello.epoch };
  const descriptor = pinRepositoryLaunch(file, args, owner);
  const checkout = await uploadRepositorySnapshot(client, id, descriptor);
  await client.launch(
    checkout,
    descriptor.prompt,
    id,
    descriptor.profile,
    descriptor.jobSessionFile,
    descriptor.placement,
    descriptor.jobQuestionOwner,
    descriptor.title,
  );
  await client.updateTask(id, {
    repository: {
      status: "awaiting_remote_result",
      snapshot: descriptor.snapshot.snapshot,
      source: descriptor.snapshot.source,
      workspace: descriptor.placement?.workspace,
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
  const { result, patch: bytes } = await downloadRepositoryResult(
    async (offset) =>
      (await client.control(
        { op: "repository-result", taskId: task.taskId, offset },
        descriptor.owner,
      )) as RepositoryResultPage,
    descriptor.snapshot.snapshot,
    MAX,
    { maxPages: MAX / CHUNK },
  );
  const patch = join(dir, "result.patch");
  writeFileSync(patch, bytes, { mode: 0o600 });
  const lockDir = join(dirname(client.path), "repo-locks");
  mkdirSync(lockDir, { recursive: true, mode: 0o700 });
  const db = new Database(join(lockDir, digest(descriptor.root) + ".sqlite"));
  try {
    db.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE");
    const latest = read<Descriptor>(file);
    if (latest.outcome) {
      db.exec("COMMIT");
      return latest.outcome;
    }
    descriptor.outcome = integrateRepositoryResult(
      descriptor.root,
      descriptor.snapshot,
      { ...result, patch },
      join(dir, "receipts"),
    );
    durableJsonReplace(file, descriptor);
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
        title: descriptor.title,
        artifact: join(base, id),
      };
    });
}
export async function retryRepository(client: RemoteClient, id: string) {
  const descriptor = read<Descriptor>(join(directory(client, id), "handoff.json"));
  return launchRepository(client, {
    jobSessionFile: descriptor.jobSessionFile,
    jobQuestionOwner: descriptor.jobQuestionOwner,
    localRoot: descriptor.root,
    prompt: descriptor.prompt,
    taskId: id,
    approvedUntracked: descriptor.snapshot.selectedUntracked,
    placement: descriptor.placement,
    ...descriptor.profile,
  });
}
