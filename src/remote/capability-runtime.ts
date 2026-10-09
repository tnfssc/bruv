import { sensitiveRepoPath } from "./security";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  CAPABILITY_MAX_BYTES,
  readGrantedRepoFile,
  type CapabilityKind,
  type Grant,
  type Reply,
  type Request,
} from "./capabilities";

// Owner task directory is trusted, private state. Never derive this path from a client payload.
const id = (s: string) => typeof s === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(s);
const kind = (s: string): s is CapabilityKind =>
  s === "repo.read" ||
  s === "tool:git-status" ||
  s === "tool:git-diff" ||
  /^skill:[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(s);
const size = (s: string) => Buffer.byteLength(s, "utf8");
const checkKinds = (kinds: readonly CapabilityKind[]) => {
  if (
    !Array.isArray(kinds) ||
    !kinds.length ||
    kinds.length > 16 ||
    new Set(kinds).size !== kinds.length ||
    !kinds.every(kind)
  )
    throw new Error("Unsupported capability kinds");
};
const read = async <T>(path: string): Promise<T | undefined> => {
  try {
    const data = await readFile(path);
    if (data.length > 65536) throw new Error("Oversized capability record");
    return JSON.parse(data.toString()) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
};
async function durable(path: string, value: unknown): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}`;
  const fd = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    await fd.writeFile(JSON.stringify(value));
    await fd.sync();
  } finally {
    await fd.close();
  }
  // Records are immutable: link fails rather than overwriting a previous intent.
  try {
    const { link, unlink } = await import("node:fs/promises");
    await link(temp, path);
    await unlink(temp);
  } catch (e) {
    const { unlink } = await import("node:fs/promises");
    await unlink(temp).catch(() => {});
    throw e;
  }
  const d = await open(dir, "r");
  try {
    await d.sync();
  } finally {
    await d.close();
  }
}
const conflict = (e: unknown) => (e as NodeJS.ErrnoException).code === "EEXIST";
// Grants, requests and replies may be replayed, but never replaced with a different intent.
async function persistIntent(path: string, value: unknown): Promise<void> {
  try {
    await durable(path, value);
  } catch (error) {
    if (!conflict(error) || JSON.stringify(await read(path)) !== JSON.stringify(value)) throw error;
  }
}
// Cancellation, revocation and terminal state are one-way: the first durable marker wins.
async function persistMarker(path: string, value: unknown): Promise<void> {
  try {
    await durable(path, value);
  } catch (error) {
    if (!conflict(error)) throw error;
  }
}
const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((r) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      r();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });

const requestQueues = new Map<string, Promise<void>>();
async function serializeRequest<T>(key: string, run: () => Promise<T>): Promise<T> {
  const result = (requestQueues.get(key) ?? Promise.resolve()).then(run);
  // A failed admission still releases the next request; only its caller receives the rejection.
  const settled = result.then(
    () => {},
    () => {},
  );
  requestQueues.set(key, settled);
  try {
    return await result;
  } finally {
    if (requestQueues.get(key) === settled) requestQueues.delete(key);
  }
}
export type GrantMetadata = { id: string; taskId: string; kinds: CapabilityKind[] };
/** Owner storage: instantiate with root/tasks/taskId. One owner process serializes reply/terminal operations. */
export class OwnerCapabilityMailbox {
  constructor(
    readonly taskDir: string,
    readonly taskId: string,
  ) {
    if (!id(taskId)) throw new Error("Invalid task id");
  }
  private dir() {
    return join(this.taskDir, "capabilities");
  }
  private grantPath(grantId: string) {
    if (!id(grantId)) throw new Error("Invalid grant id");
    return join(this.dir(), "grants", `${grantId}.json`);
  }
  private requestPath(requestId: string) {
    if (!id(requestId)) throw new Error("Invalid request id");
    return join(this.dir(), "requests", `${requestId}.json`);
  }
  private replyPath(requestId: string) {
    return join(this.dir(), "replies", `${requestId}.json`);
  }
  private cancelledPath(requestId: string) {
    return join(this.dir(), "cancelled", `${requestId}.json`);
  }
  private terminalPath() {
    return join(this.dir(), "terminal.json");
  }
  private revokedPath(grantId: string) {
    return join(this.dir(), "revoked", `${grantId}.json`);
  }
  async acceptGrant(grant: GrantMetadata): Promise<void> {
    if (grant.taskId !== this.taskId || !id(grant.id)) throw new Error("Grant task mismatch");
    checkKinds(grant.kinds);
    if (await read(this.terminalPath())) throw new Error("Task terminal");
    const grants = await readdir(join(this.dir(), "grants")).catch((error) => {
      if (error.code === "ENOENT") return [] as string[];
      throw error;
    });
    if (grants.length >= 64 && !grants.includes(`${grant.id}.json`)) throw Error("Capability grant limit reached");
    const value = { id: grant.id, taskId: this.taskId, kinds: [...grant.kinds] };
    await persistIntent(this.grantPath(grant.id), value);
  }
  async revoke(grantId: string): Promise<void> {
    if (!(await read(this.grantPath(grantId)))) throw new Error("Unknown grant");
    await persistMarker(this.revokedPath(grantId), { revoked: true });
  }
  async grant(grantId: string): Promise<GrantMetadata | undefined> {
    if (await read(this.revokedPath(grantId))) return undefined;
    return read<GrantMetadata>(this.grantPath(grantId));
  }
  async terminal(reason = "Task ended"): Promise<void> {
    await persistMarker(this.terminalPath(), { reason });
  }
  request(
    grantId: string,
    kindName: CapabilityKind,
    input: string,
    requestId: string = randomUUID(),
  ): Promise<Request> {
    return serializeRequest(this.taskDir, () => this.createRequest(grantId, kindName, input, requestId));
  }
  private async createRequest(
    grantId: string,
    kindName: CapabilityKind,
    input: string,
    requestId: string = randomUUID(),
  ): Promise<Request> {
    if (!id(requestId) || !kind(kindName) || typeof input !== "string" || size(input) > 4096)
      throw new Error("Invalid capability request");
    const value: Request = { id: requestId, grantId, taskId: this.taskId, kind: kindName, input };
    const old = await read<Request>(this.requestPath(requestId));
    if (old) {
      if (JSON.stringify(old) !== JSON.stringify(value)) throw new Error("Request ID conflict");
      return old;
    }
    const grant = await this.grant(grantId);
    if (!grant?.kinds.includes(kindName) || (await read(this.terminalPath()))) throw new Error("No active task grant");
    const records = await readdir(join(this.dir(), "requests")).catch((error) => {
      if (error.code === "ENOENT") return [] as string[];
      throw error;
    });
    if (records.length >= 1024) throw Error("Capability mailbox retention limit reached");
    const pending = await this.pending();
    if (pending.length >= 32) throw new Error("Too many pending capability requests");
    await persistIntent(this.requestPath(requestId), value);
    return value;
  }
  async cancelRequest(requestId: string): Promise<void> {
    if (!id(requestId)) throw new Error("Invalid request id");
    if (!(await read(this.requestPath(requestId)))) return;
    await persistMarker(this.cancelledPath(requestId), { cancelled: true });
  }
  async pending(): Promise<Request[]> {
    let names: string[];
    try {
      names = await readdir(join(this.dir(), "requests"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    if (names.length > 1024) throw new Error("Capability mailbox limit exceeded");
    if (await read(this.terminalPath())) return [];
    const result: Request[] = [];
    for (const name of names) {
      if (!/^[a-zA-Z0-9_-]{1,128}\.json$/.test(name)) continue;
      const request = await read<Request>(join(this.dir(), "requests", name));
      if (
        request &&
        request.taskId === this.taskId &&
        !(await read(this.replyPath(request.id))) &&
        !(await read(this.cancelledPath(request.id))) &&
        (await this.grant(request.grantId))
      )
        result.push(request);
    }
    return result;
  }
  async reply(reply: Reply): Promise<boolean> {
    if (
      !id(reply.requestId) ||
      !id(reply.grantId) ||
      reply.taskId !== this.taskId ||
      (typeof reply.value === "string") === (typeof reply.error === "string") ||
      (reply.value !== undefined && (typeof reply.value !== "string" || size(reply.value) > CAPABILITY_MAX_BYTES)) ||
      (reply.error !== undefined && (typeof reply.error !== "string" || size(reply.error) > 1024))
    )
      throw new Error("Invalid capability reply");
    if (await read(this.terminalPath())) return false;
    const request = await read<Request>(this.requestPath(reply.requestId));
    if (
      !request ||
      request.grantId !== reply.grantId ||
      request.taskId !== this.taskId ||
      (await read(this.cancelledPath(reply.requestId))) ||
      !(await this.grant(reply.grantId))
    )
      return false;
    const previous = await read<Reply>(this.replyPath(reply.requestId));
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(reply)) throw new Error("Reply ID conflict");
      return true;
    }
    await persistIntent(this.replyPath(reply.requestId), reply);
    return true;
  }
  async awaitReply(request: Request, options: { signal?: AbortSignal; deadlineMs?: number } = {}): Promise<string> {
    const deadline = Date.now() + (options.deadlineMs ?? 3600_000);
    while (true) {
      if (options.signal?.aborted) {
        await this.cancelRequest(request.id);
        throw new Error("Capability request cancelled");
      }
      if (await read(this.cancelledPath(request.id))) throw new Error("Capability request cancelled");
      if (await read(this.terminalPath())) throw new Error("Task terminal");
      if (!(await this.grant(request.grantId))) throw new Error("Grant revoked");
      const reply = await read<Reply>(this.replyPath(request.id));
      if (reply) {
        if (reply.taskId !== request.taskId || reply.grantId !== request.grantId)
          throw new Error("Reply fence mismatch");
        if (reply.error !== undefined) throw new Error(reply.error);
        if (reply.value === undefined) throw new Error("Capability reply has no value");
        return reply.value;
      }
      if (Date.now() >= deadline) {
        await this.cancelRequest(request.id);
        throw new Error("Capability reply deadline exceeded");
      }
      await pause(Math.min(250, Math.max(1, deadline - Date.now())), options.signal);
    }
  }
  async execute(
    grantId: string,
    kindName: CapabilityKind,
    input: string,
    options: { requestId?: string; signal?: AbortSignal; deadlineMs?: number } = {},
  ): Promise<string> {
    if (options.signal?.aborted) throw new Error("Capability request cancelled");
    const request = await this.request(grantId, kindName, input, options.requestId);
    return this.awaitReply(request, options);
  }
}

const sensitive = sensitiveRepoPath;
function safePath(path: string) {
  if (
    !path ||
    path.includes("\0") ||
    isAbsolute(path) ||
    path.split(/[/]/).some((x) => x === ".." || x === "") ||
    sensitive(path)
  )
    throw new Error("Sensitive or invalid repo path denied");
  return path;
}
async function git(root: string, args: string[], signal?: AbortSignal): Promise<string> {
  const config = Bun.spawnSync(["git", "-C", root, "config", "--local", "--get-regexp", "^filter\\."], {
    env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 2000,
    maxBuffer: 16384,
  });
  if (config.exitCode !== 1)
    throw Error("Local Git filters or unreadable configuration are not allowed for read-only capabilities");
  return new Promise((resolveValue, reject) => {
    const child = spawn(
      "git",
      [
        "-c",
        "core.pager=cat",
        "-c",
        "diff.external=",
        "-c",
        "diff.trustExitCode=false",
        "-c",
        "core.fsmonitor=false",
        ...args,
      ],
      {
        cwd: root,
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HOME: "/nonexistent",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_PAGER: "cat",
          GIT_OPTIONAL_LOCKS: "0",
        },
        stdio: ["ignore", "pipe", "pipe"],
        signal,
        timeout: 5000,
        killSignal: "SIGKILL",
      },
    );
    const chunks: Buffer[] = [];
    let count = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      count += chunk.length;
      if (count > CAPABILITY_MAX_BYTES) child.kill();
      else chunks.push(chunk);
    });
    child.stderr.on("data", () => {});
    child.on("error", reject);
    child.on("close", (code) => {
      if (count > CAPABILITY_MAX_BYTES) reject(new Error("Capability output exceeds limit"));
      else if (code !== 0) reject(new Error("Git read failed"));
      else {
        try {
          resolveValue(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
        } catch (e) {
          reject(e);
        }
      }
    });
  });
}
/** Client-side explicit local grants. Store is private to the client, never transport localRoot. */
export class ClientCapabilityStore {
  constructor(readonly dir: string) {}
  async grant(
    taskId: string,
    localRoot: string,
    kinds: CapabilityKind[],
    grantId: string = randomUUID(),
  ): Promise<GrantMetadata> {
    if (!id(taskId) || !id(grantId) || !isAbsolute(localRoot)) throw new Error("Invalid local grant");
    checkKinds(kinds);
    const root = await realpath(localRoot);
    if (!(await stat(root)).isDirectory()) throw new Error("Invalid local repo root");
    const record: Grant = { id: grantId, taskId, repoRoot: root, kinds: [...kinds] };
    await persistIntent(join(this.dir, `${grantId}.json`), record);
    return { id: grantId, taskId, kinds: [...kinds] };
  }
  async revoke(grantId: string): Promise<void> {
    if (!id(grantId)) throw new Error("Invalid grant id");
    await persistMarker(join(this.dir, `${grantId}.revoked`), true);
  }
  async serve(request: Request, signal?: AbortSignal): Promise<Reply> {
    if (
      !id(request.id) ||
      !id(request.grantId) ||
      !id(request.taskId) ||
      !kind(request.kind) ||
      typeof request.input !== "string" ||
      size(request.input) > 4096
    )
      throw new Error("Invalid capability request");
    const grant = await read<Grant>(join(this.dir, `${request.grantId}.json`));
    if (
      !grant ||
      grant.id !== request.grantId ||
      grant.taskId !== request.taskId ||
      !grant.kinds.includes(request.kind) ||
      (await read(join(this.dir, `${request.grantId}.revoked`)))
    )
      throw new Error("No explicit local task grant");
    try {
      if (signal?.aborted) throw new Error("Cancelled");
      let value: string;
      if (request.kind === "repo.read") value = await readGrantedRepoFile(grant.repoRoot, safePath(request.input));
      else if (request.kind.startsWith("skill:")) {
        if (request.input !== "") throw new Error("Skill input must be empty");
        value = await readGrantedRepoFile(grant.repoRoot, safePath(`.agents/skills/${request.kind.slice(6)}/SKILL.md`));
      } else if (request.kind === "tool:git-status") {
        if (request.input !== "") throw new Error("Status input must be empty");
        value = await git(
          grant.repoRoot,
          ["status", "--porcelain=v1", "--ignore-submodules=all", "-uno", "--"],
          signal,
        );
      } else {
        const path = safePath(request.input);
        // Diffing a directory could disclose an otherwise-denied credential file beneath it.
        const file = resolve(grant.repoRoot, path);
        if (!(await stat(file)).isFile()) throw new Error("Diff requires an exact regular file");
        await readGrantedRepoFile(grant.repoRoot, path); // enforce no symlinks, UTF-8 and bound before diff
        value = await git(grant.repoRoot, ["diff", "--no-ext-diff", "--no-textconv", "--", path], signal);
      }
      if (signal?.aborted) throw new Error("Cancelled");
      if (await read(join(this.dir, `${request.grantId}.revoked`))) throw new Error("Grant revoked");
      if (size(value) > CAPABILITY_MAX_BYTES) throw new Error("Capability output exceeds limit");
      return { requestId: request.id, grantId: request.grantId, taskId: request.taskId, value };
    } catch (e) {
      return {
        requestId: request.id,
        grantId: request.grantId,
        taskId: request.taskId,
        error: String(e instanceof Error ? e.message : e).slice(0, 1024),
      };
    }
  }
}
