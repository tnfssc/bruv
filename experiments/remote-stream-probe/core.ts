export type Kind = "acceptance" | "progress" | "question" | "result" | "transcript";
export type Event = { epoch: string; cursor: number; task: number; kind: Kind; created: number; text: string };
export type Page = { events: Event[]; cursor: number; epoch: string; unavailable?: true };
export const jsonBytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v));
export class Log {
  readonly epoch: string;
  readonly cap: number;
  events: Event[] = [];
  used = 0;
  cursor = 0;
  constructor(cap = 1024 * 1024, epoch: string = crypto.randomUUID()) { this.cap = cap; this.epoch = epoch; }
  add(task: number, kind: Kind, text = "x"): Event {
    const event: Event = { epoch: this.epoch, cursor: ++this.cursor, task, kind, created: performance.now(), text };
    const n = jsonBytes(event);
    if (n > this.cap) throw Error("event larger than retention capacity");
    this.events.push(event); this.used += n;
    while (this.used > this.cap) this.used -= jsonBytes(this.events.shift());
    return event;
  }
  page(cursor: number, epoch: string, limit = 64): Page {
    if (epoch !== this.epoch || !Number.isSafeInteger(cursor) || cursor < 0 || cursor > this.cursor || cursor < (this.events[0]?.cursor ?? this.cursor + 1) - 1)
      return { events: [], cursor: this.cursor, epoch: this.epoch, unavailable: true };
    const events = this.events.filter(e => e.cursor > cursor).slice(0, limit);
    return { events, cursor: events.at(-1)?.cursor ?? cursor, epoch: this.epoch };
  }
}
// Application notification queue, NOT TCP/socket bytes.
export class Notices {
  entries: Event[] = [];
  bytes = 0;
  peak = 0;
  gap = false;
  readonly cap: number;
  constructor(cap: number) { this.cap = cap; }
  push(e: Event) {
    if (this.gap) return;
    const n = jsonBytes(e);
    if (this.bytes + n > this.cap) { this.entries = []; this.bytes = 0; this.gap = true; return; }
    this.entries.push(e); this.bytes += n; this.peak = Math.max(this.peak, this.bytes);
  }
  drain() { const result = { events: this.entries, gap: this.gap }; this.entries = []; this.bytes = 0; this.gap = false; return result; }
}
export class Replica {
  cursor = 0;
  readonly recent = new Map<number, string>();
  epoch: string;
  constructor(epoch: string) { this.epoch = epoch; }
  apply(events: Event[]) {
    for (const e of events) {
      if (e.epoch !== this.epoch) throw Error("epoch mismatch: history unavailable");
      if (e.cursor <= this.cursor) {
        const prior=this.recent.get(e.cursor);
        if(prior !== undefined && prior !== JSON.stringify(e)) throw Error("conflicting duplicate cursor");
        continue;
      }
      if (e.cursor !== this.cursor + 1) throw Error("gap: resync required");
      this.cursor = e.cursor;
      this.recent.set(e.cursor,JSON.stringify(e));
      if(this.recent.size>64) this.recent.delete(this.recent.keys().next().value!);
    }
  }
}
