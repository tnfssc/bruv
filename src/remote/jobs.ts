import type { RemoteClient, RemoteTask } from "./client";

/** SSH task IDs cannot collide with local or native task IDs. */
export function sshJobId(taskId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(taskId)) throw new Error("Invalid SSH task ID");
  return "ssh:" + Buffer.from(taskId, "utf8").toString("base64url");
}
export function sshTaskId(id: string): string {
  if (!id.startsWith("ssh:")) throw new Error("Not an SSH job ID");
  const value = Buffer.from(id.slice(4), "base64url").toString("utf8");
  if (sshJobId(value) !== id) throw new Error("Invalid SSH job ID");
  return value;
}
export function isSshJobId(id: string): boolean { return id.startsWith("ssh:"); }

export type SshJob = {
  id: string;
  kind: "ssh";
  source: "ssh";
  status: "running" | "completed" | "failed" | "cancelled" | "unknown";
  remoteState?: string;
  observedAt?: string;
  stale: true;
  outcome: "accepted" | "unknown";
  cancelRequested?: boolean;
  lastError?: string;
  host: string;
  ownerId: string;
  epoch: string;
};
export interface RemoteJobsAdapter {
  list(sessionFile: string): Promise<SshJob[]>;
  inspect(sessionFile: string, id: string, offset?: number, limit?: number): Promise<SshJob & { output: string; requestedOffset: number; nextOffset: number; hasMore: boolean; outputLost: boolean }>;
  stop(sessionFile: string, id: string): Promise<SshJob & { cancellationRequested: boolean }>;
  stopWork(sessionFile: string): Promise<{ outcome: "acknowledged" | "pending" | "partial"; discoveryComplete: boolean; discoveryError?: string; jobs: Array<{ id: string; kind: "ssh"; outcome: "pending" | "finished" | "error"; status?: string; error?: string }> }>;
}
function project(task: RemoteTask): SshJob {
  const state = task.task?.state;
  const status = state === "done" ? (task.task?.error ? "failed" : "completed") : state === "cancelled" ? "cancelled" : (state === "accepted" || state === "running") && !task.lastError ? "running" : "unknown";
  return { id: sshJobId(task.taskId), kind: "ssh", source: "ssh", status,
    ...(state ? { remoteState: state } : {}), ...(task.lastSync ? { observedAt: task.lastSync } : {}),
    stale: true, outcome: task.outcome, ...(task.cancelRequested ? { cancelRequested: true } : {}),
    ...(task.lastError ? { lastError: task.lastError } : {}), host: task.host, ownerId: task.ownerId, epoch: task.epoch };
}
export function createRemoteJobsAdapter(client: RemoteClient): RemoteJobsAdapter {
  async function owned(sessionFile: string): Promise<RemoteTask[]> {
    if (!sessionFile) throw new Error("SSH jobs require a durable parent session");
    const state = await client.read();
    return Object.values(state.tasks).filter((task) => task.jobSessionFile === sessionFile && !!task.ownerId && !!task.epoch)
      .sort((a, b) => a.taskId.localeCompare(b.taskId));
  }
  async function find(sessionFile: string, id: string): Promise<RemoteTask> {
    const taskId = sshTaskId(id);
    const task = (await owned(sessionFile)).find((task) => task.taskId === taskId);
    if (!task) throw new Error("Unknown SSH job in this session");
    return task;
  }
  return {
    async list(sessionFile) { return (await owned(sessionFile)).map(project); },
    async inspect(sessionFile, id, offset = 0, limit = 5000) {
      const task = await find(sessionFile, id);
      const { utf8SafeSlice } = await import("../tasks/task-manager");
      const pieces: Buffer[] = [];
      let position = 0;
      for (let i = 0; i < task.events.length; i++) {
        const entry = Buffer.from((i ? "\n" : "") + JSON.stringify(task.events[i]!.event));
        if (position + entry.length > offset && position < offset + limit + 3)
          pieces.push(entry.subarray(Math.max(0, offset - position), Math.min(entry.length, offset + limit + 3 - position)));
        position += entry.length;
      }
      const safe = utf8SafeSlice(Buffer.concat(pieces), limit);
      const nextOffset = offset + safe.end;
      return { ...project(task), output: Buffer.concat(pieces).subarray(safe.start, safe.end).toString("utf8"),
        requestedOffset: offset, nextOffset, hasMore: nextOffset < position, outputLost: safe.start > 0 };
    },
    async stop(sessionFile, id) {
      await find(sessionFile, id);
      // cancel() records intent before contacting SSH. A failure is not an acknowledgement.
      const task = await client.cancel(sshTaskId(id));
      return { ...project(task), cancellationRequested: true };
    },
    async stopWork(sessionFile) {
      let tasks: RemoteTask[];
      try { tasks = await owned(sessionFile); }
      catch (error) { return { outcome: "partial", discoveryComplete: false, discoveryError: String(error), jobs: [] }; }
      const jobs: Array<{ id: string; kind: "ssh"; outcome: "pending" | "finished" | "error"; status?: string; error?: string }> = [];
      for (const task of tasks) {
        const id = sshJobId(task.taskId);
        if (task.task?.state === "done") continue;
        try { const stopped = await client.cancel(task.taskId);
          jobs.push({ id, kind: "ssh", outcome: stopped.task?.state === "done" ? "finished" : "pending", status: project(stopped).status });
        } catch (error) { jobs.push({ id, kind: "ssh", outcome: "error", error: String(error) }); }
      }
      return { outcome: jobs.some((job) => job.outcome === "error") ? "partial" : jobs.some((job) => job.outcome === "pending") ? "pending" : "acknowledged", discoveryComplete: true, jobs };
    },
  };
}
