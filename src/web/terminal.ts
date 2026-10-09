import type { ServerWebSocket, Subprocess } from "bun";
import { InputOwnership } from "./input-ownership";

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
  private clients = new Map<ServerWebSocket<SocketData>, { active: boolean; cols: number; rows: number }>();
  private chunks: { seq: number; data: string; bytes: number }[] = [];
  private bytes = 0;
  private sequence = 0;
  private code?: number;
  private stopping = false;
  private stopped?: Promise<void>;
  private ownership?: InputOwnership;
  cols = 80;
  rows = 24;

  constructor(
    private command: string[],
    private cwd: string,
    private env: NodeJS.ProcessEnv = process.env,
    private onChange: () => void = () => {},
    inputTicket?: (owner: string | undefined) => string,
  ) {
    if (inputTicket) this.ownership = new InputOwnership(inputTicket, (bytes) => this.process?.terminal?.write(bytes));
  }

  get pid() {
    return this.process?.pid;
  }

  get exited() {
    return this.code !== undefined;
  }

  hasOwner(ownerId: string) {
    return [...this.clients.keys()].some((socket) => socket.readyState === 1 && socket.data.audioOwner === ownerId);
  }

  sendOwner(owner: string, message: object) {
    const socket = [...this.clients.keys()].find(
      (socket) => socket.data.audioOwner === owner && socket.readyState === 1,
    );
    return socket ? this.sendTo(socket, message) : false;
  }

  private sendTo(socket: ServerWebSocket<SocketData>, message: object) {
    const text = JSON.stringify(message);
    if (socket.getBufferedAmount() + Buffer.byteLength(text) > SOCKET_BYTES || socket.send(text) === 0) {
      this.clients.delete(socket);
      socket.close(1013, "Output backlog; reconnect to replay");
      return false;
    }
    return true;
  }

  private send(message: object) {
    for (const socket of this.clients.keys()) this.sendTo(socket, message);
  }

  private resize() {
    const active = [...this.clients.values()].filter((view) => view.active);
    if (!active.length) return;
    const cols = Math.min(...active.map((view) => view.cols));
    const rows = Math.min(...active.map((view) => view.rows));
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    if (this.code === undefined) this.process?.terminal?.resize(cols, rows);
    this.send({ type: "size", cols, rows });
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
            "View lost · this screen cannot be recovered. The original work still runs. Open a new terminal without closing this one.",
        }),
      );
      socket.close(1008, "Replay expired");
      return false;
    }
    this.clients.set(socket, { active: false, cols: this.cols, rows: this.rows });
    if (!this.sendTo(socket, { type: "ready", cols: this.cols, rows: this.rows })) return false;
    for (const chunk of this.chunks)
      if (chunk.seq > after && !this.sendTo(socket, { type: "output", seq: chunk.seq, data: chunk.data })) return false;
    if (this.code !== undefined) {
      this.sendTo(socket, { type: "exit", code: this.code });
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
      this.onChange();
      void this.process.exited.then((code) => {
        this.ownership?.close();
        this.code = code;
        this.send({ type: "exit", code });
        this.process?.terminal?.close();
        this.onChange();
      });
    } catch (error) {
      this.code = 1;
      this.onChange();
      this.send({ type: "error", message: "CLI startup failed: " + String(error) });
      socket.close(1011, "CLI startup failed");
    }
    return true;
  }

  detach(socket: ServerWebSocket<SocketData>) {
    this.clients.delete(socket);
    this.resize();
  }

  message(socket: ServerWebSocket<SocketData>, raw: string | Buffer) {
    const view = this.clients.get(socket);
    if (!view || this.stopping) return;
    try {
      const message = JSON.parse(String(raw));
      if (
        message.type === "input" &&
        typeof message.data === "string" &&
        Buffer.byteLength(message.data) <= 64 * 1024
      ) {
        if (this.code !== undefined) return;
        const bytes = message.encoding === "base64" ? Buffer.from(message.data, "base64") : Buffer.from(message.data);
        if (this.ownership) this.ownership.input(bytes, String(socket.data.audioOwner));
        else this.process?.terminal?.write(bytes);
      } else if (
        message.type === "resize" &&
        Number.isInteger(message.cols) &&
        Number.isInteger(message.rows) &&
        message.cols >= 2 &&
        message.cols <= 500 &&
        message.rows >= 2 &&
        message.rows <= 200
      ) {
        view.active = true;
        view.cols = message.cols;
        view.rows = message.rows;
        this.resize();
      } else if (message.type === "visibility" && message.active === false) {
        view.active = false;
        this.resize();
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
    this.ownership?.close();
    for (const socket of this.clients.keys()) socket.close(1001, "Server stopping");
    this.clients.clear();
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
