import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { T3Link } from "./t3";
import { setUpWebTunnel, stopWebTunnel } from "./tunnel";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * `/web` (the page's link, the tunnel, pairing with a T3 elsewhere) and `/web-fresh` (moving to a fresh
 * session when this one grew big).
 */
export function registerWebCommands(
  pi: ExtensionAPI,
  options: {
    agentDir?: string;
    /** The running web version, or nothing when Pi wasn't started with --web. */
    live: () => { t3: T3Link; address: string } | undefined;
    /** Points T3's MCP tools at the T3 in use. */
    registerMcp: () => Promise<void> | undefined;
  },
) {
  pi.registerCommand("web", {
    description:
      "Show the web version's link (start Pi with --web to turn it on); /web tunnel serves it on your domain, for your phone",
    getArgumentCompletions: (prefix) =>
      [
        { value: "tunnel", description: "Serve the page on your own domain, for your phone" },
        { value: "tunnel off", description: "Stop serving the page on your domain" },
        { value: "t3 ", description: "Pair with a T3 on another machine: paste the link `t3 pair` prints there" },
        { value: "t3 local", description: "Use the T3 on this machine again" },
      ]
        .filter(({ value }) => value.startsWith(prefix.trimStart()))
        .map(({ value, description }) => ({ value, label: value, description })),
    handler: async (args, context) => {
      const live = options.live();
      const word = args.trim();
      if (word === "tunnel") return setUpWebTunnel(context, options.agentDir);
      if (word === "tunnel off") return stopWebTunnel(context, options.agentDir);
      if (word === "t3" || word.startsWith("t3 ")) {
        const link = word.slice(2).trim();
        if (!live) return context.ui.notify("Start Pi with --web to run the web version.", "info");
        if (!link)
          return context.ui.notify(
            "Run `t3 pair --tailscale` where T3 runs (or with a --host other machines reach), then /web t3 <the pairing link>.",
            "info",
          );
        if (link === "local") {
          const was = live.t3.unpair();
          context.ui.notify(
            was ? "Using the T3 on this machine again." : "Already using the T3 on this machine.",
            "info",
          );
          // T3's tools go to the T3 in use.
          if (was) await options.registerMcp();
          return;
        }
        try {
          const origin = await live.t3.pair(link);
          context.ui.notify(`Paired with T3 at ${origin}.`, "info");
          await options.registerMcp();
        } catch (error) {
          context.ui.notify(`Couldn't pair with T3: ${message(error)}`, "error");
        }
        return;
      }
      context.ui.notify(
        live ? `The web version is on: ${live.address}` : "Start Pi with --web to run the web version.",
        "info",
      );
    },
  });

  pi.registerCommand("web-fresh", {
    description: "Move the web version to a fresh session; the page can still scroll back into this one",
    handler: async (_args, context) => {
      await context.waitForIdle();
      const parent = context.sessionManager.getSessionFile();
      await context.newSession({
        parentSession: parent,
        setup: async (manager) => {
          manager.appendCustomMessageEntry(
            "bruv-web",
            `This conversation continues an earlier one${parent ? `, saved in ${parent}` : ""}. Your threads carry on in T3: \`overview\` lists them, and memory.md in your working folder has what you learned about the user.`,
            false,
          );
        },
      });
    },
  });
}
