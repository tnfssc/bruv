import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Question, type QuestionContext, type QuestionOwner, QuestionService } from "../questions/service";
import { captureRepository, type RepositorySnapshot } from "./repository";

export type SourceSelection = { includeUntracked: string[]; retryTaskId?: string };
export type SourceIntent = {
  taskId: string;
  jobSessionFile: string;
  localRoot: string;
  target: string;
  ownerId: string;
  epoch: string;
  prompt: string;
  title?: string;
  placement: unknown;
  model?: string;
  thinking?: string;
  includeUntracked: string[];
};
type Pinned = { snapshot: RepositorySnapshot; sha256: string };
export type SourcePreparation = {
  version: 1;
  order: { afterSequence: number; ordinal: number };
  intent: SourceIntent;
  questionOwner: QuestionOwner;
  questionId?: string;
  questionVersion?: number;
  questionText: string;
  dedupKey: string;
  include: Pinned;
  omit: Pinned;
  state: "waiting" | "ready" | "cancelled";
  decision?: "include" | "omit";
  replyId?: string;
  omissionReason?: string;
};
export const SOURCE_CHOICES = ["Include pinned files", "Omit untracked files", "Cancel task"];
const jobId = (taskId: string) => `ssh:${Buffer.from(taskId).toString("base64url")}`;
const digest = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
function atomic(path: string, value: unknown) {
  const temp = `${path}.${randomUUID()}`;
  writeFileSync(temp, JSON.stringify(value), { flag: "wx", mode: 0o600 });
  renameSync(temp, path);
}
function id(value: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw Error("Invalid source approval task ID");
  return value;
}
function canonical(intent: SourceIntent): SourceIntent {
  const result = Bun.spawnSync(["git", "-C", intent.localRoot, "rev-parse", "--show-toplevel"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode) throw Error("Current directory is not a Git repository");
  const paths = intent.includeUntracked;
  if (
    !Array.isArray(paths) ||
    !paths.length ||
    paths.length > 256 ||
    new Set(paths).size !== paths.length ||
    paths.some((p) => typeof p !== "string" || !p || p.length > 1024)
  )
    throw Error("Source inclusion requires exact unique paths");
  return { ...intent, localRoot: realpathSync(result.stdout.toString().trim()), includeUntracked: [...paths] };
}
/** Trusted local preflight. Never accepts agent-supplied approval/provenance. */
export class SourceApprovalService {
  readonly directory: string;
  constructor(
    clientPath: string,
    private questions = new QuestionService(),
  ) {
    this.directory = join(dirname(clientPath), "source-approvals");
  }
  private file(taskId: string) {
    return join(this.directory, id(taskId), "approval.json");
  }
  get(sessionFile: string, taskId: string): SourcePreparation | undefined {
    const file = this.file(taskId);
    if (!existsSync(file)) return;
    const record = JSON.parse(readFileSync(file, "utf8")) as SourcePreparation;
    if (record.version !== 1 || record.intent.taskId !== taskId || record.intent.jobSessionFile !== sessionFile)
      throw Error("Source approval parent ownership conflict");
    return record;
  }
  list(sessionFile: string): SourcePreparation[] {
    if (!existsSync(this.directory)) return [];
    return readdirSync(this.directory)
      .filter((p) => /^[a-zA-Z0-9_-]{1,100}$/.test(p))
      .flatMap((taskId) => {
        const file = this.file(taskId);
        if (!existsSync(file)) return [];
        const record = JSON.parse(readFileSync(file, "utf8")) as SourcePreparation;
        const owned = record.intent.jobSessionFile === sessionFile ? this.get(sessionFile, taskId) : undefined;
        return owned ? [owned] : [];
      });
  }
  private async locked<T>(work: () => Promise<T>): Promise<T> {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const db = new Database(join(this.directory, "lock.sqlite"));
    try {
      db.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE");
      const result = await work();
      db.exec("COMMIT");
      return result;
    } finally {
      db.close();
    }
  }
  async prepare(input: SourceIntent, ctx: QuestionContext, afterSequence = 0): Promise<SourcePreparation> {
    return this.locked(async () => {
      const intent = canonical(input);
      if (ctx.sessionManager.getSessionFile() !== intent.jobSessionFile)
        throw Error("Source approval parent session mismatch");
      const saved = this.get(intent.jobSessionFile, intent.taskId);
      if (saved && JSON.stringify(saved.intent) !== JSON.stringify(intent))
        throw Error("Source approval retry intent conflict");
      const pinned = saved ?? this.pinSource(intent, ctx, afterSequence);
      if (pinned.state === "cancelled") return pinned;
      const awaiting = pinned.questionId ? pinned : await this.requestApproval(pinned, ctx);
      if (!awaiting.questionId) throw Error("Source approval question was not created");
      return this.acceptAnswer(awaiting, this.questions.get(ctx, awaiting.questionId));
    });
  }
  private pinSource(intent: SourceIntent, ctx: QuestionContext, afterSequence: number): SourcePreparation {
    const sessionId = ctx.sessionManager.getSessionId();
    const branchId = ctx.sessionManager.getLeafId();
    if (!sessionId || !branchId) throw Error("Source approval requires a durable parent branch");
    const questionOwner = { sessionId, branchId };
    let questionText =
      "Include these exact pinned untracked files in current-source handoff?\n" +
      JSON.stringify({
        taskId: intent.taskId,
        target: intent.target,
        source: intent.localRoot,
        ownerId: intent.ownerId,
        epoch: intent.epoch,
        parent: questionOwner,
        promptSummary: intent.prompt.slice(0, 200),
        promptSha256: digest(intent.prompt),
        placement: intent.placement,
        paths: intent.includeUntracked,
      });
    if (questionText.length > 4000) throw Error("Source approval intent exceeds question display limit");
    const dir = join(this.directory, id(intent.taskId));
    mkdirSync(dir, { mode: 0o700 });
    const include = captureRepository(intent.localRoot, join(dir, "include"), intent.includeUntracked);
    const omit = captureRepository(intent.localRoot, join(dir, "omit"));
    if (include.base !== omit.base || include.head !== omit.head)
      throw Error("Tracked source changed during approval preparation");
    questionText += `\nPinned included snapshot SHA-256: ${digest(readFileSync(include.bundle))}`;
    if (questionText.length > 4000) throw Error("Source approval intent exceeds question display limit");
    const record: SourcePreparation = {
      version: 1,
      order: {
        afterSequence,
        ordinal: readdirSync(this.directory).filter((p) => /^[a-zA-Z0-9_-]{1,100}$/.test(p)).length,
      },
      intent,
      questionOwner,
      questionText,
      dedupKey: `source-${randomUUID()}`,
      include: { snapshot: include, sha256: digest(readFileSync(include.bundle)) },
      omit: { snapshot: omit, sha256: digest(readFileSync(omit.bundle)) },
      state: "waiting",
    };
    atomic(this.file(intent.taskId), record);
    return record;
  }
  private async requestApproval(record: SourcePreparation, ctx: QuestionContext): Promise<SourcePreparation> {
    if (
      ctx.sessionManager.getLeafId() !== record.questionOwner.branchId ||
      ctx.sessionManager.getSessionId() !== record.questionOwner.sessionId
    )
      throw Error("Source approval owner branch changed before question creation");
    let q = await this.questions.ask(ctx, {
      text: record.questionText,
      dedupKey: record.dedupKey,
      choices: SOURCE_CHOICES,
      allowFreeText: false,
      requester: "Source handoff",
      taskIds: [jobId(record.intent.taskId)],
      reason: "Pinned untracked bytes need a human CLI answer. All untracked files stay out by default.",
    });
    if (q.status === "pending" && !q.blocked)
      q = await this.questions.block(ctx, {
        id: q.id,
        owner: q.owner,
        version: q.version,
        checkpoint:
          "Retry unchanged subagent source intent with source.retryTaskId=" +
          record.intent.taskId +
          " after human answer",
        taskIds: [jobId(record.intent.taskId)],
      });
    const awaiting: SourcePreparation = { ...record, questionId: q.id, questionVersion: q.version };
    atomic(this.file(record.intent.taskId), awaiting);
    return awaiting;
  }
  private acceptAnswer(record: SourcePreparation, q: Question): SourcePreparation {
    if (
      q.readOnly ||
      q.owner.sessionId !== record.questionOwner.sessionId ||
      q.owner.branchId !== record.questionOwner.branchId ||
      q.text !== record.questionText ||
      q.dedupKey !== record.dedupKey ||
      q.allowFreeText !== false ||
      JSON.stringify(q.choices) !== JSON.stringify(SOURCE_CHOICES) ||
      JSON.stringify(q.taskIds) !== JSON.stringify([jobId(record.intent.taskId)])
    )
      throw Error("Source approval question provenance conflict");
    if (record.state === "ready") return record;
    if (q.status === "pending") return record;
    const human =
      (q.status === "answered" || q.status === "resolved") &&
      q.answeredFrom === "cli" &&
      !!q.replyId &&
      q.replyVersion !== undefined &&
      record.questionVersion !== undefined &&
      Number.isSafeInteger(q.replyVersion) &&
      q.replyVersion >= record.questionVersion &&
      q.version > q.replyVersion;
    if (human && q.answer === SOURCE_CHOICES[2]) {
      const cancelled: SourcePreparation = { ...record, state: "cancelled" };
      atomic(this.file(record.intent.taskId), cancelled);
      return cancelled;
    }
    const decision = human && q.answer === SOURCE_CHOICES[0] ? "include" : "omit";
    const ready: SourcePreparation = {
      ...record,
      state: "ready",
      decision,
      replyId: human ? q.replyId : undefined,
      ...(decision === "omit"
        ? { omissionReason: "Untracked inclusion not approved; all untracked files omitted" }
        : {}),
    };
    atomic(this.file(record.intent.taskId), ready);
    return ready;
  }

  snapshot(record: SourcePreparation): RepositorySnapshot {
    if (record.state !== "ready") throw Error("Source approval is not ready for dispatch");
    const pinned = record.decision === "include" ? record.include : record.omit;
    if (
      digest(readFileSync(pinned.snapshot.bundle)) !== pinned.sha256 ||
      JSON.stringify(JSON.parse(readFileSync(pinned.snapshot.manifest, "utf8"))) !== JSON.stringify(pinned.snapshot)
    )
      throw Error("Pinned source snapshot changed; refusing dispatch");
    return pinned.snapshot;
  }
  async cancel(sessionFile: string, taskId: string): Promise<SourcePreparation> {
    return this.locked(async () => {
      const record = this.get(sessionFile, taskId);
      if (!record) throw Error("Unknown source approval job in this session");
      record.state = "cancelled";
      atomic(this.file(taskId), record);
      return record;
    });
  }
}
