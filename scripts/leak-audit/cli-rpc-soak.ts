#!/usr/bin/env bun
/**
 * Soak the real Bruv RPC lifecycle against a local OpenAI-compatible fake. Touch
 * only this run's temporary HOME, loopback listener, and spawned Bruv PID.
 */
import { chmod, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

function completion(text: string) {
  const chunk = (delta: object, finish_reason: string | null) => ({
    id: "soak",
    object: "chat.completion.chunk",
    created: 1,
    model: "soak-model",
    choices: [{ index: 0, delta, finish_reason }],
  });
  const body =
    [chunk({ role: "assistant", content: text }, null), chunk({}, "stop")]
      .map((x) => "data: " + JSON.stringify(x) + "\n\n")
      .join("") + "data: [DONE]\n\n";
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

async function procSample(pid: number, label: string) {
  const status = await readFile(`/proc/${pid}/status`, "utf8");
  const get = (key: string) => Number(status.match(new RegExp("^" + key + ":\\s+(\\d+)", "m"))?.[1] ?? 0);
  const children = new Set<number>();
  async function walk(parent: number) {
    let dirs: string[] = [];
    try {
      dirs = await readdir("/proc");
    } catch {
      return;
    }
    for (const d of dirs) {
      if (!/^\d+$/.test(d)) continue;
      try {
        const s = await readFile(`/proc/${d}/status`, "utf8");
        if (Number(s.match(/^PPid:\s+(\d+)/m)?.[1]) === parent && !children.has(Number(d))) {
          children.add(Number(d));
          await walk(Number(d));
        }
      } catch {
        /* exited */
      }
    }
  }
  await walk(pid);
  return {
    label,
    at: Date.now(),
    rssKiB: get("VmRSS"),
    hwmKiB: get("VmHWM"),
    vmKiB: get("VmSize"),
    threads: get("Threads"),
    fds: (await readdir(`/proc/${pid}/fd`)).length,
    children: [...children],
  };
}

type RpcEvent = {
  type: string;
  id?: string;
  command?: string;
  success?: boolean;
  error?: string;
};

/** Owns the one subprocess, its RPC correlations, and its output drains. */
class SoakRpcSession {
  private readonly child: Bun.Subprocess<"pipe", "pipe", "pipe">;
  private readonly stdoutTask: Promise<void>;
  private readonly stderrTask: Promise<string>;
  private readonly responses = new Map<string, { resolve: (event: RpcEvent) => void; timer: Timer }>();
  private agentEnd: (() => void) | undefined;
  private serial = 0;
  private eventCount = 0;
  private readonly failedResponses: RpcEvent[] = [];

  constructor(binary: string, root: string, home: string, agentDir: string) {
    this.child = Bun.spawn([binary, "--mode", "rpc", "--offline", "--provider", "soak", "--model", "soak-model"], {
      cwd: root,
      env: {
        ...process.env,
        HOME: home,
        PI_CODING_AGENT_DIR: agentDir,
        BRUV_CODING_AGENT_DIR: agentDir,
        PI_OFFLINE: "1",
        HERDR_ENV: "0",
        BRUV_SUBAGENT_DEPTH: "0",
        BRUV_SUBAGENT_TYPE: "",
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    this.stdoutTask = this.readEvents();
    this.stderrTask = new Response(this.child.stderr).text();
  }

  get pid() {
    return this.child.pid;
  }

  private async readEvents() {
    const reader = this.child.stdout.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let event: RpcEvent;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        this.eventCount++;
        if (event.type === "response" && event.success === false) this.failedResponses.push(event);
        if (event.type === "response" && event.id) {
          const response = this.responses.get(event.id);
          if (response) {
            clearTimeout(response.timer);
            this.responses.delete(event.id);
            response.resolve(event);
          }
        }
        if (event.type === "agent_end") this.agentEnd?.();
      }
    }
  }

  send(type: string, extra: object = {}, timeout = 15_000) {
    const id = "c" + ++this.serial;
    this.child.stdin.write(JSON.stringify({ id, type, ...extra }) + "\n");
    return new Promise<RpcEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.responses.delete(id);
        reject(new Error("timeout " + type));
      }, timeout);
      this.responses.set(id, { resolve, timer });
    });
  }

  turn(message: string) {
    return this.runTurn(message);
  }

  abortTurn(message: string) {
    return this.runTurn(message, 50);
  }

  private async runTurn(message: string, abortAfter?: number) {
    // Register before prompting: an offline completion can end immediately.
    const end = Promise.withResolvers<void>();
    const timer = setTimeout(() => end.reject(new Error("timeout agent_end")), 15_000);
    this.agentEnd = () => end.resolve();
    // A response may still be pending when the end deadline expires.
    void end.promise.catch(() => {});
    try {
      const response = await this.send("prompt", { message });
      if (abortAfter !== undefined) {
        await Bun.sleep(abortAfter);
        await this.send("abort");
      } else if (!response.success) {
        throw new Error(JSON.stringify(response));
      }
      await end.promise;
    } finally {
      clearTimeout(timer);
      this.agentEnd = undefined;
    }
  }

  async finish() {
    this.child.stdin.end();
    const exitCode = await this.child.exited;
    await this.stdoutTask;
    const stderr = await this.stderrTask;
    return { exitCode, eventCount: this.eventCount, failedResponses: this.failedResponses, stderr };
  }

  async dispose() {
    // Kill only our exact PID, and retain ownership until exit and pipe EOF.
    if (this.child.exitCode === null) this.child.kill();
    await this.child.exited;
    await this.stdoutTask;
    await this.stderrTask;
  }
}

async function soak() {
  const cycles = Number(process.env.BRUV_SOAK_CYCLES ?? 120);
  const newOnly = process.env.BRUV_SOAK_NEW_ONLY === "1";
  const root = await mkdtemp("/var/tmp/bruv-cli-runtime-soak-");
  await chmod(root, 0o700);
  const home = join(root, "home");
  const agentDir = join(root, "agent");
  await mkdir(home, { recursive: true, mode: 0o700 });
  await mkdir(agentDir, { recursive: true, mode: 0o700 });
  await mkdir(join(home, ".bruv"), { recursive: true, mode: 0o700 });
  let requestCount = 0;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      requestCount++;
      const body = await req.text();
      let latestUser = "";
      try {
        const parsed = JSON.parse(body);
        latestUser = [...(parsed.messages ?? [])].reverse().find((m: any) => m.role === "user")?.content ?? "";
        if (typeof latestUser !== "string") latestUser = JSON.stringify(latestUser);
      } catch {
        /* malformed requests should still receive a harmless completion */
      }
      // Only the current abort turn is delayed; do not match historical messages.
      if (latestUser.includes("SOAK_ABORT_ME")) await Bun.sleep(10_000);
      return completion(body.includes("Summarize") || body.includes("summary") ? "compact summary" : "ok");
    },
  });
  let rpc: SoakRpcSession | undefined;
  const samples: Awaited<ReturnType<typeof procSample>>[] = [];
  try {
    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({ compaction: { enabled: true, reserveTokens: 256, keepRecentTokens: 128 } }, null, 2) + "\n",
      { mode: 0o600 },
    );
    await writeFile(
      join(agentDir, "models.json"),
      JSON.stringify(
        {
          providers: {
            soak: {
              baseUrl: `http://127.0.0.1:${server.port}/v1`,
              api: "openai-completions",
              apiKey: "local",
              models: [{ id: "soak-model", name: "Local soak", contextWindow: 8192, maxTokens: 128 }],
            },
          },
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );

    const binary = resolve(import.meta.dir, "../../dist/bruv");
    if (!(await Bun.file(binary).exists())) throw new Error("dist/bruv missing; run bun run build");
    rpc = new SoakRpcSession(binary, root, home, agentDir);
    await rpc.send("get_state");
    samples.push(await procSample(rpc.pid, "start"));
    for (let i = 1; i <= cycles; i++) {
      if (newOnly) {
        await rpc.send("new_session");
      } else if (i % 12 === 0) {
        await rpc.abortTurn(`SOAK_ABORT_ME ${i}`);
      } else await rpc.turn(`soak turn ${i} ` + "padding ".repeat(80));
      if (!newOnly && i % 15 === 0) await rpc.send("compact", { customInstructions: "Return a tiny summary." }, 20_000);
      if (i % 20 === 0) {
        if (!newOnly) await rpc.send("new_session");
        await Bun.sleep(30);
        samples.push(await procSample(rpc.pid, `post-new-${i}`));
      }
    }
    samples.push(await procSample(rpc.pid, "final"));
    const result = await rpc.finish();
    const report = {
      root,
      cycles,
      requestCount,
      ...result,
      samples,
    };
    await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify(report, null, 2));
    const unexpectedFailures = report.failedResponses.filter(
      (e) => e.command !== "compact" || !/Nothing to compact|Compaction cancelled/.test(e.error ?? ""),
    );
    if (report.exitCode !== 0 || unexpectedFailures.length) process.exitCode = 1;
  } catch (error) {
    console.error(error);
    console.error("artifacts: " + root);
    process.exitCode = 1;
  } finally {
    try {
      await rpc?.dispose();
    } finally {
      server.stop(true);
    }
  }
}

await soak();
