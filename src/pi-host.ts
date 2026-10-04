// Private Pi seam, pinned and hash-checked by prepare:assets. A source CLI
// started after a fresh dependency checkout must prepare assets/adaptation first.
import * as piAgentSession from "../node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js";
import * as piMain from "../node_modules/@earendil-works/pi-coding-agent/dist/main.js";
import * as piArgs from "../node_modules/@earendil-works/pi-coding-agent/dist/cli/args.js";
import * as piChatViewport from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/chat-viewport.js";
import { builtInExtensions } from "../node_modules/@earendil-works/pi-coding-agent/dist/extensions/index.js";

export function assertBruvPiHost(
  state: {
    inputIdentityPrepared?: boolean;
    mainPrepared?: boolean;
    argsPrepared?: boolean;
    viewportPrepared?: boolean;
    builtInNames: (string | undefined)[];
  } = {
    inputIdentityPrepared: (piAgentSession as typeof piAgentSession & { bruvInputIdentityAdapted?: boolean })
      .bruvInputIdentityAdapted,
    mainPrepared: (piMain as typeof piMain & { bruvHostAdapted?: boolean }).bruvHostAdapted,
    argsPrepared: (piArgs as typeof piArgs & { bruvHostAdapted?: boolean }).bruvHostAdapted,
    viewportPrepared: (piChatViewport as typeof piChatViewport & { bruvHostAdapted?: boolean }).bruvHostAdapted,
    builtInNames: builtInExtensions.map((extension) => extension.name),
  },
): void {
  // Reject a partially prepared dependency (e.g. interrupted writes) as well
  // as a pristine dependency checkout. No factories run before this gate.
  if (
    !state.inputIdentityPrepared ||
    !state.mainPrepared ||
    !state.argsPrepared ||
    !state.viewportPrepared ||
    state.builtInNames.length !== 1 ||
    state.builtInNames[0] !== "llama.cpp"
  ) {
    throw new Error("Pi host is not prepared for bruv; run bun run prepare:assets before starting the source CLI.");
  }
}
