import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** Optional client-side capabilities. No automatic grants, credential discovery or shell execution. */
export const CAPABILITY_MAX_BYTES = 16 * 1024;
export type CapabilityKind = "repo.read" | `tool:${string}` | `skill:${string}`;
export type Grant = Readonly<{ id: string; taskId: string; repoRoot: string; kinds: readonly CapabilityKind[] }>;
export type Request = Readonly<{ id: string; grantId: string; taskId: string; kind: CapabilityKind; input: string }>;
export type Reply = Readonly<{ requestId: string; grantId: string; taskId: string; value?: string; error?: string }>;
export type Handler = (input: string, ctx: { repoRoot: string; signal: AbortSignal }) => Promise<string>;
type Pending = { request: Request; resolve: (reply: Reply) => void; signal?: AbortSignal; abort?: () => void };
const bytes = (s: string) => Buffer.byteLength(s, "utf8");
const valid = (s: string): s is CapabilityKind => s === "repo.read" || /^(tool|skill):[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(s);
const inside = (root: string, target: string) => {
  const rel = relative(root, target);
  return !!rel && rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
};

/** Bounded, fatal UTF-8 read; reject symlinks at every path element. Node path-based APIs
 * cannot promise confinement against a hostile process concurrently replacing ancestors. */
export async function readGrantedRepoFile(root: string, name: string): Promise<string> {
  if (!name || name.includes("\0") || isAbsolute(name) || name.split(/[\/]/).includes(".."))
    throw new Error("Invalid relative repo file");
  const target = resolve(root, name);
  if (!inside(root, target)) throw new Error("Outside granted repo");
  let part = root;
  for (const piece of relative(root, target).split(sep)) {
    part = resolve(part, piece);
    const st = await lstat(part);
    if (st.isSymbolicLink()) throw new Error("Repo symlink denied");
    if (part !== target && !st.isDirectory()) throw new Error("Not a directory");
  }
  if (!inside(root, await realpath(target))) throw new Error("Outside granted repo");
  const fd = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!(await fd.stat()).isFile()) throw new Error("Not a regular file");
    const buf = Buffer.alloc(CAPABILITY_MAX_BYTES + 1);
    let used = 0;
    while (used < buf.length) {
      const { bytesRead } = await fd.read(buf, used, buf.length - used, null);
      if (!bytesRead) break;
      used += bytesRead;
    }
    if (used > CAPABILITY_MAX_BYTES) throw new Error("Repo file exceeds read limit");
    return new TextDecoder("utf-8", { fatal: true }).decode(buf.subarray(0, used));
  } finally { await fd.close(); }
}

/** Volatile queue: owner must journal requests/replies before ACK and reconcile after restart.
 * Offline request remains waiting. Instance restart does not restore or infer grants. */
export class LocalCapabilities {
  private grants = new Map<string, Grant>();
  private pending = new Map<string, Pending>();
  private handlers = new Map<CapabilityKind, Handler>();
  private ownerGrants = new Map<string, { taskId: string; kinds: readonly CapabilityKind[] }>();
  /** Owner-side registration from an explicitly accepted launch grant. Never use remote repo path here. */
  allowOwnerGrant(id: string, taskId: string, kinds: readonly CapabilityKind[]): void {
    if (!id || !taskId || !kinds.length || kinds.length > 16 || new Set(kinds).size !== kinds.length || kinds.some(k => !valid(k)) || this.ownerGrants.has(id))
      throw new Error("Invalid or duplicate owner grant");
    this.ownerGrants.set(id, { taskId, kinds: [...kinds] });
  }
  register(kind: CapabilityKind, handler: Handler): void {
    if (!valid(kind) || kind === "repo.read" || this.handlers.has(kind)) throw new Error("Invalid or duplicate handler");
    this.handlers.set(kind, handler);
  }
  async grant(taskId: string, repoRoot: string, kinds: readonly CapabilityKind[]): Promise<Grant> {
    if (!taskId || !isAbsolute(repoRoot) || !kinds.length || kinds.length > 16 || new Set(kinds).size !== kinds.length ||
      kinds.some(k => !valid(k) || (k !== "repo.read" && !this.handlers.has(k))))
      throw new Error("Explicit task, absolute repo and registered kinds required");
    const root = await realpath(repoRoot);
    if (!(await lstat(root)).isDirectory()) throw new Error("Repo root must be a directory");
    const g: Grant = Object.freeze({ id: randomUUID(), taskId, repoRoot: root, kinds: Object.freeze([...kinds]) });
    this.grants.set(g.id, g);
    return g;
  }
  revoke(id: string): void {
    this.grants.delete(id);
    this.ownerGrants.delete(id);
    for (const p of [...this.pending.values()]) if (p.request.grantId === id) this.finish(p, { error: "Grant revoked" });
  }
  endTask(taskId: string): void {
    for (const g of [...this.grants.values()]) if (g.taskId === taskId) this.revoke(g.id);
    for (const [id, g] of [...this.ownerGrants]) if (g.taskId === taskId) this.revoke(id);
  }
  listPending(): Request[] { return [...this.pending.values()].map(p => p.request); }
  request(grantId: string, taskId: string, kind: CapabilityKind, input: string, signal?: AbortSignal): Promise<Reply> {
    const g = this.ownerGrants.get(grantId);
    if (!g || g.taskId !== taskId || !g.kinds.includes(kind)) throw new Error("No task grant for kind");
    if (typeof input !== "string" || bytes(input) > 4096) throw new Error("Capability input exceeds limit");
    if (this.pending.size >= 32) throw new Error("Too many pending requests");
    const id = randomUUID();
    if (signal?.aborted) return Promise.resolve({ requestId: id, grantId, taskId, error: "Cancelled" });
    const request = Object.freeze({ id, grantId, taskId, kind, input });
    return new Promise(resolve => {
      const p: Pending = { request, resolve, signal };
      p.abort = () => this.finish(p, { error: "Cancelled" });
      this.pending.set(id, p);
      signal?.addEventListener("abort", p.abort, { once: true });
    });
  }
  private finish(p: Pending, outcome: { value?: string; error?: string }): void {
    if (!this.pending.delete(p.request.id)) return;
    p.signal?.removeEventListener("abort", p.abort!);
    p.resolve({ requestId: p.request.id, grantId: p.request.grantId, taskId: p.request.taskId, ...outcome });
  }
  /** Called only after transport pins owner identity/task; handlers receive no machine-wide authority. */
  async serve(request: Request, signal?: AbortSignal): Promise<Reply> {
    const g = this.grants.get(request.grantId);
    if (!g || g.taskId !== request.taskId || !g.kinds.includes(request.kind)) throw new Error("No task grant for kind");
    if (!request.id || typeof request.input !== "string" || bytes(request.input) > 4096) throw new Error("Invalid request");
    try {
      if (signal?.aborted) throw new Error("Cancelled");
      const value = request.kind === "repo.read" ? await readGrantedRepoFile(g.repoRoot, request.input)
        : await this.handlers.get(request.kind)!(request.input, { repoRoot: g.repoRoot, signal: signal ?? new AbortController().signal });
      if (signal?.aborted) throw new Error("Cancelled");
      if (this.grants.get(g.id) !== g) throw new Error("Grant revoked");
      if (typeof value !== "string" || bytes(value) > CAPABILITY_MAX_BYTES) throw new Error("Capability output exceeds limit");
      return { requestId: request.id, grantId: g.id, taskId: g.taskId, value };
    } catch (e) { return { requestId: request.id, grantId: g.id, taskId: g.taskId, error: e instanceof Error ? e.message : "Capability failed" }; }
  }
  /** Reply transport must pin owner/task and journal before ACK. Duplicate reply is stale (false). */
  submit(reply: Reply): boolean {
    const p = this.pending.get(reply.requestId);
    if (!p) return false;
    if (reply.grantId !== p.request.grantId || reply.taskId !== p.request.taskId ||
      (typeof reply.value === "string") === (typeof reply.error === "string") ||
      (reply.value !== undefined && (typeof reply.value !== "string" || bytes(reply.value) > CAPABILITY_MAX_BYTES)) ||
      (reply.error !== undefined && (typeof reply.error !== "string" || bytes(reply.error) > 1024)))
      throw new Error("Mismatched capability reply");
    this.finish(p, { value: reply.value, error: reply.error });
    return true;
  }
}
