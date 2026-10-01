import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { RootStore, rootId, canonical, type StoredRoot } from "./root-store";
import type {
  RootIdentity,
  RootIntent,
  RootRequest,
  RootRecord,
  RootCommand,
  RootCommandReceipt,
} from "./root-contract";
import { handleRemoteRequest } from "./owner";
import { repositoryRequest } from "./repository-wire";
import { rootFacetRequest, RootFacetAcknowledgedError, type RootFacet } from "./root-runtime";

export function processStamp(pid: number): string | undefined {
  try {
    const stat = readFileSync("/proc/" + pid + "/stat", "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
  } catch {
    return;
  }
}
function alive(root: StoredRoot) {
  return !!root.ownerPid && !!root.ownerStart && processStamp(root.ownerPid) === root.ownerStart;
}
function reconcile(store: RootStore, id: string) {
  const value = store.get(id);
  if (["closed", "unknown"].includes(value.record.state)) return;
  if (value.ownerClaim && !alive(value))
    store.unknown(id, "Root owner process disappeared; runtime/commands remain unknown; no automatic replacement");
  else if (!value.ownerClaim && Date.now() - value.acceptedAt > 30000)
    store.unknown(id, "Root owner start acknowledgement unknown; no automatic replacement");
}
function strict(value: unknown, fields: string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    throw Error("Unsupported root request field");
}
function text(value: unknown, max = 1000000) {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > max) throw Error("Invalid root text");
}
export function validateRootCommand(command: RootCommand) {
  const fields: Record<string, string[]> = {
    prompt: ["text"],
    abort: [],
    "ui.respond": ["id", "value", "confirmed", "cancelled"],
    "questions.list": [],
    "questions.answer": ["id", "owner", "version", "text", "replyId"],
    "jobs.list": ["cursor", "count"],
    "jobs.inspect": ["id", "offset", "limit"],
    "jobs.stop": ["id"],
    close: [],
  };
  if (!command || !Object.hasOwn(fields, command.kind)) throw Error("Invalid root command");
  strict(command, ["kind", ...fields[command.kind]!]);
  if (command.kind === "prompt") text(command.text);
  if (command.kind === "ui.respond") {
    text(command.id, 256);
    if (
      [command.value !== undefined, command.confirmed !== undefined, command.cancelled !== undefined].filter(Boolean)
        .length !== 1
    )
      throw Error("Root UI response requires exactly one payload");
    if (
      command.value !== undefined &&
      (typeof command.value !== "string" || Buffer.byteLength(command.value) > 1000000)
    )
      throw Error("Invalid root UI value");
    if (command.confirmed !== undefined && typeof command.confirmed !== "boolean")
      throw Error("Invalid root UI confirmation");
    if (command.cancelled !== undefined && command.cancelled !== true) throw Error("Invalid root UI cancellation");
  }
  if (command.kind === "questions.answer") {
    text(command.id, 128);
    text(command.text, 8000);
    rootId(command.replyId);
    strict(command.owner, ["sessionId", "branchId"]);
    text(command.owner.sessionId, 512);
    text(command.owner.branchId, 512);
    if (!Number.isSafeInteger(command.version) || command.version < 1) throw Error("Invalid pinned question version");
  }
  if (command.kind === "jobs.inspect" || command.kind === "jobs.stop") text(command.id, 256);
  if (command.kind === "jobs.inspect")
    for (const field of ["offset", "limit"] as const)
      if (command[field] !== undefined && (!Number.isSafeInteger(command[field]) || command[field]! < 0))
        throw Error("Invalid job pagination");
  if (command.kind === "jobs.list") {
    if (
      command.count !== undefined &&
      (!Number.isSafeInteger(command.count) || command.count < 1 || command.count > 100)
    )
      throw Error("Invalid job count");
    if (
      command.cursor !== undefined &&
      typeof command.cursor !== "string" &&
      (!Number.isSafeInteger(command.cursor) || command.cursor < 0)
    )
      throw Error("Invalid job cursor");
  }
}
function validateIntent(intent: RootIntent, identity: RootIdentity) {
  strict(intent, ["ownerId", "epoch", "sessionId", "role", "depth", "repoPath", "model", "thinking"]);
  rootId(intent.sessionId);
  if (intent.ownerId !== identity.ownerId || intent.epoch !== identity.epoch)
    throw Error("Owner identity or boot epoch changed");
  if (intent.role !== "root" || intent.depth !== 0)
    throw Error("Root placement requires genuine root role at depth zero");
  if (typeof intent.repoPath !== "string" || !isAbsolute(intent.repoPath))
    throw Error("Root repository path must be an existing absolute destination directory");
  if (intent.model !== undefined && (typeof intent.model !== "string" || !/^([^/\s]+)\/(.+)$/.test(intent.model)))
    throw Error("Explicit root model must be exact provider/model, no profile fallback");
  if (
    intent.thinking !== undefined &&
    !new Set(["off", "minimal", "low", "medium", "high", "xhigh"]).has(intent.thinking)
  )
    throw Error("Unsupported root thinking level");
}
export type RootOwnerOptions = {
  directory?: string;
  executable?: string;
  hello?: () => Promise<RootIdentity & Record<string, unknown>>;
  launch?: (sessionId: string) => void;
};
/** SSH control is short lived; only the detached session owner retains the provider/session. */
export async function handleRootRequest(req: RootRequest, options: RootOwnerOptions = {}): Promise<unknown> {
  const hello =
    options.hello ??
    (async () => (await handleRemoteRequest({ op: "hello" })) as RootIdentity & Record<string, unknown>);
  const identity = await hello();
  if (typeof identity.ownerId !== "string" || typeof identity.epoch !== "string")
    throw Error("Installed SSH owner identity unavailable");
  if (req?.op === "hello") {
    strict(req, ["op"]);
    return { ownerId: identity.ownerId, epoch: identity.epoch, rootProtocol: 1, version: identity.version };
  }
  if (!req || typeof req !== "object") throw Error("Invalid root request");
  const fields: Record<string, string[]> = {
    create: ["intent", "requestId"],
    observe: ["sessionId", "cursor"],
    command: ["sessionId", "commandId", "command"],
    "command-status": ["sessionId", "commandId"],
    detach: ["sessionId"],
    "repository-upload": ["sessionId", "snapshot", "sha256", "total", "offset", "data", "workspace"],
    "repository-result": ["sessionId", "offset"],
  };
  if (!Object.hasOwn(fields, req.op)) throw Error("Invalid root operation");
  strict(req, ["op", ...(req.op === "create" ? [] : ["ownerId", "epoch"]), ...fields[req.op]!]);
  if (req.op !== "create" && (req.ownerId !== identity.ownerId || req.epoch !== identity.epoch))
    throw Error("Owner identity or boot epoch changed");
  const store = new RootStore(options.directory);
  try {
    if (req.op === "create") {
      validateIntent(req.intent, identity);
      if (
        !store.db.query("SELECT id FROM roots WHERE id=?").get(req.intent.sessionId) &&
        !statSync(req.intent.repoPath).isDirectory()
      )
        throw Error("Root repository path must be an existing destination directory");
      const { created, value } = store.accept(req.intent, req.requestId);
      if (created) {
        try {
          if (options.launch) options.launch(req.intent.sessionId);
          else {
            const child = spawn(options.executable ?? process.execPath, ["--remote-root-owner", req.intent.sessionId], {
              detached: true,
              stdio: "ignore",
              env: process.env,
            });
            child.on("error", (error) => {
              const later = new RootStore(options.directory);
              try {
                later.unknown(req.intent.sessionId, "Root spawn outcome unknown: " + error);
              } finally {
                later.close();
              }
            });
            if (!child.pid) throw Error("Detached root owner spawn did not acknowledge a PID");
            child.unref();
          }
        } catch (error) {
          store.unknown(req.intent.sessionId, "Root spawn outcome unknown: " + error);
        }
      } else reconcile(store, req.intent.sessionId);
      return store.get(value.record.intent.sessionId).record;
    }
    rootId(req.sessionId);
    if (req.op === "repository-upload" || req.op === "repository-result") {
      return store.transaction(() => {
        let root: StoredRoot | undefined;
        try {
          root = store.get(req.sessionId);
        } catch (error) {
          if (!String(error).includes("Unknown root session")) throw error;
        }
        if (root && (root.record.intent.ownerId !== identity.ownerId || root.record.intent.epoch !== identity.epoch))
          throw Error("Pinned root identity changed");
        const { sessionId, ownerId, epoch, ...request } = req;
        return repositoryRequest(
          store.path(sessionId),
          { ...request, taskId: sessionId },
          root
            ? root.record.state === "closed" && root.record.exitCode === 0
              ? "done"
              : root.record.state
            : undefined,
        );
      });
    }
    reconcile(store, req.sessionId);
    const root = store.get(req.sessionId);
    if (root.record.intent.ownerId !== identity.ownerId || root.record.intent.epoch !== identity.epoch)
      throw Error("Pinned root identity changed");
    switch (req.op) {
      case "observe":
        return store.observe(req.sessionId, req.cursor);
      case "detach":
        return { detached: true }; // Never sends a process signal, abort, or job cancellation.
      case "command-status":
        return store.receipt(req.sessionId, req.commandId);
      case "command":
        validateRootCommand(req.command);
        return store.enqueue(req.sessionId, req.commandId, req.command);
    }
  } finally {
    store.close();
  }
}

export interface RootSessionPort {
  rpc(id: string, command: Record<string, unknown>): Promise<unknown>;
  facet(command: RootFacet): Promise<unknown>;
  ui?(command: Extract<RootCommand, { kind: "ui.respond" }>): Promise<unknown>;
  onEvent(listener: (event: unknown) => void): () => void;
  readonly exited: Promise<{ code: number | null; signal: string | null }>;
  end(): void;
}
class RpcPort implements RootSessionPort {
  private pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private dialogs = new Map<string, string>();
  private listeners = new Set<(event: unknown) => void>();
  readonly exited: Promise<{ code: number | null; signal: string | null }>;
  private child: ReturnType<typeof spawn>;
  constructor(
    executable: string,
    args: string[],
    cwd: string,
    readonly socket: string,
    readonly token: string,
  ) {
    const env = { ...process.env, DIE_ROOT_RUNTIME_SOCKET: socket, DIE_ROOT_RUNTIME_TOKEN: token };
    // A placed root never inherits a child role or a parent's routed worker bridge.
    for (const key of Object.keys(env))
      if (
        key.startsWith("DIE_SUBAGENT_") ||
        key.startsWith("DIE_REMOTE_RUNTIME_") ||
        key.startsWith("DIE_T3_") ||
        key === "DIE_REMOTE_RUNTIME_STATE"
      )
        delete (env as Record<string, string | undefined>)[key];
    this.child = spawn(executable, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "",
      failed = false;
    this.child.stdout!.on("data", (data) => {
      if (failed) return;
      buffer += data.toString();
      if (Buffer.byteLength(buffer) > 2 * 1024 * 1024) {
        failed = true;
        this.fatal(Error("Root RPC event gap: oversized or unterminated output"));
        return;
      }
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (
            event.type === "extension_ui_request" &&
            ["select", "confirm", "input", "editor"].includes(event.method) &&
            typeof event.id === "string"
          )
            this.dialogs.set(event.id, event.method);
          // RPC acknowledgements are owner-private; get_state may include provider headers.
          if (event.type !== "response") for (const listener of this.listeners) listener(event);
          if (event.type === "response" && typeof event.id === "string") {
            const pending = this.pending.get(event.id);
            if (!pending) continue;
            clearTimeout(pending.timer);
            this.pending.delete(event.id);
            if (event.success) pending.resolve(event.data);
            else pending.reject(new RootAcknowledgedError(event.error ?? "Root RPC rejected command"));
          }
        } catch (error) {
          failed = true;
          this.fatal(Error("Root RPC event gap: " + error));
        }
      }
    });
    // Diagnostics do not become model text or unbounded retained output.
    this.child.stderr!.on("data", () => {});
    this.child.on("error", (error) => this.fail(error));
    this.exited = new Promise((resolve) =>
      this.child.on("close", (code, signal) => {
        if (buffer.trim()) this.fail(Error("Root RPC event gap: truncated final row"));
        this.fail(Error("Root runtime exited; pending acknowledgements unknown"));
        resolve({ code, signal });
      }),
    );
  }
  private fatal(error: Error) {
    this.fail(error);
    for (const listener of this.listeners) listener({ type: "root_event_gap", error: String(error) });
  }
  private fail(error: Error) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
  }
  rpc(id: string, command: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error("Root RPC acknowledgement unknown"));
      }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin!.write(JSON.stringify({ ...command, id }) + "\n", (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }
  ui(command: Extract<RootCommand, { kind: "ui.respond" }>): Promise<unknown> {
    const method = this.dialogs.get(command.id);
    if (!method) return Promise.reject(new RootAcknowledgedError("Unknown or already answered root UI request"));
    if (
      command.cancelled !== true &&
      (method === "confirm" ? typeof command.confirmed !== "boolean" : typeof command.value !== "string")
    )
      return Promise.reject(new RootAcknowledgedError("Root UI response type mismatch"));
    this.dialogs.delete(command.id);
    const { kind, ...response } = command;
    return new Promise((resolve, reject) =>
      this.child.stdin!.write(JSON.stringify({ type: "extension_ui_response", ...response }) + "\n", (error) =>
        error ? reject(error) : resolve({ delivery: "written", applied: "unknown" }),
      ),
    );
  }
  facet(command: RootFacet) {
    return rootFacetRequest(this.socket, this.token, command);
  }
  onEvent(listener: (event: unknown) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  end() {
    this.child.stdin!.end();
  }
}
export class RootAcknowledgedError extends Error {}

/** Injectable real-session port keeps tests inference-free; production always uses installed normal CLI RPC. */
export async function serveRootSession(store: RootStore, id: string, port: RootSessionPort): Promise<void> {
  let exited = false,
    closed = false,
    closingId: string | undefined,
    closeResult: unknown;
  let closingAt = 0;
  let lastSnapshot = "",
    snapshotAt = 0;
  const inflight = new Set<Promise<unknown>>();
  const unlisten = port.onEvent((event) => {
    if ((event as { type?: string })?.type === "response") return;
    try {
      store.append(id, event);
      if ((event as { type?: string })?.type === "root_event_gap") store.unknown(id, "Root event journal gap");
    } catch (error) {
      store.unknown(id, String(error));
    }
  });
  const exit = port.exited.then(({ code, signal }) => {
    exited = true;
    if (closingId && closed && code === 0 && !signal && store.get(id).record.state !== "unknown") {
      store.transaction(() => {
        const r = store.get(id);
        r.record = { ...r.record, state: "closed", exitCode: 0, error: undefined };
        store.save(r);
        store.finish(id, {
          commandId: closingId!,
          state: "completed",
          result: { ...(closeResult as object), exitCode: 0 },
        });
      });
      while (true) {
        const queued = store.claimCommand(id);
        if (!queued) break;
        store.finish(id, { ...queued.receipt, state: "completed", error: "Root closed before command dispatch" });
      }
      store.append(id, { type: "root_closed", exitCode: 0 });
    } else store.unknown(id, "Root runtime exit outcome unknown (code=" + code + ", signal=" + signal + ")");
  });
  try {
    const state = (await port.rpc("root-startup-state", { type: "get_state" })) as {
      model?: { provider: string; id: string };
      thinkingLevel?: string;
      sessionFile?: string;
    };
    const r = store.get(id),
      intent = r.record.intent;
    if (!state.model) throw Error("Destination root has no configured model; no child-profile fallback");
    if (intent.model && intent.model !== state.model.provider + "/" + state.model.id)
      throw Error("Destination rejected explicit root model; silent fallback forbidden");
    if (intent.thinking && intent.thinking !== state.thinkingLevel)
      throw Error("Destination rejected explicit root thinking level");
    // Wait for the ordinary extension's private facets; its session_start may follow RPC readiness.
    let snapshot: unknown;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        snapshot = await port.facet({ kind: "snapshot" });
        break;
      } catch (error) {
        if (exited || attempt === 99) throw error;
        await Bun.sleep(50);
      }
    }
    store.transaction(() => {
      const current = store.get(id);
      if (current.record.state === "unknown") throw Error(current.record.error ?? "Root startup became unknown");
      current.record = {
        ...current.record,
        state: "running",
        model: { provider: state.model!.provider, id: state.model!.id },
        sessionFile: state.sessionFile,
      };
      store.save(current);
    });
    store.append(id, {
      type: "root_ready",
      state: {
        model: { provider: state.model.provider, id: state.model.id },
        thinkingLevel: state.thinkingLevel,
        sessionFile: state.sessionFile,
      },
      facets: snapshot,
    });
    async function finishCommand(receipt: RootCommandReceipt, task: () => Promise<unknown>) {
      try {
        const result = await task();
        store.finish(id, { ...receipt, state: "completed", result });
      } catch (error) {
        store.finish(id, {
          ...receipt,
          state:
            error instanceof RootAcknowledgedError || error instanceof RootFacetAcknowledgedError
              ? "completed"
              : "unknown",
          error: String(error),
        });
      }
    }
    while (!exited) {
      if (store.get(id).record.state === "unknown") break;
      if (closingId) {
        if (Date.now() - closingAt >= 20000)
          store.unknown(id, "Root close exit acknowledgement unknown; runtime was not replaced");
        await Bun.sleep(25);
        continue;
      }
      const next = store.claimCommand(id);
      if (next) {
        const { command, receipt } = next;
        if (command.kind === "prompt" || command.kind === "abort") {
          const task = finishCommand(receipt, () =>
            port.rpc(
              receipt.commandId,
              command.kind === "prompt"
                ? { type: "prompt", message: command.text, streamingBehavior: "followUp" }
                : { type: "abort" },
            ),
          );
          inflight.add(task);
          void task.finally(() => inflight.delete(task));
        } else if (command.kind === "ui.respond") {
          // Hide the prompt before writing; an uncertain human response must not be solicited/replayed.
          store.append(id, { type: "root_ui_response", id: command.id });
          await finishCommand(receipt, () =>
            port.ui ? port.ui(command) : Promise.reject(new RootAcknowledgedError("Root UI facet unavailable")),
          );
        } else if (command.kind === "close") {
          try {
            store.transaction(() => {
              const r = store.get(id);
              r.closing = true;
              store.save(r);
            });
            // Clear queued user turns before the trusted child-settlement check.
            await port.rpc("root-clear-" + receipt.commandId, { type: "clear_queue" });
            closeResult = await port.facet(command);
            if ((closeResult as { settled?: boolean })?.settled === true) {
              closingId = receipt.commandId;
              closingAt = Date.now();
              closed = true;
              port.end();
            } else
              store.transaction(() => {
                const r = store.get(id);
                r.closing = false;
                store.save(r);
                store.finish(id, { ...receipt, state: "completed", result: closeResult });
              });
          } catch (error) {
            store.unknown(id, "Root close acknowledgement unknown: " + error);
          }
        } else await finishCommand(receipt, () => port.facet(command));
        continue;
      }
      if (Date.now() - snapshotAt >= 1000) {
        snapshotAt = Date.now();
        const snapshot = await port.facet({ kind: "snapshot" }),
          serialized = canonical(snapshot);
        if (serialized !== lastSnapshot) {
          lastSnapshot = serialized;
          store.append(id, { type: "root_facets", ...(snapshot as object) });
        }
      }
      await Bun.sleep(25);
    }
    await exit;
  } catch (error) {
    store.unknown(id, String(error));
    if (!exited) {
      port.end();
      await exit;
    }
  } finally {
    unlisten();
  }
  // Do not kill/replace an unknown runtime. An uncertain provider write is not authorization to replay.
}
export async function runRootOwner(
  sessionId: string,
  options: { directory?: string; executable?: string; port?: (record: RootRecord) => RootSessionPort } = {},
): Promise<void> {
  rootId(sessionId);
  const store = new RootStore(options.directory);
  let claimed = false;
  try {
    const identity = options.port ? undefined : ((await handleRemoteRequest({ op: "hello" })) as RootIdentity);
    const initial = store.transaction(() => {
      const r = store.get(sessionId);
      if (identity && (r.record.intent.ownerId !== identity.ownerId || r.record.intent.epoch !== identity.epoch))
        throw Error("Pinned SSH owner identity changed before root startup");
      if (r.record.state !== "accepted" || r.ownerClaim)
        throw Error("Root owner already claimed; automatic respawn forbidden");
      r.ownerClaim = randomUUID();
      r.ownerPid = process.pid;
      r.ownerStart = processStamp(process.pid);
      store.save(r);
      return r;
    });
    claimed = true;
    let port: RootSessionPort;
    if (options.port) port = options.port(initial.record);
    else {
      const socket = join(
        tmpdir(),
        "die-root-" + createHash("sha256").update(initial.ownerClaim!).digest("hex").slice(0, 16) + ".sock",
      );
      if (Buffer.byteLength(socket) > 100) throw Error("Root private IPC socket path exceeds Unix limit");
      const sessionFile = join(store.path(sessionId), "session.jsonl");
      const args = ["--mode", "rpc", "--session", sessionFile];
      if (initial.record.intent.model) {
        const i = initial.record.intent.model.indexOf("/");
        args.push(
          "--provider",
          initial.record.intent.model.slice(0, i),
          "--model",
          initial.record.intent.model.slice(i + 1),
        );
      }
      if (initial.record.intent.thinking) args.push("--thinking", initial.record.intent.thinking);
      port = new RpcPort(
        options.executable ?? process.execPath,
        args,
        initial.record.intent.repoPath,
        socket,
        randomUUID(),
      );
    }
    await serveRootSession(store, sessionId, port);
  } catch (error) {
    if (!claimed) throw error;
    store.unknown(sessionId, String(error));
  } finally {
    store.close();
  }
}
