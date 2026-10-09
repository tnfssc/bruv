import { BROWSER_INPUT_MARKER } from "../live/browser-protocol";

/** Keep escape packets intact, including split paste delimiters and Alt+Enter. */
export class InputOwnership {
  private owner?: string;
  private mixed = false;
  private paste = false;
  private packet = "";
  private writers = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private ticket: (owner: string | undefined) => string,
    private write: (bytes: Buffer) => void,
  ) {}
  input(bytes: Buffer, owner: string) {
    let output = "";
    const emit = (packet: string, writers: Set<string>) => {
      const report =
        // biome-ignore lint/suspicious/noControlCharactersInRegex: Recognize terminal reports without assigning command ownership.
        /^(?:\x1b\[[IO]|\x1b\[(?:[?>][0-9;]*c|[0-9;]+[tR]|\?[0-9;]+u)|\x1b\](?:10|11|4;[0-9]+);rgb:[a-fA-F0-9/]+(?:\x07|\x1b\\))$/.test(
          packet,
        );
      if (!report) {
        for (const writer of writers) {
          if (this.owner && this.owner !== writer) this.mixed = true;
          this.owner ??= writer;
        }
      }
      if (!this.paste && (packet === "\r" || packet === "\x1b\r")) {
        output += BROWSER_INPUT_MARKER + this.ticket(this.mixed ? undefined : this.owner) + "\x07";
        this.owner = undefined;
        this.mixed = false;
      }
      output += packet;
      if (packet === "\x1b[200~") this.paste = true;
      if (packet === "\x1b[201~") this.paste = false;
      if (packet === "\x03") {
        this.owner = undefined;
        this.mixed = false;
      }
    };
    clearTimeout(this.timer);
    for (const byte of bytes.toString("latin1")) {
      if (this.packet || byte === "\x1b") {
        this.packet += byte;
        this.writers.add(owner);
        const packet = this.packet;
        const kind = packet[1];
        const complete =
          packet.length > 1 &&
          ((kind === "[" && packet.length > 2 && /[@-~]/.test(byte)) ||
            (kind === "O" && packet.length >= 3) ||
            (["]", "P", "_", "^"].includes(kind) && (packet.endsWith("\x1b\\") || (kind === "]" && byte === "\x07"))) ||
            !["[", "O", "]", "P", "_", "^"].includes(kind) ||
            packet.length >= 2048);
        if (complete) {
          emit(packet, this.writers);
          this.packet = "";
          this.writers.clear();
        }
      } else emit(byte, new Set([owner]));
    }
    if (output) this.write(Buffer.from(output, "latin1"));
    if (this.packet)
      this.timer = setTimeout(() => {
        // A lone Escape is a key, not an unfinished forever-buffer.
        const packet = this.packet,
          writers = new Set(this.writers);
        this.packet = "";
        this.writers.clear();
        emit(packet, writers);
        if (output) {
          this.write(Buffer.from(output, "latin1"));
          output = "";
        }
      }, 50);
    output = "";
  }
  close() {
    clearTimeout(this.timer);
    this.packet = "";
    this.writers.clear();
  }
}
