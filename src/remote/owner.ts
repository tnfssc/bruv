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
  fstatSync,
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
    try { row = JSON.parse(line); } catch { throw new Error("Journal gap: corrupt row"); }
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
        try { return { task: existing.task, ...events(req.taskId) }; }
        catch (e) { return error("journal_gap", String(e)); }
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
      try { return { task: value.task, ...events(req.taskId) }; }
      catch (e) { return error("journal_gap", String(e)); }
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
      try { return { task: value.task, ...events(req.taskId, req.cursor) }; }
      catch (e) { return error("journal_gap", String(e)); }
    }
    return error("invalid_request", "Unsupported operation");
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
  if (initial.pid !== process.pid || initial.boot !== boot() ||
      initial.startTime !== processInfo(process.pid).startTime || initial.task.state !== "accepted") return;
  const path = join(location(taskId), "events.jsonl");
  let journal: number | undefined;
  let child: ReturnType<typeof spawn> | undefined;
  let failure: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
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
        for (let offset = 0; offset < bytes.length;) {
          const written = writeSync(journal!, bytes, offset, bytes.length - offset);
          if (!written) throw new Error("Short journal write");
          offset += written;
        }
        fsyncSync(journal!);
        seq++;
      } catch (e) {
        failure = "Journal write failed: " + String(e);
        child?.kill();
      }
    };
    initial.task.state = "running";
    persist(taskId, initial);
    const { model, thinking } = initial.task.profile;
    const slash = model.indexOf("/");
    const session = join(location(taskId), "session.jsonl");
    const args = ["--mode", "rpc", "--session", session, "--provider", model.slice(0, slash), "--model", model.slice(slash + 1)];
    if (thinking) args.push("--thinking", thinking);
    child = spawn(executable, args, { cwd: initial.task.repoPath, stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "";
    let ended = false;
    let modelError: string | undefined;

    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      if (failure) return;
      buffer += chunk;
      if (Buffer.byteLength(buffer) > MAX_LINE && !buffer.includes("\n")) {
        failure = "RPC line limit exceeded";
        child?.kill();
        return;
      }
      let pos: number;
      while (!failure && (pos = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, pos);
        buffer = buffer.slice(pos + 1);
        if (Buffer.byteLength(line) > MAX_LINE) {
          failure = "RPC line limit exceeded";
          child?.kill();
          break;
        }
        let event: any;
        try { event = JSON.parse(line); }
        catch { failure = "Invalid RPC JSON output"; child?.kill(); break; }
        record(event);
        if (event?.type === "message_end") {
          const message = event.message;
          if (message?.stopReason === "error" || message?.stopReason === "aborted" || message?.errorMessage)
            modelError = String(message.errorMessage || message.stopReason);
        }
        if (event?.type === "agent_end" && !event.willRetry) {
          ended = true;
          child?.stdin?.end();
        }
      }
      if (Buffer.byteLength(buffer) > MAX_LINE) {
        failure = "RPC line limit exceeded";
        child?.kill();
      }
    });
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => record({ type: "stderr", text: chunk }));
    child.stdin!.on("error", () => { /* child exit is handled below */ });
    child.stdin!.write(JSON.stringify({
      id: "remote-prompt", type: "prompt",
      message: read<{ prompt: string }>(join(location(taskId), "request.json")).prompt,
    }) + "\n");
    timer = setTimeout(() => { failure = "RPC timed out"; child?.kill(); }, 60 * 60 * 1000);
    const code = await new Promise<number | null>((resolve, reject) => {
      child!.on("error", reject);
      child!.on("close", resolve);
    });
    if (buffer.length && !failure) failure = "Truncated RPC output";
    const ledger = session + ".questions.json";
    const pendingQuestion = existsSync(ledger) && (read<Array<{ status: string }>>(ledger)).some(q => q.status === "pending" || q.status === "answered");
    initial.task.state = code === 0 && ended && !failure && !modelError && !pendingQuestion ? "done" : "unknown";
    if (initial.task.state === "unknown")
      initial.task.error = failure || modelError || (pendingQuestion ? "Native question unresolved; remote answering unavailable" :
        "RPC exited without successful agent_end (exit " + code + ")");
    persist(taskId, initial);
  } catch (e) {
    child?.kill();
    initial.task.state = "unknown";
    initial.task.error = failure || String(e);
    persist(taskId, initial);
  } finally {
    if (timer) clearTimeout(timer);
    if (journal !== undefined) closeSync(journal);
  }
}
