import { downloadRepositoryResult } from "./repository-download";
import { durableJsonReplace } from "./durable-json";
import { isDeepStrictEqual } from "node:util";
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync, chmodSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Database } from "bun:sqlite";
import {
  captureRepository,
  integrateRepositoryResult,
  type RepositorySnapshot,
  type RepositoryReturn,
} from "./repository";
import type {
  RootIntent,
  RootRecord,
  RootObservation,
  RootCommand,
  RootCommandReceipt,
  RootRequest,
  RootTransport,
} from "./root-contract";
import { rootSshTransport } from "./root-transport";

const hash = (x: string | Buffer) => createHash("sha256").update(x).digest("hex");
const CHUNK = 256 * 1024,
  MAX = 32 * 1024 * 1024;
export type RootTarget = { name: string; host: string; bruvPath: string; ownerId: string; epoch: string };
export type RootClientOptions = {
  target: RootTarget;
  cwd: string;
  stateDir?: string;
  remoteRepo?: string;
  remoteInclude?: string[];
  model?: string;
  thinking?: string;
  projectTrusted?: boolean;
  workspace?: { kind: "inherit" } | { kind: "worktree"; baseRef?: string; branch?: string };
  fresh?: boolean;
  transport?: RootTransport;
};
export type RootLocalState = {
  version: 1;
  target: RootTarget;
  sourceRoot: string;
  requestId: string;
  intent: RootIntent;
  source?: RepositorySnapshot;
  sourceLabel: string;
  workspace?: RootClientOptions["workspace"];
  created: boolean;
  record?: RootRecord;
  cursor: number;
  events: RootObservation["events"];
  cacheStart: number;
  commands: Record<string, { command: RootCommand; receipt: RootCommandReceipt }>;
  initialPrompt?: { text: string; commandId: string };
  outcome?: RepositoryReturn;
  lastError?: string;
};
function object(value: unknown): any {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid root response");
  const r = value as any;
  if (r.code && r.error) throw Error(r.error);
  return r;
}
function atomic(path: string, value: unknown) {
  if (Buffer.byteLength(JSON.stringify(value)) > MAX) throw Error("Root cache full; preserve it before continuing");
  durableJsonReplace(path, value);
}
/** No local provider, tools or session. This is only a durable presentation pointer. */
export class RootClient {
  readonly path: string;
  readonly directory: string;
  private queue: Promise<unknown> = Promise.resolve();
  private transport: RootTransport;
  private constructor(
    readonly options: RootClientOptions,
    directory: string,
  ) {
    this.directory = directory;
    this.path = join(directory, "root.json");
    this.transport = options.transport ?? rootSshTransport;
  }
  static async open(options: RootClientOptions): Promise<RootClient> {
    let cwd = realpathSync(options.cwd);
    const sourceRoot = Bun.spawnSync(["git", "-C", cwd, "rev-parse", "--show-toplevel"], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000,
    });
    if (sourceRoot.exitCode === 0) cwd = realpathSync(sourceRoot.stdout.toString().trim());
    const base = options.stateDir ?? join(homedir(), ".bruv", "remote", "roots");
    mkdirSync(base, { recursive: true, mode: 0o700 });
    chmodSync(base, 0o700);
    const key = hash(options.target.name + "\0" + cwd);
    const pointer = join(base, key + ".json");
    const db = new Database(join(base, "pointers.sqlite"));
    let directory: string;
    try {
      db.exec("PRAGMA busy_timeout=5000; BEGIN EXCLUSIVE");
      if (existsSync(pointer) && !options.fresh)
        directory = join(base, object(JSON.parse(readFileSync(pointer, "utf8"))).sessionId);
      else {
        if (readdirSync(base).filter((name) => /^[0-9a-f-]{36}$/.test(name)).length >= 100)
          throw Error("Root session cache limit reached; preserve/export sessions before creating more");
        const sessionId = randomUUID();
        directory = join(base, sessionId);
        mkdirSync(directory, { mode: 0o700 });
        const source = options.remoteRepo
          ? undefined
          : captureRepository(
              cwd,
              join(directory, "source"),
              options.remoteInclude ?? [],
              options.workspace?.kind === "worktree" ? { baseRef: options.workspace.baseRef } : {},
            );
        const state: RootLocalState = {
          version: 1,
          target: { ...options.target },
          sourceRoot: cwd,
          requestId: randomUUID(),
          intent: {
            ownerId: options.target.ownerId,
            epoch: options.target.epoch,
            sessionId,
            role: "root",
            depth: 0,
            ...(options.projectTrusted === undefined ? {} : { projectTrusted: options.projectTrusted }),
            repoPath: options.remoteRepo ?? "pending-upload",
            ...(options.model ? { model: options.model } : {}),
            ...(options.thinking ? { thinking: options.thinking } : {}),
          },
          source,
          sourceLabel: source
            ? source.source?.kind === "commit"
              ? "explicit source commit " +
                source.source.commit +
                " (history-free snapshot; matches current: " +
                source.source.matchesCurrent +
                ")"
              : "current tracked source snapshot (history-free)"
            : "server existing repository: " + options.remoteRepo,
          workspace: options.workspace,
          created: false,
          cursor: 0,
          cacheStart: 1,
          events: [],
          commands: {},
        };
        atomic(join(directory, "root.json"), state);
        atomic(pointer, { sessionId });
      }
      db.exec("COMMIT");
    } finally {
      db.close();
    }
    const client = new RootClient({ ...options, cwd }, directory!);
    const state = client.read();
    if (!isDeepStrictEqual(state.target, options.target))
      throw Error("Saved root belongs to a different pinned target/owner epoch; no request sent");
    if (options.remoteRepo !== undefined && state.intent.repoPath !== options.remoteRepo)
      throw Error("Saved root source differs; use an explicit fresh root");
    if (
      (options.projectTrusted !== undefined && state.intent.projectTrusted !== options.projectTrusted) ||
      (options.model !== undefined && state.intent.model !== options.model) ||
      (options.thinking !== undefined && state.intent.thinking !== options.thinking)
    )
      throw Error("Root model intent is immutable; use an explicit fresh root");
    if (
      options.remoteInclude?.length &&
      (!state.source ||
        !isDeepStrictEqual([...options.remoteInclude].sort(), [...state.source.selectedUntracked].sort()))
    )
      throw Error("Saved root untracked approval differs; explicitly start fresh to capture newly approved bytes");
    if (options.workspace !== undefined && !isDeepStrictEqual(state.workspace, options.workspace))
      throw Error("Root workspace intent is immutable; explicitly start fresh");
    return client;
  }
  read(): RootLocalState {
    return JSON.parse(readFileSync(this.path, "utf8"));
  }
  private withState<T>(fn: (state: RootLocalState) => Promise<T>): Promise<T> {
    const run = async () => {
      const db = new Database(join(this.directory, "lock.sqlite"));
      try {
        db.exec("PRAGMA busy_timeout=0");
        let acquired = false;
        for (let i = 0; i < 100; i++) {
          try {
            db.exec("BEGIN EXCLUSIVE");
            acquired = true;
            break;
          } catch {
            await Bun.sleep(30);
          }
        }
        if (!acquired) throw Error("Root presentation state is in use");
        const result = await fn(this.read());
        db.exec("COMMIT");
        return result;
      } finally {
        db.close();
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }
  private async request(state: RootLocalState, request: RootRequest): Promise<any> {
    const h = object(await this.transport(state.target.host, state.target.bruvPath, { op: "hello" }));
    if (h.ownerId !== state.target.ownerId || h.epoch !== state.target.epoch)
      throw Error("Remote root owner/epoch changed; request refused");
    return object(await this.transport(state.target.host, state.target.bruvPath, request));
  }
  private identity(s: RootLocalState) {
    return { ownerId: s.intent.ownerId, epoch: s.intent.epoch, sessionId: s.intent.sessionId };
  }
  async ensureCreated(): Promise<RootRecord> {
    return this.withState(async (s) => {
      if (s.created && s.record) return s.record;
      if (s.source && s.intent.repoPath === "pending-upload") {
        s.intent.repoPath = await this.uploadPinnedSource(s, s.source);
        atomic(this.path, s);
      }
      const response = await this.request(s, { op: "create", intent: s.intent, requestId: s.requestId });
      s.record = this.record(response.record ?? response, s);
      s.created = true;
      atomic(this.path, s);
      return s.record;
    });
  }
  private async uploadPinnedSource(s: RootLocalState, source: RepositorySnapshot): Promise<string> {
    const bytes = readFileSync(source.bundle);
    const sha256 = hash(bytes);
    if (
      source.bundleSha256 !== sha256 ||
      source.localRoot !== s.sourceRoot ||
      !isDeepStrictEqual(JSON.parse(readFileSync(source.manifest, "utf8")), source)
    )
      throw Error("Pinned root source bytes or manifest changed; no transfer sent");
    let offset = 0,
      checkout: string | undefined;
    while (offset < bytes.length) {
      const r = await this.request(s, {
        op: "repository-upload",
        ...this.identity(s),
        snapshot: source.snapshot,
        sha256,
        total: bytes.length,
        offset,
        data: bytes.subarray(offset, offset + CHUNK).toString("base64"),
        workspace: s.workspace,
      });
      if (r.offset !== Math.min(bytes.length, offset + CHUNK)) throw Error("Invalid source upload acknowledgement");
      offset = r.offset;
      checkout = r.checkout;
    }
    if (!checkout || !checkout.startsWith("/")) throw Error("Missing root source checkout");
    return checkout;
  }
  private record(value: unknown, s: RootLocalState): RootRecord {
    const r = object(value);
    if (!isDeepStrictEqual(r.intent, s.intent)) throw Error("Root snapshot identity or immutable intent mismatch");
    if (!["accepted", "running", "closed", "unknown"].includes(r.state)) throw Error("Invalid root state");
    return r;
  }
  async observe(): Promise<RootObservation> {
    return this.withState(async (s) => {
      const r = (await this.request(s, { op: "observe", ...this.identity(s), cursor: s.cursor })) as RootObservation;
      const record = this.record(r.record, s);
      if (!Array.isArray(r.events) || !Number.isSafeInteger(r.cursor) || typeof r.hasMore !== "boolean")
        throw Error("Invalid root observation");
      let cursor = s.cursor;
      for (const e of r.events) {
        if (e.seq !== cursor + 1) {
          s.record = record;
          s.lastError = "Root event gap: authoritative snapshot retained; reconnect cannot invent missing events";
          atomic(this.path, s);
          throw Error(s.lastError);
        }
        cursor = e.seq;
      }
      if (r.cursor !== cursor) throw Error("Root cursor skipped events");
      s.record = record;
      s.cursor = cursor;
      s.events.push(...r.events);
      while (s.events.length > 2000 || Buffer.byteLength(JSON.stringify(s.events)) > 4 * 1024 * 1024) {
        s.events.shift();
      }
      s.cacheStart = s.events[0]?.seq ?? s.cursor + 1;
      delete s.lastError;
      atomic(this.path, s);
      return r;
    });
  }
  async command(command: RootCommand, commandId: string = randomUUID()): Promise<RootCommandReceipt> {
    return this.withState((s) => this.sendOrReconcile(s, command, commandId));
  }
  private async sendOrReconcile(
    s: RootLocalState,
    command: RootCommand,
    commandId: string,
  ): Promise<RootCommandReceipt> {
    const prior = s.commands[commandId];
    if (prior) {
      if (!isDeepStrictEqual(prior.command, command)) throw Error("Command ID intent conflict");
      return this.reconcileSaved(s, commandId);
    }
    if (Object.keys(s.commands).length >= 10000) throw Error("Root command ledger full");
    s.commands[commandId] = { command, receipt: { commandId, state: "unknown" } };
    atomic(this.path, s);
    try {
      const r = await this.request(s, { op: "command", ...this.identity(s), commandId, command });
      const receipt = this.receipt(r.receipt ?? r, commandId);
      s.commands[commandId]!.receipt = receipt;
      atomic(this.path, s);
      return receipt;
    } catch (error) {
      s.lastError =
        "Command outcome uncertain; same saved identity will be reconciled, never automatically replayed: " +
        String(error);
      atomic(this.path, s);
      throw Error(s.lastError);
    }
  }
  private receipt(value: unknown, id: string): RootCommandReceipt {
    const r = object(value);
    if (r.commandId !== id || !["queued", "dispatching", "completed", "unknown"].includes(r.state))
      throw Error("Invalid root command receipt");
    return r;
  }
  private async reconcileSaved(s: RootLocalState, id: string): Promise<RootCommandReceipt> {
    const r = await this.request(s, { op: "command-status", ...this.identity(s), commandId: id });
    const receipt = this.receipt(r.receipt ?? r, id);
    s.commands[id]!.receipt = receipt;
    atomic(this.path, s);
    return receipt;
  }
  async reconcile(): Promise<RootCommandReceipt[]> {
    return this.withState(async (s) => {
      const results: RootCommandReceipt[] = [];
      for (const [id, c] of Object.entries(s.commands)) {
        if (c.receipt.state !== "completed") results.push(await this.reconcileSaved(s, id));
      }
      return results;
    });
  }
  async initialPrompt(text: string): Promise<RootCommandReceipt> {
    const id = await this.withState(async (s) => {
      if (s.initialPrompt) {
        if (s.initialPrompt.text !== text)
          throw Error(
            "Saved root has a different startup prompt; type the new prompt in its editor or explicitly start fresh",
          );
        return s.initialPrompt.commandId;
      }
      s.initialPrompt = { text, commandId: randomUUID() };
      atomic(this.path, s);
      return s.initialPrompt.commandId;
    });
    // Reservation is not admission: commands already queued get their turn before the prompt.
    return this.command({ kind: "prompt", text }, id);
  }
  async result(command: RootCommand): Promise<unknown> {
    let r = await this.command(command);
    for (let i = 0; i < 30 && ["queued", "dispatching"].includes(r.state); i++) {
      await Bun.sleep(100);
      r = await this.withState((s) => this.reconcileSaved(s, r.commandId));
    }
    if (r.state !== "completed") throw Error("Remote control outcome is " + r.state + "; no duplicate command sent");
    if (r.error) throw Error(r.error);
    return r.result;
  }
  async detach(): Promise<void> {
    const s = this.read();
    await this.request(s, { op: "detach", ...this.identity(s) });
  }
  async returnSource(): Promise<RepositoryReturn | undefined> {
    return this.withState(async (s) => {
      if (s.outcome) return s.outcome;
      if (!s.source) return;
      const observed = await this.request(s, { op: "observe", ...this.identity(s), cursor: s.cursor });
      const record = this.record(observed.record, s);
      if (record.state !== "closed" || record.exitCode !== 0)
        throw Error("Source return requires confirmed closed successful root; active/unknown is not safe");
      const { result, patch } = await downloadRepositoryResult(
        (offset) => this.request(s, { op: "repository-result", ...this.identity(s), offset }),
        s.source.snapshot,
        MAX,
        { pageError: "Invalid root repository result page", integrityError: "Root result digest or source mismatch" },
      );
      const path = join(this.directory, "result.patch");
      writeFileSync(path, patch, { mode: 0o600 });
      const base = join(this.directory, "..", "repo-locks");
      mkdirSync(base, { recursive: true, mode: 0o700 });
      const db = new Database(join(base, hash(s.sourceRoot) + ".sqlite"));
      try {
        db.exec("PRAGMA busy_timeout=5000; BEGIN EXCLUSIVE");
        s.outcome = integrateRepositoryResult(
          s.sourceRoot,
          s.source,
          { ...result, patch: path },
          join(this.directory, "receipts"),
        );
        atomic(this.path, s);
        db.exec("COMMIT");
      } finally {
        db.close();
      }
      return s.outcome;
    });
  }
}
