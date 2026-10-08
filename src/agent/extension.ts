import { getLatestDiskBackedCustomEntry } from "../history/session-manager";
import { createHash } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { T3_MCP_BEARER_ENV, T3_MCP_URL_ENV } from "../delegation-environment";
import { attachDiagnosticSink, diagnosticRecorder, recordDiagnostic } from "../diagnostics";
import { registerOperationDiagnostics } from "../diagnostics-extension";
import { type GoalRuntime, registerGoalMode } from "../goals/extension";
import { HistoryService } from "../history/service";
import { currentMainOwner, currentMainToolOwner } from "../live/main-owner";
import { withMainAgentGuidance, withSubagentGuidance } from "../prompts";
import { registerQuestions } from "../questions/extension";
import { registerQuestionRuntime } from "../questions/runtime";
import { registerRemoteCancellationService } from "../remote/cancellation";
import { RemoteClient } from "../remote/client";
import { RemoteJobDeliveryOutbox } from "../remote/job-delivery";
import { clearRemoteJobEvents, type RemoteJobObservation, remoteJobEvents } from "../remote/job-events";
import { publishRemoteJobObservations, remoteCompletionSummary } from "../remote/job-observations";
import { createRemoteJobsAdapter, sshJobId } from "../remote/jobs";
import { createRemoteOperations, type RemoteOperation } from "../remote/operations";
import { registerRootRuntime } from "../remote/root/runtime";
import { SessionHost, type SessionTaskPort } from "../session/host";
import { registerSessionHost } from "../session/host-access";
import { createWebTaskEventEmitter } from "../t3/tasks/events";
import { T3LocalNotificationDelivery, T3LocalNotificationOutbox } from "../t3/tasks/local-notifications";
import { t3BridgeEnvironment } from "../t3/tasks/mcp-client";
import { CompletionBatcher } from "../tasks/completion-batcher";
import { formatCompletionNotification } from "../tasks/completion-notification";
import { requestForegroundStop } from "../tasks/foreground-stop";
import {
  type AttentionNotice,
  type AttentionOptions,
  formatAttentionNotification,
  JobAttentionScheduler,
} from "../tasks/job-attention";
import { JobService } from "../tasks/job-service";
import { installLocalAgentTermination } from "../tasks/local-agent-termination";
import { registerResumeSafeguards } from "../tasks/resume-safeguards";
import { SUBAGENT_TYPES } from "../tasks/subagent-profiles";
import { registerSubagentSettings } from "../tasks/subagent-settings-ui";
import { createTaskLifecycleRecorder } from "../tasks/task-lifecycle";
import { type TaskInspection, TaskManager } from "../tasks/task-manager";
import { registerTaskMonitor } from "../tasks/task-monitor";
import type { TaskOwnerBinding, TaskOwnerObserver } from "../tasks/task-owner";
import { registerExecuteTool } from "../typescript/extension";
import { completionPreview } from "../ui/execution-previews";
import { createCompactUI } from "../ui/footer";
import { registerRollingActivity } from "../ui/rolling-activity";
import { installSdkTaskRows } from "../ui/sdk-task-rows";
import {
  type TaskRow,
  taskRowFromLaunch,
  taskRowFromRemote,
  taskRowKey,
  taskRowsFromSessionManager,
  upsertTaskRow,
} from "../ui/task-rows";
import { registerProjectWisdom } from "../wisdom/extension";
import { registerCacheAffineCompaction } from "./cache-affine-compaction";
import { CacheCountdown, registerCacheCountdown } from "./cache-countdown";
import { clearInstructionContinuity, scopeInstructionContinuity } from "./instruction-continuity";
import { registerInstructionMode } from "./instruction-mode";
import { registerLastUsedCliModel } from "./last-used-cli-model";
import { registerManualShake } from "./manual-shake";
import { registerNativeCodexCompaction } from "./native-compaction";
import { registerNativeFastMode } from "./native-fast-mode";

export function completionDiagnosticDetails(tasks: TaskInspection[], notices: AttentionNotice[]) {
  const taskStatusCounts = {
    completed: 0,
    failed: 0,
    killed: 0,
    running: 0,
    unknown: 0,
  };
  for (const task of tasks) {
    const row = taskRowFromLaunch(task);
    const status = row?.status;
    if (status === "succeeded") taskStatusCounts.completed++;
    else if (status === "failed") taskStatusCounts.failed++;
    else if (status === "cancelled") taskStatusCounts.killed++;
    else if (status === "running") taskStatusCounts.running++;
    else taskStatusCounts.unknown++;
  }
  return {
    taskRows: tasks.slice(0, 50).flatMap((task) => {
      const row = taskRowFromLaunch(task);
      return row ? [row] : [];
    }),
    tasks: tasks.slice(0, 50).map(({ output: _output, command, ...summary }) => ({
      ...summary,
      command: command.slice(0, 400),
    })),
    attention: notices.slice(0, 50).map(({ task, ...notice }) => ({
      ...notice,
      ...(task.launchIdentity
        ? {
            launchIdentity: {
              sourceSessionId: task.launchIdentity.sourceSessionId,
              sourceCallId: task.launchIdentity.sourceCallId,
              callIndex: task.launchIdentity.callIndex,
            },
          }
        : {}),
    })),
    taskStatusCounts,
    taskCount: tasks.length,
    attentionCount: notices.length,
    omittedTasks: Math.max(0, tasks.length - 50),
    omittedAttention: Math.max(0, notices.length - 50),
  };
}

export default function asynchronousTasksExtension(
  pi: ExtensionAPI,
  options: {
    profilesPath?: string;
    cacheSettingsPath?: string;
    attention?: AttentionOptions;
    executablePath?: string;
    /** Observe the existing manager; shutdown drains it before closing this binding. */
    onTaskOwner?: TaskOwnerObserver;
    /** Host adapter binding; only explicit user Fast selection acknowledges billing. */
    onNativeFastMode?: (control: ReturnType<typeof registerNativeFastMode>) => void;
  } = {},
): void {
  registerOperationDiagnostics(pi);
  registerRollingActivity(pi);
  // Must precede all payload capture/observation hooks so snapshots contain the
  // exact tier that the provider transport will serialize.
  const nativeFast = registerNativeFastMode(pi);
  options.onNativeFastMode?.(nativeFast);
  const cacheCountdown = new CacheCountdown();
  registerCacheCountdown(pi, cacheCountdown, options.cacheSettingsPath);
  const installUI = createCompactUI(pi, cacheCountdown);
  pi.registerMessageRenderer("task-complete", (message, options, theme) =>
    completionPreview(message.content, options.expanded, theme, options.outputPad, "task-complete", message.details),
  );
  pi.registerMessageRenderer("task-attention", (message, options, theme) =>
    completionPreview(message.content, options.expanded, theme, options.outputPad, "task-attention", message.details),
  );
  registerSubagentSettings(pi, options.profilesPath);
  // Environment identity is the floor for genuinely spawned child processes.
  // A root process may switch among root and child sessions in the same closure.
  const environmentDepth = Math.max(0, Number.parseInt(process.env.BRUV_SUBAGENT_DEPTH ?? "0", 10) || 0);
  const rawEnvironmentType = process.env.BRUV_SUBAGENT_TYPE;
  const environmentType = SUBAGENT_TYPES.includes(rawEnvironmentType as (typeof SUBAGENT_TYPES)[number])
    ? rawEnvironmentType
    : undefined;
  let subagentDepth = environmentDepth;
  let agentType = environmentType;
  const instructionMode = registerInstructionMode(pi, () => subagentDepth === 0);
  registerLastUsedCliModel(pi, () => subagentDepth === 0);
  let identityDiagnosticSession: object | undefined;
  let identityDiagnosticId: string | undefined;
  const restoreAgentIdentity = (ctx: ExtensionContext) => {
    type RestoredIdentity =
      | { kind: "absent" }
      | { kind: "invalid" }
      | { kind: "child"; type: (typeof SUBAGENT_TYPES)[number]; depth: number };
    // Begin fail-closed. Only a completely successful scan can establish that
    // the branch has no child marker and may therefore use root privileges.
    let identity: RestoredIdentity = { kind: "invalid" };
    try {
      const sessionManager = ctx.sessionManager as
        | { getBranch?: () => unknown; getEntries?: () => unknown }
        | undefined;
      const latest = sessionManager && getLatestDiskBackedCustomEntry(sessionManager, "bruv-agent");
      const entries =
        latest === undefined
          ? (sessionManager?.getBranch?.() ?? sessionManager?.getEntries?.() ?? [])
          : latest
            ? [latest]
            : [];
      if (!Array.isArray(entries)) throw new Error("Invalid session entries");

      let marker: Record<string, unknown> | undefined;
      for (let index = entries.length - 1; index >= 0; index--) {
        const candidate = entries[index];
        if (!candidate || (typeof candidate !== "object" && typeof candidate !== "function"))
          throw new Error("Malformed session entry");
        // Access each possibly hostile property inside this guarded scan.
        const type = (candidate as Record<string, unknown>).type;
        const customType = (candidate as Record<string, unknown>).customType;
        if (type === "custom" && customType === "bruv-agent") {
          marker = candidate as Record<string, unknown>;
          break;
        }
      }

      if (!marker) {
        identity = { kind: "absent" };
      } else {
        const rawData = marker.data;
        if (!rawData || (typeof rawData !== "object" && typeof rawData !== "function"))
          throw new Error("Invalid child identity");
        const data = rawData as Record<string, unknown>;
        const type = data.type;
        const depth = data.depth;
        if (
          !SUBAGENT_TYPES.includes(type as (typeof SUBAGENT_TYPES)[number]) ||
          !Number.isInteger(depth) ||
          (depth as number) < 1
        )
          throw new Error("Invalid child identity");
        identity = {
          kind: "child",
          type: type as (typeof SUBAGENT_TYPES)[number],
          depth: depth as number,
        };
      }
    } catch {
      identity = { kind: "invalid" };
    }

    if (identity.kind === "child" && identity.depth >= environmentDepth) {
      // A spawned process may resume/fork deeper metadata, but its actual role
      // is a capability cap: session metadata cannot turn a leaf into an
      // orchestrator (or change an orchestrator into a different role). Root
      // processes intentionally remain free to traverse session identities.
      agentType = environmentDepth > 0 && environmentType ? environmentType : identity.type;
      subagentDepth = identity.depth;
    } else if (identity.kind === "invalid" || identity.kind === "child") {
      // Invalid or shallower metadata is never evidence of a root session.
      agentType = environmentType === "fast" ? "fast" : "normal";
      subagentDepth = Math.max(1, environmentDepth);
      try {
        const sessionId = ctx.sessionManager?.getSessionId?.();
        if (identityDiagnosticSession !== ctx.sessionManager || identityDiagnosticId !== sessionId) {
          identityDiagnosticSession = ctx.sessionManager;
          identityDiagnosticId = sessionId;
          recordDiagnostic(ctx.sessionManager as object, {
            component: "resume",
            code: "CHILD_IDENTITY_INVALID",
            outcome: "blocked",
            cancellation: "safety",
          });
        }
      } catch {
        // Hostile session metadata must not interrupt capability restriction.
      }
    } else {
      agentType = environmentType;
      subagentDepth = environmentDepth;
    }
  };
  let manager: TaskManager | undefined;
  let taskOwnerBinding: TaskOwnerBinding | undefined;
  let detachLocalTermination: (() => void) | undefined;
  let owningContext: ExtensionContext | undefined;
  const transcriptRows = new Map<string, TaskRow>();
  let restoreTaskRows: (() => void) | undefined;
  const recordTaskRow = (row: TaskRow) => {
    const current = transcriptRows.get(taskRowKey(row));
    const next = upsertTaskRow(transcriptRows, row);
    if (JSON.stringify(current) === JSON.stringify(next)) return;
    // UI metadata is optional; a write failure must not change job execution.
    try {
      pi.appendEntry("die-task-row", next);
    } catch {}
  };
  pi.events?.on?.("die:task-row-launch", (value: unknown) => {
    const event = value as { row: TaskRow; sessionId?: string };
    if (event.sessionId !== owningContext?.sessionManager?.getSessionId?.()) return;
    recordTaskRow(event.row);
    const actual = event.row.source === "local" ? manager?.list().find((task) => task.id === event.row.id) : undefined;
    const latest = actual && taskRowFromLaunch(actual, event.row.sourceCallId);
    if (latest) recordTaskRow(latest);
  });
  let managerRecorder: ((input: Parameters<typeof recordDiagnostic>[1]) => void) | undefined;
  let detachManagerDiagnostics: (() => void) | undefined;
  let attention: JobAttentionScheduler | undefined;
  let invalidateShakeSnapshots = () => {};
  // Registration order is policy: shake previews first and a qualifying cancel
  // short-circuits native Codex and normal cache-affine compaction handlers.
  registerManualShake(pi, () => invalidateShakeSnapshots());
  const nativeCompaction = registerNativeCodexCompaction(
    pi,
    () =>
      manager
        ?.list()
        .filter((task) => task.status === "running")
        .map(({ id, kind, status }) => ({ id, kind, status })) ?? [],
  );
  invalidateShakeSnapshots = () => {
    nativeCompaction.invalidateCapture();
    cacheCountdown.invalidate();
  };
  registerCacheAffineCompaction(
    pi,
    () =>
      manager
        ?.list()
        .filter((task) => task.status === "running")
        .map(({ id, kind, status }) => ({ id, kind, status })) ?? [],
    { skipCodexNative: () => nativeCompaction.hasFreshCapture() },
  );
  let taskUi: ExtensionContext["ui"] | undefined;
  const updateTaskStatus = () => {
    const running = manager?.list().filter((task) => task.status === "running").length ?? 0;
    pi.events?.emit?.("herdr:tasks", { running });
    taskUi?.setStatus("bruv-tasks", running > 0 ? `${running} task${running === 1 ? "" : "s"} running` : undefined);
  };

  const notifications = createJobNotifications(
    pi,
    () => manager,
    () => attention,
    updateTaskStatus,
    () => owningContext?.sessionManager && currentMainOwner(owningContext.sessionManager),
    (event) => {
      const row = taskRowFromRemote(event);
      if (row && transcriptRows.has(taskRowKey(row))) recordTaskRow(row);
    },
  );

  let goals: GoalRuntime;
  const getManager = (ctx = owningContext) => {
    notifications.requireLocalDelivery();
    if (!manager) {
      // Capture ownership at manager creation, never through a mutable active
      // context. SessionManager objects may themselves be reused on /resume.
      const owner = ctx?.sessionManager;
      const sessionId = owner?.getSessionId?.();
      // Generation capture prevents an old manager from writing after the same
      // SessionManager object is detached and reattached, even when its SID is
      // unchanged or unavailable.
      const recordForAttachment = owner ? diagnosticRecorder(owner) : undefined;
      const recordOwned = (input: Parameters<typeof recordDiagnostic>[1]) => {
        try {
          if (owner && owner.getSessionId?.() === sessionId) recordForAttachment?.(input);
        } catch {
          // Diagnostics remain best effort when manager metadata is hostile.
        }
      };
      managerRecorder = recordOwned;
      const lifecycle = createTaskLifecycleRecorder(owner?.getSessionFile?.(), (failure) =>
        recordOwned({
          component: "jobs",
          code:
            failure === "contention"
              ? "lifecycle_lock_contended"
              : failure === "locking"
                ? "lifecycle_lock_unavailable"
                : "JOBS_LIFECYCLE_WRITE_FAILED",
          outcome: "failed",
        }),
      );
      manager = new TaskManager(
        (task) => {
          notifications.complete(task);
          goals.jobsChanged();
        },
        undefined,
        {
          recordDiagnostic: (input) => {
            recordOwned(input);
            if (input.code === "JOBS_SHUTDOWN_CLOSURE_TIMEOUT") {
              for (const task of ownedManager.pending())
                lifecycle({
                  event: "closure-unobserved",
                  at: new Date().toISOString(),
                  taskId: task.id,
                  kind: task.kind,
                  status: task.status,
                  termination: task.termination,
                  sessionFile: task.agent?.sessionFile,
                });
            }
          },
        },
      );
      const ownedManager = manager;
      if (options.onTaskOwner && !ctx) throw new Error("Native task owner requires a session context");
      taskOwnerBinding =
        ctx &&
        options.onTaskOwner?.({
          manager,
          context: ctx,
          sourceSessionId: owner?.getSessionFile?.() ?? sessionId!,
          appendEntry: (type, data) => {
            if (owner === owningContext?.sessionManager && owner?.getSessionId?.() === sessionId)
              pi.appendEntry(type, data);
          },
        });
      // Only the local CLI subagent receives a parent SIGTERM. Its own async
      // children live in detached groups, outside the parent group signal.
      if (subagentDepth > 0 && environmentDepth > 0 && !notifications.isNativeSession()) {
        detachLocalTermination = installLocalAgentTermination(process, ownedManager, (code) => process.exit(code));
      }
      detachManagerDiagnostics = attachDiagnosticSink(manager, (_type, data) =>
        recordOwned(data as Parameters<typeof recordDiagnostic>[1]),
      );
      const emitWebTask = createWebTaskEventEmitter(ctx?.mode);
      manager.subscribe((event) => {
        emitWebTask(event);
        if (event.type === "activity") return;
        const task = event.task;
        if (owner?.getSessionId?.() === sessionId && owner === owningContext?.sessionManager) {
          const row = taskRowFromLaunch(task);
          if (row && transcriptRows.has(taskRowKey(row))) recordTaskRow(row);
        }
        lifecycle({
          event: event.type,
          at: new Date().toISOString(),
          taskId: task.id,
          kind: task.kind,
          status: task.status,
          startedAt: task.startedAt,
          completedAt: task.completedAt,
          termination: task.termination,
          exitCode: task.exitCode,
          signal: task.signal,
          sessionFile: task.agent?.sessionFile,
        });
      });
      attention = new JobAttentionScheduler(
        manager,
        (notices) => {
          for (const notice of notices) notifications.attend(notice);
        },
        options.attention,
      );
    }
    return manager;
  };

  registerResumeSafeguards(pi);

  const questions = registerQuestionRuntime(pi, {
    supported: () =>
      (subagentDepth === 0 || !!process.env.BRUV_REMOTE_RUNTIME_STATE) && !notifications.isNativeSession(),
    nativeSupported: () => subagentDepth === 0,
  });
  registerQuestions(pi, (ctx) => questions.commands(ctx));

  goals = registerGoalMode(
    pi,
    {
      runningIds: () =>
        new Set(
          manager
            ?.list()
            .filter((task) => task.status === "running")
            .map((task) => task.id) ?? [],
        ),
      status: (id) => {
        const task = manager?.list().find((item) => item.id === id);
        if (!task) return "unavailable";
        return task.status === "running" ? "running" : "finished";
      },
    },
    { hasBlockingQuestions: () => questions.hasBlockingQuestions() },
  );
  const history = new HistoryService();
  let service: JobService | undefined;
  const remoteClient = new RemoteClient();
  questions.configureRemote(remoteClient);
  const remoteJobs = createRemoteJobsAdapter(remoteClient);
  registerTaskMonitor(pi, getManager, remoteJobs);
  const getService = (ctx: ExtensionContext) => {
    taskUi = ctx.ui;
    owningContext = ctx;
    const tasks = getManager(ctx);
    // The service belongs to exactly one manager/session attachment. Shutdown
    // clears both, so a resumed or switched session cannot dispatch into stale state.
    if (!service || service.manager !== tasks)
      service = new JobService(
        tasks,
        () => ({ depth: subagentDepth, type: agentType }),
        updateTaskStatus,
        options.profilesPath,
        attention,
        managerRecorder,
        undefined,
        undefined,
        () => notifications.assertLaunchCapacity(tasks.list().filter((task) => task.status === "running").length),
        remoteJobs,
      );
    return service;
  };
  registerRootRuntime(pi, {
    questions: { service: questions.service, sync: (ctx) => questions.syncRemote(ctx) },
    jobs: (ctx, method, params) => getService(ctx).handle(method, params, ctx, new AbortController().signal),
  });
  let sessionHost: SessionHost | undefined;
  registerSessionHost(pi, (ctx) => {
    if (ctx.sessionManager !== owningContext?.sessionManager) return undefined;
    if (!sessionHost)
      sessionHost = new SessionHost({
        tasks: {
          list: (params, context, signal) => getService(context).handle("jobs.list", params, context, signal),
          inspect: (id, offset, context, signal) =>
            getService(context).handle(
              "jobs.inspect",
              { id, ...(offset === undefined ? {} : { offset }), limit: 3000 },
              context,
              signal,
            ),
          stop: (id, context, signal) => getService(context).handle("jobs.stop", { id }, context, signal),
          localJobs: () =>
            getManager(ctx)
              .list()
              .map(({ id, status, kind }) => ({ id, status, kind })),
          subscribe: (listener) => getManager(ctx).subscribe((event) => listener(event)),
        } satisfies SessionTaskPort,
        context: ctx,
        sendUserMessage: (text, options) => pi.sendUserMessage(text, options),
        confirmStop: (id) => ctx.ui.confirm("Stop job?", `Cancel job ${id}?`),
      });
    return sessionHost;
  });
  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") return;
    const text = event.message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join(" ")
      .slice(0, 2000);
    if (text) sessionHost?.observe({ type: "assistant", text });
  });
  pi.on("turn_end", () => {
    sessionHost?.observe({ type: "turn_end" });
  });
  registerProjectWisdom(pi, {
    isRoot: (ctx) => {
      // Resumed identity may be attached after session_start, before either effect.
      restoreAgentIdentity(ctx);
      return subagentDepth === 0;
    },
  });
  const remoteOperations = createRemoteOperations(remoteClient);
  registerRemoteCancellationService(pi, (ctx) =>
    getService(ctx).handle("jobs.stopWork", {}, ctx, new AbortController().signal),
  );
  const executeControl = registerExecuteTool(
    pi,
    async (ctx, method, params, signal) => {
      if (method === "remote") {
        const operation = params as RemoteOperation;
        if (operation.op === "cancel" && sessionHost)
          await sessionHost.confirmDelegatedAgentStop("remote task " + operation.taskId);
        const sessionFile = ctx.sessionManager?.getSessionFile?.();
        try {
          return await remoteOperations(operation, ctx.cwd, signal, sessionFile);
        } finally {
          publishRemoteJobObservations(await remoteClient.status(), sessionFile);
        }
      }
      if (method.startsWith("history.")) return history.handle(method, params, ctx);
      if (method.startsWith("goal.")) return Promise.resolve(goals.handle(method, params));
      if (method.startsWith("questions.")) return questions.handle(ctx, method, params);
      if ((method === "jobs.stop" || method === "jobs.stopWork") && sessionHost)
        await sessionHost.confirmDelegatedAgentStop(
          method === "jobs.stopWork"
            ? "current-session work"
            : params && typeof params === "object"
              ? (params as { id?: unknown }).id
              : undefined,
        );
      const result = await getService(ctx).handle(method, params, ctx, signal);
      if (method !== "jobs.stopWork") return result;
      questions.pause();
      // The helper result must reach execute before aborting that foreground.
      // Async jobs are already requested through the same scoped JobService.
      const voiceOwner = currentMainToolOwner(ctx.sessionManager);
      voiceOwner?.captureStopWorkReport?.(result);
      const foreground = requestForegroundStop(
        {
          sessionManager: ctx.sessionManager,
          isIdle: () => (voiceOwner ? false : ctx.isIdle()),
          abort: () => {
            if (voiceOwner) voiceOwner.stopForeground();
            else {
              executeControl.stopForeground(ctx);
              ctx.abort();
            }
          },
        },
        signal,
        (observed) =>
          sessionHost?.observe({ type: "stopping", text: "Foreground stop observation: " + JSON.stringify(observed) }),
        voiceOwner ? () => currentMainToolOwner(ctx.sessionManager) === voiceOwner : undefined,
      );
      sessionHost?.observe({
        type: "stopping",
        text: "Current-session stop-work result (not proof pending jobs exited): " + JSON.stringify(result),
      });
      return {
        ...(result as object),
        foreground,
        outcome:
          foreground.outcome === "error" || (result as { outcome: string }).outcome === "partial"
            ? "partial"
            : foreground.outcome === "pending"
              ? "pending"
              : (result as { outcome: string }).outcome,
      };
    },
    options.executablePath,
  );

  pi.on("agent_end", async (event, ctx) => {
    // Print/JSON sessions otherwise dispose their runtime immediately when the
    // model yields. Hold only that idle boundary (never spawn or the TUI loop)
    // until one result is ready, then queue it for Pi's post-run continuation.
    // RPC is persistent. Local CLI sessions retain the historical synchronous
    // flush, but T3 notifications never use Pi's volatile steer queue: they are
    // persisted at the completion edge and committed through the server.
    if (ctx.mode === "rpc") {
      // T3 delivery is already durable and server-dispatched. Flushing Pi's
      // volatile steer queue here cannot make a post-handoff completion safe.
      notifications.flushRpcTurn();
      return;
    }
    if (ctx.mode !== "print" && ctx.mode !== "json") return;
    const lastAssistant = [...event.messages].reverse().find((message) => message.role === "assistant");
    if (ctx.signal?.aborted || lastAssistant?.stopReason === "aborted" || lastAssistant?.stopReason === "error") return;
    await notifications.waitForNextResult(ctx.signal);
  });

  pi.on("input", async (event, ctx) => {
    const owner = currentMainOwner(ctx.sessionManager);
    if (!owner) return;
    if (event.source === "extension") return;
    if (event.images?.length) {
      ctx.ui.notify("Live typed input cannot forward images; try again without images.", "warning");
      return { action: "handled" };
    }
    try {
      await owner.typedInput(event.text);
    } catch {
      ctx.ui.notify("Live could not prepare this turn. Continue in text.", "warning");
    }
    return { action: "handled" };
  });

  pi.on("before_agent_start", (event, ctx) => {
    // Some SDK embedders emit session_start before resumed entries are attached.
    // Rehydrate at the definitive ordinary-turn seam as well.
    restoreAgentIdentity(ctx);
    instructionMode.refresh(ctx);
    // session_start may precede dynamically loaded extension handlers in SDK
    // embedders; framing the first ordinary turn is the definitive scope seam.
    scopeInstructionContinuity(ctx.sessionManager as object);
    const systemPrompt =
      subagentDepth > 0
        ? withSubagentGuidance(event.systemPrompt, event.systemPromptOptions, agentType ?? "normal")
        : withMainAgentGuidance(event.systemPrompt, event.systemPromptOptions, () => instructionMode.guidance(ctx));
    if (systemPrompt !== event.systemPrompt) return { systemPrompt };
  });

  pi.on("session_start", async (_event, ctx) => {
    owningContext = ctx;
    transcriptRows.clear();
    for (const row of taskRowsFromSessionManager(ctx.sessionManager))
      upsertTaskRow(transcriptRows, row.status === "running" ? { ...row, status: "unknown" } : row);
    restoreTaskRows?.();
    restoreTaskRows =
      ctx.mode === "tui" ? installSdkTaskRows(ctx.ui.theme, () => [...transcriptRows.values()]) : undefined;
    await notifications.attach(ctx.sessionManager?.getSessionFile?.());
    owningContext = ctx;
    scopeInstructionContinuity(ctx.sessionManager as object);
    // A resumed child keeps identity and delegation restrictions even when
    // launched from /resume without the original process environment.
    restoreAgentIdentity(ctx);
    pi.setActiveTools(["execute"]);
    installUI(ctx);
    instructionMode.sessionStart(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    restoreTaskRows?.();
    restoreTaskRows = undefined;
    currentMainOwner(ctx.sessionManager)?.stopForeground();
    currentMainOwner(ctx.sessionManager)?.close();
    // Pi emits this before reload/new/resume/fork as well as final quit.
    sessionHost?.close();
    sessionHost = undefined;
    clearInstructionContinuity(ctx.sessionManager as object);
    taskUi?.setStatus("bruv-tasks", undefined);
    instructionMode.shutdown();
    await notifications.close();
    attention?.dispose();
    await manager?.shutdown();
    await taskOwnerBinding?.close();
    taskOwnerBinding = undefined;
    detachLocalTermination?.();
    detachLocalTermination = undefined;
    detachManagerDiagnostics?.();
    detachManagerDiagnostics = undefined;
    managerRecorder = undefined;
    manager = undefined;
    attention = undefined;
    service = undefined;
    owningContext = undefined;
  });
}

/** Owns completion delivery for one attached session, including durable replay and print settlement. */
function createJobNotifications(
  pi: ExtensionAPI,
  currentManager: () => TaskManager | undefined,
  currentAttention: () => JobAttentionScheduler | undefined,
  updateTaskStatus: () => void,
  currentOwner: () => ReturnType<typeof currentMainOwner>,
  observeRemote: (event: RemoteJobObservation) => void,
) {
  let t3NativeSession = false;
  let remoteOutbox: RemoteJobDeliveryOutbox | undefined;
  let remoteSessionFile: string | undefined;
  let unsubscribeRemote: (() => void) | undefined;
  let remoteRetry: ReturnType<typeof setTimeout> | undefined;
  const scheduleRemoteRetry = () => {
    if (remoteRetry || !remoteOutbox?.hasPending()) return;
    remoteRetry = setTimeout(() => {
      remoteRetry = undefined;
      if (remoteOutbox?.pending().length) notificationBatch.add({ kind: "remote" });
      scheduleRemoteRetry();
    }, 1_000);
    remoteRetry.unref?.();
  };
  const disposeRemote = () => {
    unsubscribeRemote?.();
    unsubscribeRemote = undefined;
    if (remoteRetry) clearTimeout(remoteRetry);
    remoteRetry = undefined;
    remoteOutbox?.close();
    remoteOutbox = undefined;
    if (remoteSessionFile) clearRemoteJobEvents(remoteSessionFile);
    remoteSessionFile = undefined;
  };
  let t3LocalDelivery: T3LocalNotificationDelivery | undefined;
  type Notification =
    | { kind: "completion"; task: TaskInspection }
    | { kind: "attention"; notice: AttentionNotice }
    | { kind: "remote" };
  const notificationBatch = new CompletionBatcher<Notification>(
    (items) => {
      updateTaskStatus();
      const completionMap = new Map(
        items.filter((item) => item.kind === "completion").map((item) => [item.task.id, item.task]),
      );
      const runningIds = new Set(
        currentManager()
          ?.pending()
          .map((task) => task.id) ?? [],
      );
      const attentionMap = new Map(
        items
          .filter((item) => item.kind === "attention")
          .filter((item) => runningIds.has(item.notice.id) && !completionMap.has(item.notice.id))
          .map((item) => [item.notice.id, item.notice]),
      );
      const tasks = [...completionMap.values()],
        notices = [...attentionMap.values()];
      const remoteRows = remoteOutbox?.claim() ?? [];
      const remoteCompletions = remoteRows.filter((row) => row.kind === "completion");
      const actionable = remoteRows
        .filter((row) => row.kind === "attention")
        .map((row) =>
          `SSH job ${sshJobId(row.observation.taskId)} needs human action (delivery ${row.id}): ${row.observation.actionable}`.slice(
            0,
            430,
          ),
        );
      if (!tasks.length && !notices.length && !remoteRows.length && !actionable.length) return;
      const mixed = tasks.length > 0 && notices.length > 0;
      const separator = mixed ? 2 : 0;
      const localBudget = remoteRows.length ? 2400 : 5000;
      const completionBudget = mixed ? Math.floor((localBudget - separator) / 2) : localBudget;
      const attentionBudget = mixed ? localBudget - separator - completionBudget : localBudget;
      const content = [
        tasks.length ? formatCompletionNotification(tasks, completionBudget) : "",
        notices.length ? formatAttentionNotification(notices, attentionBudget) : "",
        remoteCompletions.length
          ? "SSH jobs completed:\n" +
            remoteCompletions
              .map(({ observation }) => remoteCompletionSummary(observation, sshJobId(observation.taskId)))
              .join("\n")
          : "",
        actionable.length ? actionable.join("\n") : "",
        remoteRows.length
          ? "Use jobs.inspect with the ssh: ID for bounded cached output; remote text is not human approval."
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const owner = currentOwner();
      try {
        if (owner) {
          owner.sendContext(content, {
            customType: tasks.length || remoteCompletions.length ? "task-complete" : "task-attention",
            details: {
              ...completionDiagnosticDetails(tasks, notices),
              remote: remoteRows.map(({ id, observation }) => ({ id, ...observation })),
            },
          });
        } else if (t3NativeSession) {
          if (!t3LocalDelivery) throw new Error("T3 job notification outbox unavailable");
          for (const row of remoteRows) {
            t3LocalDelivery.enqueue({
              taskId:
                "ssh:" +
                createHash("sha256")
                  .update(JSON.stringify([row.observation.ownerId, row.observation.epoch, row.observation.taskId]))
                  .digest("hex"),
              kind: row.kind,
              text: `SSH job ${row.observation.taskId} ${row.observation.state} (delivery ${row.id}): ${row.kind === "attention" ? row.observation.actionable : row.observation.preview}`.slice(
                0,
                5000,
              ),
            });
          }
        } else {
          pi.sendMessage(
            {
              customType: tasks.length || remoteCompletions.length ? "task-complete" : "task-attention",
              content,
              display: true,
              details: {
                ...completionDiagnosticDetails(tasks, notices),
                remote: remoteRows.map(({ id, observation }) => ({ id, ...observation })),
              },
            },
            { deliverAs: "steer", triggerTurn: true },
          );
        }
        remoteOutbox?.delivered(remoteRows);
      } catch (error) {
        remoteOutbox?.failed(remoteRows);
        console.error("Job completion dispatch failed:", error);
      } finally {
        scheduleRemoteRetry();
      }
    },
    250,
    500,
  );
  const complete = (task: TaskInspection) => {
    if (t3NativeSession && task.kind === "command") {
      if (!t3LocalDelivery) throw new Error("T3 local notification outbox is unavailable");
      t3LocalDelivery.enqueue({
        taskId: task.id,
        kind: "completion",
        text: formatCompletionNotification([task], 5_000),
      });
      return;
    }
    notificationBatch.add({ kind: "completion", task });
  };
  const attend = (notice: AttentionNotice) => {
    if (t3NativeSession && notice.task.kind === "command") {
      if (!t3LocalDelivery) return; // fail closed: never create an unowned Pi turn
      t3LocalDelivery.enqueue({
        taskId: notice.id,
        kind: "attention",
        text: formatAttentionNotification([notice], 5_000),
      });
      return;
    }
    notificationBatch.add({ kind: "attention", notice });
  };

  const attach = async (sessionFile: string | undefined) => {
    notificationBatch.reset();
    disposeRemote();
    await t3LocalDelivery?.stop();
    t3LocalDelivery = undefined;
    t3NativeSession = process.env[T3_MCP_URL_ENV] !== undefined || process.env[T3_MCP_BEARER_ENV] !== undefined;
    if (sessionFile) {
      try {
        const bridge = t3BridgeEnvironment();
        if (bridge.kind === "remote") {
          t3NativeSession = true;
          t3LocalDelivery = new T3LocalNotificationDelivery(new T3LocalNotificationOutbox(sessionFile), bridge);
          t3LocalDelivery.start(); // replay commit-with-lost-ACK rows on resume
        }
      } catch {
        // A configured T3 session fails closed if its durable mailbox cannot be
        // opened. It must never fall back to an unowned Pi-triggered turn.
      }
    }
    if (sessionFile) {
      remoteSessionFile = sessionFile;
      try {
        remoteOutbox = new RemoteJobDeliveryOutbox(sessionFile);
        remoteOutbox.replay();
        const source = remoteJobEvents(sessionFile);
        const observe = (event: RemoteJobObservation) => {
          observeRemote(event);
          remoteOutbox?.enqueue(event);
          if (remoteOutbox?.pending().length) notificationBatch.add({ kind: "remote" });
          scheduleRemoteRetry();
        };
        unsubscribeRemote = source.subscribe(observe);
        for (const event of source.snapshot()) observe(event);
        if (remoteOutbox.pending().length) notificationBatch.add({ kind: "remote" });
        scheduleRemoteRetry();
      } catch (error) {
        console.error("Remote job outbox unavailable:", error);
        disposeRemote();
      }
    }
  };
  const close = async () => {
    await t3LocalDelivery?.stop();
    t3LocalDelivery = undefined;
    t3NativeSession = false;
    notificationBatch.dispose();
    disposeRemote();
  };
  const waitForNextResult = async (signal?: AbortSignal) => {
    const tasks = currentManager();
    const attention = currentAttention();
    const running = tasks?.list().filter((task) => task.status === "running") ?? [];
    const remoteSource = remoteSessionFile ? remoteJobEvents(remoteSessionFile) : undefined;
    const remoteRunning =
      remoteSource
        ?.snapshot()
        .filter((job) => (job.state === "running" || job.state === "unknown") && !job.actionable) ?? [];
    let boundary: "completion" | "attention" | "abort" = "abort";
    if ((tasks && running.length > 0) || remoteRunning.length > 0) {
      let onAbort: (() => void) | undefined;
      let resolveCompletion!: () => void;
      const completion = new Promise<void>((resolve) => {
        resolveCompletion = resolve;
      });
      // One manager listener covers every running job and, unlike Promise.then,
      // can be detached when attention or cancellation wins this boundary.
      const unsubscribe = tasks?.subscribe((event) => {
        if (event.type === "completed") resolveCompletion();
      });
      const remoteKeys = new Set(remoteRunning.map((job) => JSON.stringify([job.ownerId, job.epoch, job.taskId])));
      const unsubscribeRemoteWait = remoteSource?.subscribe((event) => {
        if (
          remoteKeys.has(JSON.stringify([event.ownerId, event.epoch, event.taskId])) &&
          (event.state === "done" || event.state === "cancelled" || !!event.actionable)
        )
          resolveCompletion();
      });
      const attentionWait = new AbortController();
      try {
        // A child can exit after the running snapshot but before subscription.
        // Rechecking after subscribing closes that gap without per-job waits.
        const current = new Map(tasks?.list().map((task) => [task.id, task.status]) ?? []);
        if (running.some((task) => current.get(task.id) !== "running")) resolveCompletion();
        const remoteCurrent = new Map(
          remoteSource?.snapshot().map((job) => [JSON.stringify([job.ownerId, job.epoch, job.taskId]), job]) ?? [],
        );
        if (
          remoteRunning.some((job) => {
            const latest = remoteCurrent.get(JSON.stringify([job.ownerId, job.epoch, job.taskId]));
            return (
              latest?.state === "done" ||
              latest?.state === "cancelled" ||
              (!!latest?.actionable && !!remoteOutbox?.pending().some((row) => row.kind === "attention"))
            );
          })
        )
          resolveCompletion();
        boundary = await Promise.race([
          completion.then(() => "completion" as const),
          ...(attention
            ? [
                attention
                  .waitForNotice(signal ? AbortSignal.any([signal, attentionWait.signal]) : attentionWait.signal)
                  .then(() => "attention" as const),
              ]
            : []),
          new Promise<"abort">((resolve) => {
            onAbort = () => resolve("abort");
            signal?.addEventListener("abort", onAbort, { once: true });
            if (signal?.aborted) resolve("abort");
          }),
        ]);
      } finally {
        unsubscribe?.();
        unsubscribeRemoteWait?.();
        attentionWait.abort();
        if (onAbort) signal?.removeEventListener("abort", onAbort);
      }
    }
    // Keep the print boundary until the shared batch is actually delivered.
    // For attention, retain the normal short coalescing window so a completion
    // racing the checkpoint supersedes stale attention in one parent wakeup.
    if (!signal?.aborted) {
      if (boundary === "attention" && tasks) {
        // Give a task already racing the checkpoint one bounded chance to
        // complete; its completion supersedes stale attention for that task.
        // A single disposable listener avoids retaining one wait handler per
        // running task throughout repeated attention boundaries.
        const ids = new Set(running.map((task) => task.id));
        await new Promise<void>((resolve) => {
          let settled = false;
          let timer: ReturnType<typeof setTimeout> | undefined;
          let unsubscribe = () => {};
          const finish = () => {
            if (settled) return;
            settled = true;
            unsubscribe();
            if (timer) clearTimeout(timer);
            signal?.removeEventListener("abort", finish);
            resolve();
          };
          unsubscribe = tasks.subscribe((event) => {
            if (event.type === "completed" && ids.has(event.task.id)) finish();
          });
          signal?.addEventListener("abort", finish, { once: true });
          timer = setTimeout(finish, 200);
          timer.unref?.();
          // Close the completion-before-subscription race.
          const current = new Map(tasks.list().map((task) => [task.id, task.status]));
          if ([...ids].some((id) => current.get(id) !== "running") || signal?.aborted) finish();
        });
      }
      notificationBatch.flush();
      // Print/json must not exit between a failed SSH dispatch and its bounded retry.
      // A live claim belongs to another dispatcher or is crash-uncertain until its lease expires.
      while (remoteOutbox?.hasPending() && !signal?.aborted) {
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", done);
            resolve();
          };
          const timer = setTimeout(done, 1000);
          signal?.addEventListener("abort", done, { once: true });
        });
        if (remoteOutbox?.pending().length) {
          notificationBatch.add({ kind: "remote" });
          notificationBatch.flush();
        }
      }
    }
  };

  return {
    attach,
    close,
    complete,
    attend,
    waitForNextResult,
    isNativeSession: () => t3NativeSession,
    requireLocalDelivery: () => {
      if (t3NativeSession && !t3LocalDelivery)
        throw new Error("T3 local jobs require an available durable notification outbox");
    },
    assertLaunchCapacity: (runningTasks: number) => {
      if (t3NativeSession) t3LocalDelivery!.outbox.assertLaunchCapacity(runningTasks);
    },
    flushRpcTurn: () => {
      // Native completion was persisted at its edge, not into Pi's volatile steer queue.
      if (!t3NativeSession) notificationBatch.flush();
    },
  };
}
