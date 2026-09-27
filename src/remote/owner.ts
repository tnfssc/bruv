import { randomUUID, createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
  fsyncSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";
import { loadProfiles } from "../tasks/subagent-profiles";
import type { RemoteRequest, RemoteResponse, RemoteTask } from "./protocol";
import pkg from "../../package.json" with { type: "json" };

const root = join(process.env.HOME ?? homedir(), ".die", "remote-owner");
const tasks = join(root, "tasks");
const boot = () => {
  try {
    return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  } catch {
    throw new Error("Linux boot_id unavailable");
  }
};
function atomic(path: string, value: unknown) {
  const tmp = path + "." + randomUUID();
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeSync(fd, JSON.stringify(value));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
  const dir = openSync(dirname(path), "r");
  try {
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
}
function read<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
function location(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error("Invalid taskId");
  return join(tasks, id);
}
type Saved = { task: RemoteTask; intent: string; pid?: number; startTime?: string; boot: string };
function processInfo(pid: number) {
  const fields = readFileSync("/proc/" + pid + "/stat", "utf8")
    .split(") ")[1]!
    .split(" ");
  return { state: fields[0], startTime: fields[19] };
}
function statePath(id: string) {
  return join(location(id), "state.json");
}
function saved(id: string) {
  return read<Saved>(statePath(id));
}
function persist(id: string, value: Saved) {
  atomic(statePath(id), value);
}
function owner() {
  mkdirSync(tasks, { recursive: true, mode: 0o700 });
  const path = join(root, "identity.json");
  const currentBoot = boot();
  if (existsSync(path)) {
    const identity = read<{ ownerId: string; epoch: string; boot: string }>(path);
    if (identity.boot === currentBoot) return identity;
    const next = { ownerId: identity.ownerId, epoch: randomUUID(), boot: currentBoot };
    atomic(path, next);
    return next;
  }
  const next = { ownerId: randomUUID(), epoch: randomUUID(), boot: currentBoot };
  atomic(path, next);
  return next;
}
function error(code: string, detail: string): RemoteResponse {
  return { code, error: detail };
}
async function locked<T>(fn: () => Promise<T>): Promise<T> {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const path = join(root, "lock");
  for (let n = 0; n < 100; n++) {
    try {
      mkdirSync(path, { mode: 0o700 });
      try {
        return await fn();
      } finally {
        rmSync(path, { recursive: true, force: true });
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      await Bun.sleep(30);
    }
  }
  throw new Error("Remote owner locked; manual inspection required");
}
function intent(req: Extract<RemoteRequest, { op: "launch" }>, profile: RemoteTask["profile"]) {
  return createHash("sha256")
    .update(JSON.stringify([req.repoPath, req.prompt, profile]))
    .digest("hex");
}
function events(id: string, cursor = 0) {
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error("Invalid cursor");
  const path = join(location(id), "events.jsonl");
  const rows = existsSync(path)
    ? readFileSync(path, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { seq: number; event: unknown })
    : [];
  const pending = rows.filter((row) => row.seq > cursor);
  const page = pending.slice(0, 100);
  return { events: page, cursor: page.at(-1)?.seq ?? cursor, hasMore: pending.length > page.length };
}
export async function handleRemoteRequest(req: RemoteRequest, executable = process.execPath): Promise<RemoteResponse> {
  return locked(async () => {
    const identity = owner();
    if (req?.op !== "hello" && (req?.ownerId !== identity.ownerId || req?.epoch !== identity.epoch))
      return error("owner_changed", "Owner identity or boot epoch changed");
    if (req.op === "hello") {
      const normal = (await loadProfiles(join(process.env.HOME ?? homedir(), ".die", "subagents.json"))).normal;
      return {
        protocol: 1,
        ownerId: identity.ownerId,
        epoch: identity.epoch,
        version: pkg.version,
        platform: platform(),
        profile: {
          name: "normal",
          model: normal.model,
          thinking: normal.thinking,
          auth: normal.model ? "unknown" : "missing",
        },
      };
    }
    if (req.op === "launch") {
      location(req.taskId);
      if (existsSync(statePath(req.taskId))) {
        const existing = saved(req.taskId);
        if (existing.intent !== intent(req, existing.task.profile))
          return error("intent_conflict", "taskId already accepted with different intent");
        return { task: existing.task, ...events(req.taskId) };
      }
      if (!isAbsolute(req.repoPath) || !statSync(req.repoPath).isDirectory() || !existsSync(join(req.repoPath, ".git")))
        return error("invalid_repo", "repoPath must be an existing absolute Git repository");
      if (typeof req.prompt !== "string" || !req.prompt.trim())
        return error("invalid_prompt", "Nonempty prompt required");
      const normal = (await loadProfiles(join(process.env.HOME ?? homedir(), ".die", "subagents.json"))).normal;
      if (!normal.model)
        return error("missing_model", "Configure remote normal profile model in ~/.die/subagents.json");
      const profile = { name: "normal" as const, model: normal.model, thinking: normal.thinking };
      const hash = intent(req, profile);

      mkdirSync(location(req.taskId), { mode: 0o700 });
      const tasksFd = openSync(tasks, "r");
      try {
        fsyncSync(tasksFd);
      } finally {
        closeSync(tasksFd);
      }
      const value: Saved = {
        intent: hash,
        task: { taskId: req.taskId, state: "accepted", repoPath: req.repoPath, profile },
        boot: identity.boot,
      };
      persist(req.taskId, value);
      atomic(join(location(req.taskId), "request.json"), { prompt: req.prompt });
      try {
        const child = spawn(executable, ["--remote-owner", req.taskId], {
          detached: true,
          stdio: "ignore",
          env: process.env,
        });
        // spawn may emit an asynchronous error; check the immediate pid before acknowledging.
        if (!child.pid) throw new Error("Owner process did not start");
        child.on("error", () => {
          /* launch may fail after spawn returns; sync reports unknown */
        });
        child.unref();
        value.pid = child.pid;
        value.startTime = processInfo(child.pid).startTime;
        persist(req.taskId, value);
      } catch (e) {
        value.task.state = "unknown";
        value.task.error = String(e);
        persist(req.taskId, value);
      }
      return { task: value.task, ...events(req.taskId) };
    }
    if (req.op === "sync") {
      location(req.taskId);
      if (!existsSync(statePath(req.taskId))) return error("not_found", "Unknown taskId");
      const value = saved(req.taskId);
      if (value.task.state === "accepted" || value.task.state === "running") {
        let alive = false;
        if (value.boot === identity.boot && value.pid) {
          try {
            process.kill(value.pid, 0);
            const info = processInfo(value.pid);
            alive = info.state !== "Z" && !!value.startTime && info.startTime === value.startTime;
          } catch {
            /* dead */
          }
        }
        if (!alive) {
          value.task.state = "unknown";
          value.task.error = "Owner exited without durable completion; task will not be relaunched";
          persist(req.taskId, value);
        }
      }
      return { task: value.task, ...events(req.taskId, req.cursor) };
    }
    return error("invalid_request", "Unsupported operation");
  });
}

export async function runOwnerTask(taskId: string, executable = process.execPath): Promise<void> {
  location(taskId);
  // A launched owner owns only its recorded PID. Never run an uncertain accepted task again.
  let initial = saved(taskId);
  for (let i = 0; i < 100 && !initial.pid; i++) {
    await Bun.sleep(20);
    initial = saved(taskId);
  }
  if (initial.pid !== process.pid || initial.boot !== boot() || initial.task.state !== "accepted") return;
  const path = join(location(taskId), "events.jsonl");
  const journal = openSync(path, "a", 0o600);
  let seq = 0;
  const record = (event: unknown) => {
    writeSync(journal, JSON.stringify({ seq: ++seq, event }) + "\n");
    fsyncSync(journal);
  };
  try {
    initial.task.state = "running";
    persist(taskId, initial);
    const { model, thinking } = initial.task.profile;
    const slash = model.indexOf("/");
    const args = ["--mode", "rpc", "--provider", model.slice(0, slash), "--model", model.slice(slash + 1)];
    if (thinking) args.push("--thinking", thinking);
    const child = spawn(executable, args, { cwd: initial.task.repoPath, stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "";
    let ended = false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let pos: number;
      while ((pos = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, pos);
        buffer = buffer.slice(pos + 1);
        try {
          const event = JSON.parse(line);
          record(event);
          if (event.type === "agent_end" && !event.willRetry) {
            ended = true;
            child.stdin.end();
          }
        } catch {
          record({ type: "invalid_rpc_output", line });
        }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => record({ type: "stderr", text: chunk }));
    child.stdin.write(
      JSON.stringify({
        id: "remote-prompt",
        type: "prompt",
        message: read<{ prompt: string }>(join(location(taskId), "request.json")).prompt,
      }) + "\n",
    );
    const timer = setTimeout(() => child.kill(), 60 * 60 * 1000);
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    clearTimeout(timer);
    if (buffer.trim()) record({ type: "truncated_rpc_output", text: buffer });
    initial.task.state = code === 0 && ended ? "done" : "unknown";
    if (initial.task.state === "unknown")
      initial.task.error = "RPC exited without successful agent_end (exit " + code + ")";
    persist(taskId, initial);
  } catch (e) {
    initial.task.state = "unknown";
    initial.task.error = String(e);
    persist(taskId, initial);
  } finally {
    closeSync(journal);
  }
}
