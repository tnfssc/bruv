import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { toolResult } from "../jobs";
import { prepareShow } from "./files";
import { showTool } from "./lines";
import { overview } from "./overview";
import type { Decision, Shown, Thread } from "./protocol";
import type { T3Link } from "./t3";

/**
 * The assistant's own tools in the web version: what is going on across T3 (`overview`), answering a
 * thread's permission request (`approve`), and showing the user a file (`show`). T3's own tools come
 * through its MCP server.
 */
export function registerWebTools(
  pi: ExtensionAPI,
  options: {
    live: () => { t3: T3Link; key: string } | undefined;
    answer: (threadId: string, decision: Decision) => Promise<Thread>;
    /** Puts a shown file in the conversation. */
    shown: (file: Shown) => void;
  },
) {
  pi.registerTool({
    name: "overview",
    label: "Overview",
    description:
      "What is going on across all the user's T3 work right now: threads waiting on the user, working, failed, and finished but not yet opened. Instant, from bruv's live view of T3. Start here; read a thread with T3's tools when you need more.",
    parameters: Type.Object({
      project: Type.Optional(Type.String({ description: "Only this project, by name or id." })),
    }),
    async execute(_id, args) {
      const live = options.live();
      if (!live) throw new Error("The web version is off.");
      const state = live.t3.state();
      const text = overview(live.t3.threads(), live.t3.projects(), { project: args.project });
      return {
        ...toolResult({ text }),
        content: [
          {
            type: "text" as const,
            text: state.state === "unavailable" ? `T3 is unavailable: ${state.reason}` : text,
          },
        ],
      };
    },
  });

  pi.registerTool({
    name: "approve",
    label: "Approve",
    description:
      "Answer a T3 thread's permission request (a command, a file change, a permission) as the user would in T3. Only when the user said to: approve once, approve for the rest of the thread's session, or deny. The thread's requestKind says what it asks; read the thread first if you need the details.",
    parameters: Type.Object({
      threadId: Type.String(),
      decision: Type.Union([Type.Literal("approve"), Type.Literal("approve for session"), Type.Literal("deny")]),
    }),
    async execute(_id, args) {
      const decision: Decision =
        args.decision === "approve" ? "accept" : args.decision === "deny" ? "decline" : "acceptForSession";
      const thread = await options.answer(args.threadId, decision);
      return toolResult({ answered: thread.title, decision: args.decision });
    },
  });

  pi.registerTool({
    name: showTool,
    label: "Show",
    description:
      "Show the user a file on the page, in the conversation: a picture, video, sound, HTML page, PDF or text file. From your working folder (path), from a T3 thread's folder (path and thread), or a page a thread showed with html_render (render: its attachment id, and thread). It shows at once; say what it is in a line, not what's in it.",
    parameters: Type.Object({
      path: Type.Optional(
        Type.String({ description: "The file: in your working folder, or with thread, in that thread's folder." }),
      ),
      thread: Type.Optional(Type.String({ description: "The T3 thread whose folder the file is in." })),
      render: Type.Optional(
        Type.String({ description: "An html_render page's attachment id, from the thread's activity." }),
      ),
      title: Type.Optional(Type.String({ description: "A few words for it, shown with it." })),
    }),
    async execute(_id, args, _signal, _update, context) {
      const live = options.live();
      if (!live) throw new Error("The web version is off.");
      const shown = await prepareShow({
        secret: live.key,
        workspace: context.cwd,
        t3: live.t3,
        path: args.path,
        thread: args.thread,
        render: args.render,
        title: args.title,
      });
      options.shown(shown);
      return {
        content: [{ type: "text" as const, text: `Shown to the user: ${shown.name} (${shown.kind}).` }],
        details: { shown },
      };
    },
  });
}
