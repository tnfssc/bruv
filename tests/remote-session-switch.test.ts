import { expect, test } from "bun:test";
import remoteExtension from "../src/remote/extension";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

test("a refresh awaiting its baseline cannot adopt an unowned task into the next UI session", async () => {
  const handlers = new Map<string, Function>();
  const baselineEntered = deferred<void>();
  const baseline = deferred<any>();
  const messages: string[] = [];
  const entries: Array<{ type: string; data: any }> = [];
  const task = { taskId: "old-session", events: [], task: { state: "running" } };
  let statusCalls = 0;
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
        return { tasks: { [task.taskId]: task } };
      },
      syncActive: async () => { task.task.state = "done"; },
    } as any,
  );
  const start = (file: string) => handlers.get("session_start")!({}, {
    sessionManager: { getSessionFile: () => file, getBranch: () => [] },
  });
  try {
    await start("/sessions/A.jsonl");
    await baselineEntered.promise;
    await handlers.get("session_shutdown")!();
    await start("/sessions/B.jsonl");
    baseline.resolve({ tasks: { [task.taskId]: task } });
    // Wait for both status calls / notification processing without depending on the 5s poll timer.
    for (let i = 0; i < 10 && statusCalls < 2; i++) await Bun.sleep(0);
    await Bun.sleep(0);
    expect(messages.filter((message) => message.includes("Remote old-session · done"))).toEqual([]);
    expect(entries.filter((entry) => entry.type === "die-remote-active")).toEqual([]);
  } finally {
    await handlers.get("session_shutdown")!();
  }
});
