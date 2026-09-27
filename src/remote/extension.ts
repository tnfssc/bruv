import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as z from "zod/mini";
import { toolParameters } from "../tool-schema";
import { registerRemoteRuntime } from "./runtime";
import { RemoteClient, type RemoteTask } from "./client";

const Parameters = z.object({
  op: z.enum(["status", "launch", "sync", "transcript"]),
  repoPath: z.optional(z.string()),
  prompt: z.optional(z.string()),
  taskId: z.optional(z.string()),
  offset: z.optional(z.number()),
});
/** The agent cannot choose SSH hosts: only a human /remote connect sets the host. */
export default function remoteExtension(pi: ExtensionAPI, client = new RemoteClient()): void {
  registerRemoteRuntime(pi);
  // The core extension fixes its tool set first; remote is assembled after it.
  pi.on("session_start", async () => {
    pi.setActiveTools([...new Set([...pi.getActiveTools(), "remote"])]);
  });
  const summary = (task: RemoteTask) => ({
    ...task,
    events: undefined,
    cached: true,
    observation: task.lastError
      ? "Current remote status unavailable; cached observation only: " + task.lastError
      : "Last synchronized state, not live status",
    eventCount: task.events.length,
  });
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
  const publish = (result: unknown) =>
    pi.sendMessage({ customType: "die-remote", content: JSON.stringify(result, null, 2), display: true });
  pi.registerTool({
    name: "remote",
    label: "Remote",
    description:
      "Use the human-configured SSH remote owner. Launch requires explicit remote repoPath and prompt; pass the SAME taskId to retry an uncertain launch; never launch a replacement automatically. Sync retrieves durable pages. Offline status/transcripts are cached, not live. Transcript returns 50 events per page; use nextOffset as offset. No local files/capabilities are transferred.",
    parameters: toolParameters(Parameters),
    async execute(_id, input) {
      const args = z.parse(Parameters, input);
      try {
        let result: unknown;
        switch (args.op) {
          case "status":
            result = await status();
            break;
          case "launch":
            if (!args.repoPath || !args.prompt) throw new Error("launch requires repoPath and prompt");
            result = summary(await client.launch(args.repoPath, args.prompt, args.taskId));
            break;
          case "sync":
            if (!args.taskId) throw new Error("sync requires taskId");
            result = summary(await client.sync(args.taskId));
            break;
          case "transcript":
            if (!args.taskId) throw new Error("transcript requires taskId");
            result = await transcript(args.taskId, args.offset);
            break;
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: {} };
      } catch (error) {
        return { content: [{ type: "text" as const, text: String(error) }], isError: true, details: {} };
      }
    },
  });
  pi.registerCommand("remote", {
    description:
      "Remote SSH owner: connect <configured-host> [absolute-die-path], status, launch <absolute-repo-path> <prompt>, retry <taskId>, sync <taskId>, transcript <taskId> [offset]",
    handler: async (input, ctx) => {
      try {
        const [op, ...rest] = input.trim().split(/\s+/);
        let result: unknown;
        switch (op) {
          case "connect":
            if (!rest[0] || rest.length > 2)
              throw new Error("Usage: /remote connect <configured-ssh-host> [absolute-remote-die-path]");
            result = {
              host: rest[0],
              ...(await client.connect(rest[0], rest[1])),
              scope: "Existing remote repository only; no local files, tools, or credentials copied",
            };
            break;
          case "status":
            result = await status();
            break;
          case "launch": {
            const repoPath = rest.shift(),
              prompt = rest.join(" ");
            if (!repoPath || !prompt) throw new Error("Usage: /remote launch <absolute-remote-repo-path> <prompt>");
            result = summary(await client.launch(repoPath, prompt));
            break;
          }
          case "retry": {
            if (rest.length !== 1) throw new Error("Usage: /remote retry <taskId>");
            const saved = await client.transcript(rest[0]!);
            result = summary(await client.launch(saved.repoPath, saved.prompt, saved.taskId));
            break;
          }
          case "sync":
            if (!rest[0]) throw new Error("Usage: /remote sync <taskId>");
            result = summary(await client.sync(rest[0]));
            break;
          case "transcript":
            if (!rest[0]) throw new Error("Usage: /remote transcript <taskId>");
            result = await transcript(rest[0], rest[1] === undefined ? 0 : Number(rest[1]));
            break;
          default:
            throw new Error("Usage: /remote connect|status|launch|retry|sync|transcript");
        }
        publish(result);
      } catch (error) {
        publish({
          error: String(error),
          hint: "Use /remote status for saved task IDs; /remote transcript <taskId> works offline. Unknown launch must reconcile the same ID, not launch again.",
        });
      }
    },
  });
}
