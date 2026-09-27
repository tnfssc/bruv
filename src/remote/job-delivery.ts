import { Database } from "bun:sqlite";
import type { RemoteJobObservation } from "./job-events";

export type RemoteDelivery = { id: string; observation: RemoteJobObservation; attempts: number };
/** One mailbox per parent session. SQLite's unique key is independent of artifact updates. */
export class RemoteJobDeliveryOutbox {
  readonly #db: Database;
  constructor(sessionFile: string) {
    this.#db = new Database(sessionFile + ".remote-jobs.sqlite", { create: true });
    this.#db.exec(`CREATE TABLE IF NOT EXISTS remote_job_delivery (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, epoch TEXT NOT NULL, task_id TEXT NOT NULL,
      payload TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
      next_retry INTEGER NOT NULL DEFAULT 0, UNIQUE(owner_id, epoch, task_id)
    )`);
  }
  enqueue(event: RemoteJobObservation): void {
    if (event.state !== "done" && event.state !== "cancelled") return;
    const id = JSON.stringify([event.ownerId, event.epoch, event.taskId]);
    this.#db
      .query(`INSERT OR IGNORE INTO remote_job_delivery (id, owner_id, epoch, task_id, payload)
      VALUES (?, ?, ?, ?, ?)`)
      .run(id, event.ownerId, event.epoch, event.taskId, JSON.stringify(event));
  }
  pending(now = Date.now()): RemoteDelivery[] {
    const rows = this.#db
      .query(
        "SELECT id, payload, attempts FROM remote_job_delivery WHERE delivered = 0 AND attempts < 8 AND next_retry <= ? ORDER BY rowid LIMIT 50",
      )
      .all(now) as Array<{ id: string; payload: string; attempts: number }>;
    return rows.map((row) => ({
      id: row.id,
      observation: JSON.parse(row.payload) as RemoteJobObservation,
      attempts: row.attempts,
    }));
  }
  hasPending(): boolean {
    return !!this.#db
      .query("SELECT 1 AS found FROM remote_job_delivery WHERE delivered = 0 AND attempts < 8 LIMIT 1")
      .get();
  }
  delivered(rows: RemoteDelivery[]): void {
    const statement = this.#db.query("UPDATE remote_job_delivery SET delivered = 1 WHERE id = ? AND delivered = 0");
    this.#db.transaction(() => {
      for (const row of rows) statement.run(row.id);
    })();
  }
  failed(rows: RemoteDelivery[], now = Date.now()): void {
    const statement = this.#db.query(
      "UPDATE remote_job_delivery SET attempts = attempts + 1, next_retry = ? WHERE id = ? AND delivered = 0",
    );
    this.#db.transaction(() => {
      for (const row of rows) statement.run(now + Math.min(60_000, 500 * 2 ** Math.min(row.attempts, 7)), row.id);
    })();
  }
  /** Replay uncertainty on restart, retaining the exact same id and payload. */
  replay(): void {
    this.#db.exec("UPDATE remote_job_delivery SET next_retry = 0, attempts = 0 WHERE delivered = 0");
  }
  close(): void {
    this.#db.close();
  }
}
