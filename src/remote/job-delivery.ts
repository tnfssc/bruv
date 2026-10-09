import { Database } from "bun:sqlite";
import { openSync, closeSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { RemoteJobObservation } from "./job-events";

export type RemoteDelivery = {
  id: string;
  kind: "completion" | "attention";
  observation: RemoteJobObservation;
  attempts: number;
  claim?: string;
};
/** A durable adapter outbox, drained only by the existing jobs completion batch. */
export class RemoteJobDeliveryOutbox {
  readonly #db: Database;
  constructor(sessionFile: string) {
    mkdirSync(dirname(sessionFile), { recursive: true, mode: 0o700 });
    closeSync(openSync(`${sessionFile}.remote-jobs.sqlite`, "a", 0o600));
    this.#db = new Database(`${sessionFile}.remote-jobs.sqlite`, { create: true });
    this.#db.exec("PRAGMA busy_timeout=1000");
    this.#db.exec(`CREATE TABLE IF NOT EXISTS remote_job_delivery (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, epoch TEXT NOT NULL, task_id TEXT NOT NULL,
      kind TEXT NOT NULL, payload TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0, next_retry INTEGER NOT NULL DEFAULT 0,
      claim TEXT, lease_until INTEGER NOT NULL DEFAULT 0
    )`);
  }
  enqueue(event: RemoteJobObservation): void {
    const terminal = event.state === "done" || event.state === "cancelled";
    const actionable = event.actionable;
    if (!terminal && !actionable) return;
    const kind = terminal ? "completion" : "attention";
    const key = terminal
      ? "terminal"
      : createHash("sha256")
          .update(actionable ?? "")
          .digest("hex");
    const id = JSON.stringify([event.ownerId, event.epoch, event.taskId, key]);
    this.#db.transaction(() => {
      if (terminal)
        this.#db
          .query(
            "UPDATE remote_job_delivery SET delivered=1 WHERE owner_id=? AND epoch=? AND task_id=? AND kind='attention'",
          )
          .run(event.ownerId, event.epoch, event.taskId);
      this.#db
        .query(
          "INSERT OR IGNORE INTO remote_job_delivery (id,owner_id,epoch,task_id,kind,payload) VALUES (?,?,?,?,?,?)",
        )
        .run(id, event.ownerId, event.epoch, event.taskId, kind, JSON.stringify(event));
    })();
  }
  pending(now = Date.now()): RemoteDelivery[] {
    const rows = this.#db
      .query(
        "SELECT id,kind,payload,attempts FROM remote_job_delivery WHERE delivered=0 AND attempts<8 AND next_retry<=? AND lease_until<=? ORDER BY rowid LIMIT 5",
      )
      .all(now, now) as Array<{ id: string; kind: RemoteDelivery["kind"]; payload: string; attempts: number }>;
    return rows.map(({ payload, ...row }) => ({ ...row, observation: JSON.parse(payload) }));
  }
  /** Claim before host dispatch. Concurrent/reopened clients cannot both send an active lease. */
  claim(now = Date.now()): RemoteDelivery[] {
    return this.#db
      .transaction(() => {
        const rows = this.pending(now),
          claim = randomUUID();
        const statement = this.#db.query(
          "UPDATE remote_job_delivery SET claim=?,lease_until=? WHERE id=? AND delivered=0",
        );
        for (const row of rows) statement.run(claim, now + 30_000, row.id);
        return rows.map((row) => ({ ...row, claim }));
      })
      .immediate();
  }
  hasPending(): boolean {
    return !!this.#db.query("SELECT 1 FROM remote_job_delivery WHERE delivered=0 AND attempts<8 LIMIT 1").get();
  }
  delivered(rows: RemoteDelivery[]): void {
    const statement = this.#db.query(
      "UPDATE remote_job_delivery SET delivered=1,claim=NULL,lease_until=0 WHERE id=? AND delivered=0 AND claim IS ?",
    );
    this.#db.transaction(() => {
      for (const row of rows) statement.run(row.id, row.claim ?? null);
    })();
  }
  failed(rows: RemoteDelivery[], now = Date.now()): void {
    const statement = this.#db.query(
      "UPDATE remote_job_delivery SET attempts=attempts+1,next_retry=?,claim=NULL,lease_until=0 WHERE id=? AND delivered=0 AND claim IS ?",
    );
    this.#db.transaction(() => {
      for (const row of rows)
        statement.run(now + Math.min(60_000, 500 * 2 ** Math.min(row.attempts, 7)), row.id, row.claim ?? null);
    })();
  }
  /** Restart retries exhausted dispatch failures; never steal another process's live claim. */
  replay(now = Date.now()): void {
    this.#db
      .query("UPDATE remote_job_delivery SET next_retry=0,attempts=0 WHERE delivered=0 AND lease_until<=?")
      .run(now);
  }
  close(): void {
    this.#db.close();
  }
}
