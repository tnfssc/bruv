import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiskEntryStore, parseEntryMetadata, scanJsonl } from "../src/history/disk-entry-store";

test("metadata parsing skips payloads but preserves indexed fields and full session headers", () => {
  const input = {
    type: "custom",
    id: "abc",
    parentId: null,
    timestamp: "2026-01-01",
    customType: "bruv-native-task-projection",
    data: { cursor: [{ content: 'quote" slash\\ newline\n lone\ud800 😀', number: -1.2e30, bool: true, nil: null }] },
  };
  const { data: _, ...metadata } = input;
  expect(parseEntryMetadata(JSON.stringify(input)) as unknown).toEqual(metadata);
  const message = {
    ...input,
    type: "message",
    message: { role: "assistant", provider: "p", model: "m", content: input.data },
  };
  expect(parseEntryMetadata(JSON.stringify(message)) as unknown).toEqual({
    ...metadata,
    type: "message",
    message: { role: "assistant", provider: "p", model: "m" },
  });
  const header = {
    type: "session",
    id: "session",
    version: 3,
    timestamp: "t",
    cwd: "/tmp",
    parentSession: "old",
    extra: "preserve me",
  };
  expect(parseEntryMetadata(JSON.stringify(header)) as unknown).toEqual(header);
  expect(
    parseEntryMetadata(
      '{"id":"old","data":{"id":"wrong"},"id":"new","type":"custom","custom\u0054ype":"x"}',
    ) as unknown,
  ).toEqual({ id: "new", type: "custom", customType: "x" });
});

test("deep valid payloads are indexed without imposing a new nesting limit", () => {
  const text = '{"type":"custom","id":"deep","data":' + "[".repeat(20_000) + "0" + "]".repeat(20_000) + "}";
  expect(parseEntryMetadata(text) as unknown).toEqual({ type: "custom", id: "deep" });
});

test("skipped JSON has the same validity rules as native parsing", () => {
  const valid = [
    "null",
    "false",
    "0",
    "true",
    "42",
    '"text"',
    "[]",
    "{}",
    '{"data":[-0,1e+2,true,false,null,{"x":"\\u0000\\\\\\""}]}',
  ];
  for (const text of valid) expect(() => parseEntryMetadata(text)).not.toThrow();
  const invalid = [
    '{"data":[1,]}',
    '{"data":{"x":1,}}',
    '{"data":01}',
    '{"data":1e}',
    '{"data":undefined}',
    '{"data":"\\x00"}',
    '{"data":"raw\nnewline"}',
    '{"data":true} trailing',
    '{"data":[}',
    '{"data":"\\u123Z"}',
    '{"data":"unterminated}',
  ];
  for (const text of invalid) {
    expect(() => JSON.parse(text)).toThrow();
    expect(() => parseEntryMetadata(text)).toThrow();
  }
});

test("JSONL scan reuses line storage without corrupting offsets, Unicode or malformed-line handling", () => {
  const dir = mkdtempSync(join(tmpdir(), "history-metadata-"));
  const path = join(dir, "session.jsonl");
  try {
    const header = { type: "session", version: 3, id: "session", cwd: dir, timestamp: "t" };
    const a = {
      type: "custom",
      id: "a",
      parentId: null,
      timestamp: "t",
      customType: "snapshot",
      data: { text: "😀".repeat(40_000) },
    };
    const b = { ...a, id: "b", parentId: "a", data: { text: "B".repeat(180_000) } };
    const bytes = [header, a, b].map((v) => JSON.stringify(v)).join("\n");
    writeFileSync(path, bytes);
    const store = DiskEntryStore.open(path);
    expect(store.entries.map((v) => v.id)).toEqual(["a", "b"]);
    expect(store.entries.map((v) => v.timestamp)).toEqual(["t", "t"]);
    expect(store.materialize("a") as unknown).toEqual(a);
    expect(store.materialize("b") as unknown).toEqual(b);
    // Opening a valid final record without newline may append just its separator.
    expect(readFileSync(path, "utf8")).toBe(bytes + "\n");
    writeFileSync(path, JSON.stringify(header) + '\n{"data":[1,]}\nnull\n' + JSON.stringify(a) + "\n");
    const rows: unknown[] = [];
    scanJsonl(
      path,
      ({ entry }) => rows.push(entry),
      (line) => parseEntryMetadata(line.toString("utf8")),
    );
    expect(rows).toHaveLength(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("metadata selection agrees with native parsing across varied payload and property layouts", () => {
  let seed = 123456;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const payload = (depth: number): unknown => {
    const which = Math.floor(rand() * (depth ? 7 : 5));
    if (which === 0) return null;
    if (which === 1) return rand() > 0.5;
    if (which === 2) return (rand() - 0.5) * 1e20;
    if (which === 3) return 'quote" slash\\ tab\t lone\ud800 😀' + rand();
    if (which === 4) return "";
    if (which === 5) return Array.from({ length: Math.floor(rand() * 8) }, () => payload(depth - 1));
    return { data: payload(depth - 1), nested: payload(depth - 1), "\u0000key": payload(depth - 1) };
  };
  for (let i = 0; i < 300; i++) {
    const data = payload(4);
    const input =
      i % 2
        ? { data, type: "custom", id: "x", parentId: null, timestamp: "t", customType: "snapshot" }
        : { type: "custom", id: "x", parentId: null, timestamp: "t", customType: "snapshot", data };
    const { data: _, ...selected } = input;
    for (const indent of [undefined, 2]) {
      expect(parseEntryMetadata(JSON.stringify(input, null, indent)) as unknown).toEqual(selected);
    }
  }
});
