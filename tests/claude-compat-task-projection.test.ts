import { describe, expect, test } from "bun:test";
import { TaskManager, type TaskEvent } from "../src/tasks/task-manager";
import {
  createTaskProjector,
  nativeTaskId,
  nativeTaskMessageId,
  projectTask,
  projectLocalTask,
  projectBackgroundRoster,
  projectChildFrame,
  type TaskLink,
  type TaskObservation,
  type TaskProjectionCheckpoint,
} from "../src/claude-compat/task-projection";

const root = { namespace: "bruv:test-install", sourceSessionId: "/real/root.jsonl", sessionId: "native-root-id" };
const worker: TaskLink = {
  root,
  sourceId: "local-owner",
  jobId: "task_actual-job-1",
  launchToolUseId: "call_actual-launch-1",
  origin: "bruv",
  kind: "worker",
  parent: { sourceSessionId: root.sourceSessionId, launchToolUseId: null },
  child: { sourceSessionId: "/real/child-1.jsonl", parentSessionId: root.sourceSessionId },
  prompt: "Inspect task projection",
  subagentType: "normal",
  spawnDepth: 1,
};
const shell: TaskLink = {
  root,
  sourceId: "local-owner",
  jobId: "shell_actual-job-2",
  launchToolUseId: "call_actual-shell",
  origin: "bruv",
  kind: "shell",
  parent: worker.parent,
};
const usage = { total_tokens: 125, tool_uses: 2, duration_ms: 740 };
function observation(revision: number, patch: Partial<TaskObservation> = {}): TaskObservation {
  return {
    revision,
    eventId: "source-event-" + revision,
    edge: "snapshot",
    status: "running",
    description: "Inspecting tasks",
    isBackgrounded: true,
    ...patch,
  };
}
function start(link = worker) {
  return projectTask(link, observation(1, { edge: "started" }));
}
function finish(link = worker, checkpoint = start(link).checkpoint) {
  return projectTask(
    link,
    observation(3, {
      status: "completed",
      terminal: { confirmed: true, summary: "Actual answer", outputFile: "/real/artifact.txt", usage },
    }),
    checkpoint,
  );
}

describe("native Claude SDK 0.3.276 task projection", () => {
  test("exact started envelope comes from a linked real worker", () => {
    const result = start();
    expect(result.frames).toEqual([
      {
        type: "system",
        subtype: "task_started",
        task_id: nativeTaskId(worker),
        tool_use_id: worker.launchToolUseId,
        description: "Inspecting tasks",
        task_type: "local_agent",
        is_backgrounded: true,
        prompt: worker.kind === "worker" ? worker.prompt : "",
        subagent_type: "normal",
        spawn_depth: 1,
        uuid: nativeTaskMessageId(worker, "source-event-1", "task_started"),
        session_id: root.sessionId,
      },
    ]);
    expect(result.checkpoint?.phase).toBe("active");
    expect(projectTask(worker, observation(1), result.checkpoint).skipped).toBe("stale");
  });
  test("progress uses actual measured usage, phase and tools", () => {
    expect(
      projectTask(
        worker,
        observation(2, {
          progress: { description: "running tool", usage, lastToolName: "read", summary: "Reading source" },
        }),
        start().checkpoint,
      ).frames,
    ).toEqual([
      {
        type: "system",
        subtype: "task_progress",
        task_id: nativeTaskId(worker),
        tool_use_id: worker.launchToolUseId,
        description: "running tool",
        usage,
        last_tool_name: "read",
        summary: "Reading source",
        subagent_type: "normal",
        session_id: root.sessionId,
        uuid: nativeTaskMessageId(worker, "source-event-2", "task_progress"),
      },
    ]);
    expect(projectTask(worker, observation(2), start().checkpoint).frames).toEqual([]);
    expect(() =>
      projectTask(
        worker,
        observation(2, { progress: { description: "bad", usage: { ...usage, total_tokens: NaN } } }),
        start().checkpoint,
      ),
    ).toThrow("observed");
  });
  test("terminal exact shape, monotonicity, actual killed vs requested stop", () => {
    const started = start();
    const stopping = projectTask(worker, observation(2, { status: "stopping" }), started.checkpoint);
    expect(stopping.frames).toEqual([]);
    expect(stopping.checkpoint?.phase).toBe("active");
    const done = finish(worker, stopping.checkpoint);
    expect(done.frames).toEqual([
      {
        type: "system",
        subtype: "task_notification",
        task_id: nativeTaskId(worker),
        tool_use_id: worker.launchToolUseId,
        status: "completed",
        output_file: "/real/artifact.txt",
        summary: "Actual answer",
        usage,
        session_id: root.sessionId,
        uuid: nativeTaskMessageId(worker, "source-event-3", "task_notification"),
      },
    ]);
    expect(
      projectTask(worker, observation(4, { progress: { description: "late", usage } }), done.checkpoint).frames,
    ).toEqual([]);
    expect(projectTask(worker, observation(5, { edge: "started" }), done.checkpoint).skipped).toBe("terminal");
    for (const [actual, expected] of [
      ["failed", "failed"],
      ["killed", "stopped"],
    ] as const) {
      const ended = projectTask(
        worker,
        observation(3, { status: actual, terminal: { confirmed: true, summary: "Actual exit", outputFile: null } }),
        stopping.checkpoint,
      );
      expect(ended.frames[0]).toMatchObject({ status: expected, output_file: "" });
    }
    expect(projectTask(worker, observation(3, { status: "killed" }), stopping.checkpoint).skipped).toBe("unconfirmed");
  });
  test("only explicit authoritative resume reopens and keeps task identity", () => {
    const done = finish();
    const resumedLink = { ...worker, runToolUseId: "call_real-resume" };
    const resumed = projectTask(resumedLink, observation(4, { edge: "resumed" }), done.checkpoint);
    expect(resumed.frames[0]).toMatchObject({
      subtype: "task_started",
      task_id: nativeTaskId(worker),
      tool_use_id: "call_real-resume",
    });
    expect(resumed.checkpoint?.phase).toBe("active");
    if (resumedLink.kind === "worker")
      expect(
        projectChildFrame(resumedLink, {
          sourceSessionId: resumedLink.child.sourceSessionId,
          eventId: "real-resumed-child-output",
          body: { type: "user", message: { role: "user", content: "Actual tool result" } },
        })?.parent_tool_use_id,
      ).toBe(worker.launchToolUseId);
    expect(projectTask(worker, observation(5), resumed.checkpoint).skipped).toBe("stale");
    expect(projectTask(resumedLink, observation(2, { edge: "resumed" }), done.checkpoint).skipped).toBe("stale");
  });
  test("preparing, unknown and orphan terminals never invent a running child", () => {
    for (const status of ["preparing", "unknown", "completed"] as const)
      expect(projectTask(worker, observation(1, { status })).frames).toEqual([]);
    const started = start(shell);
    const unknown = projectTask(
      shell,
      observation(2, { status: "unknown", isBackgrounded: false }),
      started.checkpoint,
    );
    expect(unknown.frames).toEqual([]);
    expect(unknown.checkpoint?.isBackgrounded).toBe(true);
    expect(
      projectBackgroundRoster(root, "snapshot-2", [{ link: shell, checkpoint: unknown.checkpoint }]).tasks,
    ).toHaveLength(1);
  });
  test("shells and genuine monitors are opaque; roster REPLACE is full and accurate", () => {
    const monitor: TaskLink = {
      ...shell,
      kind: "monitor",
      jobId: "actual-watcher",
      launchToolUseId: "call_actual-monitor",
    };
    expect(start(shell).frames[0]).toMatchObject({ task_type: "local_bash" });
    expect(start(monitor).frames[0]).toMatchObject({ task_type: "local_bash", tool_use_id: monitor.launchToolUseId });
    expect(
      projectTask(
        shell,
        observation(2, { progress: { description: "stdout is not a worker", usage } }),
        start(shell).checkpoint,
      ).frames,
    ).toEqual([]);
    const roster = projectBackgroundRoster(root, "roster-real-1", [
      { link: worker, checkpoint: start().checkpoint },
      { link: shell, checkpoint: start(shell).checkpoint },
      { link: monitor, checkpoint: start(monitor).checkpoint, ambient: true },
    ]);
    expect(roster).toMatchObject({ type: "system", subtype: "background_tasks_changed", session_id: root.sessionId });
    expect(roster.tasks).toHaveLength(2);
    expect(roster.tasks).toContainEqual({
      task_id: nativeTaskId(monitor),
      task_type: "local_bash",
      description: "Inspecting tasks",
      ambient: true,
    });
    expect(
      projectBackgroundRoster(root, "roster-real-2", [{ link: shell, checkpoint: finish(shell).checkpoint }]).tasks,
    ).toEqual([]);
    const foreground = projectTask(shell, observation(1, { isBackgrounded: false }));
    expect(
      projectBackgroundRoster(root, "foreground", [{ link: shell, checkpoint: foreground.checkpoint }]).tasks,
    ).toEqual([]);
    const background = projectTask(shell, observation(2), foreground.checkpoint);
    expect(background.frames).toEqual([]); // no second task_started on backgrounding
    expect(
      projectBackgroundRoster(root, "background", [{ link: shell, checkpoint: background.checkpoint }]).tasks,
    ).toHaveLength(1);
  });
  test("IDs stable across reload, distinct across actual job/root/source namespaces", () => {
    expect(nativeTaskId({ ...worker })).toBe(nativeTaskId(worker));
    const variants: TaskLink[] = [
      { ...worker, jobId: "second-job" },
      { ...worker, sourceId: "ssh:host-owner" },
      { ...worker, root: { ...root, sessionId: "another-native-root" } },
    ];
    expect(new Set([nativeTaskId(worker), ...variants.map(nativeTaskId)]).size).toBe(4);
    expect(nativeTaskMessageId(worker, "original", "task_started")).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    );
    expect(() => projectTask(variants[0], observation(2), start().checkpoint)).toThrow("another job/link");
  });
  test("nested real parent link and child output have explicit causal attribution", () => {
    if (worker.kind !== "worker") throw new Error("fixture");
    const nested: TaskLink = {
      ...worker,
      jobId: "actual-nested-job",
      launchToolUseId: "call_nested-launch",
      parent: { sourceSessionId: worker.child.sourceSessionId, launchToolUseId: worker.launchToolUseId },
      child: { sourceSessionId: "/real/nested.jsonl", parentSessionId: worker.child.sourceSessionId },
      spawnDepth: 2,
    };
    const launchBody = {
      type: "assistant" as const,
      message: {
        id: "real-assistant-launch",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: nested.launchToolUseId,
            name: "Agent",
            input: { prompt: "Real nested prompt", description: "Real nested worker" },
          },
        ],
      },
    };
    // This real launch is routed in the parent's child thread BEFORE nested task_started.
    const parentLaunch = projectChildFrame(worker, {
      sourceSessionId: worker.child.sourceSessionId,
      eventId: "actual-parent-launch-event",
      body: launchBody,
    });
    expect(parentLaunch?.parent_tool_use_id).toBe(worker.launchToolUseId);
    expect(parentLaunch?.message).toEqual(launchBody.message);
    expect(start(nested).frames[0]).toMatchObject({ tool_use_id: nested.launchToolUseId, spawn_depth: 2 });
    const body = {
      type: "assistant" as const,
      message: {
        id: "actual-nested-answer",
        role: "assistant",
        content: [{ type: "text", text: "Actual nested answer" }],
      },
    };
    expect(
      projectChildFrame(nested, { sourceSessionId: "/real/nested.jsonl", eventId: "real-answer-event", body }),
    ).toEqual({
      ...body,
      parent_tool_use_id: nested.launchToolUseId,
      session_id: root.sessionId,
      uuid: nativeTaskMessageId(nested, "real-answer-event", "child:assistant"),
    });
    expect(() =>
      projectChildFrame(nested, { sourceSessionId: worker.child.sourceSessionId, eventId: "wrong", body }),
    ).toThrow("explicitly linked");
    expect(() => start({ ...nested, parent: { ...nested.parent, launchToolUseId: null } })).toThrow("Nested parent");
    expect(() =>
      start({ ...nested, child: { sourceSessionId: "/real/nested.jsonl", parentSessionId: "/wrong.jsonl" } }),
    ).toThrow("actual launching parent");
  });
  test("T3 app-owned delegation never has a duplicate provider-native projection", () => {
    const app: TaskLink = { ...shell, origin: "app_owned", kind: "app_task" };
    expect(start(app)).toEqual({ frames: [], skipped: "app-owned" });
    expect(projectBackgroundRoster(root, "app-roster", [{ link: app }]).tasks).toEqual([]);
    expect(
      projectChildFrame(app, {
        sourceSessionId: "real-T3-child",
        eventId: "app-event",
        body: { type: "user", message: { role: "user", content: "Actual prompt" } },
      }),
    ).toBeNull();
  });
  test("injected handler receives frames and cursor, no internal job registry", async () => {
    let checkpoint: TaskProjectionCheckpoint | undefined;
    const frames: unknown[] = [];
    const projector = createTaskProjector({
      publish: async (result) => {
        frames.push(...result.frames);
        checkpoint = result.checkpoint ?? checkpoint;
      },
    });
    await projector.task(worker, observation(1), checkpoint);
    await projector.task(worker, observation(2), checkpoint);
    await projector.task(
      worker,
      observation(3, {
        status: "completed",
        terminal: { confirmed: true, summary: "Late actual answer", outputFile: null },
      }),
      checkpoint,
    );
    expect(frames).toHaveLength(2);
    expect(checkpoint?.phase).toBe("terminal");
  });
});

test("real local TaskSummary shape suppresses preparing/stop request and confirms actual close", () => {
  const local = {
    id: worker.jobId,
    kind: "agent" as const,
    status: "running" as const,
    command: "bruv child",
    background: true,
    agent: {
      sessionFile: "/real/child-1.jsonl",
      parentSessionFile: root.sourceSessionId,
      phase: "running tool",
      currentTool: "read",
    },
  };
  const reservation = projectLocalTask(
    worker,
    { ...local, workspace: { preparationStatus: "preparing" }, agent: undefined },
    { revision: 1, eventId: "real-reservation" },
  );
  expect(reservation.frames).toEqual([]);
  const active = projectLocalTask(worker, local, { revision: 2, eventId: "real-spawn", usage }, reservation.checkpoint);
  expect(active.frames).toHaveLength(2);
  expect(active.frames[1]).toMatchObject({ description: "running tool", last_tool_name: "read", usage });
  const stopping = projectLocalTask(
    worker,
    { ...local, termination: { requestedAt: "2026-10-03T15:00:00Z" } },
    { revision: 3, eventId: "real-stop-request" },
    active.checkpoint,
  );
  expect(stopping.frames).toEqual([]);
  const unclosed = projectLocalTask(
    worker,
    { ...local, status: "killed" },
    { revision: 4, eventId: "unconfirmed-exit", result: { summary: "Output", outputFile: null } },
    stopping.checkpoint,
  );
  expect(unclosed.skipped).toBe("unconfirmed");
  const closed = projectLocalTask(
    worker,
    { ...local, status: "killed", completedAt: "2026-10-03T15:00:01Z" },
    {
      revision: 5,
      eventId: "real-close",
      result: { summary: "Actual partial output", outputFile: null, truncated: true },
    },
    unclosed.checkpoint,
  );
  expect(closed.frames[0]).toMatchObject({
    subtype: "task_notification",
    status: "stopped",
    summary: "[Truncated Bruv job output]\nActual partial output",
    output_file: "",
  });
  expect(() =>
    projectLocalTask(
      worker,
      { ...local, agent: { ...local.agent, parentSessionFile: "/wrong.jsonl" } },
      { revision: 6, eventId: "wrong-link" },
    ),
  ).toThrow("actual child/parent");
});

// Real local process state/output, with an explicit fixture launch-call binding; no model/provider request.
test("real local shell events project success, failure and confirmed cancellation", async () => {
  for (const [command, expected] of [
    ["printf 'actual shell output\n'", "completed"],
    ["printf 'actual failure output\n'; exit 7", "failed"],
    ["exec sleep 5", "stopped"],
  ] as const) {
    const manager = new TaskManager(() => {}, 20);
    const events: TaskEvent[] = [];
    const unsubscribe = manager.subscribe((event) => events.push(event));
    try {
      const task = manager.spawn({
        kind: "command",
        command: "/bin/sh",
        args: ["-c", command],
        displayCommand: command,
        cwd: process.cwd(),
        notifyOnComplete: true,
      });
      const link: TaskLink = { ...shell, jobId: task.id, launchToolUseId: "explicit-fixture-launch:" + task.id };
      if (expected === "stopped") manager.kill(task.id);
      const result = await manager.wait(task.id);
      let checkpoint: TaskProjectionCheckpoint | undefined;
      const frames: unknown[] = [];
      for (const [index, event] of events.entries()) {
        const projected = projectLocalTask(
          link,
          event.task,
          {
            revision: index + 1,
            eventId: task.id + ":source-event:" + index,
            ...(event.type === "completed" ? { result: { summary: result.output, outputFile: null } } : {}),
          },
          checkpoint,
        );
        if (event.type === "stopping") expect(projected.frames).toEqual([]);
        frames.push(...projected.frames);
        checkpoint = projected.checkpoint;
      }
      expect(frames).toHaveLength(2);
      expect(frames[0]).toMatchObject({
        subtype: "task_started",
        task_type: "local_bash",
        task_id: nativeTaskId(link),
      });
      expect(frames[1]).toMatchObject({
        subtype: "task_notification",
        status: expected,
        summary: result.output,
        output_file: "",
      });
      expect(checkpoint?.phase).toBe("terminal");
      expect(result.completedAt).toBeDefined();
      if (expected !== "stopped") expect(result.output).toContain("actual");
    } finally {
      unsubscribe();
      await manager.shutdown();
    }
  }
});

test("confirmed exit with evicted output clears roster without inventing a result", () => {
  const started = start(shell);
  const finished = projectLocalTask(
    shell,
    {
      id: shell.jobId,
      kind: "command",
      status: "failed",
      command: "real command",
      background: true,
      completedAt: "2026-10-03T15:00:01Z",
    },
    { revision: 2, eventId: "real-close-output-evicted" },
    started.checkpoint,
  );
  expect(finished.frames[0]).toMatchObject({
    subtype: "task_notification",
    status: "failed",
    summary: "",
    output_file: "",
  });
  expect(
    projectBackgroundRoster(root, "snapshot-after-real-close", [{ link: shell, checkpoint: finished.checkpoint }])
      .tasks,
  ).toEqual([]);
});
