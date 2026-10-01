import { utf8SafeSlice, type TaskManager, type TaskSummary } from "./task-manager";
import { isSshJobId, type RemoteJobsAdapter, type SshJob } from "../remote/jobs";

/** A read projection, not another task registry or completion consumer. */
export type MonitorTask = Omit<TaskSummary, "kind" | "status"> & {
  kind: TaskSummary["kind"] | "ssh";
  status: TaskSummary["status"] | "unknown" | "cancelled";
  monitorIdentity?: string;
  ssh?: SshJob;
  monitorNote?: string;
};
export interface TaskMonitorSource {
  list(): MonitorTask[];
  inspect(id: string, offset: number, limit: number): { output: string };
  kill(id: string): unknown;
  subscribe(listener: () => void): () => void;
  notice?: string;
}
const CACHE_BYTES = 5000;
const REFRESH_MS = 1000;
function boundedOutput(output: string, limit: number): string {
  const bytes = Buffer.from(output);
  const safe = utf8SafeSlice(bytes, Math.max(0, Math.min(CACHE_BYTES, limit)));
  return bytes.subarray(safe.start, safe.end).toString("utf8");
}
const identity = (job: SshJob) => JSON.stringify([job.id, job.host, job.ownerId, job.epoch]);
export const monitorActive = (task: MonitorTask) => task.status === "running" || task.status === "unknown";

/** One panel owns this adapter. Remote APIs read their existing cache; only stop contacts SSH. */
export class MergedTaskMonitorSource implements TaskMonitorSource {
  private remoteTasks: SshJob[] = [];
  private outputs = new Map<string, { identity: string; output: string; at: number; note?: string }>();
  private inspecting = new Set<string>();
  private stopping = new Set<string>();
  private stopNotes = new Map<string, string>();
  private listeners = new Set<() => void>();
  private disposed = false;
  private refreshing = false;
  private timer: ReturnType<typeof setInterval>;
  private unsubscribe: () => void;
  notice?: string;

  constructor(
    private local: TaskManager,
    private remote: RemoteJobsAdapter,
    private sessionFile?: string,
  ) {
    this.notice = sessionFile
      ? "SSH observations loading (cache only)."
      : "SSH jobs unavailable without a durable session.";
    this.unsubscribe = local.subscribe(() => this.changed());
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref?.();
    void this.refresh();
  }
  private changed() {
    if (!this.disposed) for (const listener of this.listeners) listener();
  }
  subscribe(listener: () => void) {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  async refresh(): Promise<void> {
    if (this.disposed || this.refreshing || !this.sessionFile) return;
    this.refreshing = true;
    try {
      const tasks = await this.remote.list(this.sessionFile);
      if (this.disposed) return;
      for (const task of tasks) {
        const prior = this.remoteTasks.find((job) => job.id === task.id);
        if (prior && identity(prior) !== identity(task)) this.stopNotes.delete(task.id);
      }
      this.remoteTasks = tasks;
      for (const [id, cached] of this.outputs) {
        if (!tasks.some((task) => task.id === id && identity(task) === cached.identity)) this.outputs.delete(id);
      }
      for (const id of this.stopNotes.keys()) if (!tasks.some((task) => task.id === id)) this.stopNotes.delete(id);
      this.notice = undefined;
    } catch (error) {
      // Retain last observations: a failed cache read is not a task failure.
      if (!this.disposed) this.notice = "SSH cache read unavailable; prior observations retained: " + String(error);
    } finally {
      this.refreshing = false;
      this.changed();
    }
  }
  list(): MonitorTask[] {
    return [
      ...this.local.list(),
      ...this.remoteTasks.map(
        (job): MonitorTask => ({
          id: job.id,
          kind: "ssh",
          status: job.status,
          command: job.host,
          cwd: job.host,
          startedAt: "",
          baseOffset: 0,
          outputEnd: Buffer.byteLength(this.outputs.get(job.id)?.output ?? ""),
          timedOut: false,
          monitorIdentity: identity(job),
          ssh: job,
          monitorNote: this.stopNotes.get(job.id) ?? this.outputs.get(job.id)?.note,
        }),
      ),
    ];
  }
  inspect(id: string, offset: number, limit: number): { output: string } {
    const job = this.remoteTasks.find((task) => task.id === id);
    if (!job) return isSshJobId(id) ? { output: "" } : this.local.inspect(id, offset, limit);
    const cached = this.outputs.get(id);
    if (!cached || Date.now() - cached.at >= REFRESH_MS) void this.readOutput(job);
    // SSH inspect has no tail index: keep a single bounded first page, never walk the transcript.
    return { output: boundedOutput(cached?.output ?? "", limit) };
  }
  private async readOutput(job: SshJob) {
    if (this.disposed || this.inspecting.has(job.id) || !this.sessionFile) return;
    this.inspecting.add(job.id);
    try {
      const result = await this.remote.inspect(this.sessionFile, job.id, 0, CACHE_BYTES);
      if (
        this.disposed ||
        !this.remoteTasks.some((task) => identity(task) === identity(job)) ||
        identity(result) !== identity(job)
      )
        return;
      this.outputs.set(job.id, {
        identity: identity(job),
        output: boundedOutput(result.output, CACHE_BYTES),
        at: Date.now(),
        note: result.outputLost
          ? "Cached transcript has gaps."
          : result.hasMore
            ? "More cached output exists; showing first bounded page."
            : undefined,
      });
    } catch (error) {
      if (!this.disposed && this.remoteTasks.some((task) => identity(task) === identity(job))) {
        this.outputs.set(job.id, {
          identity: identity(job),
          output: this.outputs.get(job.id)?.output ?? "",
          at: Date.now(),
          note: "SSH cached output unavailable: " + String(error),
        });
      }
    } finally {
      this.inspecting.delete(job.id);
      this.changed();
    }
  }
  kill(id: string): unknown {
    const job = this.remoteTasks.find((task) => task.id === id);
    if (!job) return isSshJobId(id) ? undefined : this.local.kill(id);
    return this.stop(job);
  }
  private async stop(job: SshJob) {
    if (this.disposed || this.stopping.has(job.id) || !this.sessionFile) return;
    this.stopping.add(job.id);
    this.stopNotes.set(job.id, "SSH stop request in flight; not stopped.");
    this.changed();
    try {
      // Revalidate the frozen ownership against the session-scoped cache before issuing stop.
      const current = (await this.remote.list(this.sessionFile)).find((task) => task.id === job.id);
      if (this.disposed) return;
      if (!current || identity(current) !== identity(job)) throw new Error("SSH ownership changed; stop not sent");
      if (current.status !== "running" && current.status !== "unknown") {
        this.remoteTasks = this.remoteTasks.map((task) => (task.id === job.id ? current : task));
        this.stopNotes.delete(job.id);
        return;
      }
      const result = await this.remote.stop(this.sessionFile, job.id);
      if (this.disposed) return;
      if (!this.remoteTasks.some((task) => identity(task) === identity(job))) return;
      if (identity(result) !== identity(job)) throw new Error("SSH ownership changed while stopping");
      this.remoteTasks = this.remoteTasks.map((task) => (task.id === job.id ? result : task));
      this.stopNotes.set(
        job.id,
        result.status === "running" || result.status === "unknown"
          ? "SSH cancellation pending (" + (result.cancelDelivery ?? "unconfirmed") + "); not stopped."
          : "SSH terminal state observed: " + result.status,
      );
    } catch (error) {
      if (!this.disposed && this.remoteTasks.some((task) => identity(task) === identity(job)))
        this.stopNotes.set(job.id, "SSH stop error; not confirmed stopped: " + String(error));
    } finally {
      this.stopping.delete(job.id);
      this.changed();
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.timer);
    this.unsubscribe();
    this.listeners.clear();
    this.outputs.clear();
  }
}
