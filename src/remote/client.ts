import { Database } from "bun:sqlite";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, chmod, open, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type Hello = {
  protocol: 1;
  ownerId: string;
  epoch: string;
  version: string;
  platform: string;
  profile: { name: "normal"; model: string; thinking?: string; auth: "configured" | "missing" | "unknown" };
};
export type RemoteEvent = { seq: number; event: unknown };
export type Task = { taskId: string; state: string; [key: string]: unknown };
export type RemoteTask = {
  taskId: string;
  host: string;
  ownerId: string;
  epoch: string;
  repoPath: string;
  prompt: string;
  cursor: number;
  events: RemoteEvent[];
  task?: Task;
  outcome: "unknown" | "accepted";
  lastSync?: string;
  lastError?: string;
};
export type RemoteState = {
  connection?: { host: string; diePath: string; hello: Hello };
  tasks: Record<string, RemoteTask>;
};
export type Transport = (host: string, diePath: string, request: Record<string, unknown>) => Promise<unknown>;
const validHost = (host: string) => /^[a-zA-Z0-9_][a-zA-Z0-9_.@-]*$/.test(host) && !host.startsWith("-");
const validPath = (path: string) => path === "die" || (path.startsWith("/") && !/[\r\n\0]/.test(path));
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";

/** One SSH stdio invocation per operation. SSH's remote command is a shell string: quote only the executable. */
export const sshTransport: Transport = async (host, diePath, request) => {
  if (!validHost(host) || !validPath(diePath)) throw new Error("Invalid SSH alias or remote die path");
  return await new Promise((resolve, reject) => {
    const child = spawn(
      "ssh",
      [
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        "UpdateHostKeys=no",
        "-o",
        "ClearAllForwardings=yes",
        "-o",
        "ForwardAgent=no",
        "--",
        host,
        quote(diePath) + " --remote-control",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let out = "",
      err = "";
    const timer = setTimeout(() => child.kill(), 30_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (s: string) => {
      out += s;
      if (out.length > 4_000_000) child.kill();
    });
    child.stderr.on("data", (s: string) => {
      err += s;
      if (err.length > 4000) err = err.slice(-4000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error("SSH remote control failed: " + (err.trim() || "exit " + code)));
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error("Invalid remote JSON response"));
      }
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
  const h = object(value),
    p = object(h.profile);
  if (!p.model)
    throw new Error(
      "Remote normal profile has no model. Configure normal in ~/.die/subagents.json on the Linux server; local credentials/models are never copied.",
    );
  if (
    h.protocol !== 1 ||
    typeof h.ownerId !== "string" ||
    !h.ownerId ||
    typeof h.epoch !== "string" ||
    !h.epoch ||
    typeof h.version !== "string" ||
    typeof h.platform !== "string" ||
    p.name !== "normal" ||
    typeof p.model !== "string" ||
    !["configured", "missing", "unknown"].includes(String(p.auth)) ||
    (p.thinking !== undefined && typeof p.thinking !== "string")
  )
    throw new Error("Unsupported remote hello");
  return h as Hello;
}
const MAX_CACHE_BYTES = 128 * 1024 * 1024;

export function remoteStatePath(): string {
  return join(homedir(), ".die", "remote", "state.json");
}
export class RemoteClient {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    readonly path = remoteStatePath(),
    readonly transport: Transport = sshTransport,
  ) {}
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const locked = async () => {
      const dir = join(this.path, "..");
      await mkdir(dir, { recursive: true, mode: 0o700 });
      // OS-backed SQLite locking releases on client death; a stale mkdir lock would
      // strand the very reconnect needed to reconcile an ambiguous launch.
      const lock = this.path + ".lock.sqlite";
      const file = await open(lock, "a", 0o600);
      await file.close();
      const database = new Database(lock);
      let acquired = false;
      try {
        database.exec("PRAGMA busy_timeout=0");
        for (let attempt = 0; attempt < 100; attempt++) {
          try {
            database.exec("BEGIN EXCLUSIVE");
            acquired = true;
            break;
          } catch (error) {
            if (!(error instanceof Error) || !/locked|busy/i.test(error.message)) throw error;
            await Bun.sleep(30);
          }
        }
        if (!acquired)
          throw new Error("Remote local state is in use by another client; try again after its operation finishes");
        database.exec("CREATE TABLE IF NOT EXISTS state_lock (id INTEGER)");
        return await fn();
      } finally {
        try {
          if (acquired) database.exec("COMMIT");
        } finally {
          database.close();
        }
      }
    };
    const next = this.queue.then(locked, locked);
    this.queue = next.catch(() => {});
    return next;
  }
  async read(): Promise<RemoteState> {
    try {
      if ((await stat(this.path)).size > MAX_CACHE_BYTES)
        throw new Error("Remote cache exceeds 128 MiB; preserve/export it before starting a fresh cache");
      const state = JSON.parse(await readFile(this.path, "utf8"));
      if (!state || typeof state !== "object" || !state.tasks || typeof state.tasks !== "object")
        throw new Error("Invalid remote state");
      return state;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return { tasks: {} };
      throw e;
    }
  }
  private async save(state: RemoteState): Promise<void> {
    const dir = join(this.path, "..");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
    const text = JSON.stringify(state);
    if (Buffer.byteLength(text) > MAX_CACHE_BYTES)
      throw new Error(
        "Remote cache 128 MiB limit reached; no page/cursor was committed. Preserve/export the cache before continuing.",
      );
    const tmp = this.path + "." + randomUUID();
    try {
      const file = await open(tmp, "wx", 0o600);
      try {
        await file.writeFile(text);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(tmp, this.path);
      await chmod(this.path, 0o600);
      const directory = await open(dir, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } catch (e) {
      const { unlink } = await import("node:fs/promises");
      await unlink(tmp).catch(() => {});
      throw e;
    }
  }
  connect(host: string, diePath = "die"): Promise<Hello> {
    return this.exclusive(async () => {
      if (!validHost(host) || !validPath(diePath)) throw new Error("Invalid SSH alias or remote die path");
      const h = hello(await this.transport(host, diePath, { op: "hello" }));
      const state = await this.read();
      state.connection = { host, diePath, hello: h };
      await this.save(state);
      return h;
    });
  }
  status(): Promise<RemoteState> {
    return this.read();
  }
  launch(repoPath: string, prompt: string, taskId?: string): Promise<RemoteTask> {
    return this.exclusive(async () => {
      if (
        !repoPath.startsWith("/") ||
        !prompt.trim() ||
        (taskId !== undefined && !/^[a-zA-Z0-9_-]{1,128}$/.test(taskId))
      )
        throw new Error("Expected absolute remote repoPath, prompt and safe taskId");
      const state = await this.read(),
        c = state.connection;
      if (!c) throw new Error("Connect via /remote connect first");
      if (!taskId) {
        const uncertain = Object.values(state.tasks).find(
          (t) => t.host === c.host && t.repoPath === repoPath && t.prompt === prompt && t.outcome === "unknown",
        );
        if (uncertain)
          throw new Error(
            "An identical launch has unknown outcome: " +
              uncertain.taskId +
              ". Sync or retry that same taskId; no new task was sent.",
          );
        if (Object.keys(state.tasks).length >= 100)
          throw new Error(
            "Remote cache task limit (100) reached; preserve/export the cache before starting more tasks",
          );
        taskId = randomUUID();
      }
      let task = state.tasks[taskId];
      if (task) {
        if (
          task.host !== c.host ||
          task.ownerId !== c.hello.ownerId ||
          task.epoch !== c.hello.epoch ||
          task.repoPath !== repoPath ||
          task.prompt !== prompt
        )
          throw new Error("Task ID is pinned to a different owner or intent; refusal to retry");
        if (task.outcome === "accepted") return task;
      } else {
        task = {
          taskId,
          host: c.host,
          ownerId: c.hello.ownerId,
          epoch: c.hello.epoch,
          repoPath,
          prompt,
          cursor: 0,
          events: [],
          outcome: "unknown",
        };
        state.tasks[taskId] = task;
        await this.save(state); // before network, including first POST
      }
      try {
        // Recheck identity before retry. A lost reply is not permission to POST to a new owner.
        const current = hello(await this.transport(c.host, c.diePath, { op: "hello" }));
        if (current.ownerId !== task.ownerId || current.epoch !== task.epoch)
          throw new Error("Remote owner changed; launch outcome unknown, no retry");
        const reply = object(
          await this.transport(c.host, c.diePath, {
            op: "launch",
            ownerId: task.ownerId,
            epoch: task.epoch,
            taskId,
            repoPath,
            prompt,
          }),
        );
        if (object(reply.task).taskId !== taskId) throw new Error("Invalid launch response task ID");
        delete task.lastError;
        task.task = object(reply.task) as Task;
        task.outcome = "accepted";
        await this.save(state);
        return task;
      } catch (error) {
        task.lastError = String(error);
        await this.save(state);
        throw new Error(
          "Launch outcome unknown for " +
            task.taskId +
            ": " +
            String(error) +
            ". Reconcile this same taskId; do not create a replacement.",
        );
      }
    });
  }
  sync(taskId: string): Promise<RemoteTask> {
    return this.exclusive(async () => {
      const state = await this.read(),
        task = state.tasks[taskId],
        c = state.connection;
      if (!task) throw new Error("Unknown remote task");
      try {
        if (!c || c.host !== task.host || c.hello.ownerId !== task.ownerId || c.hello.epoch !== task.epoch)
          throw new Error("Task belongs to another remote owner; cached transcript only");
        const current = hello(await this.transport(c.host, c.diePath, { op: "hello" }));
        if (current.ownerId !== task.ownerId || current.epoch !== task.epoch)
          throw new Error(
            "Remote owner changed (server restart or replaced state); outcome unknown; cached transcript only",
          );
        for (let page = 0; page < 1000; page++) {
          const r = object(
            await this.transport(c.host, c.diePath, {
              op: "sync",
              ownerId: task.ownerId,
              epoch: task.epoch,
              taskId,
              cursor: task.cursor,
            }),
          );
          const snapshot = object(r.task);
          if (
            snapshot.taskId !== taskId ||
            typeof snapshot.state !== "string" ||
            !Array.isArray(r.events) ||
            !Number.isSafeInteger(r.cursor) ||
            typeof r.hasMore !== "boolean"
          )
            throw new Error("Invalid sync response");
          let seq = task.cursor;
          const events = r.events.map((raw) => {
            const e = object(raw);
            if (!Number.isSafeInteger(e.seq) || e.seq !== ++seq || !("event" in e))
              throw new Error("Noncontiguous remote transcript");
            return e as RemoteEvent;
          });
          if (r.cursor !== seq || (r.hasMore && !events.length)) throw new Error("Invalid sync cursor");
          task.events.push(...events);
          task.cursor = seq;
          // A stale owner snapshot must not erase an already observed terminal result.
          if (
            !task.task ||
            !["done", "failed", "cancelled", "stopped"].includes(task.task.state) ||
            task.task.state === snapshot.state
          )
            task.task = snapshot as Task;
          task.outcome = "accepted";
          task.lastSync = new Date().toISOString();
          delete task.lastError;
          await this.save(state);
          if (!r.hasMore) return task;
        }
        throw new Error("Remote pagination limit reached; cached pages retained");
      } catch (error) {
        task.lastError = String(error);
        await this.save(state);
        throw error;
      }
    });
  }
  async transcript(taskId: string): Promise<RemoteTask> {
    const task = (await this.read()).tasks[taskId];
    if (!task) throw new Error("Unknown remote task");
    return task;
  }
}
