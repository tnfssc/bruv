import { expect, test } from "bun:test";
import remoteExtension from "../../src/remote/extension";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test("a refresh awaiting its baseline cannot adopt an unowned task into the next UI session", async () => {
  const handlers = new Map<string, Function>();
  const baselineEntered = deferred<void>();
  const baseline = deferred<any>();
  const nextSessionRead = deferred<void>();
  const messages: string[] = [];
  const entries: Array<{ type: string; data: any }> = [];
  const task = { taskId: "old-session", events: [], task: { state: "running" } };
  let statusCalls = 0;
  let syncs = 0;
  remoteExtension(
    {
      on: (name: string, handler: Function) => handlers.set(name, handler),
      registerCommand() {},
      sendMessage: (message: any) => messages.push(message.content),
      appendEntry: (type: string, data: any) => entries.push({ type, data }),
    } as any,
    {
      status: async () => {
        if (++statusCalls === 1) {
          baselineEntered.resolve();
          return baseline.promise;
        }
        if (statusCalls === 3) nextSessionRead.resolve();
        return { tasks: { [task.taskId]: task } };
      },
      syncActive: async () => {
        syncs++;
        task.task.state = "done";
      },
    } as any,
  );
  const start = (file: string) =>
    handlers.get("session_start")!(
      {},
      {
        sessionManager: { getSessionFile: () => file, getBranch: () => [] },
      },
    );
  try {
    await start("/sessions/A.jsonl");
    await baselineEntered.promise;
    await handlers.get("session_shutdown")!();
    await start("/sessions/B.jsonl");
    // B is queued behind A's cache read; closing A invalidates publication, not I/O.
    expect(statusCalls).toBe(1);
    expect(syncs).toBe(0);
    // The old cache snapshot is running; B sees the already-terminal current cache.
    const staleTask = { ...task, task: { state: "running" } };
    task.task.state = "done";
    baseline.resolve({ tasks: { [task.taskId]: staleTask } });
    await nextSessionRead.promise;
    // Terminal history has no footer effect; let the final read's publication tail drain.
    await Bun.sleep(0);
    expect(statusCalls).toBe(3);
    expect(syncs).toBe(1);
    expect(messages.filter((message) => message.includes("Remote old-session · done"))).toEqual([]);
    expect(entries.filter((entry) => entry.type === "bruv-remote-active")).toEqual([]);
  } finally {
    baseline.resolve({ tasks: {} });
    await handlers.get("session_shutdown")!();
  }
});

for (const failure of [false, true])
  test("a switched-away refresh cannot publish late sync " + (failure ? "errors" : "results"), async () => {
    const handlers = new Map<string, Function>();
    const entered = deferred<void>();
    const release = deferred<void>();
    const nextSessionRead = deferred<void>();
    const messages: string[] = [];
    const statuses: Array<string | undefined> = [];
    let syncs = 0;
    const task = { taskId: "from-A", events: [], task: { state: "running" } };
    remoteExtension(
      {
        on: (name: string, handler: Function) => handlers.set(name, handler),
        registerCommand() {},
        sendMessage: (message: any) => messages.push(message.content),
      } as any,
      {
        status: async () => {
          if (syncs === 2) nextSessionRead.resolve();
          return { tasks: { [task.taskId]: task } };
        },
        syncActive: async () => {
          if (++syncs === 1) {
            entered.resolve();
            await release.promise;
            if (failure) throw Error("A-only offline error");
          }
        },
      } as any,
    );
    const start = (file: string) =>
      handlers.get("session_start")!(
        {},
        {
          hasUI: true,
          ui: {
            setStatus: (_key: string, value: string | undefined) => {
              statuses.push(value);
            },
          },
          sessionManager: { getSessionFile: () => file, getBranch: () => [] },
        },
      );
    try {
      await start("A");
      await entered.promise;
      await handlers.get("session_shutdown")!();
      task.task.state = "done";
      await start("B");
      expect(syncs).toBe(1);
      release.resolve();
      await nextSessionRead.promise;
      // The healthy terminal snapshot emits no footer; drain its publication tail.
      await Bun.sleep(0);
      expect(syncs).toBe(2);
      expect(messages).toEqual([]);
      expect(statuses.some((status) => status?.includes("offline"))).toBe(false);
    } finally {
      release.resolve();
      await handlers.get("session_shutdown")!();
    }
  });

// Exercise both publication boundaries: a late snapshot can set a banner, and
// a late picker result can clear one. Neither effect survives session closure.
for (const heldAt of ["snapshot", "choice"] as const)
  test("a picker held at " + heldAt + " cannot set or clear session B's status", async () => {
    const handlers = new Map<string, Function>();
    let command: any;
    const oldSessionPublished = deferred<void>();
    const snapshotEntered = deferred<void>();
    const snapshot = deferred<any>();
    const pickerEntered = deferred<void>();
    const picker = deferred<string | undefined>();
    const nextSessionPublished = deferred<void>();
    const oldStatus: Array<string | undefined> = [];
    const nextStatus: Array<string | undefined> = [];
    const state = {
      tasks: { cached: { taskId: "cached", prompt: "work", events: [], task: { state: "running" } } },
    };
    const context = (file: string, ui: any) => ({
      hasUI: true,
      ui,
      sessionManager: { getSessionFile: () => file, getBranch: () => [] },
    });
    const oldContext = context("A", {
      setStatus: (_key: string, status: string | undefined) => {
        oldStatus.push(status);
        if (status !== undefined) oldSessionPublished.resolve();
      },
      custom: () => {
        pickerEntered.resolve();
        return picker.promise;
      },
    });
    const nextContext = context("B", {
      setStatus: (_key: string, status: string | undefined) => {
        nextStatus.push(status);
        if (status !== undefined) nextSessionPublished.resolve();
      },
    });
    let statusCalls = 0;
    remoteExtension(
      {
        on: (name: string, handler: Function) => handlers.set(name, handler),
        registerCommand: (_name: string, value: any) => (command = value),
        sendMessage() {},
      } as any,
      {
        status: async () => {
          // A's completed poll reads twice; the next read belongs to its menu.
          if (++statusCalls === 3) {
            snapshotEntered.resolve();
            return snapshot.promise;
          }
          return state;
        },
        syncActive: async () => {},
      } as any,
    );
    let menu: Promise<void> | undefined;
    try {
      await handlers.get("session_start")!({}, oldContext);
      await oldSessionPublished.promise;
      expect(statusCalls).toBe(2);
      menu = command.handler("", oldContext);
      await snapshotEntered.promise;
      if (heldAt === "choice") {
        snapshot.resolve(state);
        await pickerEntered.promise;
      }
      await handlers.get("session_shutdown")!();
      await handlers.get("session_start")!({}, nextContext);
      await nextSessionPublished.promise;
      expect(nextStatus).toStrictEqual(["remote: 1 active"]);
      const closedStatus = [...oldStatus];

      // The old menu's I/O still finishes. Only its UI authority is invalidated.
      snapshot.resolve(state);
      await pickerEntered.promise;
      expect(oldStatus).toStrictEqual(closedStatus);
      expect(nextStatus).toStrictEqual(["remote: 1 active"]);
      picker.resolve(undefined);
      await menu;
      expect(oldStatus).toStrictEqual(closedStatus);
      expect(nextStatus).toStrictEqual(["remote: 1 active"]);
      expect(statusCalls).toBe(5);
    } finally {
      snapshot.resolve(state);
      picker.resolve(undefined);
      await menu;
      await handlers.get("session_shutdown")!();
    }
  });
