import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";

export const StatusSchema = Type.Union([Type.Literal("running"), Type.Literal("done"), Type.Literal("failed")]);
export const SummarySchema = Type.Object({
  id: Type.String(),
  kind: Type.Union([Type.Literal("job"), Type.Literal("agent")]),
  title: Type.String(),
  status: StatusSchema,
  startedAt: Type.Number(),
  elapsedSeconds: Type.Number(),
  outputPath: Type.String(),
  worktree: Type.Optional(Type.Object({ path: Type.String(), branch: Type.String() })),
});
export const ResultSchema = Type.Object({
  ...SummarySchema.properties,
  exitCode: Type.Optional(Type.Number()),
  output: Type.String(),
  answer: Type.Optional(Type.String()),
  usage: Type.Optional(Type.Object({ input: Type.Number(), output: Type.Number(), cost: Type.Number() })),
  sessionPath: Type.Optional(Type.String()),
});
export type Summary = Static<typeof SummarySchema>;
export type Result = Static<typeof ResultSchema>;
export interface Work extends Result {
  tail: Buffer;
  outputStream: WriteStream;
  outputDone: Promise<undefined | Error>;
  detached: boolean;
  seen: boolean;
  stopped: boolean;
  progress?: string;
  pid?: number;
  endedAt?: number;
  completion: Promise<void>;
  finish: () => void;
}
export const seconds = (fallback: number) => Type.Optional(Type.Number({ minimum: 0, default: fallback }));
export function toolResult<T extends object>(value: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    details: value,
    structuredContent: JSON.parse(JSON.stringify(value)),
  };
}

export class Jobs {
  items = new Map<string, Work>();
  listeners = new Set<() => void>();
  private stops = new Set<Promise<void>>();
  private counts = { job: 0, agent: 0 };

  changed() {
    for (const listener of this.listeners) listener();
  }
  get(id: string) {
    const item = this.items.get(id);
    if (!item) throw new Error(`Unknown job: ${id}`);
    return item;
  }
  create(kind: Work["kind"], title: string, directory: string, detached = false): Work {
    const id = `${kind === "job" ? "j" : "a"}${++this.counts[kind]}`;
    mkdirSync(directory, { recursive: true });
    const completion = Promise.withResolvers<void>();
    const outputStream = createWriteStream(join(directory, `${id}.log`));
    const item: Work = {
      id,
      kind,
      title,
      status: "running",
      startedAt: Date.now(),
      elapsedSeconds: 0,
      outputPath: join(directory, `${id}.log`),
      output: "",
      tail: Buffer.alloc(0),
      outputStream,
      outputDone: finished(outputStream).then(
        () => undefined,
        (error: Error) => error,
      ),
      detached,
      seen: false,
      stopped: false,
      completion: completion.promise,
      finish: completion.resolve,
    };
    this.items.set(id, item);
    this.changed();
    return item;
  }
  append(item: Work, chunk: Buffer | string) {
    item.outputStream.write(chunk);
    item.tail = Buffer.concat([item.tail, Buffer.from(chunk)]).subarray(-65536);
    this.changed();
  }
  summary(item: Work): Summary {
    return {
      id: item.id,
      kind: item.kind,
      title: item.title,
      status: item.status,
      startedAt: item.startedAt,
      elapsedSeconds: Math.floor(((item.endedAt ?? Date.now()) - item.startedAt) / 1000),
      outputPath: item.outputPath,
      ...(item.worktree ? { worktree: item.worktree } : {}),
    };
  }
  result(item: Work): Result {
    return {
      ...this.summary(item),
      output: item.tail.toString("utf8").slice(-4000),
      exitCode: item.exitCode,
      ...(item.kind === "agent" ? { answer: item.answer, usage: item.usage, sessionPath: item.sessionPath } : {}),
    };
  }
  list() {
    return [...this.items.values()].map((item) => this.summary(item));
  }
  async run(item: Work, task: () => Promise<number>) {
    try {
      item.exitCode = await task();
    } catch (error) {
      this.append(item, `\n${String(error)}\n`);
      item.exitCode = 1;
    }
    item.outputStream.end();
    const outputError = await item.outputDone;
    if (outputError) {
      item.tail = Buffer.from(String(outputError));
      item.exitCode = 1;
    }
    item.status = !item.stopped && item.exitCode === 0 ? "done" : "failed";
    item.endedAt = Date.now();
    item.finish();
    this.changed();
  }
  process(
    item: Work,
    command: string,
    args: string[],
    cwd: string,
    options: {
      env?: NodeJS.ProcessEnv;
      timeoutSeconds?: number;
      stdout?: (chunk: string) => void;
    } = {},
  ): Promise<number> {
    if (item.stopped) return Promise.resolve(1);
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, env: options.env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
      item.pid = child.pid;
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        this.append(item, chunk);
        try {
          options.stdout?.(chunk);
        } catch (error) {
          this.append(item, `\n${String(error)}\n`);
          this.stop(item.id);
        }
      });
      child.stderr.on("data", (chunk: Buffer) => this.append(item, chunk));
      child.on("error", reject);
      const timeout =
        options.timeoutSeconds === undefined
          ? undefined
          : setTimeout(() => this.stop(item.id), options.timeoutSeconds * 1000);
      child.on("close", (code) => {
        clearTimeout(timeout);
        item.pid = undefined;
        resolve(code ?? 1);
      });
    });
  }
  stop(id: string) {
    const item = this.get(id);
    if (item.status !== "running" || item.stopped) return this.summary(item);
    item.stopped = true;
    const pid = item.pid;
    if (pid) {
      this.signal(pid, "SIGTERM");
      // Keep escalation even if the shell exits before its children.
      const stopped = new Promise<void>((resolve) => {
        setTimeout(() => {
          this.signal(pid, "SIGKILL");
          resolve();
        }, 5000);
      });
      this.stops.add(stopped);
      void stopped.then(() => this.stops.delete(stopped));
    }
    this.changed();
    return this.summary(item);
  }
  private signal(pid: number, signal: NodeJS.Signals) {
    try {
      process.kill(-pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
  async shutdown() {
    for (const item of this.items.values()) this.stop(item.id);
    await Promise.all([...this.items.values()].map((item) => item.completion));
    await Promise.all(this.stops);
  }
  async reset() {
    await this.shutdown();
    this.items.clear();
    this.counts = { job: 0, agent: 0 };
    this.changed();
  }

  async wait(
    ids = [...this.items.keys()],
    all = false,
    timeoutSeconds = 600,
    pending = () => false,
    signal?: AbortSignal,
  ) {
    const items = ids.map((id) => this.get(id));
    let cleanup: () => void;
    await new Promise<void>((resolve) => {
      const ready = () =>
        signal?.aborted ||
        pending() ||
        (all
          ? items.every((item) => item.status !== "running")
          : items.length === 0 || items.some((item) => item.status !== "running"));
      const check = () => {
        if (ready()) resolve();
      };
      const timer = setTimeout(resolve, timeoutSeconds * 1000);
      const poll = setInterval(check, 250);
      this.listeners.add(check);
      signal?.addEventListener("abort", check, { once: true });
      check();
      // The cleanup is attached before the promise can resume its caller.
      cleanup = () => {
        clearTimeout(timer);
        clearInterval(poll);
        this.listeners.delete(check);
        signal?.removeEventListener("abort", check);
      };
    }).finally(() => cleanup());
    const done = items.filter((item) => item.status !== "running");
    if (!signal?.aborted) for (const item of done) item.seen = true;
    return {
      done: done.map((item) => this.result(item)),
      running: items.filter((item) => item.status === "running").map((item) => this.summary(item)),
      userMessagePending: pending(),
    };
  }
}

export function workDirectory(ctx: ExtensionContext) {
  return join(ctx.sessionManager.getSessionDir(), "bruv", ctx.sessionManager.getSessionId());
}
export function registerJobs(pi: ExtensionAPI, jobs: Jobs) {
  pi.on("session_start", () => jobs.reset());
  pi.on("session_shutdown", () => jobs.shutdown());
  pi.registerTool({
    name: "job_start",
    label: "Start job",
    description: "Run a command in the background.",
    exposure: "codemode",
    parameters: Type.Object({
      command: Type.String(),
      cwd: Type.Optional(Type.String()),
      title: Type.Optional(Type.String()),
      waitSeconds: seconds(3),
      timeoutSeconds: Type.Optional(Type.Number({ minimum: 0 })),
      detach: Type.Optional(Type.Boolean()),
    }),
    outputSchema: ResultSchema,
    async execute(_id, args, signal, _update, ctx) {
      const item = jobs.create("job", args.title ?? args.command, workDirectory(ctx), args.detach);
      void jobs.run(item, () =>
        jobs.process(item, process.env.SHELL ?? "/bin/sh", ["-c", args.command], args.cwd ?? ctx.cwd, args),
      );
      await jobs.wait([item.id], true, args.waitSeconds ?? 3, () => ctx.hasPendingMessages(), signal);
      return toolResult(jobs.result(item));
    },
  });
  pi.registerTool({
    name: "wait",
    label: "Wait",
    description: "Wait for work to finish or a user message.",
    exposure: "codemode",
    parameters: Type.Object({
      ids: Type.Optional(Type.Array(Type.String())),
      all: Type.Optional(Type.Boolean()),
      timeoutSeconds: seconds(600),
    }),
    outputSchema: Type.Object({
      done: Type.Array(ResultSchema),
      running: Type.Array(SummarySchema),
      userMessagePending: Type.Boolean(),
    }),
    async execute(_id, args, signal, _update, ctx) {
      return toolResult(
        await jobs.wait(args.ids, args.all, args.timeoutSeconds, () => ctx.hasPendingMessages(), signal),
      );
    },
  });
  pi.registerTool({
    name: "jobs",
    label: "Jobs",
    description: "List work started in this session.",
    exposure: "codemode",
    parameters: Type.Object({}),
    outputSchema: Type.Object({ items: Type.Array(SummarySchema) }),
    async execute() {
      return toolResult({ items: jobs.list() });
    },
  });
  pi.registerTool({
    name: "job_stop",
    label: "Stop job",
    description: "Stop a job or agent and its child processes.",
    exposure: "codemode",
    parameters: Type.Object({ id: Type.String() }),
    outputSchema: Type.Object({ id: Type.String(), status: StatusSchema }),
    async execute(_id, args) {
      const { id, status } = jobs.stop(args.id);
      return toolResult({ id, status });
    },
  });
}
