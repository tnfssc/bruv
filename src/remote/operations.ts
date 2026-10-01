import { repositoryPreparations } from "./repository-wire";
import { requestLocalCapability } from "./services";
import type { CapabilityKind } from "./capabilities";
import { RemoteClient, type RemoteTask } from "./client";
export type RemoteOperation =
  | { op: "status" }
  | { op: "launchRepository"; prompt: string; taskId?: string; model?: string; thinking?: string }
  | { op: "cancel"; taskId: string }
  | { op: "requestCapability"; kind: CapabilityKind; input: string; requestId?: string }
  | { op: "launch"; repoPath: string; prompt: string; taskId?: string; model?: string; thinking?: string }
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
    return {
      connection: state.connection,
      cached: true,
      tasks: Object.values(state.tasks).map(summary),
      repositoryPreparations: await repositoryPreparations(client),
    };
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
  return async (
    args: RemoteOperation,
    cwd = process.cwd(),
    signal?: AbortSignal,
    jobSessionFile?: string,
  ): Promise<unknown> => {
    if (!args || typeof args !== "object") throw new Error("Invalid remote operation");
    switch (args.op) {
      case "status":
        return status();
      case "launchRepository":
      case "launch":
        throw new Error(
          "Remote task launch uses subagent({ target: <authorized name>, ... }); legacy remote launch helpers cannot bypass delegation role/depth policy.",
        );
      case "requestCapability":
        return requestLocalCapability(args, signal);
      case "cancel":
        return summary(await client.cancel(args.taskId));
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
