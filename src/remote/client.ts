import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, chmod, open, rmdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type Hello = { protocol: 1; ownerId: string; epoch: string; version: string; platform: string; profile: { name: "normal"; model: string; thinking?: string; auth: "configured" | "missing" | "unknown" } };
export type RemoteEvent = { seq: number; event: unknown };
export type Task = { taskId: string; state: string; [key: string]: unknown };
export type RemoteTask = { taskId: string; host: string; ownerId: string; epoch: string; repoPath: string; prompt: string; cursor: number; events: RemoteEvent[]; task?: Task; outcome: "unknown" | "accepted"; lastSync?: string };
export type RemoteState = { connection?: { host: string; diePath: string; hello: Hello }; tasks: Record<string, RemoteTask> };
export type Transport = (host: string, diePath: string, request: Record<string, unknown>) => Promise<unknown>;
const validHost = (host: string) => /^[a-zA-Z0-9_][a-zA-Z0-9_.@-]*$/.test(host) && !host.startsWith("-");
const validPath = (path: string) => path === "die" || (path.startsWith("/") && !/[\r\n\0]/.test(path));
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";

/** One SSH stdio invocation per operation. SSH's remote command is a shell string: quote only the executable. */
export const sshTransport: Transport = async (host, diePath, request) => {
  if (!validHost(host) || !validPath(diePath)) throw new Error("Invalid SSH alias or remote die path");
  return await new Promise((resolve, reject) => {
    const child = spawn("ssh", ["-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "UpdateHostKeys=no", "-o", "ClearAllForwardings=yes", "-o", "ForwardAgent=no", "--", host, quote(diePath) + " --remote-control"], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => child.kill(), 30_000);
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (s: string) => { out += s; if (out.length > 4_000_000) child.kill(); });
    child.stderr.on("data", (s: string) => { err += s; if (err.length > 4000) err = err.slice(-4000); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error("SSH remote control failed: " + (err.trim() || "exit " + code)));
      try { resolve(JSON.parse(out)); } catch { reject(new Error("Invalid remote JSON response")); }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(request) + "\n");
  });
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid remote response");
  const result = value as Record<string, unknown>;
  if (typeof result.error === "string") throw new Error(result.error);
  return result;
}
function hello(value: unknown): Hello {
  const h = object(value), p = object(h.profile);
  if (!p.model) throw new Error("Remote normal profile has no model. Configure normal in ~/.die/subagents.json on the Linux server; local credentials/models are never copied.");
  if (h.protocol !== 1 || typeof h.ownerId !== "string" || !h.ownerId || typeof h.epoch !== "string" || !h.epoch || typeof h.version !== "string" || typeof h.platform !== "string" || p.name !== "normal" || typeof p.model !== "string" || !["configured", "missing", "unknown"].includes(String(p.auth)) || (p.thinking !== undefined && typeof p.thinking !== "string")) throw new Error("Unsupported remote hello");
  return h as Hello;
}
export function remoteStatePath(): string { return join(homedir(), ".die", "remote", "state.json"); }
export class RemoteClient {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly path = remoteStatePath(), readonly transport: Transport = sshTransport) {}
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const locked = async () => {
      const dir = join(this.path, ".."); await mkdir(dir, { recursive: true, mode: 0o700 });
      const lock = this.path + ".lock";
      let acquired = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        try { await mkdir(lock, { mode: 0o700 }); acquired = true; break; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; await Bun.sleep(30); }
      }
      if (!acquired) throw new Error("Remote local state is locked by another client. If a client crashed, inspect before removing " + lock);
      try { return await fn(); } finally { await rmdir(lock); }
    };
    const next = this.queue.then(locked, locked); this.queue = next.catch(() => {}); return next;
  }
  async read(): Promise<RemoteState> {
    try { const state = JSON.parse(await readFile(this.path, "utf8")); if (!state || typeof state !== "object" || !state.tasks || typeof state.tasks !== "object") throw new Error("Invalid remote state"); return state; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return { tasks: {} }; throw e; }
  }
  private async save(state: RemoteState): Promise<void> {
    const dir = join(this.path, ".."); await mkdir(dir, { recursive: true, mode: 0o700 }); await chmod(dir, 0o700);
    const tmp = this.path + "." + randomUUID();
    try { const file = await open(tmp, "wx", 0o600); try { await file.writeFile(JSON.stringify(state)); await file.sync(); } finally { await file.close(); } await rename(tmp, this.path); await chmod(this.path, 0o600); const directory = await open(dir, "r"); try { await directory.sync(); } finally { await directory.close(); } }
    catch (e) { const { unlink } = await import("node:fs/promises"); await unlink(tmp).catch(() => {}); throw e; }
  }
  connect(host: string, diePath = "die"): Promise<Hello> { return this.exclusive(async () => {
    if (!validHost(host) || !validPath(diePath)) throw new Error("Invalid SSH alias or remote die path");
    const h = hello(await this.transport(host, diePath, { op: "hello" }));
    const state = await this.read(); state.connection = { host, diePath, hello: h }; await this.save(state); return h;
  }); }
  status(): Promise<RemoteState> { return this.read(); }
  launch(repoPath: string, prompt: string, taskId?: string): Promise<RemoteTask> { return this.exclusive(async () => {
    if (!repoPath.startsWith("/") || !prompt.trim() || (taskId !== undefined && !/^[a-zA-Z0-9_-]{1,128}$/.test(taskId))) throw new Error("Expected absolute remote repoPath, prompt and safe taskId");
    const state = await this.read(), c = state.connection;
    if (!c) throw new Error("Connect via /remote connect first");
    if (!taskId) {
      const uncertain = Object.values(state.tasks).find(t => t.host === c.host && t.repoPath === repoPath && t.prompt === prompt && t.outcome === "unknown");
      if (uncertain) throw new Error("An identical launch has unknown outcome: " + uncertain.taskId + ". Sync or retry that same taskId; no new task was sent.");
      taskId = randomUUID();
    }
    let task = state.tasks[taskId];
    if (task) {
      if (task.host !== c.host || task.ownerId !== c.hello.ownerId || task.epoch !== c.hello.epoch || task.repoPath !== repoPath || task.prompt !== prompt) throw new Error("Task ID is pinned to a different owner or intent; refusal to retry");
      if (task.outcome === "accepted") return task;
    } else {
      task = { taskId, host: c.host, ownerId: c.hello.ownerId, epoch: c.hello.epoch, repoPath, prompt, cursor: 0, events: [], outcome: "unknown" };
      state.tasks[taskId] = task; await this.save(state); // before network, including first POST
    }
    // Recheck identity before retry. A lost reply is not permission to POST to a new owner.
    const current = hello(await this.transport(c.host, c.diePath, { op: "hello" }));
    if (current.ownerId !== task.ownerId || current.epoch !== task.epoch) throw new Error("Remote owner changed; launch outcome unknown, no retry");
    const reply = object(await this.transport(c.host, c.diePath, { op: "launch", ownerId: task.ownerId, epoch: task.epoch, taskId, repoPath, prompt }));
    if (object(reply.task).taskId !== taskId) throw new Error("Invalid launch response task ID");
    task.task = object(reply.task) as Task; task.outcome = "accepted"; await this.save(state); return task;
  }); }
  sync(taskId: string): Promise<RemoteTask> { return this.exclusive(async () => {
    const state = await this.read(), task = state.tasks[taskId], c = state.connection;
    if (!task) throw new Error("Unknown remote task");
    if (!c || c.host !== task.host || c.hello.ownerId !== task.ownerId || c.hello.epoch !== task.epoch) throw new Error("Task belongs to another remote owner; cached transcript only");
    const current = hello(await this.transport(c.host, c.diePath, { op: "hello" }));
    if (current.ownerId !== task.ownerId || current.epoch !== task.epoch) throw new Error("Remote owner changed; cached transcript only");
    for (let page = 0; page < 1000; page++) {
      const r = object(await this.transport(c.host, c.diePath, { op: "sync", ownerId: task.ownerId, epoch: task.epoch, taskId, cursor: task.cursor }));
      const snapshot = object(r.task);
      if (snapshot.taskId !== taskId || typeof snapshot.state !== "string" || !Array.isArray(r.events) || !Number.isSafeInteger(r.cursor) || typeof r.hasMore !== "boolean") throw new Error("Invalid sync response");
      let seq = task.cursor;
      const events = r.events.map((raw) => { const e = object(raw); if (!Number.isSafeInteger(e.seq) || e.seq !== ++seq || !("event" in e)) throw new Error("Noncontiguous remote transcript"); return e as RemoteEvent; });
      if (r.cursor !== seq || (r.hasMore && !events.length)) throw new Error("Invalid sync cursor");
      task.events.push(...events); task.cursor = seq;
      // A stale owner snapshot must not erase an already observed terminal result.
      if (!task.task || !["done", "failed", "cancelled", "stopped"].includes(task.task.state) || task.task.state === snapshot.state) task.task = snapshot as Task;
      task.outcome = "accepted"; task.lastSync = new Date().toISOString();
      await this.save(state);
      if (!r.hasMore) return task;
    }
    throw new Error("Remote pagination limit reached; cached pages retained");
  }); }
  async transcript(taskId: string): Promise<RemoteTask> { const task = (await this.read()).tasks[taskId]; if (!task) throw new Error("Unknown remote task"); return task; }
}
