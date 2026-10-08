import type { Terminal } from "@earendil-works/pi-tui";

/** Counting transport, not emulator/PTY/backpressure. Callback starts after stdin decoding. */
export class NavigationTerminal implements Terminal {
  kittyProtocolActive = false;
  writes: string[] = [];
  input?: (data: string) => void;
  resize?: () => void;
  constructor(
    public columns: number,
    public rows: number,
  ) {}
  start(input: (data: string) => void, resize: () => void) {
    this.input = input;
    this.resize = resize;
  }
  async drainInput() {}
  stop() {
    this.input = undefined;
    this.resize = undefined;
  }
  send(data: string) {
    if (!this.input) throw new Error("Terminal not started");
    this.input(data);
  }
  write(data: string) {
    this.writes.push(data);
  }
  moveBy(lines: number) {
    if (lines) this.write("\x1b[" + Math.abs(lines) + (lines > 0 ? "B" : "A"));
  }
  hideCursor() {
    this.write("\x1b[?25l");
  }
  showCursor() {
    this.write("\x1b[?25h");
  }
  clearLine() {
    this.write("\x1b[2K");
  }
  clearFromCursor() {
    this.write("\x1b[J");
  }
  clearScreen() {
    this.write("\x1b[2J");
  }
  setTitle(title: string) {
    this.write("\x1b]0;" + title + "\x07");
  }
  setProgress(_active: boolean) {}
}
