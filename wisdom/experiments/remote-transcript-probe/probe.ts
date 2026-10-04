import { gzipSync, gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

// Length is checked on BYTES before decoding; fatal decoding never substitutes U+FFFD.
export class JsonlDecoder {
  private pending = Buffer.alloc(0);
  constructor(readonly maxRecordBytes = 65536) {}
  push(chunk: Uint8Array): unknown[] {
    const records: unknown[] = [];
    // Never concatenate an unbounded transport chunk into the pending buffer.
    const step = Math.min(this.maxRecordBytes, 4096);
    if (step < 1) throw new Error("invalid record cap");
    for (let i = 0; i < chunk.length; i += step) records.push(...this.pushPart(chunk.subarray(i, i + step)));
    return records;
  }
  private pushPart(chunk: Uint8Array): unknown[] {
    const next = Buffer.concat([this.pending, chunk]);
    const records: unknown[] = [];
    let start = 0;
    for (let i = 0; i < next.length; i++) {
      if (next[i] !== 10) continue;
      const length = i - start;
      if (length > this.maxRecordBytes) throw new Error("oversize record");
      const bytes = next.subarray(start, i);
      if (!bytes.length) throw new Error("empty record");
      records.push(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
      start = i + 1;
    }
    this.pending = Buffer.from(next.subarray(start));
    if (this.pending.length > this.maxRecordBytes) throw new Error("oversize pending record");
    return records;
  }
  finish(): void {
    if (this.pending.length) throw new Error("incomplete final record");
  }
  get pendingBytes(): number { return this.pending.length; }
}

export type Event = { seq: number; ms: number; type: string; data: unknown; [key: string]: unknown };
export function parseFixture(input: Buffer): Event[] {
  const decoder = new JsonlDecoder();
  const events: Event[] = [];
  for (let i = 0; i < input.length; i += 997) events.push(...decoder.push(input.subarray(i, i + 997)) as Event[]);
  decoder.finish();
  if (!events.length || events.some((e, i) => e.seq !== i + 1)) throw new Error("gap/out-of-order fixture");
  return events;
}
export function frames(events: Event[], byteCap = 4096, timeCapMs = 40): Event[][] {
  const result: Event[][] = [];
  let batch: Event[] = [];
  let size = 2;
  let first = 0;
  for (const e of events) {
    const len = Buffer.byteLength(JSON.stringify(e)) + (batch.length ? 1 : 0);
    if (batch.length && (size + len > byteCap || e.ms - first >= timeCapMs)) {
      result.push(batch); batch = []; size = 2;
    }
    if (!batch.length) first = e.ms;
    batch.push(e); size += Buffer.byteLength(JSON.stringify(e)) + (batch.length > 1 ? 1 : 0);
    if (size > byteCap) { result.push(batch); batch = []; size = 2; } // oversized single event, immediate
  }
  if (batch.length) result.push(batch);
  return result;
}
export function formats(events: Event[]) {
  const raw = events.map(e => Buffer.from(JSON.stringify(e) + "\n"));
  const perEventGzip = raw.map(b => gzipSync(b));
  const batches = frames(events);
  const batchRaw = batches.map(b => Buffer.from(JSON.stringify(b)));
  const batchGzip = batchRaw.map(b => gzipSync(b));
  const same = (a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error("roundtrip mismatch");
  };
  same(parseFixture(Buffer.concat(raw)), events);
  same(parseFixture(Buffer.concat(perEventGzip.map(b => gunzipSync(b)))), events);
  same(batchRaw.flatMap(b => JSON.parse(b.toString("utf8")) as Event[]), events);
  same(batchGzip.flatMap(b => JSON.parse(gunzipSync(b).toString("utf8")) as Event[]), events);
  return { raw, perEventGzip, batches, batchRaw, batchGzip };
}
function msPerRound(fn: () => void, iterations = 250): number {
  for (let i = 0; i < 40; i++) fn();
  const samples: number[] = [];
  for (let j = 0; j < 7; j++) {
    const t = performance.now();
    for (let i = 0; i < iterations; i++) fn();
    samples.push((performance.now() - t) / iterations);
  }
  return samples.sort((a, b) => a - b)[3]!;
}
if (import.meta.main) {
  const path = process.argv[2] ?? new URL("./fixture.jsonl", import.meta.url).pathname;
  const events = parseFixture(readFileSync(path));
  const f = formats(events);
  const total = (bs: Buffer[]) => bs.reduce((n, b) => n + b.length, 0);
  console.log(JSON.stringify({ runtime: process.version, bun: Bun.version, path, events: events.length,
    payloadBytes: { raw: total(f.raw), perEventGzip: total(f.perEventGzip), batchRaw: total(f.batchRaw), batchGzip: total(f.batchGzip) },
    frames: { raw: f.raw.length, perEventGzip: f.perEventGzip.length, batch: f.batchRaw.length },
    maxBatchWaitMs: Math.max(...f.batches.map(b => b.at(-1)!.ms - b[0]!.ms)),
    // First event cannot wait for batching when oversized; otherwise a batch waits at most time cap
    // under an active timer. This is a model, not observed UI/transport latency.
    firstEvent: { bytes: f.raw[0]!.length, gzipBytes: f.perEventGzip[0]!.length,
      batchBytes: f.batchRaw[0]!.length, batchGzipBytes: f.batchGzip[0]!.length,
      modeledBatchTimerUpperMs: 40 },
    medianMsPerTranscript: {
      rawEncode: msPerRound(() => { events.map(e => Buffer.from(JSON.stringify(e) + "\n")); }),
      rawDecode: msPerRound(() => { parseFixture(Buffer.concat(f.raw)); }),
      eventGzipEncode: msPerRound(() => { f.raw.map(b => gzipSync(b)); }),
      eventGzipDecode: msPerRound(() => { f.perEventGzip.map(b => gunzipSync(b)).map(b => JSON.parse(b.toString("utf8"))); }),
      batchEncodeGzip: msPerRound(() => { frames(events).map(b => gzipSync(Buffer.from(JSON.stringify(b)))); }),
      batchDecodeGzip: msPerRound(() => { f.batchGzip.flatMap(b => JSON.parse(gunzipSync(b).toString("utf8"))); }),
    },
    simulatedStreams: [1,100,1000].map(count => ({ count, raw: total(f.raw)*count,
      perStreamEventGzip: total(f.perEventGzip)*count,
      perStreamBatchGzip: total(f.batchGzip)*count,
      sharedDictionaryOptimisticGzip: gzipSync(Buffer.concat(Array.from({length:count}, () => Buffer.concat(f.raw)))).length
    }))
  }, null, 2));
}
