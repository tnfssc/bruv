import type { ServerWebSocket, Subprocess } from "bun";

export interface SocketData {
  channel: string;
  after?: number;
  [key: string]: unknown;
}

const REPLAY_BYTES = 2 * 1024 * 1024;
export const SOCKET_BYTES = 2 * 1024 * 1024;

/** One real CLI process. Disconnects detach; they never restart or kill it. */
export class TerminalSession {
  private process?: Subprocess;
  private client?: ServerWebSocket<SocketData>;
  private chunks: { seq: number; data: string; bytes: number }[] = [];
  private bytes = 0;
  private sequence = 0;
  private code?: number;
  private stopping = false;
  private stopped?: Promise<void>;
  cols = 80;
  rows = 24;

  constructor(
    private command: string[],
    private cwd: string,
    private env: NodeJS.ProcessEnv = process.env,
  ) {}

  get pid() {
    return this.process?.pid;
  }

  get exited() {
    return this.code !== undefined;
  }

  private send(message: object) {
    const socket = this.client;
    if (!socket) return;
    if (socket.getBufferedAmount() > SOCKET_BYTES) {
      socket.close(1013, "Output backlog; reconnect to replay");
      this.client = undefined;
      return;
    }
    socket.send(JSON.stringify(message));
  }

  attach(socket: ServerWebSocket<SocketData>) {
    if (this.stopping) {
      socket.close(1001, "Server stopping");
      return false;
    }
    const after = socket.data.after ?? 0;
    const first = this.chunks[0]?.seq ?? this.sequence + 1;
    if (after < first - 1 || after > this.sequence) {
      socket.send(
        JSON.stringify({
          type: "gap",
          message:
            "Terminal replay expired. The CLI is still running; this screen cannot be recovered. Close this tab and open a new one to continue.",
        }),
      );
      socket.close(1008, "Replay expired");
      return false;
    }
    this.client?.close(1000, "Another browser attached");
    this.client = socket;
    this.send({ type: "ready", cols: this.cols, rows: this.rows });
    for (const chunk of this.chunks)
      if (chunk.seq > after) this.send({ type: "output", seq: chunk.seq, data: chunk.data });
    if (this.code !== undefined) {
      this.send({ type: "exit", code: this.code });
      return true;
    }
    if (this.process) return true;
    try {
      this.process = Bun.spawn(this.command, {
        cwd: this.cwd,
        env: { ...this.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
        terminal: {
          cols: this.cols,
          rows: this.rows,
          data: (_terminal, data) => {
            const chunk = { seq: ++this.sequence, data: Buffer.from(data).toString("base64"), bytes: data.byteLength };
            this.chunks.push(chunk);
            this.bytes += chunk.bytes;
            while (this.bytes > REPLAY_BYTES && this.chunks.length) this.bytes -= this.chunks.shift()!.bytes;
            this.send({ type: "output", seq: chunk.seq, data: chunk.data });
          },
        },
      });
      void this.process.exited.then((code) => {
        this.code = code;
        this.send({ type: "exit", code });
        this.process?.terminal?.close();
      });
    } catch (error) {
      this.code = 1;
      this.send({ type: "error", message: "CLI startup failed: " + String(error) });
      socket.close(1011, "CLI startup failed");
    }
    return true;
  }

  detach(socket: ServerWebSocket<SocketData>) {
    if (socket === this.client) this.client = undefined;
  }

  message(socket: ServerWebSocket<SocketData>, raw: string | Buffer) {
    if (socket !== this.client || this.code !== undefined || this.stopping) return;
    try {
      const message = JSON.parse(String(raw));
      if (
        message.type === "input" &&
        typeof message.data === "string" &&
        Buffer.byteLength(message.data) <= 64 * 1024
      ) {
        this.process?.terminal?.write(
          message.encoding === "base64" ? Buffer.from(message.data, "base64") : message.data,
        );
      } else if (
        message.type === "resize" &&
        Number.isInteger(message.cols) &&
        Number.isInteger(message.rows) &&
        message.cols >= 2 &&
        message.cols <= 500 &&
        message.rows >= 2 &&
        message.rows <= 200
      ) {
        this.cols = message.cols;
        this.rows = message.rows;
        this.process?.terminal?.resize(this.cols, this.rows);
      } else socket.close(1008, "Invalid terminal message");
    } catch {
      socket.close(1008, "Invalid terminal message");
    }
  }

  stop(): Promise<void> {
    return (this.stopped ??= this.cleanup());
  }

  private async cleanup() {
    this.stopping = true;
    this.client?.close(1001, "Server stopping");
    this.client = undefined;
    const child = this.process;
    if (!child) return;
    // Bun's POSIX PTY child is a session/process-group leader. Kill only that
    // owned group, including shell/tool descendants still in the group.
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (process.platform === "win32") child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    };
    kill("SIGTERM");
    const timer = setTimeout(() => kill("SIGKILL"), 1500);
    try {
      await child.exited;
      // The group may still contain tools after the CLI exited.
      kill("SIGKILL");
    } finally {
      clearTimeout(timer);
      child.terminal?.close();
    }
  }
}
