import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { toolResult } from "../jobs";
import type { Call } from "./call";
import { prepareShown, type Shelf } from "./show";

/**
 * The `show` tool: puts a page, picture or video on the voice page. It is declared to the model only
 * while voice is on (see `showTool`); the voice section of the prompt says when to use it.
 */
export function registerShow(pi: ExtensionAPI, live: () => { call: Call; shelf: Shelf } | undefined) {
  pi.registerTool({
    name: "show",
    label: "Show",
    description:
      "Put a page, picture or video on the user's voice page. Give one of html (a whole self-contained page), file (an image, video or .html file) or url (an image or video link).",
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
    outputSchema: Type.Object({ screens: Type.Number() }),
    async execute(_id, args, _signal, _update, ctx) {
      const voice = live();
      if (!voice) throw new Error("Voice is off, so there is no page to show it on.");
      const screens = voice.call.show(prepareShown(args, ctx.cwd, voice.shelf));
      if (!screens)
        throw new Error("No voice page is open right now. Say it instead, or ask the user to open the page.");
      return toolResult({ screens });
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
