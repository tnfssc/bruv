import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { toolResult } from "../jobs";
import type { Call } from "./call";
import { forPage, resolveShown, type Shelf } from "./show";
import { forTerminal, showInTerminal } from "./terminal";

/**
 * Where shown things can go while voice is on: open voice pages and the terminal. `web` is the page server
 * and its address (the tunnel's when there is one), so terminal links can go through it.
 */
export type Screens = { call: Call; web?: { shelf: Shelf; address: string }; saved: string };

/**
 * The `show` tool: puts a page, picture or video on every screen that can show it. It is declared to the
 * model only while voice is on (see `showTool`); the voice section of the prompt says when to use it.
 */
export function registerShow(pi: ExtensionAPI, live: () => Screens | undefined) {
  pi.registerTool({
    name: "show",
    label: "Show",
    description:
      "Put a page, picture or video on the user's screen: the terminal and any open voice page. Give one of html (a whole self-contained page), file (an image, video or .html file) or url (an image or video link).",
    exposure: "codemode",
    parameters: Type.Object({
      html: Type.Optional(Type.String({ description: "A whole page with its CSS and scripts inline." })),
      file: Type.Optional(
        Type.String({ description: "Path to a png, jpg, gif, webp, avif, svg, mp4, webm, mov or html file." }),
      ),
      url: Type.Optional(Type.String({ description: "An https link to an image or video." })),
      kind: Type.Optional(
        Type.Union([Type.Literal("image"), Type.Literal("video")], {
          description: "For a url without a file extension.",
        }),
      ),
      title: Type.Optional(Type.String({ description: "A few words shown above it." })),
    }),
    outputSchema: Type.Object({ shownOn: Type.Array(Type.String()) }),
    async execute(_id, args, _signal, _update, ctx) {
      const voice = live();
      if (!voice) throw new Error("Voice is off, so there is nowhere to show it.");
      const item = resolveShown(args, ctx.cwd);
      const shownOn: string[] = [];
      const { web } = voice;
      const page = web && forPage(item, web.shelf);
      if (page && voice.call.show(page)) shownOn.push("voice page");
      if (ctx.mode === "tui" && ctx.hasUI) {
        // With the page server running, links go through it: they work over SSH and through the tunnel.
        const href =
          web &&
          (item.url ??
            `${web.address}${page?.src ?? web.shelf.add(Buffer.from(item.html ?? ""), "text/html; charset=utf-8")}`);
        showInTerminal(ctx.ui, await forTerminal(item, voice.saved, { href }));
        shownOn.push("terminal");
      }
      if (!shownOn.length) throw new Error("No screen can show it right now: no voice page is open. Say it instead.");
      return toolResult({ shownOn });
    },
  });
}

/**
 * Declares `show` while voice is on. Declared tools change the tool list, so this costs one uncached
 * request when voice turns on; a deferred tool was tried first, and the model never found it.
 */
export function showTool(pi: ExtensionAPI, on: boolean) {
  const active = pi.getActiveTools().filter((name) => name !== "show");
  pi.setActiveTools(on ? [...active, "show"] : active);
}
