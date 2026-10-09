import { durableJsonReplace } from "./durable-json";
import { validatePlacement, remoteChildEnvironment } from "./placement";
import { listRemoteArtifacts, getRemoteArtifact } from "./artifacts";
import { repositoryRequest } from "./repository-wire";
import { OwnerCapabilityMailbox } from "./capability-runtime";
import { capabilityNeeds } from "./services";
import { Database } from "bun:sqlite";
import { spawn } from "node:child_process";
import { OwnerChild } from "./owner-child";
import { OwnerRpcOutput } from "./owner-rpc";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  writeSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { loadProfiles, THINKING_LEVELS, type ThinkingLevel } from "../tasks/subagent-profiles";
import type { RemoteRequest, RemoteResponse, RemoteTask } from "./protocol";

const root = join(process.env.HOME ?? homedir(), ".bruv", "remote-owner");
const tasks = join(root, "tasks");
const boot = () => {
  try {
    return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  } catch {
    throw new Error("Linux boot_id unavailable");
  }
};

function read<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
function location(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error("Invalid taskId");
  return join(tasks, id);
}
type Saved = {
  task: RemoteTask;
  intent: string;
  pid?: number;
  startTime?: string;
  boot: string;
  overrides?: { model?: string; thinking?: string };
};
function processInfo(pid: number) {
  const fields = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" ");
  return { state: fields[0], startTime: fields[19] };
}
function statePath(id: string) {
  return join(location(id), "state.json");
}
function saved(id: string) {
  return read<Saved>(statePath(id));
}
function persist(id: string, value: Saved) {
  durableJsonReplace(statePath(id), value);
}
function owner() {
  mkdirSync(tasks, { recursive: true, mode: 0o700 });
  const path = join(root, "identity.json");
  const currentBoot = boot();
  if (existsSync(path)) {
    const identity = read<{ ownerId: string; epoch: string; boot: string }>(path);
    if (identity.boot === currentBoot) return identity;
    const next = { ownerId: identity.ownerId, epoch: randomUUID(), boot: currentBoot };
    durableJsonReplace(path, next);
    return next;
  }
  const next = { ownerId: randomUUID(), epoch: randomUUID(), boot: currentBoot };
  durableJsonReplace(path, next);
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
    .update(
      JSON.stringify(
        req.placement ? [req.repoPath, req.prompt, profile, req.placement] : [req.repoPath, req.prompt, profile],
      ),
    )
    .digest("hex");
}
const MAX_JOURNAL = 32 * 1024 * 1024;
const MAX_LINE = 512 * 1024;
const MAX_PAGE = 2 * 1024 * 1024; // below the SSH client's 4 MB response cap
/** A fresh owner writes contiguous, bounded rows; only fsynced rows advance the sequence. */
class OwnerEventJournal {
  private readonly descriptor: number;
  private sequence = 0;

  constructor(taskId: string) {
    const path = join(location(taskId), "events.jsonl");
    // Never append from sequence one to an earlier owner's journal.
    if (existsSync(path) && statSync(path).size) throw new Error("Existing journal; cannot replay owner");
    this.descriptor = openSync(path, "a", 0o600);
  }

  append(event: unknown): void {
    const line = `${JSON.stringify({ seq: this.sequence + 1, event })}\n`;
    if (Buffer.byteLength(line) > MAX_LINE || fstatSync(this.descriptor).size + Buffer.byteLength(line) > MAX_JOURNAL)
      throw new Error("RPC journal limit exceeded");
    const bytes = Buffer.from(line);
    for (let offset = 0; offset < bytes.length; ) {
      const written = writeSync(this.descriptor, bytes, offset, bytes.length - offset);
      if (!written) throw new Error("Short journal write");
      offset += written;
    }
    fsyncSync(this.descriptor);
    this.sequence++;
  }

  close(): void {
    closeSync(this.descriptor);
  }
}

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
      const normal = (await loadProfiles(join(process.env.HOME ?? homedir(), ".bruv", "subagents.json"))).normal;
      return {
        protocol: 1,
        taskPlacement: 1,
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
    if (
      (req.op === "launch" || req.op === "repository-upload") &&
      !existsSync(location(req.taskId)) &&
      readdirSync(tasks).length >= 100
    )
      return error(
        "task_limit",
        "Remote task retention limit (100) reached; preserve artifacts and retire old task directories before launching more",
      );
    if (req.op === "artifact") {
      const dir = location(req.taskId);
      if (!existsSync(statePath(req.taskId))) return error("not_found", "Unknown artifact task");
      if (req.action === "list") return { artifacts: listRemoteArtifacts(dir) };
      if (
        req.action !== "get" ||
        typeof req.name !== "string" ||
        typeof req.sha256 !== "string" ||
        typeof req.offset !== "number"
      )
        return error("invalid_artifact", "Invalid artifact request");
      return getRemoteArtifact(dir, { name: req.name, sha256: req.sha256, offset: req.offset });
    }
    if (req.op === "repository-upload" || req.op === "repository-result") {
      const dir = location(req.taskId);
      const state = existsSync(statePath(req.taskId)) ? saved(req.taskId).task.state : undefined;
      return repositoryRequest(dir, req, state) as RemoteResponse;
    }
    if (
      req.op === "cancel" ||
      req.op === "capability-grant" ||
      req.op === "capability-revoke" ||
      req.op === "capability-reply"
    ) {
      const dir = location(req.taskId);
      if (!existsSync(statePath(req.taskId))) return error("not_found", "Unknown taskId");
      const value = saved(req.taskId),
        box = new OwnerCapabilityMailbox(dir, req.taskId);
      if (req.op === "cancel") {
        if (["accepted", "running"].includes(value.task.state)) {
          value.task.cancelRequested = true;
          persist(req.taskId, value);
          if (!existsSync(join(dir, "cancel.json")))
            durableJsonReplace(join(dir, "cancel.json"), { requestedAt: new Date().toISOString() });
          await box.terminal("Cancellation requested");
        }
        return { task: value.task, ...events(req.taskId) };
      }
      if (!["accepted", "running"].includes(value.task.state) || value.task.cancelRequested)
        return error("task_ended", "Task is terminal or cancellation requested");
      if (req.op === "capability-grant") {
        if (req.grant.taskId !== req.taskId) return error("grant_conflict", "Grant task mismatch");
        await box.acceptGrant(req.grant);
        return { accepted: true };
      }
      if (req.op === "capability-revoke") {
        await box.revoke(req.grantId);
        return { accepted: true };
      }
      if (req.reply.taskId !== req.taskId) return error("reply_conflict", "Capability task mismatch");
      return { accepted: await box.reply(req.reply) };
    }
    if (req.op === "launch") {
      location(req.taskId);
      if (existsSync(statePath(req.taskId))) {
        const existing = saved(req.taskId);
        if (
          existing.intent !== intent(req, existing.task.profile) ||
          existing.overrides?.model !== req.model ||
          existing.overrides?.thinking !== req.thinking
        )
          return error("intent_conflict", "taskId already accepted with different intent");
        try {
          return { task: existing.task, ...events(req.taskId) };
        } catch (e) {
          return error("journal_gap", String(e));
        }
      }
      if (req.placement !== undefined) {
        try {
          validatePlacement(req.placement);
        } catch (e) {
          return error("invalid_placement", String(e));
        }
      }
      const active = readdirSync(tasks).filter((id) => {
        try {
          return ["accepted", "running"].includes(saved(id).task.state);
        } catch {
          return false;
        }
      }).length;
      if (active >= 8)
        return error("active_limit", "Remote active task limit (8) reached; sync or cancel existing tasks first");
      if (!isAbsolute(req.repoPath) || !statSync(req.repoPath).isDirectory() || !existsSync(join(req.repoPath, ".git")))
        return error("invalid_repo", "repoPath must be an existing absolute Git repository");
      if (typeof req.prompt !== "string" || !req.prompt.trim() || Buffer.byteLength(req.prompt) > 128 * 1024)
        return error("invalid_prompt", "Nonempty prompt up to 128 KiB required");
      const name = req.placement?.profile ?? "normal";
      const configured = (await loadProfiles(join(process.env.HOME ?? homedir(), ".bruv", "subagents.json")))[name];
      const selectedModel = req.model ?? configured.model;
      if (!selectedModel)
        return error("missing_model", `Configure remote ${name} profile model in ~/.bruv/subagents.json`);
      if (
        req.model !== undefined &&
        (typeof req.model !== "string" || !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.:/-]+$/.test(req.model))
      )
        return error("invalid_model", "Expected provider/model override");
      if (
        req.thinking !== undefined &&
        (typeof req.thinking !== "string" || !THINKING_LEVELS.includes(req.thinking as ThinkingLevel))
      )
        return error("invalid_thinking", "Invalid thinking override");
      const profile = {
        name,
        model: selectedModel,
        thinking: req.thinking ?? configured.thinking ?? "off",
      };
      const hash = intent(req, profile);

      const taskDirectory = location(req.taskId);
      if (existsSync(taskDirectory)) {
        const prepared = join(taskDirectory, "repository-ready.json");
        if (!existsSync(prepared) || read<{ checkout: string }>(prepared).checkout !== req.repoPath)
          return error("repository_incomplete", "Existing task directory is not the verified prepared checkout");
        if (req.placement) {
          const preparedWorkspace = read<{ workspace?: unknown }>(prepared).workspace;
          if (JSON.stringify(preparedWorkspace) !== JSON.stringify(req.placement.workspace))
            return error("workspace_conflict", "Prepared snapshot does not match requested workspace isolation");
        }
      } else {
        if (req.placement)
          return error("repository_required", "Placed tasks require a verified isolated repository snapshot");
        mkdirSync(taskDirectory, { mode: 0o700 });
      }
      const tasksFd = openSync(tasks, "r");
      try {
        fsyncSync(tasksFd);
      } finally {
        closeSync(tasksFd);
      }
      const value: Saved = {
        intent: hash,
        task: { taskId: req.taskId, state: "accepted", repoPath: req.repoPath, profile, placement: req.placement },
        boot: identity.boot,
        overrides: { model: req.model, thinking: req.thinking },
      };
      persist(req.taskId, value);
      durableJsonReplace(join(location(req.taskId), "request.json"), { prompt: req.prompt });
      try {
        const child = spawn(executable, ["--remote-owner", req.taskId], {
          detached: true,
          stdio: "ignore",
          env: remoteChildEnvironment(process.env, req.placement),
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
    if (req.op === "answer") return new NativeAnswerDelivery(req.taskId).accept(req);
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
        const box = new OwnerCapabilityMailbox(location(req.taskId), req.taskId);
        if (["accepted", "running"].includes(value.task.state) && !value.task.cancelRequested) {
          value.task.capabilities = await box.pending();
          value.task.capabilityNeeds = capabilityNeeds(location(req.taskId));
        } else await box.terminal(`Task ${value.task.state}`);
        if (!["accepted", "running"].includes(value.task.state)) {
          try {
            value.task.artifacts = listRemoteArtifacts(location(req.taskId));
          } catch (error) {
            value.task.artifactError = String(error);
          }
        }
        return { task: value.task, ...events(req.taskId, req.cursor) };
      } catch (e) {
        return error("journal_gap", String(e));
      }
    }
    return error("invalid_request", "Unsupported operation");
  });
}

type NativeAnswer = Extract<RemoteRequest, { op: "answer" }>;
type AnswerSlot = NativeAnswer & { dispatch?: string };

/** Receipt = accepted intent/result; slot = at-most-once dispatch; ledger = delivery proof. */
class NativeAnswerDelivery {
  private readonly directory: string;
  private readonly slotPath: string;

  constructor(private readonly taskId: string) {
    this.directory = location(taskId);
    this.slotPath = join(this.directory, "answer.json");
  }

  // Called inside the request transaction. Receipt must precede slot publication.
  accept(req: NativeAnswer): RemoteResponse {
    if (!existsSync(statePath(req.taskId))) return error("not_found", "Unknown taskId");
    const value = saved(req.taskId);
    if (value.task.state !== "running")
      return error("not_running", "Remote session is not running; answer was not sent");
    if (
      !/^[a-zA-Z0-9_-]{1,128}$/.test(req.replyId) ||
      typeof req.text !== "string" ||
      !req.text.trim() ||
      Buffer.byteLength(req.text) > 16_384 ||
      !Number.isSafeInteger(req.version) ||
      !req.owner ||
      typeof req.owner.sessionId !== "string" ||
      typeof req.owner.branchId !== "string" ||
      typeof req.id !== "string"
    )
      return error("invalid_answer", "Invalid targeted native reply");
    const receipt = join(this.directory, "answers", `${req.replyId}.json`);
    if (existsSync(receipt)) {
      const prior = read<{ request: typeof req; status: "delivered" | "uncertain" }>(receipt);
      if (JSON.stringify(prior.request) !== JSON.stringify(req))
        return error("answer_conflict", "Reply ID reused with different intent");
      if (prior.status === "uncertain") {
        // Receipt is committed before the command slot. Recover that exact pre-dispatch
        // crash window, but never rewrite an existing (possibly dispatched) same-ID slot.
        const slotPath = this.slotPath;
        const slot = existsSync(slotPath) ? read<{ replyId: string }>(slotPath) : undefined;
        const oldReceipt = slot ? join(this.directory, "answers", `${slot.replyId}.json`) : undefined;
        const oldDelivered =
          oldReceipt && existsSync(oldReceipt) && read<{ status: string }>(oldReceipt).status === "delivered";
        if (!slot || (slot.replyId !== req.replyId && oldDelivered)) {
          durableJsonReplace(slotPath, req);
          value.task.reply = { replyId: req.replyId, status: "uncertain" };
          persist(req.taskId, value);
        }
      }
      return {
        task: { ...value.task, reply: { replyId: req.replyId, status: prior.status } },
        ...events(req.taskId),
      };
    }
    const questions = value.task.questions;
    if (
      !Array.isArray(questions) ||
      !questions.some((item) => {
        const q = item as { id?: string; status?: string; version?: number; owner?: typeof req.owner };
        return (
          q.id === req.id &&
          q.status === "pending" &&
          q.version === req.version &&
          q.owner?.sessionId === req.owner.sessionId &&
          q.owner?.branchId === req.owner.branchId
        );
      })
    )
      return error("stale_question", "Question is not pending at this owner/version; sync before answering");
    const path = this.slotPath;
    if (existsSync(path)) {
      const prior = read<typeof req>(path);
      if (prior.replyId !== req.replyId && value.task.reply?.status !== "delivered")
        return error("answer_conflict", "Previous reply outcome remains uncertain");
      if (prior.replyId === req.replyId && JSON.stringify({ ...prior, dispatch: undefined }) !== JSON.stringify(req))
        return error("answer_conflict", "Reply intent conflict");
    }
    mkdirSync(dirname(receipt), { recursive: true, mode: 0o700 });
    durableJsonReplace(receipt, { request: req, status: "uncertain" });
    durableJsonReplace(path, req);
    value.task.reply = { replyId: req.replyId, status: "uncertain" };
    persist(req.taskId, value);
    return { task: value.task, ...events(req.taskId) };
  }

  dispatch(send: (command: unknown) => void): void {
    if (!existsSync(this.slotPath)) return;
    const request = read<AnswerSlot>(this.slotPath);
    if (request.dispatch) return;
    // A crash after this marker cannot authorize a replay into another session.
    request.dispatch = "uncertain";
    durableJsonReplace(this.slotPath, request);
    send({
      id: `remote-answer-${request.replyId}`,
      type: "prompt",
      message: `/remote-native-answer ${Buffer.from(JSON.stringify(request)).toString("base64url")}`,
    });
  }

  async acknowledge(responseId: string, success: boolean): Promise<void> {
    const request = read<AnswerSlot>(this.slotPath);
    if (responseId !== `remote-answer-${request.replyId}`) return;
    let delivered = false;
    try {
      delivered =
        success &&
        read<
          Array<{
            id: string;
            replyId?: string;
            replyVersion?: number;
            status: string;
            delivery?: string;
          }>
        >(join(this.directory, "session.jsonl.questions.json")).some(
          (q) =>
            q.id === request.id &&
            q.replyId === request.replyId &&
            q.replyVersion === request.version &&
            q.status === "answered" &&
            q.delivery === "delivered",
        );
    } catch {
      // An RPC success without matching native-ledger evidence is uncertain.
    }
    await locked(async () => {
      const current = saved(this.taskId);
      if (current.task.state !== "running") return;
      current.task.reply = { replyId: request.replyId, status: delivered ? "delivered" : "uncertain" };
      const { dispatch: _dispatch, ...accepted } = request;
      durableJsonReplace(join(this.directory, "answers", `${request.replyId}.json`), {
        request: accepted,
        status: current.task.reply.status,
      });
      persist(this.taskId, current);
    });
  }

  get questionInFlight(): string | undefined {
    return existsSync(this.slotPath) ? read<AnswerSlot>(this.slotPath).id : undefined;
  }
}

type OwnerRpcEvent = {
  type?: string;
  id?: string;
  success?: boolean;
  data?: { model?: { provider?: string; id?: string }; thinkingLevel?: string };
  message?: { stopReason?: string; errorMessage?: string };
};

type NativeSettlement =
  | { kind: "work-pending" }
  | { kind: "questions-pending"; questions: unknown[]; textOutputGap?: string }
  | { kind: "complete"; questions: unknown[]; textOutputGap?: string };

function nativeSettlement(runtimePath: string): NativeSettlement {
  // The extension writes this before agent_settled. A yielded turn is not task completion.
  const runtime = read<{
    settled: boolean;
    activeJobs?: number;
    pendingMessages?: boolean;
    questions?: unknown[];
    textOutputGap?: string;
    error?: string;
  }>(runtimePath);
  if (!runtime.settled || runtime.error || typeof runtime.activeJobs !== "number" || !Array.isArray(runtime.questions))
    throw new Error(runtime.error || "Missing native runtime checkpoint");
  if (runtime.activeJobs > 0 || runtime.pendingMessages) return { kind: "work-pending" };
  return {
    kind: runtime.questions.length ? "questions-pending" : "complete",
    questions: runtime.questions,
    textOutputGap: runtime.textOutputGap,
  };
}

async function publishQuestions(taskId: string, questions: unknown[]): Promise<void> {
  await locked(async () => {
    const current = saved(taskId);
    if (current.task.state !== "running") return;
    current.task.questions = questions;
    persist(taskId, current);
  });
}

class OwnerCancellation {
  private requestedAt = 0;
  constructor(private readonly taskId: string) {}

  get requested(): boolean {
    return this.requestedAt !== 0;
  }

  poll(
    send: (command: unknown) => void,
    record: (event: unknown) => void,
  ): "none" | "waiting" | "settled" | "unconfirmed" | "timed-out" {
    if (!existsSync(join(location(this.taskId), "cancel.json"))) return "none";
    if (!this.requestedAt) {
      this.requestedAt = Date.now();
      record({ type: "cancel_requested" });
      send({ id: "remote-cancel", type: "prompt", message: "/bruv-remote-cancel" });
    }
    const reportPath = join(location(this.taskId), "cancel-report.json");
    if (existsSync(reportPath)) {
      const report = read<{ settled?: boolean }>(reportPath);
      record({ type: "cancel_report", report });
      return report.settled === true ? "settled" : "unconfirmed";
    }
    return Date.now() - this.requestedAt > 20_000 ? "timed-out" : "waiting";
  }
}

async function publishTerminal(taskId: string, result: Saved) {
  await locked(async () => {
    const current = saved(taskId);
    // A terminal record is immutable; do not replace an earlier uncertainty with a stale snapshot.
    if (current.task.state !== "accepted" && current.task.state !== "running") return;
    current.task = {
      ...result.task,
      cancelRequested: current.task.cancelRequested,
      reply: current.task.reply ?? result.task.reply,
    };
    await new OwnerCapabilityMailbox(location(taskId), taskId).terminal(`Task ${result.task.state}`);
    persist(taskId, current);
  });
}

export async function runOwnerTask(taskId: string, executable = process.execPath): Promise<void> {
  location(taskId);
  // A launched owner owns only its recorded PID. Never run an uncertain accepted task again.
  let taskSnapshot = saved(taskId);
  for (let i = 0; i < 100 && (!taskSnapshot.pid || !taskSnapshot.startTime); i++) {
    await Bun.sleep(20);
    taskSnapshot = saved(taskId);
  }
  if (
    taskSnapshot.pid !== process.pid ||
    taskSnapshot.boot !== boot() ||
    taskSnapshot.startTime !== processInfo(process.pid).startTime ||
    taskSnapshot.task.state !== "accepted"
  )
    return;
  let journal: OwnerEventJournal | undefined;
  if (taskSnapshot.task.cancelRequested || existsSync(join(location(taskId), "cancel.json"))) {
    taskSnapshot.task.state = "cancelled";
    await publishTerminal(taskId, taskSnapshot);
    return;
  }
  let ownedChild: OwnerChild | undefined;
  let controlTimer: ReturnType<typeof setInterval> | undefined;
  let failure: string | undefined;
  let ownerError: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let exitCode: number | null | undefined;
  let nativeSettled = false;
  let promptSent = false;
  let modelError: string | undefined;
  let cancelled = false;
  const cancellation = new OwnerCancellation(taskId);
  const pendingWrites = new Set<Promise<void>>();
  const stopChild = (graceful = false) => ownedChild?.stop(graceful);
  const fail = (detail: string, graceful = false) => {
    failure = detail;
    stopChild(graceful);
  };
  try {
    const writer = new OwnerEventJournal(taskId);
    journal = writer;
    const record = (event: unknown) => {
      if (failure) return;
      try {
        writer.append(event);
      } catch (e) {
        fail(`Journal write failed: ${String(e)}`);
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
    const { model, thinking } = taskSnapshot.task.profile;
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
    ownedChild = new OwnerChild(executable, args, {
      cwd: taskSnapshot.task.repoPath,
      env: {
        ...remoteChildEnvironment(process.env, taskSnapshot.task.placement),
        BRUV_REMOTE_RUNTIME_STATE: runtimePath,
      },
    });
    const child = ownedChild.process;
    const output = new OwnerRpcOutput(MAX_LINE);
    const send = (command: unknown) => child.stdin.write(`${JSON.stringify(command)}\n`);
    const persistBeforeExit = (write: Promise<void>, detail: string) => {
      const pending = write.catch((error) => fail(detail + String(error)));
      pendingWrites.add(pending);
      void pending.then(() => pendingWrites.delete(pending));
    };
    const answers = new NativeAnswerDelivery(taskId);
    controlTimer = setInterval(() => {
      if (!child.stdin?.writable) return;
      const outcome = cancellation.poll(send, record);
      if (outcome === "settled" || outcome === "unconfirmed") {
        cancelled = outcome === "settled";
        if (!cancelled) failure = "Cancellation acknowledged but native work exit is unconfirmed";
        stopChild(true);
        return;
      }
      if (outcome === "timed-out") {
        fail("Cancellation outcome unknown: native checkpoint unavailable");
        return;
      }
      if (failure || nativeSettled || !promptSent) return;
      try {
        answers.dispatch(send);
      } catch (error) {
        fail(`Native answer dispatch uncertain: ${String(error)}`);
      }
    }, 200);
    controlTimer.unref();

    child.stdout.setEncoding("utf8");
    const verifyConfigurationAndSendPrompt = (event: OwnerRpcEvent) => {
      const effective = event.data?.model;
      if (
        !event.success ||
        effective?.provider !== model.slice(0, slash) ||
        effective?.id !== model.slice(slash + 1) ||
        event.data?.thinkingLevel !== thinking
      ) {
        fail("Remote CLI selected a different or unavailable model/thinking configuration; prompt was not sent", true);
        return;
      }
      if (promptSent || existsSync(join(location(taskId), "cancel.json"))) return;
      promptSent = true;
      send({
        id: "remote-prompt",
        type: "prompt",
        message: read<{ prompt: string }>(join(location(taskId), "request.json")).prompt,
      });
    };

    const settleNativeTurn = () => {
      if (existsSync(join(location(taskId), "cancel.json"))) return;
      try {
        const settlement = nativeSettlement(runtimePath);
        if (settlement.kind === "work-pending") return;
        taskSnapshot.task.questions = settlement.questions;
        taskSnapshot.task.textOutputGap = settlement.textOutputGap;
        if (settlement.kind === "questions-pending") {
          persistBeforeExit(publishQuestions(taskId, settlement.questions), "Question checkpoint failed: ");
          return;
        }
        nativeSettled = true;
      } catch (error) {
        fail(`Cannot verify remote task completion: ${String(error)}`, true);
        return;
      }
      stopChild(true);
    };

    const routeEvent = (event: OwnerRpcEvent | null) => {
      if (event?.type === "response") {
        if (event.id === "remote-config") verifyConfigurationAndSendPrompt(event);
        else if (typeof event.id === "string" && event.id.startsWith("remote-answer-"))
          persistBeforeExit(
            answers.acknowledge(event.id, event.success === true),
            "Native reply result persistence failed: ",
          );
        return;
      }
      if (event?.type === "message_end") {
        const message = event.message;
        if (message?.stopReason === "error" || message?.stopReason === "aborted" || message?.errorMessage)
          modelError = String(message.errorMessage || message.stopReason);
      } else if (event?.type === "agent_start") {
        nativeSettled = false;
        modelError = undefined;
      } else if (event?.type === "agent_settled") settleNativeTurn();
    };

    child.stdout.on("data", (chunk: string) => {
      if (failure) return;
      try {
        for (const event of output.push(chunk)) {
          record(event);
          if (failure) break;
          routeEvent(event as OwnerRpcEvent | null);
          if (failure) break;
        }
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => record({ type: "stderr", text: chunk }));
    child.stdin.on("error", () => {
      /* child exit is handled below */
    });
    send({ id: "remote-config", type: "get_state" });
    const watchdog = () => {
      // A native question waits for a human, not a one-hour RPC turn deadline.
      // A dispatched answer is uncertain if it does not settle within the deadline.
      const questionInFlight = answers.questionInFlight;
      if (
        taskSnapshot.task.questions?.some(
          (q) =>
            (q as { status?: string; id?: string }).status === "pending" &&
            (q as { id?: string }).id !== questionInFlight,
        )
      ) {
        timer = setTimeout(watchdog, 60 * 60 * 1000);
        return;
      }
      failure = "RPC timed out";
      stopChild();
    };
    timer = setTimeout(watchdog, 60 * 60 * 1000);
    exitCode = await ownedChild.waitForExit();
    if (output.truncated && !failure) failure = "Truncated RPC output";
  } catch (error) {
    ownerError = String(error);
  } finally {
    // No polling or watchdog survives teardown. Escalation stays owned until close.
    if (timer) clearTimeout(timer);
    if (controlTimer) clearInterval(controlTimer);
    await ownedChild?.release();
    await Promise.all(pendingWrites);
    journal?.close();
  }

  let pendingQuestion = false;
  try {
    const ledger = join(location(taskId), "session.jsonl.questions.json");
    pendingQuestion =
      !ownerError &&
      existsSync(ledger) &&
      read<Array<{ status: string; delivery?: string }>>(ledger).some(
        (q) => q.status === "pending" || (q.status === "answered" && q.delivery !== "delivered"),
      );
  } catch (error) {
    ownerError = String(error);
  }
  taskSnapshot.task.state = ownerError
    ? "unknown"
    : cancelled
      ? "cancelled"
      : exitCode === 0 &&
          promptSent &&
          nativeSettled &&
          !failure &&
          !modelError &&
          !pendingQuestion &&
          !cancellation.requested
        ? "done"
        : "unknown";
  if (taskSnapshot.task.state === "unknown")
    taskSnapshot.task.error =
      failure ||
      ownerError ||
      modelError ||
      (pendingQuestion
        ? "Native question unresolved when remote session exited"
        : `RPC exited without verified native settlement (exit ${exitCode})`);
  try {
    await publishTerminal(taskId, taskSnapshot);
  } catch (error) {
    taskSnapshot.task.state = "unknown";
    taskSnapshot.task.error = failure || String(error);
    await publishTerminal(taskId, taskSnapshot);
  }
}
