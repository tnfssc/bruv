import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { JsonlDecoder, formats, parseFixture, frames } from "./probe";

test("full retained sanitized fixture reconstructs across every encoding", () => {
  const events = parseFixture(readFileSync(new URL("./fixture.jsonl", import.meta.url)));
  expect(events).toHaveLength(18);
  expect(formats(events).batches.flat()).toEqual(events);
  expect(frames(events).flat()).toEqual(events);
});
test("all byte split boundaries across accented text, emoji and newline", () => {
  const original = [{ text: "café 🔥 中文" }, { text: "fin 😄" }];
  const bytes = Buffer.from(original.map(x => JSON.stringify(x)).join("\n") + "\n");
  for (let split = 0; split <= bytes.length; split++) {
    const d = new JsonlDecoder(100);
    const got = [...d.push(bytes.subarray(0, split)), ...d.push(bytes.subarray(split))];
    d.finish(); expect(got).toEqual(original);
  }
  const d = new JsonlDecoder(100);
  const got: unknown[] = [];
  for (const byte of bytes) got.push(...d.push(Uint8Array.of(byte)));
  d.finish(); expect(got).toEqual(original);
  // Find a guaranteed split INSIDE the emoji, unlike arbitrary network chunking assumptions.
  const emoji = bytes.indexOf(Buffer.from("🔥"));
  const corrupted = new TextDecoder().decode(bytes.subarray(0, emoji+1)) + new TextDecoder().decode(bytes.subarray(emoji+1));
  expect(corrupted).toContain("�");
});
test("truncation, invalid UTF-8, bounded pending, and oversize complete event fail explicitly", () => {
  const d = new JsonlDecoder(8);
  d.push(Buffer.from('{"a":'));
  expect(() => d.finish()).toThrow("incomplete");
  expect(() => new JsonlDecoder(8).push(Buffer.from("123456789"))).toThrow("oversize pending");
  expect(() => new JsonlDecoder(8).push(Buffer.alloc(1_000_000, 0x61))).toThrow("oversize pending");
  expect(() => new JsonlDecoder(8).push(Buffer.from('"123456789"\n'))).toThrow("oversize record");
  expect(() => new JsonlDecoder().push(Buffer.from([0x22,0xf0,0x9f,0x0a]))).toThrow();
  expect(() => new JsonlDecoder().push(Buffer.from('{\n'))).toThrow();
});
test("gap is rejected and oversized frame emits alone", () => {
  const events = parseFixture(readFileSync(new URL("./fixture.jsonl", import.meta.url)));
  expect(() => parseFixture(Buffer.from(JSON.stringify(events[1]) + "\n"))).toThrow("gap");
  const f = frames(events, 100, 40);
  expect(f.flat()).toEqual(events);
  expect(f.some(b => b.length === 1 && Buffer.byteLength(JSON.stringify(b)) > 100)).toBe(true);
});
