/** Frames transport bytes only. Protocol decisions belong to the event consumer. */
export class OwnerRpcOutput {
  private buffer = "";

  constructor(private readonly maxLineBytes: number) {}

  get truncated(): boolean {
    return this.buffer.length > 0;
  }

  *push(chunk: string): Generator<unknown> {
    this.buffer += chunk;
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (Buffer.byteLength(line) > this.maxLineBytes) throw new Error("RPC line limit exceeded");
      if (!line.trim()) continue;
      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch {
        throw new Error("Invalid RPC JSON output");
      }
      yield event;
    }
    if (Buffer.byteLength(this.buffer) > this.maxLineBytes) throw new Error("RPC line limit exceeded");
  }
}
