import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { RootIntent, RootRecord, RootCommand, RootCommandReceipt, RootObservation } from "./root-contract";

export const rootDirectory = () => join(process.env.HOME ?? homedir(), ".die", "remote-owner", "roots");
export function rootId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw Error("Invalid root identifier");
}
/** Sorted object keys preserve semantic intent, never depend on peer JSON field order. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export type StoredRoot = {
  record: RootRecord;
  requestId: string;
  ownerClaim?: string;
  ownerPid?: number;
  ownerStart?: string;
  acceptedAt: number;
  seq: number;
  closing?: boolean;
};
export class RootStore {
  readonly db: Database;
  constructor(
    readonly directory = rootDirectory(),
    readonly eventBudget = 8 * 1024 * 1024,
  ) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new Database(join(directory, "roots.sqlite"), { create: true });
    this.db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    this.db.exec(`CREATE TABLE IF NOT EXISTS roots (id TEXT PRIMARY KEY, request TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS commands (session TEXT NOT NULL, id TEXT NOT NULL, intent TEXT NOT NULL, receipt TEXT NOT NULL, ordinal INTEGER PRIMARY KEY AUTOINCREMENT, UNIQUE(session,id));
      CREATE TABLE IF NOT EXISTS events (session TEXT NOT NULL, seq INTEGER NOT NULL, event TEXT NOT NULL, bytes INTEGER NOT NULL, PRIMARY KEY(session,seq));`);
  }
  close() {
    this.db.close();
  }
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn).immediate();
  }
  path(id: string) {
    rootId(id);
    return join(this.directory, id);
  }
  get(id: string): StoredRoot {
    rootId(id);
    const row = this.db.query("SELECT data FROM roots WHERE id=?").get(id) as { data: string } | null;
    if (!row) throw Error("Unknown root session");
    return JSON.parse(row.data);
  }
  save(value: StoredRoot) {
    this.db.query("UPDATE roots SET data=? WHERE id=?").run(JSON.stringify(value), value.record.intent.sessionId);
  }
  accept(intent: RootIntent, requestId: string): { value: StoredRoot; created: boolean } {
    rootId(intent.sessionId);
    rootId(requestId);
    return this.transaction(() => {
      const byRequest = this.db.query("SELECT id FROM roots WHERE request=?").get(requestId) as { id: string } | null;
      if (byRequest && byRequest.id !== intent.sessionId) throw Error("Root create request ID intent conflict");
      const prior = this.db.query("SELECT data FROM roots WHERE id=?").get(intent.sessionId) as { data: string } | null;
      if (prior) {
        const value: StoredRoot = JSON.parse(prior.data);
        if (canonical(value.record.intent) !== canonical(intent) || value.requestId !== requestId)
          throw Error("Root create immutable intent conflict");
        return { value, created: false };
      }
      const count = this.db.query("SELECT COUNT(*) AS n FROM roots").get() as { n: number };
      if (count.n >= 100) throw Error("Root retention limit reached");
      const value: StoredRoot = { record: { intent, state: "accepted" }, requestId, acceptedAt: Date.now(), seq: 0 };
      mkdirSync(this.path(intent.sessionId), { recursive: true, mode: 0o700 });
      this.db
        .query("INSERT INTO roots(id,request,data) VALUES(?,?,?)")
        .run(intent.sessionId, requestId, JSON.stringify(value));
      return { value, created: true };
    });
  }
  enqueue(session: string, id: string, command: RootCommand): RootCommandReceipt {
    rootId(id);
    return this.transaction(() => {
      const prior = this.db.query("SELECT intent,receipt FROM commands WHERE session=? AND id=?").get(session, id) as {
        intent: string;
        receipt: string;
      } | null;
      if (prior) {
        if (prior.intent !== canonical(command)) throw Error("Root command ID intent conflict");
        return JSON.parse(prior.receipt);
      }
      const root = this.get(session);
      if (root.closing || !["accepted", "running"].includes(root.record.state))
        throw Error("Root is not accepting commands: " + root.record.state);
      const count = this.db.query("SELECT COUNT(*) AS n FROM commands WHERE session=?").get(session) as { n: number };
      if (count.n >= 10000) throw Error("Root command retention limit reached");
      const receipt: RootCommandReceipt = { commandId: id, state: "queued" };
      this.db
        .query("INSERT INTO commands(session,id,intent,receipt) VALUES(?,?,?,?)")
        .run(session, id, canonical(command), JSON.stringify(receipt));
      return receipt;
    });
  }
  receipt(session: string, id: string): RootCommandReceipt {
    rootId(id);
    this.get(session);
    const r = this.db.query("SELECT receipt FROM commands WHERE session=? AND id=?").get(session, id) as {
      receipt: string;
    } | null;
    if (!r) throw Error("Unknown root command");
    return JSON.parse(r.receipt);
  }
  finish(session: string, receipt: RootCommandReceipt) {
    this.db
      .query("UPDATE commands SET receipt=? WHERE session=? AND id=?")
      .run(JSON.stringify(receipt), session, receipt.commandId);
  }
  claimCommand(session: string): { command: RootCommand; receipt: RootCommandReceipt } | undefined {
    return this.transaction(() => {
      const rows = this.db
        .query("SELECT id,intent,receipt FROM commands WHERE session=? ORDER BY ordinal")
        .all(session) as Array<{ id: string; intent: string; receipt: string }>;
      const row = rows.find((r) => JSON.parse(r.receipt).state === "queued");
      if (!row) return;
      const receipt: RootCommandReceipt = { commandId: row.id, state: "dispatching" };
      // The claim is committed before any runtime write. A lost write stays unknown.
      this.finish(session, receipt);
      return { command: JSON.parse(row.intent), receipt };
    });
  }
  unknown(session: string, error: string) {
    this.transaction(() => {
      const r = this.get(session);
      if (r.record.state === "closed") return;
      r.record = { ...r.record, state: "unknown", error: r.record.error ?? error };
      this.save(r);
      const rows = this.db.query("SELECT id,receipt FROM commands WHERE session=?").all(session) as Array<{
        id: string;
        receipt: string;
      }>;
      for (const row of rows)
        if (["queued", "dispatching"].includes(JSON.parse(row.receipt).state))
          this.finish(session, { commandId: row.id, state: "unknown", error });
    });
  }
  append(session: string, event: unknown) {
    const text = JSON.stringify(event),
      bytes = Buffer.byteLength(text);
    if (bytes > 512 * 1024) throw Error("Root event gap: oversized event");
    this.transaction(() => {
      const r = this.get(session);
      r.seq++;
      const e = event as { type?: string; id?: string; method?: string };
      if (
        e?.type === "extension_ui_request" &&
        typeof e.id === "string" &&
        ["select", "confirm", "input", "editor"].includes(e.method ?? "")
      ) {
        const dialogs = r.record.dialogs ?? [];
        if (dialogs.length >= 20 && !dialogs.some((d) => d.id === e.id)) throw Error("Too many pending root dialogs");
        r.record.dialogs = [...dialogs.filter((d) => d.id !== e.id), event as import("./root-contract").RootDialog];
      }
      if (e?.type === "root_ui_response") r.record.dialogs = (r.record.dialogs ?? []).filter((d) => d.id !== e.id);
      this.save(r);
      this.db.query("INSERT INTO events(session,seq,event,bytes) VALUES(?,?,?,?)").run(session, r.seq, text, bytes);
      let total = (
        this.db.query("SELECT COALESCE(SUM(bytes),0) AS n FROM events WHERE session=?").get(session) as { n: number }
      ).n;
      if (total > this.eventBudget) {
        const rows = this.db.query("SELECT seq,bytes FROM events WHERE session=? ORDER BY seq").all(session) as Array<{
          seq: number;
          bytes: number;
        }>;
        for (const row of rows) {
          if (total <= this.eventBudget) break;
          this.db.query("DELETE FROM events WHERE session=? AND seq=?").run(session, row.seq);
          total -= row.bytes;
        }
      }
    });
  }
  observe(session: string, cursor: number): RootObservation {
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw Error("Invalid root cursor");
    return this.transaction(() => {
      const r = this.get(session);
      const first = this.db.query("SELECT MIN(seq) AS n FROM events WHERE session=?").get(session) as {
        n: number | null;
      };
      if (cursor > r.seq || cursor < (first.n ?? r.seq + 1) - 1)
        throw Error("Root event gap: cursor outside retained journal");
      const rows = this.db
        .query("SELECT seq,event FROM events WHERE session=? AND seq>? ORDER BY seq LIMIT 100")
        .all(session, cursor) as Array<{ seq: number; event: string }>;
      const events: RootObservation["events"] = [];
      let bytes = 0;
      for (const row of rows) {
        bytes += Buffer.byteLength(row.event);
        if (bytes > 2 * 1024 * 1024) break;
        events.push({ seq: row.seq, event: JSON.parse(row.event) });
      }
      const next = events.at(-1)?.seq ?? cursor;
      return { record: r.record, events, cursor: next, hasMore: next < r.seq };
    });
  }
}
