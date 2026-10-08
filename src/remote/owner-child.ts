import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";

/** Owns shutdown escalation until close, including error and exceptional exits. */
export class OwnerChild {
  readonly process: ChildProcessWithoutNullStreams;
  private readonly closed: Promise<number | null>;
  private didClose = false;
  private error: Error | undefined;
  private escalation: ReturnType<typeof setTimeout> | undefined;

  constructor(executable: string, args: string[], options: SpawnOptionsWithoutStdio) {
    this.process = spawn(executable, args, { ...options, stdio: ["pipe", "pipe", "pipe"] });
    this.closed = new Promise((resolve) => {
      this.process.on("error", (error) => {
        this.error = error;
        this.stop();
      });
      this.process.on("close", (code) => {
        this.didClose = true;
        if (this.escalation) clearTimeout(this.escalation);
        resolve(code);
      });
    });
  }

  stop(graceful = false): void {
    if (this.didClose || !this.process.pid) return;
    if (graceful) this.process.stdin?.end();
    else this.process.kill();
    this.escalation ??= setTimeout(() => this.process.kill("SIGKILL"), 2_000);
  }

  async waitForExit(): Promise<number | null> {
    const code = await this.closed;
    if (this.error) throw this.error;
    return code;
  }

  async release(): Promise<void> {
    if (!this.didClose) this.stop();
    await this.closed;
    if (this.escalation) clearTimeout(this.escalation);
  }
}
