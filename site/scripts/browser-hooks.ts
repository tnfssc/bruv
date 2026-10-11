import type { Terminal } from "ghostty-web";

// Browser tests expose the terminal after open() and inspect the pinned renderer.
type InspectedTerminal = Pick<Terminal, keyof Terminal> & {
  renderer: { getCanvas(): HTMLCanvasElement; render(terminal: unknown, force: boolean): void };
  wasmTerm: unknown;
};
declare global {
  interface Window {
    __terminal: InspectedTerminal;
    __writes: number;
  }
}
