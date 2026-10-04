import { test, expect } from "bun:test";
import {
  fixture,
  compact,
  catchup,
  apply,
  hydrate,
  batch,
  utf8,
  run,
} from "./bench";
test("deterministic stable cursor duplicate replay and gap", () => {
  const { tasks } = fixture(2);
  expect(fixture(2)).toEqual(fixture(2));
  const state = apply([], catchup(tasks[0], 0).slice(0, 12));
  apply(state, catchup(tasks[0], 8).slice(0, 4));
  expect(state).toHaveLength(12);
  expect(() => apply(state, catchup(tasks[0], 15))).toThrow("gap");
  apply(state, catchup(tasks[0], 12));
  expect(state).toHaveLength(32);
  expect(() => apply(state, [tasks[1][31]])).toThrow("wrong task");
  expect(() =>
    apply(state, [{ ...tasks[0][31], id: "corrupt", seq: 32 }]),
  ).toThrow("conflicting");
});
test("lazy output retained and missing blob explicit", () => {
  const { tasks, blobs } = fixture(1);
  const summaries = catchup(tasks[0], 0);
  expect(summaries[23].output).toBeUndefined();
  expect(summaries[23].available?.bytes).toBe(
    Buffer.byteLength(tasks[0][23].output!),
  );
  expect(hydrate(summaries, blobs)).toEqual(tasks[0]);
  expect(() => hydrate(summaries, new Map())).toThrow("unavailable");
  expect(utf8(compact(tasks[0][23]))).toBeLessThan(utf8(tasks[0][23]));
});
test("batch preserves ordering and caps, except oversized single events", () => {
  const { tasks } = fixture(1);
  const input = tasks[0].map((event, i) => ({
    event: compact(event),
    at: i * 20,
  }));
  const frames = batch(input, 400, 40);
  expect(frames.flatMap((f) => f.events)).toEqual(input.map((x) => x.event));
  expect(frames.every((f) => f.at - f.firstAt <= 40)).toBe(true);
  expect(
    frames.every((f) => utf8(f.events) <= 400 || f.events.length === 1),
  ).toBe(true);
});

test("same ID with changed payload is not an idempotent duplicate", () => {
  const { tasks } = fixture(1);
  const state = apply([], [tasks[0][0]]);
  expect(() => apply(state, [{ ...tasks[0][0], text: "changed" }])).toThrow(
    "conflicting event",
  );
  expect(state).toHaveLength(1);
});

test("batch byte boundary, time boundary, oversized singleton, and stable ordering", () => {
  const { tasks } = fixture(1);
  const [a, b, c] = tasks[0];
  const huge = tasks[0][23];
  const limit = utf8([a, b]);
  const frames = batch(
    [
      { event: a, at: 0 },
      { event: b, at: 1 },
      { event: c, at: 2 },
      { event: huge, at: 42 },
    ],
    limit,
    40,
  );
  expect(frames.map((f) => f.events)).toEqual([[a, b], [c], [huge]]);
  expect(frames.map((f) => f.at)).toEqual([1, 42, 42]);
  expect(frames.map((f) => f.oversized)).toEqual([
    false,
    false,
    utf8([huge]) > limit,
  ]);
  expect(frames.every((f) => f.oversized || utf8(f.events) <= limit)).toBe(
    true,
  );
  expect(() =>
    batch([
      { event: a, at: 2 },
      { event: b, at: 1 },
    ]),
  ).toThrow("timestamps out of order");
  const timed = batch(
    [
      { event: a, at: 0 },
      { event: b, at: 40 },
    ],
    10000,
    40,
  );
  expect(timed.map((f) => f.at)).toEqual([40, 80]);
});

test("measurement axes preserve active transcript and all-task status coverage", () => {
  const small = run(3, 1);
  expect(small.fullDelta.bytes).toBeGreaterThan(small.lazyDelta.bytes);
  expect(small.fullDelta.bytes).toBeLessThan(small.historyReplay.bytes);
  expect(small.lazyFetchBytes).toBeGreaterThan(0);
  expect(small.statusSnapshotAndDeltas.frames).toBe(33);
  const all = run(3, 3);
  expect(all.statusSnapshotAndDeltas.bytes).toBeGreaterThan(all.statusPolling.bytes);
  expect(all.fullDelta.frames).toBe(96);
});
