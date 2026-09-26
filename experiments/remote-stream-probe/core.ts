export type Kind = "acceptance" | "progress" | "question" | "result" | "transcript";
export type Event = {
  epoch: string;
  cursor: number;
  task: number;
  kind: Kind;
  created: number;
  text: string;
};
export type Page = {
  events: Event[];
  cursor: number;
  epoch: string;
  more: boolean;
  unavailable?: true;
};
export const jsonBytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v));
export const PAGE_EVENTS = 64;
export const PAGE_BYTES = 32 * 1024; // full JSON page including envelope
export class Log {
  readonly epoch: string;
  readonly cap: number;
  events: Event[] = [];
  used = 0;
  cursor = 0;
  constructor(cap = 1024 * 1024, epoch: string = crypto.randomUUID()) {
    this.cap = cap;
    this.epoch = epoch;
  }
  add(task: number, kind: Kind, text = "x"): Event {
    const event: Event = {
      epoch: this.epoch,
      cursor: this.cursor + 1,
      task,
      kind,
      created: performance.now(),
      text,
    };
    const n = jsonBytes(event);
    if (
      n > this.cap ||
      jsonBytes({
        events: [event],
        cursor: event.cursor,
        epoch: this.epoch,
        more: false,
      }) > PAGE_BYTES
    )
      throw Error("event larger than retention or page capacity");
    this.cursor = event.cursor;
    this.events.push(event);
    this.used += n;
    while (this.used > this.cap) this.used -= jsonBytes(this.events.shift());
    return event;
  }
  page(cursor: number, epoch: string): Page {
    if (
      epoch !== this.epoch ||
      !Number.isSafeInteger(cursor) ||
      cursor < 0 ||
      cursor > this.cursor ||
      cursor < (this.events[0]?.cursor ?? this.cursor + 1) - 1
    )
      return {
        events: [],
        cursor: this.cursor,
        epoch: this.epoch,
        more: false,
        unavailable: true,
      };
    const events: Event[] = [];
    for (const e of this.events) {
      if (e.cursor <= cursor) continue;
      const next = [...events, e];
      if (
        next.length > PAGE_EVENTS ||
        jsonBytes({
          events: next,
          cursor: e.cursor,
          epoch: this.epoch,
          more: false, // longer JSON boolean: final frame must fit too
        }) > PAGE_BYTES
      )
        break;
      events.push(e);
    }
    const next = events.at(-1)?.cursor ?? cursor;
    if (next < this.cursor && !events.length) throw Error("unpageable retained event");
    return {
      events,
      cursor: next,
      epoch: this.epoch,
      more: next < this.cursor,
    };
  }
}
// App hint queue: cap sums serialized hint entries, excluding frame envelope and TCP buffers.
export class Notices {
  entries: { cursor: number; epoch: string }[] = [];
  bytes = 0;
  peak = 0;
  gap = false;
  readonly cap: number;
  constructor(cap: number) {
    this.cap = cap;
  }
  push(e: Event) {
    if (this.gap) return;
    const hint = { cursor: e.cursor, epoch: e.epoch };
    const n = jsonBytes(hint);
    if (this.bytes + n > this.cap) {
      this.entries = [];
      this.bytes = 0;
      this.gap = true;
      return;
    }
    this.entries.push(hint);
    this.bytes += n;
    this.peak = Math.max(this.peak, this.bytes);
  }
  drain() {
    const result = { highwater: this.entries.at(-1)?.cursor, gap: this.gap };
    this.entries = [];
    this.bytes = 0;
    this.gap = false;
    return result;
  }
}
export class Replica {
  cursor = 0;
  readonly recent = new Map<number, string>();
  epoch: string;
  constructor(epoch: string) {
    this.epoch = epoch;
  }
  apply(events: Event[]) {
    for (const e of events) {
      if (e.epoch !== this.epoch) throw Error("epoch mismatch: history unavailable");
      if (e.cursor <= this.cursor) {
        const prior = this.recent.get(e.cursor);
        if (prior !== undefined && prior !== JSON.stringify(e)) throw Error("conflicting duplicate cursor");
        continue;
      }
      if (e.cursor !== this.cursor + 1) throw Error("gap: resync required");
      this.cursor = e.cursor;
      this.recent.set(e.cursor, JSON.stringify(e));
      if (this.recent.size > 64) this.recent.delete(this.recent.keys().next().value!);
    }
  }
}
