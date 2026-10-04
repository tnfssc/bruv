import { gzipSync } from "node:zlib";
import { isDeepStrictEqual } from "node:util";
export type Event = {
  taskId: string;
  seq: number;
  id: string;
  kind: string;
  text?: string;
  output?: string;
  available?: { id: string; bytes: number };
};
export const utf8 = (v: unknown) =>
  Buffer.byteLength(JSON.stringify(v), "utf8");
function rng(seed: number) {
  let x = seed >>> 0;
  return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296;
}
function text(rand: () => number, n: number) {
  const words = [
    "ready",
    "transform",
    "éclair",
    "delta",
    "commit",
    "stdout",
    "validation",
    "worker",
    "token",
    "result",
  ];
  let s = "";
  while (s.length < n) s += words[Math.floor(rand() * words.length)] + " ";
  return s.slice(0, n);
}
export function fixture(n: number, seed = 42) {
  const rand = rng(seed),
    tasks: Event[][] = [],
    blobs = new Map<string, string>();
  for (let a = 0; a < n; a++) {
    const id = "task-" + a,
      ev: Event[] = [];
    for (let i = 1; i <= 32; i++) {
      const kind =
        i === 32
          ? "result"
          : i === 20
            ? "question"
            : i % 8 === 0
              ? "tool"
              : i % 2
                ? "token"
                : "progress";
      const e: Event = { taskId: id, seq: i, id: id + ":" + i, kind };
      if (kind === "tool") {
        e.output = text(rand, i === 24 ? 16384 : 640);
        const bid = e.id + ":output";
        blobs.set(bid, e.output);
        e.available = { id: bid, bytes: Buffer.byteLength(e.output, "utf8") };
      } else
        e.text = text(
          rand,
          kind === "token" ? 64 : kind === "progress" ? 100 : 180,
        );
      ev.push(e);
    }
    tasks.push(ev);
  }
  return { tasks, blobs };
}
export function compact(e: Event): Event {
  if (!e.available) return e;
  const { output, ...rest } = e;
  return rest;
}
export const catchup = (events: Event[], cursor: number) =>
  events.filter((e) => e.seq > cursor).map(compact);
export function apply(state: Event[], incoming: Event[]) {
  for (const event of incoming) {
    if (state.length && event.taskId !== state[0].taskId)
      throw Error("wrong task");
    const last = state.at(-1)?.seq ?? 0;
    if (event.seq <= last) {
      if (!isDeepStrictEqual(state[event.seq - 1], event))
        throw Error("conflicting event");
      continue;
    }
    if (event.seq !== last + 1 || event.id !== event.taskId + ":" + event.seq)
      throw Error("gap or invalid ID");
    state.push(event);
  }
  return state;
}
export function hydrate(events: Event[], blobs: Map<string, string>) {
  return events.map((e) => {
    if (!e.available) return e;
    const output = blobs.get(e.available.id);
    if (output === undefined) throw Error("unavailable blob");
    return { ...e, output };
  });
}
export type Frame = {
  events: Event[];
  at: number;
  firstAt: number;
  oversized: boolean;
};
// Ordered timestamps; a single event larger than the cap is emitted immediately and marked.
export function batch(
  input: { event: Event; at: number }[],
  maxBytes = 16384,
  maxMs = 40,
): Frame[] {
  if (maxBytes < 2 || maxMs <= 0) throw Error("invalid limits");
  const frames: Frame[] = [];
  let pending: Event[] = [],
    firstAt = 0,
    size = 2,
    previous = -Infinity;
  const flush = (at: number, oversized = false) => {
    if (pending.length)
      frames.push({ events: pending, firstAt, at, oversized });
    pending = [];
    size = 2;
  };
  for (const { event, at } of input) {
    if (at < previous) throw Error("timestamps out of order");
    previous = at;
    const bytes = utf8(event);
    if (
      pending.length &&
      (at - firstAt >= maxMs || size + 1 + bytes > maxBytes)
    )
      flush(Math.min(at, firstAt + maxMs));
    if (!pending.length) firstAt = at;
    if (bytes + 2 > maxBytes) {
      pending = [event];
      flush(at, true);
      continue;
    }
    size += bytes + (pending.length ? 1 : 0);
    pending.push(event);
    if (size === maxBytes) flush(at);
  }
  if (pending.length) flush(firstAt + maxMs);
  return frames;
}
function metric(payloads: Iterable<unknown>, zip = false) {
  let bytes = 0,
    frames = 0,
    largestFrame = 0;
  for (const payload of payloads) {
    const raw = Buffer.from(JSON.stringify(payload));
    const wire = zip ? gzipSync(raw, { level: 1 }) : raw;
    bytes += wire.length;
    frames++;
    largestFrame = Math.max(largestFrame, wire.length);
  }
  return { bytes, frames, largestFrame };
}

export function run(n: number, active: number, seed = 42) {
  if (
    !Number.isInteger(n) ||
    !Number.isInteger(active) ||
    n < 1 ||
    active < 1 ||
    active > n
  )
    throw Error("invalid counts");
  const { tasks, blobs } = fixture(n, seed);
  const open = tasks.slice(0, active);
  const stream = open.flatMap((task) =>
    task.map((event, i) => ({ event, at: i * 20 })),
  );
  stream.sort(
    (a, b) => a.at - b.at || a.event.taskId.localeCompare(b.event.taskId),
  );
  const lazy = stream.map(({ event, at }) => ({ event: compact(event), at }));
  const fullFrames = batch(stream),
    lazyFrames = batch(lazy);
  function* replay() {
    for (const task of open)
      for (let i = 1; i <= task.length; i++) yield task.slice(0, i);
  }
  // All-task coverage: initial full snapshot, followed by changes for active tasks.
  const statuses = (tick: number) =>
    tasks.map((task, index) => ({
      taskId: task[0].taskId,
      seq: index < active ? tick : 0,
      state: index >= active ? "idle" : tick === 32 ? "done" : "running",
    }));
  function* polls() {
    for (let tick = 1; tick <= 32; tick++) yield statuses(tick);
  }
  function* deltas() {
    yield statuses(0);
    for (let tick = 1; tick <= 32; tick++)
      yield statuses(tick).slice(0, active);
  }
  const lazyFetchBytes = open
    .flatMap((task) => task.filter((e) => e.output))
    .reduce(
      (sum, event) =>
        sum + Buffer.byteLength(blobs.get(event.available!.id)!, "utf8"),
      0,
    );
  return {
    n,
    active,
    seed,
    historyReplay: metric(replay()),
    fullDelta: metric(stream.map((s) => [s.event])),
    lazyDelta: metric(lazy.map((s) => [s.event])),
    fullBatch: metric(fullFrames.map((f) => f.events)),
    lazyBatch: metric(lazyFrames.map((f) => f.events)),
    lazyBatchGzip: metric(
      lazyFrames.map((f) => f.events),
      true,
    ),
    lazyFetchBytes,
    statusPolling: metric(polls()),
    statusSnapshotAndDeltas: metric(deltas()),
    maxBatchWaitMs: Math.max(...lazyFrames.map((f) => f.at - f.firstAt)),
    slowCatchupLast8Bytes: utf8(tasks[0].slice(24).map(compact)),
    fullCatchupBytes: utf8(catchup(tasks[0], 0)),
    canonicalTaskBytes: utf8(tasks[0]),
  };
}
if (import.meta.main) {
  const seed = Number(process.argv[2] ?? 42);
  for (const [n, active] of [
    [1, 1],
    [100, 1],
    [1000, 10],
    [1000, 1000],
  ])
    console.log(JSON.stringify(run(n, active, seed)));
}
