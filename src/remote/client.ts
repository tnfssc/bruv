import { serviceRemoteTask } from "./services";
import { Database } from "bun:sqlite";
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
  overrides?: { model?: string; thinking?: string };
  cursor: number;
  transcriptComplete?: boolean;
  events: RemoteEvent[];
  task?: Task;
  outcome: "unknown" | "accepted";
  lastSync?: string;
  lastError?: string;
  repository?: unknown;
  localArtifacts?: unknown;
  artifactsComplete?: boolean;
  integrationError?: string;
  cancelRequested?: boolean;
  /** Durable local intent is separate from delivery and observed terminal state. */
  cancelDelivery?: { status: "requested" | "uncertain" | "confirmed"; error?: string };
  replyDelivery?: Record<string, { replyId: string; status: "uncertain" | "delivered"; error?: string }>;
  replies?: Record<
    string,
    { id: string; owner: { sessionId: string; branchId: string }; version: number; text: string; replyId: string }
  >;
};
export type RemoteState = {
  connection?: { host: string; diePath: string; hello: Hello };
  tasks: Record<string, RemoteTask>;
};
export type Transport = (host: string, diePath: string, request: Record<string, unknown>) => Promise<unknown>;
export { sshTransport } from "./ssh";
import { sshTransport, validHost, validPath } from "./ssh";
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid remote response");
  const result = value as Record<string, unknown>;
  if (typeof result.error === "string" && typeof result.code === "string") throw new Error(result.error);
  return result;
}
function hello(value: unknown, requireModel = true): Hello {
  const h = object(value),
    p = object(h.profile);
  if (requireModel && !p.model)
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
    h.platform !== "linux" ||
    p.name !== "normal" ||
    (typeof p.model !== "string" && !(p.model === undefined && !requireModel)) ||
    !["configured", "missing", "unknown"].includes(String(p.auth)) ||
    (p.thinking !== undefined && typeof p.thinking !== "string")
  )
    throw new Error("Unsupported remote hello");
  return { ...h, profile: { ...p, model: p.model ?? "" } } as Hello;
}
const MAX_CACHE_BYTES = 128 * 1024 * 1024;

export function remoteStatePath(): string {
  return join(homedir(), ".die", "remote", "state.json");
}
export class RemoteClient {
  private queue: Promise<unknown> = Promise.resolve();
  private syncOffset = 0;
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
  launch(
    repoPath: string,
    prompt: string,
    taskId?: string,
    overrides?: { model?: string; thinking?: string },
  ): Promise<RemoteTask> {
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
          (t) =>
            t.host === c.host &&
            t.repoPath === repoPath &&
            t.prompt === prompt &&
            (t.outcome === "unknown" || t.transcriptComplete === false || t.task?.state !== "done"),
        );
        if (uncertain)
          throw new Error(
            "An identical launch has unknown outcome or is still active: " +
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
          task.prompt !== prompt ||
          JSON.stringify(task.overrides ?? {}) !== JSON.stringify(overrides ?? {})
        )
          throw new Error("Task ID is pinned to a different owner or intent; refusal to retry");
        if (task.outcome === "accepted") return task;
      } else {
        if (Object.keys(state.tasks).length >= 100) throw new Error("Remote cache task limit (100) reached");
        task = {
          taskId,
          host: c.host,
          ownerId: c.hello.ownerId,
          epoch: c.hello.epoch,
          repoPath,
          prompt,
          overrides,
          cursor: 0,
          events: [],
          outcome: "unknown",
        };
        state.tasks[taskId] = task;
        await this.save(state); // before network, including first POST
      }
      try {
        // Recheck identity before retry. A lost reply is not permission to POST to a new owner.
        const current = hello(await this.transport(c.host, c.diePath, { op: "hello" }), false);
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
            ...overrides,
          }),
        );
        if (object(reply.task).taskId !== taskId) throw new Error("Invalid launch response task ID");
        delete task.lastError;
        task.task = object(reply.task) as Task;
        task.outcome = "accepted";
        task.transcriptComplete = false;
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
  private syncRaw(taskId: string): Promise<RemoteTask> {
    return this.exclusive(async () => {
      const state = await this.read(),
        task = state.tasks[taskId],
        c = state.connection;
      if (!task) throw new Error("Unknown remote task");
      try {
        if (!c || c.host !== task.host || c.hello.ownerId !== task.ownerId || c.hello.epoch !== task.epoch)
          throw new Error("Task belongs to another remote owner; cached transcript only");
        const current = hello(await this.transport(c.host, c.diePath, { op: "hello" }), false);
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
          task.transcriptComplete = !r.hasMore;
          // A stale owner snapshot must not erase an already observed terminal result.
          if (
            !task.task ||
            !["done", "failed", "cancelled", "stopped"].includes(task.task.state) ||
            task.task.state === snapshot.state
          )
            task.task = snapshot as Task;
          const reply = snapshot.reply as { replyId?: string; status?: string } | undefined;
          if (reply && (reply.status === "delivered" || reply.status === "uncertain")) {
            for (const [id, intent] of Object.entries(task.replies ?? {}))
              if (intent.replyId === reply.replyId) {
                task.replyDelivery ??= {};
                task.replyDelivery[id] = { replyId: intent.replyId, status: reply.status };
              }
          }
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
  async control(request: Record<string, unknown>, expected?: { ownerId: string; epoch: string }): Promise<unknown> {
    return this.exclusive(async () => {
      const state = await this.read(),
        c = state.connection;
      if (!c) throw Error("Use /remote connect first");
      const task = typeof request.taskId === "string" ? state.tasks[request.taskId] : undefined;
      const identity = expected ?? task ?? c.hello;
      if (c.hello.ownerId !== identity.ownerId || c.hello.epoch !== identity.epoch || (task && task.host !== c.host))
        throw Error("Remote owner changed; no request sent");
      const current = hello(await this.transport(c.host, c.diePath, { op: "hello" }), false);
      if (current.ownerId !== identity.ownerId || current.epoch !== identity.epoch)
        throw Error("Remote owner changed; outcome unknown");
      return object(
        await this.transport(c.host, c.diePath, { ...request, ownerId: identity.ownerId, epoch: identity.epoch }),
      );
    });
  }
  async updateTask(
    taskId: string,
    changes: Pick<
      RemoteTask,
      "repository" | "integrationError" | "cancelRequested" | "localArtifacts" | "artifactsComplete"
    >,
  ): Promise<void> {
    return this.exclusive(async () => {
      const state = await this.read();
      const task = state.tasks[taskId];
      if (!task) throw Error("Unknown remote task");
      Object.assign(task, changes);
      await this.save(state);
    });
  }
  async sync(taskId: string): Promise<RemoteTask> {
    const task = await this.syncRaw(taskId);
    try {
      await serviceRemoteTask(this, task);
    } catch (error) {
      await this.updateTask(taskId, { integrationError: String(error) });
    }
    return this.transcript(taskId);
  }
  async cancel(taskId: string): Promise<RemoteTask> {
    await this.exclusive(async () => {
      const state = await this.read();
      const task = state.tasks[taskId];
      if (!task) throw Error("Unknown remote task");
      task.cancelRequested = true; // Preserve intent even when delivery is refused or offline.
      task.cancelDelivery ??= { status: "requested" };
      await this.save(state);
      if (task.cancelDelivery.status === "confirmed") return;
      const c = state.connection;
      if (!c || c.host !== task.host || c.hello.ownerId !== task.ownerId || c.hello.epoch !== task.epoch) {
        task.cancelDelivery = {
          status: task.cancelDelivery.status,
          error: "Pinned owner unavailable; no new cancel sent",
        };
        await this.save(state);
        throw Error("Pinned owner unavailable; no cancel sent; local cancellation intent retained");
      }
      let current: Hello;
      try {
        current = hello(await this.transport(c.host, c.diePath, { op: "hello" }), false);
      } catch (error) {
        task.cancelDelivery = { status: task.cancelDelivery.status, error: String(error) };
        await this.save(state);
        throw Error("Cannot verify pinned owner; no cancel sent; local cancellation intent retained: " + String(error));
      }
      if (current.ownerId !== task.ownerId || current.epoch !== task.epoch) {
        task.cancelDelivery = { status: task.cancelDelivery.status, error: "Remote owner changed; no new cancel sent" };
        await this.save(state);
        throw Error("Remote owner changed; no cancel sent; local cancellation intent retained");
      }
      task.cancelDelivery = { status: "uncertain" };
      await this.save(state); // A lost response must not look like confirmation.
      try {
        const response = object(
          await this.transport(c.host, c.diePath, {
            op: "cancel",
            taskId,
            ownerId: task.ownerId,
            epoch: task.epoch,
          }),
        );
        if (object(response.task).taskId !== taskId) throw Error("Invalid cancel acknowledgement");
      } catch (error) {
        task.cancelDelivery = { status: "uncertain", error: String(error) };
        await this.save(state);
        throw Error("Cancellation delivery uncertain; retry on the same pinned owner: " + String(error));
      }
      task.cancelDelivery = { status: "confirmed" };
      await this.save(state);
    });
    return this.sync(taskId);
  }
  answer(
    taskId: string,
    input: {
      id: string;
      owner: { sessionId: string; branchId: string };
      version: number;
      text: string;
      replyId?: string;
    },
  ): Promise<RemoteTask> {
    return this.exclusive(async () => {
      const state = await this.read();
      const task = state.tasks[taskId],
        connection = state.connection;
      if (
        !task ||
        !connection ||
        task.host !== connection.host ||
        task.ownerId !== connection.hello.ownerId ||
        task.epoch !== connection.hello.epoch
      )
        throw new Error("Remote question belongs to another owner; no answer sent");
      if (!input.text?.trim() || Buffer.byteLength(input.text) > 16_384) throw new Error("Invalid answer");
      if (!task.replies) task.replies = {};
      const prior = task.replies[input.id];
      const reply = { ...input, replyId: input.replyId ?? prior?.replyId ?? randomUUID() };
      if (prior && JSON.stringify(prior) !== JSON.stringify(reply))
        throw new Error("Conflicting or uncertain reply; cannot replace it");
      if (!prior) {
        const question = (
          task.task?.questions as
            | Array<{ id: string; owner: typeof input.owner; version: number; status: string }>
            | undefined
        )?.find((q) => q.id === input.id);
        if (
          !question ||
          question.status !== "pending" ||
          question.version !== input.version ||
          question.owner?.sessionId !== input.owner?.sessionId ||
          question.owner?.branchId !== input.owner?.branchId
        )
          throw new Error("Question owner/version is stale; sync before answering");
      }
      task.replies[input.id] = reply;
      task.replyDelivery ??= {};
      task.replyDelivery[input.id] = { replyId: reply.replyId, status: "uncertain" };
      await this.save(state); // preserve reply identity before SSH; lost responses are uncertain
      try {
        const current = hello(await this.transport(connection.host, connection.diePath, { op: "hello" }), false);
        if (current.ownerId !== task.ownerId || current.epoch !== task.epoch) throw new Error("Remote owner changed");
        const response = object(
          await this.transport(connection.host, connection.diePath, {
            op: "answer",
            ownerId: task.ownerId,
            epoch: task.epoch,
            taskId,
            ...reply,
          }),
        );
        const receipt = object(response.task).reply as { replyId?: string; status?: string } | undefined;
        if (receipt?.replyId === reply.replyId && receipt.status === "delivered")
          task.replyDelivery[input.id] = { replyId: reply.replyId, status: "delivered" };
        delete task.lastError;
      } catch (error) {
        task.lastError = "Native reply outcome uncertain: " + String(error);
        task.replyDelivery[input.id] = { replyId: reply.replyId, status: "uncertain", error: String(error) };
        await this.save(state);
        throw new Error(task.lastError + "; retry only this question with the same replyId");
      }
      await this.save(state);
      return task;
    });
  }
  /** Bounded refresh; one failed task does not prevent others from updating. */
  async syncActive(limit = 10): Promise<void> {
    const state = await this.read();
    const active = Object.values(state.tasks).filter(
      (t) =>
        t.task?.state === "accepted" ||
        t.task?.state === "running" ||
        t.outcome === "unknown" ||
        t.transcriptComplete === false ||
        t.artifactsComplete === false ||
        (!!t.integrationError && t.task?.state === "done"),
    );
    const batch = Array.from(
      { length: Math.min(active.length, Math.max(0, Math.min(10, limit))) },
      (_, i) => active[(this.syncOffset + i) % active.length]!,
    );
    this.syncOffset = active.length ? (this.syncOffset + batch.length) % active.length : 0;
    for (const task of batch) {
      try {
        await this.sync(task.taskId);
      } catch {
        /* lastError remains available in the cache */
      }
    }
  }
  async transcript(taskId: string): Promise<RemoteTask> {
    const task = (await this.read()).tasks[taskId];
    if (!task) throw new Error("Unknown remote task");
    return task;
  }
}
