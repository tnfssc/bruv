import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerRemoteRuntime } from "./runtime";
import { RemoteClient } from "./client";
import { createRemoteOperations, summarizeRemoteTask } from "./operations";

export function parseRemoteLaunch(input: string): { repoPath: string; prompt: string } {
  const start = /^\s*launch\s+/.exec(input);
  if (!start) throw new Error("Usage: /remote launch <absolute-remote-repo-path> <prompt>");
  let i = start[0].length,
    repoPath = "",
    quote = "";
  for (; i < input.length; i++) {
    const c = input[i]!;
    if (c === "\\" && quote !== "'") {
      if (++i >= input.length) throw new Error("Incomplete path escape");
      repoPath += input[i];
    } else if (quote) {
      if (c === quote) quote = "";
      else repoPath += c;
    } else if (c === "'" || c === '"') quote = c;
    else if (/\s/.test(c)) break;
    else repoPath += c;
  }
  if (quote) throw new Error("Unclosed repository path quote");
  const prompt = input.slice(i + 1);
  if (!repoPath || !prompt.trim()) throw new Error("Usage: /remote launch <absolute-remote-repo-path> <prompt>");
  return { repoPath, prompt };
}

/** The agent cannot choose SSH hosts: only a human /remote connect sets the host. */
export default function remoteExtension(pi: ExtensionAPI, client = new RemoteClient()): void {
  registerRemoteRuntime(pi);
  const operations = createRemoteOperations(client);
  const summary = summarizeRemoteTask;
  const status = () => operations({ op: "status" });
  const transcript = (taskId: string, offset = 0) => operations({ op: "transcript", taskId, offset });
  const publish = (result: unknown) =>
    pi.sendMessage({ customType: "die-remote", content: JSON.stringify(result, null, 2), display: true });
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
              scope:
                "Host configuration and transcript cache are shared across this OS user’s sessions. Existing remote repository only; no local files, tools, or credentials copied",
            };
            break;
          case "status":
            result = await status();
            break;
          case "launch": {
            const { repoPath, prompt } = parseRemoteLaunch(input);
            if (!repoPath || !prompt) throw new Error("Usage: /remote launch <absolute-remote-repo-path> <prompt>");
            result = summary(await client.launch(repoPath, prompt));
            break;
          }
          case "retry": {
            if (rest.length !== 1) throw new Error("Usage: /remote retry <taskId>");
            const saved = await client.transcript(rest[0]!);
            result = summary(
              saved.outcome === "accepted"
                ? await client.sync(saved.taskId)
                : await client.launch(saved.repoPath, saved.prompt, saved.taskId),
            );
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
