import { expect, test } from "bun:test";
import { getKeybindings, visibleWidth } from "@earendil-works/pi-tui";
import { TaskManager, type TaskSummary } from "../../src/tasks/task-manager";
import type { RemoteJobsAdapter, SshJob } from "../../src/remote/jobs";
import { MergedTaskMonitorSource } from "../../src/tasks/task-monitor-source";
import { TaskMonitorPanel } from "../../src/ui/task-monitor";
import { registerTaskMonitor } from "../../src/tasks/task-monitor";

const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
const session = "/fixture/parent.jsonl";
const tick = () => Bun.sleep(0);
const job = (patch: Partial<SshJob> = {}): SshJob => ({
  id: "ssh:dGFzaw",
  kind: "ssh",
  source: "ssh",
  status: "unknown",
  stale: true,
  outcome: "unknown",
  host: "fixture-host",
  target: "fixture-host",
  ownerId: "fixture-owner",
  epoch: "epoch-1",
  ...patch,
});
function localFixture(tasks: TaskSummary[] = []) {
  const listeners = new Set<() => void>();
  const stopped: string[] = [];
  const manager = {
    list: () => tasks,
    inspect: (_id: string, offset: number, limit: number) => ({ output: "local-output".slice(offset, offset + limit) }),
    kill: (id: string) => stopped.push(id),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  } as unknown as TaskManager;
  return { manager, listeners, stopped };
}
function remoteFixture(initial = [job()]) {
  let tasks = initial;
  let listError: Error | undefined;
  let stopError: Error | undefined;
  let stopResult = job({ cancelRequested: true, cancelDelivery: "pending" });
  let output = "cached-output";
  const calls: Array<[string, string, string?, number?, number?]> = [];
  const remote = {
    list: async (file: string) => {
      calls.push(["list", file]);
      if (listError) throw listError;
      return tasks;
    },
    inspect: async (file: string, id: string, offset = 0, limit = 5000) => {
      calls.push(["inspect", file, id, offset, limit]);
      return {
        ...tasks.find((task) => task.id === id)!,
        output,
        requestedOffset: offset,
        nextOffset: output.length,
        hasMore: true,
        outputLost: true,
      };
    },
    stop: async (file: string, id: string) => {
      calls.push(["stop", file, id]);
      if (stopError) throw stopError;
      return { ...stopResult, cancellationRequested: true };
    },
  } as RemoteJobsAdapter;
  return {
    remote,
    calls,
    tasks: (value: SshJob[]) => {
      tasks = value;
    },
    listError: (value?: Error) => {
      listError = value;
    },
    stopError: (value?: Error) => {
      stopError = value;
    },
    stopResult: (value: SshJob) => {
      stopResult = value;
    },
    output: (value: string) => {
      output = value;
    },
  };
}
function panelFor(source: MergedTaskMonitorSource, height = () => 22, changed = () => {}) {
  return new TaskMonitorPanel(
    source,
    theme as any,
    getKeybindings(),
    () => {},
    changed,
    height,
    () => source.dispose(),
  );
}

test("merged monitor keeps local routing and scopes every SSH read to its durable session", async () => {
  const task: TaskSummary = {
    id: "local",
    kind: "command",
    command: "fixture-command",
    cwd: "/fixture",
    status: "running",
    startedAt: new Date().toISOString(),
    baseOffset: 0,
    outputEnd: 12,
    timedOut: false,
  };
  const local = localFixture([task]);
  const remote = remoteFixture([job(), job({ id: "ssh:ZG9uZQ", status: "completed" })]);
  const source = new MergedTaskMonitorSource(local.manager, remote.remote, session);
  const panel = panelFor(source);
  try {
    await tick();
    expect(source.list().map((task) => task.id)).toEqual(["local", "ssh:dGFzaw", "ssh:ZG9uZQ"]);
    expect(source.inspect("local", 0, 5).output).toBe("local");
    source.kill("local");
    expect(local.stopped).toEqual(["local"]);
    const frame = panel.render(120).join("\n");
    expect(frame).toContain("local");
    expect(frame).toContain("ssh:dGFzaw");
    expect(frame).toContain("ssh unknown stale");
    expect(frame).not.toContain("ssh:ZG9uZQ");
    panel.handleInput("j");
    panel.render(120);
    await tick();
    expect(remote.calls.every((call) => call[1] === session)).toBe(true);
    expect(remote.calls.some((call) => call[0] === "stop")).toBe(false);
  } finally {
    panel.dispose();
  }
  expect(local.listeners.size).toBe(0);
});

test("SSH output is bounded cache-only and observations are explicitly stale, not live", async () => {
  const remote = remoteFixture([job({ observedAt: "2026-01-01T00:00:00Z", remoteState: "accepted" })]);
  remote.output("\x1b]52;c;secret\x07" + "€".repeat(5000));
  const source = new MergedTaskMonitorSource(localFixture().manager, remote.remote, session);
  const panel = panelFor(source, () => 28);
  try {
    await tick();
    panel.handleInput("i");
    panel.render(120);
    await tick();
    const frame = panel.render(120).join("\n");
    expect(frame).toContain("SSH cached output · first 5000 bytes");
    expect(frame).toContain("stale observation 2026-01-01T00:00:00Z");
    expect(frame).toContain("owner fixture-owner · epoch epoch-1");
    expect(frame).toContain("Cached transcript has gaps");
    expect(frame).not.toContain("Live preview");
    expect(frame).not.toContain("secret");
    expect(Buffer.byteLength(source.inspect(job().id, 123456, 5000).output)).toBeLessThanOrEqual(5000);
    expect(Buffer.byteLength(source.inspect(job().id, 0, 2400).output)).toBeLessThanOrEqual(2400);
    expect(remote.calls.filter((call) => call[0] === "inspect")).toEqual([["inspect", session, job().id, 0, 5000]]);
  } finally {
    panel.dispose();
  }
});

test("cache read failure retains unknown placed tasks and never invents failure", async () => {
  const remote = remoteFixture();
  const source = new MergedTaskMonitorSource(localFixture().manager, remote.remote, session);
  const panel = panelFor(source);
  try {
    await tick();
    remote.listError(new Error("fixture-offline"));
    await source.refresh();
    const frame = panel.render(120).join("\n");
    expect(frame).toContain("prior observations retained");
    expect(frame).toContain(job().id);
    expect(source.list()[0]?.status).toBe("unknown");
    remote.listError();
    remote.tasks([job({ status: "completed" })]);
    await source.refresh();
    expect(panel.render(120).join("\n")).toContain("No jobs are running");
  } finally {
    panel.dispose();
  }
});

test("pending SSH cancellation and stop errors remain visible, never presented as stopped", async () => {
  const remote = remoteFixture();
  const source = new MergedTaskMonitorSource(localFixture().manager, remote.remote, session);
  const panel = panelFor(source);
  try {
    await tick();
    panel.handleInput("s");
    panel.handleInput("y");
    await tick();
    let frame = panel.render(120).join("\n");
    expect(frame).toContain("SSH cancellation pending");
    expect(source.list()[0]?.status).toBe("unknown");
    expect(frame).toContain(job().id);
    remote.stopError(new Error("offline fixture"));
    panel.handleInput("s");
    panel.handleInput("y");
    await tick();
    frame = panel.render(120).join("\n");
    expect(frame).toContain("SSH stop error; not confirmed stopped");
    expect(source.list()[0]?.status).toBe("unknown");
    expect(remote.calls.filter((call) => call[0] === "stop").length).toBe(2);
    remote.stopError();
    remote.stopResult(job({ status: "cancelled" }));
    panel.handleInput("s");
    panel.handleInput("y");
    await tick();
    expect(panel.render(120).join("\n")).toContain("No jobs are running");
  } finally {
    panel.dispose();
  }
});

test("frozen SSH confirmation retains narrow-terminal safety and checks owner/epoch", async () => {
  const remote = remoteFixture();
  const source = new MergedTaskMonitorSource(localFixture().manager, remote.remote, session);
  let rows = 1;
  const panel = panelFor(source, () => rows);
  try {
    await tick();
    for (rows = 0; rows <= 9; rows++) {
      const tiny = panel.render(25);
      expect(tiny.length).toBeLessThanOrEqual(rows);
      if (rows > 0) expect(tiny.join("\n")).toContain(job().id);
    }
    rows = 1;
    const frame = panel.render(25);
    expect(frame.length).toBe(1);
    expect(frame[0]).toContain(job().id);
    expect(visibleWidth(frame[0]!)).toBeLessThanOrEqual(25);
    panel.handleInput("s");
    expect(panel.render(100).join("\n")).toContain("Stop " + job().id);
    rows = 0;
    panel.handleInput("y");
    expect(remote.calls.some((call) => call[0] === "stop")).toBe(false);
    rows = 2;
    remote.tasks([job({ epoch: "epoch-2" })]);
    await source.refresh();
    panel.handleInput("y");
    await tick();
    expect(remote.calls.some((call) => call[0] === "stop")).toBe(false);
    // Even if the UI has not refreshed yet, stop revalidates ownership in its scoped cache.
    remote.tasks([job({ ownerId: "new-owner", epoch: "epoch-3" })]);
    await source.kill(job().id);
    expect(remote.calls.some((call) => call[0] === "stop")).toBe(false);
    expect(source.list()[0]?.monitorNote).toContain("ownership changed");
  } finally {
    panel.dispose();
  }
});

test("absence of durable session does not query other sessions or touch SSH", async () => {
  const remote = remoteFixture();
  const source = new MergedTaskMonitorSource(localFixture().manager, remote.remote);
  const panel = panelFor(source);
  try {
    await source.refresh();
    expect(remote.calls).toEqual([]);
    expect(panel.render(100).join("\n")).toContain("without a durable session");
  } finally {
    panel.dispose();
  }
});

test("adapter disposal detaches only its subscription and discards late asynchronous reads", async () => {
  const local = localFixture();
  const independent = () => {};
  const off = local.manager.subscribe(independent);
  let finish!: (tasks: SshJob[]) => void;
  let lists = 0;
  const remote = remoteFixture();
  remote.remote.list = async () => {
    lists++;
    return await new Promise<SshJob[]>((resolve) => {
      finish = resolve;
    });
  };
  const source = new MergedTaskMonitorSource(local.manager, remote.remote, session);
  let changes = 0;
  source.subscribe(() => changes++);
  expect(local.listeners.size).toBe(2);
  source.dispose();
  source.dispose();
  finish([job()]);
  await tick();
  await source.refresh();
  expect(source.list()).toEqual([]);
  expect(changes).toBe(0);
  expect(lists).toBe(1);
  expect(local.listeners.size).toBe(1);
  off();
});

test("ordinary /ps wiring captures the session and panel owns adapter cleanup", async () => {
  const local = localFixture();
  const remote = remoteFixture();
  let handler!: (_args: string, ctx: any) => Promise<void>;
  registerTaskMonitor(
    {
      registerCommand: (_name: string, command: any) => {
        handler = command.handler;
      },
    } as any,
    () => local.manager,
    remote.remote,
  );
  await handler("", {
    mode: "tui",
    sessionManager: { getSessionFile: () => session },
    ui: {
      custom: async (factory: any) => {
        const panel: TaskMonitorPanel = factory(
          { requestRender: () => {}, terminal: { rows: 22 } },
          theme,
          getKeybindings(),
          () => {},
        );
        await tick();
        expect(panel.render(100).join("\n")).toContain(job().id);
        panel.dispose();
      },
    },
  });
  expect(remote.calls[0]).toEqual(["list", session]);
  expect(local.listeners.size).toBe(0);
});

test("late output and stop preflight cannot update or contact SSH after panel close", async () => {
  const remote = remoteFixture();
  const local = localFixture();
  const source = new MergedTaskMonitorSource(local.manager, remote.remote, session);
  await tick();
  let finishOutput!: (value: Awaited<ReturnType<RemoteJobsAdapter["inspect"]>>) => void;
  remote.remote.inspect = async () =>
    await new Promise((resolve) => {
      finishOutput = resolve;
    });
  source.inspect(job().id, 0, 5000);
  let finishList!: (value: SshJob[]) => void;
  remote.remote.list = async () =>
    await new Promise((resolve) => {
      finishList = resolve;
    });
  const stop = source.kill(job().id);
  source.dispose();
  finishList([job()]);
  finishOutput({ ...job(), output: "late", requestedOffset: 0, nextOffset: 4, outputLost: false, hasMore: false });
  await stop;
  await tick();
  expect(source.list()[0]?.outputEnd).toBe(0);
  expect(remote.calls.some((call) => call[0] === "stop")).toBe(false);
  expect(local.listeners.size).toBe(0);
});

test("monitor does not consume or duplicate the local completion delivery", async () => {
  let deliveries = 0;
  const manager = new TaskManager(() => {
    deliveries++;
  });
  const remote = remoteFixture();
  const source = new MergedTaskMonitorSource(manager, remote.remote, session);
  const panel = panelFor(source);
  try {
    const task = manager.spawn({
      kind: "command",
      command: process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "/bin/sh",
      args: process.platform === "win32" ? ["/c", "echo fixture-complete"] : ["-c", "printf fixture-complete"],
      cwd: process.cwd(),
      notifyOnComplete: true,
      displayCommand: "fixture-completion",
    });
    await manager.wait(task.id);
    await tick();
    panel.render(100);
    remote.tasks([job({ status: "completed" })]);
    await source.refresh();
    panel.render(100);
    expect(deliveries).toBe(1);
  } finally {
    panel.dispose();
    await manager.shutdown();
  }
});
