import { type QuestionContext, QuestionService } from "../questions/service";
import { canDelegate, SUBAGENT_TYPES } from "../tasks/subagent-profiles";
import type { WorkspaceRequest } from "../tasks/worktree-workspace";
import type { RemoteClient, RemoteState, RemoteTask } from "./client";
import type { RepositorySnapshot } from "./repository";
import { launchPreparedRepository, launchRepository } from "./repository-wire";
import { SourceApprovalService, type SourcePreparation, type SourceSelection } from "./source-approval";

/** SSH task IDs cannot collide with local or native task IDs. */
export function sshJobId(taskId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(taskId)) throw new Error("Invalid SSH task ID");
  return `ssh:${Buffer.from(taskId, "utf8").toString("base64url")}`;
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
  command?: string;
  title?: string;
  kind: "ssh";
  source: "ssh";
  status: "running" | "completed" | "failed" | "cancelled" | "unknown";
  remoteState?: string;
  observedAt?: string;
  stale: true;
  outcome: "accepted" | "unknown" | "not-dispatched";
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
  sourceApproval?: { taskId: string; questionId?: string; state: string; retry: string; omissionReason?: string };
};
export type SshLaunchRequest = {
  target: string;
  jobSessionFile: string;
  jobQuestionOwner?: { sessionId: string; branchId: string };
  localRoot: string;
  prompt: string;
  title?: string;
  taskId: string;
  source?: SourceSelection;
  model?: string;
  thinking?: string;
  placement: {
    profile: "fast" | "normal" | "orchestrator";
    nativeFast?: boolean;
    parentDepth: number;
    parentType?: "fast" | "normal" | "orchestrator";
    workspace: WorkspaceRequest;
  };
};
export type SshLaunchResult = SshJob & {
  output: string;
  background: true;
};
export type RepositoryLauncher = (
  client: RemoteClient,
  args: Omit<SshLaunchRequest, "target" | "source"> & {
    approvedUntracked?: string[];
    preparedSnapshot?: RepositorySnapshot;
    preparedSnapshotSha256?: string;
  },
) => Promise<RemoteTask>;
export interface RemoteJobsAdapter {
  /** Cached human-authorized destinations; never connects or changes authority. */
  targets?(): Promise<
    Array<{
      name: string;
      kind: "ssh";
      authorized: true;
      default: false;
      cached: true;
      modelSelection: "destination-profile";
    }>
  >;
  launch(request: SshLaunchRequest, approvalContext?: QuestionContext): Promise<SshLaunchResult>;
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
    command: task.title ?? task.prompt,
    ...(task.title ? { title: task.title } : {}),
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
    ...(task.events.some((event, index) => index > 0 && event.seq !== task.events[index - 1].seq + 1) ||
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
function assertLaunchOwner(
  task: RemoteTask,
  request: SshLaunchRequest,
  connection: NonNullable<RemoteState["connection"]>,
): void {
  if (
    task.taskId !== request.taskId ||
    task.jobSessionFile !== request.jobSessionFile ||
    task.host !== connection.host ||
    task.ownerId !== connection.hello.ownerId ||
    task.epoch !== connection.hello.epoch ||
    JSON.stringify(task.jobQuestionOwner) !== JSON.stringify(request.jobQuestionOwner)
  )
    throw new Error("SSH launch identity/parent ownership conflict");
}
export function createRemoteJobsAdapter(
  client: RemoteClient,
  repositoryLauncher: RepositoryLauncher = launchRepository,
  approvals = new SourceApprovalService(client.path, new QuestionService()),
): RemoteJobsAdapter {
  function projectPreparation(record: SourcePreparation): SshLaunchResult {
    return {
      id: sshJobId(record.intent.taskId),
      command: record.intent.title ?? record.intent.prompt,
      ...(record.intent.title ? { title: record.intent.title } : {}),
      kind: "ssh",
      source: "ssh",
      status: record.state === "cancelled" ? "cancelled" : "unknown",
      outcome: "not-dispatched",
      stale: true,
      target: record.intent.target,
      host: record.intent.target === "ssh:local" ? "local" : record.intent.target,
      ownerId: record.intent.ownerId,
      epoch: record.intent.epoch,
      output:
        record.omissionReason ??
        (record.state === "waiting"
          ? "Waiting for human source approval through /questions"
          : record.state === "cancelled"
            ? "Source handoff cancelled before dispatch"
            : "Pinned source approval saved; dispatch unconfirmed. Retry the same task ID."),
      background: true,
      sourceApproval: {
        taskId: record.intent.taskId,
        questionId: record.questionId,
        state: record.state,
        retry: `Retry the same subagent intent with source.retryTaskId=${record.intent.taskId}`,
        ...(record.omissionReason ? { omissionReason: record.omissionReason } : {}),
      },
      provenance: {
        kind: "snapshot",
        history: "snapshot-only",
        selectedUntracked: [],
        omittedUntracked: record.include.snapshot.omittedUntracked.concat(record.intent.includeUntracked),
      },
    };
  }
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
  // Resolve replay ownership and source approval before building transport arguments.
  async function prepareLaunchRequest(
    request: SshLaunchRequest,
    connection: NonNullable<RemoteState["connection"]>,
    tasks: RemoteState["tasks"],
    approvalContext?: QuestionContext,
  ): Promise<{ request: SshLaunchRequest; preparation?: SourcePreparation }> {
    const saved = approvals.get(request.jobSessionFile, request.taskId);
    // A retry keeps the original question owner, even if the parent branch moved.
    const ownedRequest = saved ? { ...request, jobQuestionOwner: saved.questionOwner } : request;
    const {
      source,
      placement: { workspace },
    } = ownedRequest;
    if (source && workspace.kind === "worktree" && workspace.baseRef !== undefined)
      throw Error("Untracked inclusion requires current-source snapshot, not an explicit baseRef");
    const existing = tasks[ownedRequest.taskId];
    if (existing) assertLaunchOwner(existing, ownedRequest, connection);
    if (!source && !saved) return { request: ownedRequest };
    if (!source || !approvalContext)
      throw Error("Source approval retry requires the original source selection and parent question context");
    if (source.retryTaskId && !saved) throw Error("Unknown source approval retry task ID in this parent session");
    if (source.retryTaskId && source.retryTaskId !== ownedRequest.taskId)
      throw Error("Source approval retry task ID conflict");
    if (existing && !saved) throw Error("Cannot add source inclusion to an already dispatched task");
    const preparation = await approvals.prepare(
      {
        taskId: ownedRequest.taskId,
        jobSessionFile: ownedRequest.jobSessionFile,
        localRoot: ownedRequest.localRoot,
        target: ownedRequest.target,
        ownerId: connection.hello.ownerId,
        epoch: connection.hello.epoch,
        prompt: ownedRequest.prompt,
        ...(ownedRequest.title === undefined ? {} : { title: ownedRequest.title }),
        placement: ownedRequest.placement,
        ...(ownedRequest.model === undefined ? {} : { model: ownedRequest.model }),
        ...(ownedRequest.thinking === undefined ? {} : { thinking: ownedRequest.thinking }),
        includeUntracked: source.includeUntracked,
      },
      approvalContext,
      Object.values(tasks).reduce((max, task) => Math.max(max, task.jobSequence ?? 0), 0),
    );
    return { request: { ...ownedRequest, jobQuestionOwner: preparation.questionOwner }, preparation };
  }
  return {
    async targets() {
      const { connection } = await client.read();
      return connection
        ? [
            {
              name: connection.host === "local" ? "ssh:local" : connection.host,
              kind: "ssh" as const,
              authorized: true as const,
              default: false as const,
              cached: true as const,
              modelSelection: "destination-profile" as const,
            },
          ]
        : [];
    },
    async launch(request, approvalContext) {
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
        throw new Error(`SSH target must match the already human-pinned connection.host: ${authorizedTarget}`);
      const { request: launchRequest, preparation } = await prepareLaunchRequest(
        request,
        connection,
        state.tasks,
        approvalContext,
      );
      if (preparation && preparation.state !== "ready") {
        const existing = state.tasks[launchRequest.taskId];
        return existing ? { ...project(existing), output: "", background: true } : projectPreparation(preparation);
      }
      // Only the durable human-owned source preflight may populate the trusted
      // snapshot arguments; untyped agent callers cannot smuggle these fields.
      const prepared = preparation
        ? {
            approvedUntracked: preparation.decision === "include" ? preparation.intent.includeUntracked : [],
            preparedSnapshot: approvals.snapshot(preparation),
            preparedSnapshotSha256:
              preparation.decision === "include" ? preparation.include.sha256 : preparation.omit.sha256,
          }
        : undefined;
      const args: Parameters<RepositoryLauncher>[1] = {
        jobSessionFile: launchRequest.jobSessionFile,
        jobQuestionOwner: launchRequest.jobQuestionOwner,
        localRoot: launchRequest.localRoot,
        prompt: launchRequest.prompt,
        ...(launchRequest.title === undefined ? {} : { title: launchRequest.title }),
        taskId: launchRequest.taskId,
        ...(launchRequest.model === undefined ? {} : { model: launchRequest.model }),
        ...(launchRequest.thinking === undefined ? {} : { thinking: launchRequest.thinking }),
        placement: { profile, parentDepth, ...(parentType === undefined ? {} : { parentType }), workspace },
        ...prepared,
      };
      let task: RemoteTask;
      try {
        // Source selection is a request, not an approval.
        // Destination profiles are resolved by the server, never this laptop.
        if (prepared && repositoryLauncher === launchRepository) {
          task = await launchPreparedRepository(client, { ...args, ...prepared });
        } else task = await repositoryLauncher(client, args);
      } catch (error) {
        const retained = (await client.read()).tasks[launchRequest.taskId];
        if (!retained) {
          // Preparation may have an uncertain durable repository descriptor even
          // before a task record. Expose the reserved ID; retries reuse it.
          throw new Error(
            "SSH launch failed or unconfirmed; retained task ID: " +
              sshJobId(launchRequest.taskId) +
              "; " +
              String(error),
            { cause: error },
          );
        }
        assertLaunchOwner(retained, launchRequest, connection);
        // Only uncertain transport outcomes are results. A deterministic conflict
        // or policy rejection must not be disguised as a successful replay.
        if (retained.outcome !== "unknown" || !/outcome unknown/i.test(String(error))) throw error;
        task = retained;
      }
      assertLaunchOwner(task, launchRequest, connection);
      if (approvals.get(launchRequest.jobSessionFile, launchRequest.taskId)?.state === "cancelled")
        task = await client.cancel(launchRequest.taskId);
      return {
        ...project(task),
        output: preparation?.omissionReason ?? "",
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
      const tasks = await owned(sessionFile);
      const preparations = approvals.list(sessionFile);
      // Keep the preflight's original position after acceptance. Otherwise a
      // pending approval becoming a remote task can move across a jobs cursor.
      const entries = tasks.map((task) => {
        const preparation = preparations.find((p) => p.intent.taskId === task.taskId);
        return {
          job: project(task),
          order: preparation
            ? [preparation.order.afterSequence, 1, preparation.order.ordinal]
            : [task.jobSequence ?? 0, 0, 0],
        };
      });
      for (const preparation of preparations) {
        if (tasks.some((task) => task.taskId === preparation.intent.taskId)) continue;
        entries.push({
          job: projectPreparation(preparation),
          order: [preparation.order.afterSequence, 1, preparation.order.ordinal],
        });
      }
      return entries
        .sort(
          (a, b) =>
            a.order[0] - b.order[0] ||
            a.order[1] - b.order[1] ||
            a.order[2] - b.order[2] ||
            a.job.id.localeCompare(b.job.id),
        )
        .map((entry) => entry.job);
    },
    async inspect(sessionFile, id, offset = 0, limit = 5000) {
      const preparation = approvals.get(sessionFile, sshTaskId(id));
      const dispatched = (await owned(sessionFile)).some((t) => t.taskId === sshTaskId(id));
      if (preparation && !dispatched) {
        const result = projectPreparation(preparation);
        const output = Buffer.from(result.output)
          .subarray(offset, offset + limit)
          .toString("utf8");
        return {
          ...result,
          output,
          requestedOffset: offset,
          nextOffset: offset + Buffer.byteLength(output),
          hasMore: false,
          outputLost: false,
        };
      }
      const task = await find(sessionFile, id);
      const { utf8SafeSlice } = await import("../tasks/task-manager");
      const pieces: Buffer[] = [];
      let position = 0;
      for (let i = 0; i < task.events.length; i++) {
        const entry = Buffer.from((i ? "\n" : "") + JSON.stringify(task.events[i].event));
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
          task.events.some((event, index) => index > 0 && event.seq !== task.events[index - 1].seq + 1),
      };
    },
    async stop(sessionFile, id) {
      const preparation = approvals.get(sessionFile, sshTaskId(id));
      if (preparation) {
        const cancelled = await approvals.cancel(sessionFile, sshTaskId(id));
        if (!(await owned(sessionFile)).some((t) => t.taskId === sshTaskId(id)))
          return { ...projectPreparation(cancelled), cancellationRequested: true };
      }
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
      for (const preparation of approvals.list(sessionFile)) {
        if (tasks.some((t) => t.taskId === preparation.intent.taskId) || preparation.state === "cancelled") continue;
        try {
          await approvals.cancel(sessionFile, preparation.intent.taskId);
          jobs.push({ id: sshJobId(preparation.intent.taskId), kind: "ssh", outcome: "finished", status: "cancelled" });
        } catch (error) {
          jobs.push({ id: sshJobId(preparation.intent.taskId), kind: "ssh", outcome: "error", error: String(error) });
        }
      }
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
