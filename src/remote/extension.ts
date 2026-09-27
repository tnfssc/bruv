import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as z from "zod/mini";
import { toolParameters } from "../tool-schema";
import { RemoteClient } from "./client";

const Parameters = z.object({
  op: z.enum(["status", "launch", "sync", "transcript"]),
  repoPath: z.optional(z.string()),
  prompt: z.optional(z.string()),
  taskId: z.optional(z.string()),
});
/** The agent cannot choose SSH hosts: only a human /remote connect sets the host. */
export default function remoteExtension(pi: ExtensionAPI, client = new RemoteClient()): void {
  pi.registerTool({
    name: "remote", label: "Remote", description: "Use the human-configured SSH remote owner. Launch requires explicit remote repoPath and prompt; pass taskId to retry an uncertain launch. Sync retrieves durable pages. Offline status/transcripts are cached, not live.",
    parameters: toolParameters(Parameters),
    async execute(_id, input) {
      const args = z.parse(Parameters, input);
      try {
        let result: unknown;
        switch (args.op) {
          case "status": result = await client.status(); break;
          case "launch":
            if (!args.repoPath || !args.prompt) throw new Error("launch requires repoPath and prompt");
            result = await client.launch(args.repoPath, args.prompt, args.taskId); break;
          case "sync":
            if (!args.taskId) throw new Error("sync requires taskId");
            result = await client.sync(args.taskId); break;
          case "transcript":
            if (!args.taskId) throw new Error("transcript requires taskId");
            result = await client.transcript(args.taskId); break;
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: {} };
      } catch (error) { return { content: [{ type: "text" as const, text: String(error) }], isError: true, details: {} }; }
    },
  });
  pi.registerCommand("remote", {
    description: "Remote SSH owner: connect <configured-host> [absolute-die-path], status, launch <absolute-repo-path> <prompt>, sync <taskId>, transcript <taskId>",
    handler: async (input, ctx) => {
      try {
        const [op, ...rest] = input.trim().split(/\s+/);
        let result: unknown;
        switch (op) {
          case "connect":
            if (!rest[0] || rest.length > 2) throw new Error("Usage: /remote connect <configured-ssh-host> [absolute-remote-die-path]");
            result = await client.connect(rest[0], rest[1]); break;
          case "status": result = await client.status(); break;
          case "launch": {
            const repoPath = rest.shift(), prompt = rest.join(" ");
            if (!repoPath || !prompt) throw new Error("Usage: /remote launch <absolute-remote-repo-path> <prompt>");
            result = await client.launch(repoPath, prompt); break;
          }
          case "sync": if (!rest[0]) throw new Error("Usage: /remote sync <taskId>"); result = await client.sync(rest[0]); break;
          case "transcript": if (!rest[0]) throw new Error("Usage: /remote transcript <taskId>"); result = await client.transcript(rest[0]); break;
          default: throw new Error("Usage: /remote connect|status|launch|sync|transcript");
        }
        ctx.ui.notify(JSON.stringify(result), "info");
      } catch (error) { ctx.ui.notify(String(error), "error"); }
    },
  });
}
