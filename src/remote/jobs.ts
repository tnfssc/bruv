import type { RemoteClient, RemoteTask } from "./client";
import { launchRepository } from "./repository-wire";
import { canDelegate, SUBAGENT_TYPES } from "../tasks/subagent-profiles";
import type { WorkspaceRequest } from "../tasks/worktree-workspace";

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
export function isSshJobId(id: string): boolean {
  return id.startsWith("ssh:");
}

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
  transcriptGap?: boolean;
  transcriptComplete?: boolean;
  cancelDelivery?: string;
  /** Normal placement name; "ssh:local" disambiguates the reserved runtime name. */
  target: string;
  workspace?: unknown;
  provenance?: unknown;
  host: string;
  ownerId: string;
  epoch: string;
};
export type SshLaunchRequest = {
  target: string;
  jobSessionFile: string;
  jobQuestionOwner?: { sessionId: string; branchId: string };
  localRoot: string;
  prompt: string;
  taskId: string;
  model?: string;
  thinking?: string;
  placement: {
    profile: "fast" | "normal" | "orchestrator";
    parentDepth: number;
    parentType?: "fast" | "normal" | "orchestrator";
    workspace: WorkspaceRequest;
  };
};
export type SshLaunchResult = SshJob & {
  output: string;
  background: true;
};
export type RepositoryLauncher = (client: RemoteClient, args: Omit<SshLaunchRequest, "target">) => Promise<RemoteTask>;
export interface RemoteJobsAdapter {
  launch(request: SshLaunchRequest): Promise<SshLaunchResult>;
  list(sessionFile: string): Promise<SshJob[]>;
  inspect(
    sessionFile: string,
    id: string,
    offset?: number,
    limit?: number,
  ): Promise<
    SshJob & { output: string; requestedOffset: number; nextOffset: number; hasMore: boolean; outputLost: boolean }
  >;
  stop(sessionFile: string, id: string): Promise<SshJob & { cancellationRequested: boolean }>;
  stopWork(sessionFile: string): Promise<{
    outcome: "acknowledged" | "pending" | "partial";
    discoveryComplete: boolean;
    discoveryError?: string;
    jobs: Array<{
      id: string;
      kind: "ssh";
      outcome: "pending" | "finished" | "error";
      status?: string;
      error?: string;
    }>;
  }>;
}
function project(task: RemoteTask): SshJob {
  const state = task.task?.state;
  const status =
    state === "done"
      ? task.task?.error
        ? "failed"
        : "completed"
      : state === "cancelled"
        ? "cancelled"
        : (state === "accepted" || state === "running") && !task.lastError
          ? "running"
          : "unknown";
  return {
    id: sshJobId(task.taskId),
    kind: "ssh",
    source: "ssh",
    status,
    ...(state ? { remoteState: state } : {}),
    ...(task.lastSync ? { observedAt: task.lastSync } : {}),
    stale: true,
    outcome: task.outcome,
    ...(task.cancelRequested ? { cancelRequested: true } : {}),
    ...(task.lastError ? { lastError: task.lastError } : {}),
    ...(task.transcriptComplete !== undefined ? { transcriptComplete: task.transcriptComplete } : {}),
    ...(task.cancelDelivery ? { cancelDelivery: task.cancelDelivery.status } : {}),
    ...(task.events.some((event, index) => index > 0 && event.seq !== task.events[index - 1]!.seq + 1) ||
    (task.events[0]?.seq ?? 1) > 1
      ? { transcriptGap: true }
      : {}),
    target: task.host === "local" ? "ssh:local" : task.host,
    ...(task.repository ? { provenance: task.repository } : {}),
    host: task.host,
    ownerId: task.ownerId,
    epoch: task.epoch,
  };
}
export function createRemoteJobsAdapter(
  client: RemoteClient,
  repositoryLauncher: RepositoryLauncher = launchRepository,
): RemoteJobsAdapter {
  async function owned(sessionFile: string): Promise<RemoteTask[]> {
    if (!sessionFile) throw new Error("SSH jobs require a durable parent session");
    const state = await client.read();
    return Object.values(state.tasks)
      .filter((task) => task.jobSessionFile === sessionFile && !!task.ownerId && !!task.epoch)
      .sort((a, b) => (a.jobSequence ?? 0) - (b.jobSequence ?? 0) || a.taskId.localeCompare(b.taskId));
  }
  async function find(sessionFile: string, id: string): Promise<RemoteTask> {
    const taskId = sshTaskId(id);
    const task = (await owned(sessionFile)).find((task) => task.taskId === taskId);
    if (!task) throw new Error("Unknown SSH job in this session");
    return task;
  }
  return {
    async launch(request) {
      const { profile, parentDepth, parentType, workspace } = request.placement;
      // Defense in depth for callers other than JobService. Check delegation
      // before looking at any target/connection or performing repository work.
      if (!Number.isSafeInteger(parentDepth) || parentDepth < 0 || parentDepth >= 2)
        throw new Error("Delegation is limited to two levels below the root");
      if (!canDelegate(parentDepth, parentType)) throw new Error("Only orchestrator agents can delegate");
      if (!SUBAGENT_TYPES.includes(profile)) throw new Error("Invalid subagent profile");
      if (parentDepth > 0 && profile === "orchestrator")
        throw new Error("Spawned orchestrators may only delegate to fast/normal workers");
      if (!request.jobSessionFile) throw new Error("SSH jobs require a durable parent session");
      sshJobId(request.taskId); // Validate before filesystem or transport work.
      const state = await client.read();
      const connection = state.connection;
      if (!connection) throw new Error("SSH placement requires an already human-pinned /remote connection");
      const authorizedTarget = connection.host === "local" ? "ssh:local" : connection.host;
      if (request.target !== authorizedTarget)
        throw new Error("SSH target must match the already human-pinned connection.host: " + authorizedTarget);
      const existing = state.tasks[request.taskId];
      const assertOwner = (task: RemoteTask) => {
        if (
          task.taskId !== request.taskId ||
          task.jobSessionFile !== request.jobSessionFile ||
          task.host !== connection.host ||
          task.ownerId !== connection.hello.ownerId ||
          task.epoch !== connection.hello.epoch ||
          JSON.stringify(task.jobQuestionOwner) !== JSON.stringify(request.jobQuestionOwner)
        )
          throw new Error("SSH launch identity/parent ownership conflict");
      };
      if (existing) assertOwner(existing);
      // Explicit allowlist: even an untyped caller cannot smuggle a human-only
      // approvedUntracked list or backend authority fields into repository transfer.
      const args: Omit<SshLaunchRequest, "target"> = {
        jobSessionFile: request.jobSessionFile,
        localRoot: request.localRoot,
        prompt: request.prompt,
        taskId: request.taskId,
        ...(request.model === undefined ? {} : { model: request.model }),
        ...(request.thinking === undefined ? {} : { thinking: request.thinking }),
        placement: { profile, parentDepth, ...(parentType === undefined ? {} : { parentType }), workspace },
      };
      let task: RemoteTask;
      try {
        // No approvedUntracked argument exists on this agent-facing contract.
        // Destination profiles are resolved by the server, never this laptop.
        task = await repositoryLauncher(client, args);
      } catch (error) {
        const retained = (await client.read()).tasks[request.taskId];
        if (!retained) {
          // Preparation may have an uncertain durable repository descriptor even
          // before a task record. Expose the reserved ID; retries reuse it.
          throw new Error(
            "SSH launch failed or unconfirmed; retained task ID: " + sshJobId(request.taskId) + "; " + String(error),
            { cause: error },
          );
        }
        assertOwner(retained);
        // Only uncertain transport outcomes are results. A deterministic conflict
        // or policy rejection must not be disguised as a successful replay.
        if (retained.outcome !== "unknown" || !/outcome unknown/i.test(String(error))) throw error;
        task = retained;
      }
      assertOwner(task);
      return {
        ...project(task),
        output: "",
        background: true,
        provenance: task.repository ?? { kind: "snapshot", history: "snapshot-only" },
        workspace: {
          kind: workspace.kind,
          path: task.repoPath,
          source: "snapshot",
          history: "snapshot-only",
          ...(workspace.kind === "worktree" && workspace.baseRef ? { requestedBaseRef: workspace.baseRef } : {}),
          ...(workspace.kind === "worktree" && workspace.branch ? { requestedBranch: workspace.branch } : {}),
        },
      };
    },
    async list(sessionFile) {
      return (await owned(sessionFile)).map(project);
    },
    async inspect(sessionFile, id, offset = 0, limit = 5000) {
      const task = await find(sessionFile, id);
      const { utf8SafeSlice } = await import("../tasks/task-manager");
      const pieces: Buffer[] = [];
      let position = 0;
      for (let i = 0; i < task.events.length; i++) {
        const entry = Buffer.from((i ? "\n" : "") + JSON.stringify(task.events[i]!.event));
        if (position + entry.length > offset && position < offset + limit + 3)
          pieces.push(
            entry.subarray(Math.max(0, offset - position), Math.min(entry.length, offset + limit + 3 - position)),
          );
        position += entry.length;
      }
      const safe = utf8SafeSlice(Buffer.concat(pieces), limit);
      const nextOffset = offset + safe.end;
      return {
        ...project(task),
        output: Buffer.concat(pieces).subarray(safe.start, safe.end).toString("utf8"),
        requestedOffset: offset,
        nextOffset,
        hasMore: nextOffset < position,
        outputLost:
          safe.start > 0 ||
          offset > position ||
          (task.events[0]?.seq ?? 1) > 1 ||
          task.events.some((event, index) => index > 0 && event.seq !== task.events[index - 1]!.seq + 1),
      };
    },
    async stop(sessionFile, id) {
      const current = await find(sessionFile, id);
      if (current.task?.state === "done" || current.task?.state === "cancelled")
        return { ...project(current), cancellationRequested: false };
      if (current.cancelDelivery?.status === "confirmed") return { ...project(current), cancellationRequested: true };
      // cancel() records intent before contacting SSH. A failure is not an acknowledgement.
      const task = await client.cancel(sshTaskId(id));
      return { ...project(task), cancellationRequested: true };
    },
    async stopWork(sessionFile) {
      let tasks: RemoteTask[];
      try {
        tasks = await owned(sessionFile);
      } catch (error) {
        return { outcome: "partial", discoveryComplete: false, discoveryError: String(error), jobs: [] };
      }
      const jobs: Array<{
        id: string;
        kind: "ssh";
        outcome: "pending" | "finished" | "error";
        status?: string;
        error?: string;
      }> = [];
      for (const task of tasks) {
        const id = sshJobId(task.taskId);
        if (task.task?.state === "done" || task.task?.state === "cancelled") continue;
        if (task.cancelDelivery?.status === "confirmed") {
          jobs.push({ id, kind: "ssh", outcome: "pending", status: project(task).status });
          continue;
        }
        try {
          const stopped = await client.cancel(task.taskId);
          jobs.push({
            id,
            kind: "ssh",
            outcome: stopped.task?.state === "done" || stopped.task?.state === "cancelled" ? "finished" : "pending",
            status: project(stopped).status,
          });
        } catch (error) {
          jobs.push({ id, kind: "ssh", outcome: "error", error: String(error) });
        }
      }
      return {
        outcome: jobs.some((job) => job.outcome === "error")
          ? "partial"
          : jobs.some((job) => job.outcome === "pending")
            ? "pending"
            : "acknowledged",
        discoveryComplete: true,
        jobs,
      };
    },
  };
}
