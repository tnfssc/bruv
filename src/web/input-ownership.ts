import { createHash } from "node:crypto";
import { BROWSER_INPUT_MARKER, browserInputReport } from "../live/browser-protocol";

/** Frame authorship, not commands. Only the CLI editor knows when input submits. */
export class InputOwnership {
  private paste = false;
  private pasteWriters = new Set<string>();
  private packet = "";
  private writers = new Set<string>();
  private lastTicket?: { owner: string | undefined; ticket: string };
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private ticket: (owner: string | undefined, previous?: string) => string,
    private write: (bytes: Buffer) => void,
  ) {}
  input(bytes: Buffer, owner: string) {
    let output = "";
    let labelled: string | undefined;
    const label = (writers: Set<string>, withTicket = true) => {
      const writer = writers.size === 1 ? [...writers][0] : undefined;
      const author = writer ? createHash("sha256").update(writer).digest("hex").slice(0, 32) : "-";
      if (withTicket && labelled === author) return;
      let ticket = "";
      if (withTicket) {
        ticket = this.ticket(writer, this.lastTicket?.owner === writer ? this.lastTicket?.ticket : undefined);
        this.lastTicket = { owner: writer, ticket };
      }
      output += `${BROWSER_INPUT_MARKER}${author}:${ticket}\x07`;
      labelled = withTicket ? author : undefined;
    };
    const emit = (packet: string, writers: Set<string>) => {
      const report = browserInputReport(packet);
      if (packet === "\x1b[200~") {
        label(writers, false);
        this.paste = true;
      }
      if (this.paste) {
        for (const writer of writers) this.pasteWriters.add(writer);
        output += packet;
        if (packet === "\x1b[201~") {
          this.paste = false;
          // StdinBuffer must see the paste whole, with no markers in its text.
          label(this.pasteWriters, false);
          this.pasteWriters.clear();
        }
      } else {
        if (!report) label(writers);
        output += packet;
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
        const packet = this.packet,
          writers = new Set(this.writers);
        this.packet = "";
        this.writers.clear();
        emit(packet, writers);
        if (output) this.write(Buffer.from(output, "latin1"));
        output = "";
      }, 50);
    output = "";
    labelled = undefined;
  }
  close() {
    clearTimeout(this.timer);
    this.packet = "";
    this.writers.clear();
    this.pasteWriters.clear();
  }
}
