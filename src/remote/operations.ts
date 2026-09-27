import { RemoteClient, type RemoteTask } from "./client";
export type RemoteOperation =
  | { op: "status" }
  | { op: "launch"; repoPath: string; prompt: string; taskId?: string }
  | { op: "sync"; taskId: string }
  | { op: "transcript"; taskId: string; offset?: number };

export const summarizeRemoteTask = (task: RemoteTask) => ({
  ...task,
  events: undefined,
  cached: true,
  observation: task.lastError
    ? "Current remote status unavailable; cached observation only: " + task.lastError
    : "Last synchronized state, not live status",
  eventCount: task.events.length,
});

/** Reads the human-pinned state. No operation accepts an SSH host. */
export function createRemoteOperations(client: RemoteClient = new RemoteClient()) {
  const summary = summarizeRemoteTask;
  const status = async () => {
    const state = await client.status();
    return { connection: state.connection, cached: true, tasks: Object.values(state.tasks).map(summary) };
  };
  const transcript = async (id: string, offset = 0) => {
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new Error("Transcript offset must be a nonnegative event index");
    const task = await client.transcript(id);
    const events = task.events.slice(offset, offset + 50);
    return {
      ...summary(task),
      events,
      offset,
      nextOffset: offset + events.length < task.events.length ? offset + events.length : undefined,
    };
  };
  return async (args: RemoteOperation): Promise<unknown> => {
    if (!args || typeof args !== "object") throw new Error("Invalid remote operation");
    switch (args.op) {
      case "status":
        return status();
      case "launch":
        if (
          typeof args.repoPath !== "string" ||
          typeof args.prompt !== "string" ||
          (args.taskId !== undefined && typeof args.taskId !== "string")
        )
          throw new Error("launch requires repoPath and prompt (optional taskId)");
        return summary(await client.launch(args.repoPath, args.prompt, args.taskId));
      case "sync":
        if (typeof args.taskId !== "string") throw new Error("sync requires taskId");
        return summary(await client.sync(args.taskId));
      case "transcript":
        if (typeof args.taskId !== "string" || (args.offset !== undefined && typeof args.offset !== "number"))
          throw new Error("transcript requires taskId and optional numeric offset");
        return transcript(args.taskId, args.offset);
      default:
        throw new Error("Unknown remote operation");
    }
  };
}
