// Private Pi seam, pinned and hash-checked by prepare:assets. A source CLI
// started after a fresh dependency checkout must prepare assets/adaptation first.
import * as piMain from "../node_modules/@earendil-works/pi-coding-agent/dist/main.js";
import * as piArgs from "../node_modules/@earendil-works/pi-coding-agent/dist/cli/args.js";
import { builtInExtensions } from "../node_modules/@earendil-works/pi-coding-agent/dist/extensions/index.js";

export function assertDiePiHost(
  state: { mainPrepared?: boolean; argsPrepared?: boolean; builtInNames: (string | undefined)[] } = {
    mainPrepared: (piMain as typeof piMain & { dieHostAdapted?: boolean }).dieHostAdapted,
    argsPrepared: (piArgs as typeof piArgs & { dieHostAdapted?: boolean }).dieHostAdapted,
    builtInNames: builtInExtensions.map((extension) => extension.name),
  },
): void {
  // Reject a partially prepared dependency (e.g. interrupted writes) as well
  // as a pristine dependency checkout. No factories run before this gate.
  if (
    !state.mainPrepared ||
    !state.argsPrepared ||
    state.builtInNames.length !== 1 ||
    state.builtInNames[0] !== "llama.cpp"
  ) {
    throw new Error("Pi host is not prepared for die; run bun run prepare:assets before starting the source CLI.");
  }
}
