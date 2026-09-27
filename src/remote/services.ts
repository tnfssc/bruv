import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  rmSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
  openSync,
  closeSync,
  fsyncSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import type { RemoteClient, RemoteTask } from "./client";
import { ClientCapabilityStore, OwnerCapabilityMailbox } from "./capability-runtime";
import type { CapabilityKind, Request, Reply } from "./capabilities";
import { returnRepository } from "./repository-wire";
const safeId = (id: string) => /^[a-zA-Z0-9_-]{1,100}$/.test(id);
const kinds = (kind: string) =>
  kind === "repo.read" ||
  kind === "tool:git-status" ||
  kind === "tool:git-diff" ||
  /^skill:[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(kind);
function atomic(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
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
function local(client: RemoteClient) {
  const dir = join(dirname(client.path), "capability-grants");
  return { dir, store: new ClientCapabilityStore(dir) };
}
export async function grantCapabilities(
  client: RemoteClient,
  taskId: string,
  root: string,
  selected: CapabilityKind[],
) {
  const task = await client.transcript(taskId);
  if (!task.task || !["accepted", "running"].includes(task.task.state))
    throw Error("Grant requires a live accepted task");
  const check = Bun.spawnSync(["git", "-C", root, "rev-parse", "--show-toplevel"], { stdout: "pipe", stderr: "pipe" });
  if (check.exitCode) throw Error("Capabilities require the current Git repository");
  root = check.stdout.toString().trim();
  const id =
    "grant_" +
    createHash("sha256")
      .update(JSON.stringify([taskId, root, selected]))
      .digest("hex");
  const metadata = await local(client).store.grant(taskId, root, selected, id);
  await client.control({ op: "capability-grant", taskId, grant: metadata });
  return {
    grant: metadata,
    scope: root,
    authority: "Explicit read-only repo capability grant; no credentials or arbitrary shell",
  };
}
export async function revokeCapability(client: RemoteClient, taskId: string, grantId: string) {
  await local(client).store.revoke(grantId);
  await client.control({ op: "capability-revoke", taskId, grantId });
  return { revoked: true, grantId };
}
export async function serviceRemoteTask(client: RemoteClient, task: RemoteTask) {
  if (task.task?.state === "running" || task.task?.state === "accepted") {
    const pending = task.task.capabilities;
    if (Array.isArray(pending)) {
      if (pending.length > 32) throw Error("Too many pending remote capabilities");
      for (const raw of pending) {
        const request = raw as Request;
        if (request.taskId !== task.taskId || !safeId(request.id) || !safeId(request.grantId))
          throw Error("Capability identity mismatch");
        const { dir, store } = local(client);
        if (existsSync(join(dir, request.grantId + ".revoked"))) continue;
        const path = join(dirname(client.path), "capability-replies", task.taskId, request.id + ".json");
        let reply: Reply;
        if (existsSync(path)) {
          const saved = JSON.parse(readFileSync(path, "utf8"));
          if (JSON.stringify(saved.request) !== JSON.stringify(request))
            throw Error("Capability retry intent conflict");
          reply = saved.reply;
        } else {
          reply = await store.serve(request);
          atomic(path, { request, reply });
        }
        await client.control({ op: "capability-reply", taskId: task.taskId, reply });
      }
    }
  }
  const repository = await returnRepository(client, task);
  if (repository) await client.updateTask(task.taskId, { repository, integrationError: undefined });
}
export function capabilityNeeds(taskDir: string): unknown[] {
  const dir = join(taskDir, "capability-needs");
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir);
  if (files.length > 32) throw Error("Capability request limit exceeded");
  return files.filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
}
/** Remote child's execute helper. It records the missing grant before genuinely waiting. */
export async function requestLocalCapability(
  args: { kind: CapabilityKind; input: string; requestId?: string },
  signal?: AbortSignal,
): Promise<string> {
  const runtime = process.env.DIE_REMOTE_RUNTIME_STATE;
  if (!runtime) throw Error("Local capability requests are only available inside an owned remote task");
  const taskDir = dirname(runtime),
    taskId = basename(taskDir),
    id = args.requestId ?? randomUUID();
  if (!safeId(id) || !kinds(args.kind) || typeof args.input !== "string" || Buffer.byteLength(args.input) > 4096)
    throw Error("Invalid capability request");
  const file = join(taskDir, "capability-needs", id + ".json"),
    intent = { id, taskId, kind: args.kind, input: args.input };
  if (existsSync(file)) {
    if (JSON.stringify(JSON.parse(readFileSync(file, "utf8"))) !== JSON.stringify(intent))
      throw Error("Capability intent conflict");
  } else {
    if (capabilityNeeds(taskDir).length >= 32) throw Error("Too many capability needs");
    atomic(file, intent);
  }
  const box = new OwnerCapabilityMailbox(taskDir, taskId),
    start = Date.now();
  for (;;) {
    if (signal?.aborted) throw Error("Capability request cancelled");
    if (existsSync(join(taskDir, "capabilities", "terminal.json")))
      throw Error("Remote task ended; capability unavailable");
    if (Date.now() - start > 3600_000) throw Error("Capability grant wait timed out; no local work performed");
    const dir = join(taskDir, "capabilities", "grants");
    for (const name of existsSync(dir) ? readdirSync(dir) : []) {
      if (!name.endsWith(".json")) continue;
      const grant = await box.grant(name.slice(0, -5));
      if (grant?.kinds.includes(args.kind)) {
        rmSync(file, { force: true });
        return box.execute(grant.id, args.kind, args.input, { requestId: id, signal, deadlineMs: 3600_000 });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
