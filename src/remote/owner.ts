import { Database } from "bun:sqlite";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  writeSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { loadProfiles } from "../tasks/subagent-profiles";
import type { RemoteRequest, RemoteResponse, RemoteTask } from "./protocol";

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
  const path = join(root, "control-lock.sqlite");
  const fd = openSync(path, "a", 0o600);
  closeSync(fd);
  const database = new Database(path);
  let acquired = false;
  try {
    database.exec("PRAGMA busy_timeout=0");
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        database.exec("BEGIN EXCLUSIVE");
        acquired = true;
        break;
      } catch (error) {
        if (!(error instanceof Error) || !/locked|busy/i.test(error.message)) throw error;
        await Bun.sleep(30);
      }
    }
    if (!acquired) throw new Error("Remote control is busy; retry the same request ID");
    database.exec("CREATE TABLE IF NOT EXISTS control_lock (id INTEGER)");
    return await fn();
  } finally {
    try {
      if (acquired) database.exec("COMMIT");
    } finally {
      database.close();
    }
  }
}

function intent(req: Extract<RemoteRequest, { op: "launch" }>, profile: RemoteTask["profile"]) {
  return createHash("sha256")
    .update(JSON.stringify([req.repoPath, req.prompt, profile]))
    .digest("hex");
}
const MAX_JOURNAL = 32 * 1024 * 1024;
const MAX_LINE = 512 * 1024;
const MAX_PAGE = 2 * 1024 * 1024; // below the SSH client's 4 MB response cap
function events(id: string, cursor = 0) {
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error("Invalid cursor");
  const path = join(location(id), "events.jsonl");
  if (!existsSync(path)) {
    if (cursor) throw new Error("Journal gap: cursor beyond journal");
    return { events: [], cursor: 0, hasMore: false };
  }
  if (statSync(path).size > MAX_JOURNAL) throw new Error("Journal gap: journal exceeds limit");
  const text = readFileSync(path, "utf8");
  if (text && !text.endsWith("\n")) throw new Error("Journal gap: truncated final row");
  const rows: Array<{ seq: number; event: unknown }> = [];
  let sequence = 0;
  for (const line of text.split("\n")) {
    if (!line) continue;
    if (Buffer.byteLength(line) > MAX_LINE) throw new Error("Journal gap: oversized row");
    let row: { seq: number; event: unknown };
    try {
      row = JSON.parse(line);
    } catch {
      throw new Error("Journal gap: corrupt row");
    }
    if (!row || row.seq !== ++sequence || !("event" in row)) throw new Error("Journal gap: noncontiguous row");
    rows.push(row);
  }
  if (cursor > sequence) throw new Error("Journal gap: cursor beyond journal");
  const page: typeof rows = [];
  let bytes = 256;
  for (const row of rows.slice(cursor)) {
    const size = Buffer.byteLength(JSON.stringify(row)) + 2;
    if (bytes + size > MAX_PAGE) {
      if (!page.length) throw new Error("Journal gap: event exceeds page limit");
      break;
    }
    bytes += size;
    page.push(row);
    if (page.length >= 100) break;
  }
  return { events: page, cursor: page.at(-1)?.seq ?? cursor, hasMore: cursor + page.length < sequence };
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
          thinking: normal.thinking ?? "off",
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
        try {
          return { task: existing.task, ...events(req.taskId) };
        } catch (e) {
          return error("journal_gap", String(e));
        }
      }
      if (!isAbsolute(req.repoPath) || !statSync(req.repoPath).isDirectory() || !existsSync(join(req.repoPath, ".git")))
        return error("invalid_repo", "repoPath must be an existing absolute Git repository");
      if (typeof req.prompt !== "string" || !req.prompt.trim() || Buffer.byteLength(req.prompt) > 128 * 1024)
        return error("invalid_prompt", "Nonempty prompt up to 128 KiB required");
      const normal = (await loadProfiles(join(process.env.HOME ?? homedir(), ".die", "subagents.json"))).normal;
      if (!normal.model)
        return error("missing_model", "Configure remote normal profile model in ~/.die/subagents.json");
      const profile = { name: "normal" as const, model: normal.model, thinking: normal.thinking ?? "off" };
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
        child.on("error", () => {
          /* launch may fail after spawn returns; sync reports unknown */
        });
        if (!child.pid) throw new Error("Owner process did not start");
        child.unref();
        value.pid = child.pid;
        value.startTime = processInfo(child.pid).startTime;
        persist(req.taskId, value);
      } catch (e) {
        value.task.state = "unknown";
        value.task.error = String(e);
        persist(req.taskId, value);
      }
      try {
        return { task: value.task, ...events(req.taskId) };
      } catch (e) {
        return error("journal_gap", String(e));
      }
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
      try {
        return { task: value.task, ...events(req.taskId, req.cursor) };
      } catch (e) {
        return error("journal_gap", String(e));
      }
    }
    return error("invalid_request", "Unsupported operation");
  });
}

async function publishTerminal(taskId: string, result: Saved) {
  await locked(async () => {
    const current = saved(taskId);
    // A terminal record is immutable; do not replace an earlier uncertainty with a stale snapshot.
    if (current.task.state !== "accepted" && current.task.state !== "running") return;
    current.task = result.task;
    persist(taskId, current);
  });
}

export async function runOwnerTask(taskId: string, executable = process.execPath): Promise<void> {
  location(taskId);
  // A launched owner owns only its recorded PID. Never run an uncertain accepted task again.
  let initial = saved(taskId);
  for (let i = 0; i < 100 && (!initial.pid || !initial.startTime); i++) {
    await Bun.sleep(20);
    initial = saved(taskId);
  }
  if (
    initial.pid !== process.pid ||
    initial.boot !== boot() ||
    initial.startTime !== processInfo(process.pid).startTime ||
    initial.task.state !== "accepted"
  )
    return;
  const path = join(location(taskId), "events.jsonl");
  let journal: number | undefined;
  let child: ReturnType<typeof spawn> | undefined;
  let failure: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
  const stopChild = (graceful = false) => {
    if (!child?.pid) return;
    if (graceful) child.stdin?.end();
    else child.kill();
    shutdownTimer ??= setTimeout(() => child?.kill("SIGKILL"), 2_000);
  };
  try {
    // A preexisting or malformed journal is not safe to append from sequence one.
    if (existsSync(path) && statSync(path).size) throw new Error("Existing journal; cannot replay owner");
    journal = openSync(path, "a", 0o600);
    let seq = 0;
    const record = (event: unknown) => {
      if (failure) return;
      try {
        const line = JSON.stringify({ seq: seq + 1, event }) + "\n";
        if (Buffer.byteLength(line) > MAX_LINE || fstatSync(journal!).size + Buffer.byteLength(line) > MAX_JOURNAL)
          throw new Error("RPC journal limit exceeded");
        const bytes = Buffer.from(line);
        for (let offset = 0; offset < bytes.length; ) {
          const written = writeSync(journal!, bytes, offset, bytes.length - offset);
          if (!written) throw new Error("Short journal write");
          offset += written;
        }
        fsyncSync(journal!);
        seq++;
      } catch (e) {
        failure = "Journal write failed: " + String(e);
        stopChild();
      }
    };
    await locked(async () => {
      // Sync uses this lock for its read, liveness check, and unknown transition.
      // Never publish a stale owner snapshot across that transaction.
      const current = saved(taskId);
      if (current.task.state !== "accepted") throw new Error("Owner state changed before start");
      current.task.state = "running";
      persist(taskId, current);
    });
    const { model, thinking } = initial.task.profile;
    const slash = model.indexOf("/");
    const session = join(location(taskId), "session.jsonl");
    const args = [
      "--mode",
      "rpc",
      "--session",
      session,
      "--provider",
      model.slice(0, slash),
      "--model",
      model.slice(slash + 1),
    ];
    if (thinking) args.push("--thinking", thinking);
    const runtimePath = join(location(taskId), "runtime.json");
    child = spawn(executable, args, {
      cwd: initial.task.repoPath,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, DIE_REMOTE_RUNTIME_STATE: runtimePath },
    });
    let buffer = "";
    let ended = false;
    let promptSent = false;
    let modelError: string | undefined;

    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      if (failure) return;
      buffer += chunk;
      if (Buffer.byteLength(buffer) > MAX_LINE && !buffer.includes("\n")) {
        failure = "RPC line limit exceeded";
        stopChild();
        return;
      }
      let pos: number;
      while (!failure && (pos = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, pos);
        buffer = buffer.slice(pos + 1);
        if (Buffer.byteLength(line) > MAX_LINE) {
          failure = "RPC line limit exceeded";
          stopChild();
          break;
        }
        let event: any;
        try {
          event = JSON.parse(line);
        } catch {
          failure = "Invalid RPC JSON output";
          stopChild();
          break;
        }
        record(event);
        if (event?.type === "response" && event.id === "remote-config") {
          const effective = event.data?.model;
          if (
            !event.success ||
            effective?.provider !== model.slice(0, slash) ||
            effective?.id !== model.slice(slash + 1) ||
            event.data?.thinkingLevel !== thinking
          ) {
            failure =
              "Remote CLI selected a different or unavailable model/thinking configuration; prompt was not sent";
            stopChild(true);
            continue;
          }
          if (!promptSent) {
            promptSent = true;
            child?.stdin?.write(
              JSON.stringify({
                id: "remote-prompt",
                type: "prompt",
                message: read<{ prompt: string }>(join(location(taskId), "request.json")).prompt,
              }) + "\n",
            );
          }
        }
        if (event?.type === "message_end") {
          const message = event.message;
          if (message?.stopReason === "error" || message?.stopReason === "aborted" || message?.errorMessage)
            modelError = String(message.errorMessage || message.stopReason);
        }
        if (event?.type === "agent_start") {
          ended = false;
          modelError = undefined;
        }
        if (event?.type === "agent_settled") {
          // The normal extension checkpoint runs before RPC agent_settled. A yielded
          // model turn must not close the CLI and kill its still-running jobs.
          try {
            const runtime = read<{
              settled: boolean;
              activeJobs?: number;
              pendingMessages?: boolean;
              questions?: unknown[];
              error?: string;
            }>(runtimePath);
            if (
              !runtime.settled ||
              runtime.error ||
              typeof runtime.activeJobs !== "number" ||
              !Array.isArray(runtime.questions)
            )
              throw new Error(runtime.error || "Missing native runtime checkpoint");
            if (runtime.activeJobs > 0 || runtime.pendingMessages) continue;
            if (runtime.questions.length) {
              failure =
                "Native question unresolved; remote answering unavailable. Resume the recorded remote session only after this owner has exited.";
              initial.task.questions = runtime.questions;
            }
            ended = true;
          } catch (error) {
            failure = "Cannot verify remote task completion: " + String(error);
          }
          stopChild(true);
        }
      }
      if (Buffer.byteLength(buffer) > MAX_LINE) {
        failure = "RPC line limit exceeded";
        stopChild();
      }
    });
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => record({ type: "stderr", text: chunk }));
    child.stdin!.on("error", () => {
      /* child exit is handled below */
    });
    child.stdin!.write(JSON.stringify({ id: "remote-config", type: "get_state" }) + "\n");
    timer = setTimeout(
      () => {
        failure = "RPC timed out";
        stopChild();
      },
      60 * 60 * 1000,
    );
    const code = await new Promise<number | null>((resolve, reject) => {
      child!.on("error", reject);
      child!.on("close", resolve);
    });
    if (buffer.length && !failure) failure = "Truncated RPC output";
    const ledger = session + ".questions.json";
    const pendingQuestion =
      existsSync(ledger) &&
      read<Array<{ status: string }>>(ledger).some((q) => q.status === "pending" || q.status === "answered");
    initial.task.state =
      code === 0 && promptSent && ended && !failure && !modelError && !pendingQuestion ? "done" : "unknown";
    if (initial.task.state === "unknown")
      initial.task.error =
        failure ||
        modelError ||
        (pendingQuestion
          ? "Native question unresolved; remote answering unavailable"
          : "RPC exited without verified native settlement (exit " + code + ")");
    await publishTerminal(taskId, initial);
  } catch (e) {
    stopChild();
    initial.task.state = "unknown";
    initial.task.error = failure || String(e);
    await publishTerminal(taskId, initial);
  } finally {
    if (timer) clearTimeout(timer);
    if (shutdownTimer) clearTimeout(shutdownTimer);
    if (journal !== undefined) closeSync(journal);
  }
}
