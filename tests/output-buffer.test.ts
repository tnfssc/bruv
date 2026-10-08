import { describe, expect, test } from "bun:test";
import { BoundedOutputBuffer } from "../src/output-buffer";

describe("byte cursors and output loss", () => {
  test("pages across append boundaries using the returned byte cursor", () => {
    const output = new BoundedOutputBuffer(100);
    output.append("abc");
    output.append("def");

    const first = output.read(0, 4);
    expect(first).toEqual({
      buffer: Buffer.from("abcd"),
      nextOffset: 4,
      outputLost: false,
      hasMore: true,
    });
    const second = output.read(first.nextOffset, 4);
    expect(second).toEqual({
      buffer: Buffer.from("ef"),
      nextOffset: 6,
      outputLost: false,
      hasMore: false,
    });
  });

  test("resumes an expired cursor at the retained tail and reports the gap", () => {
    const output = new BoundedOutputBuffer(10);
    output.append("12345");
    output.append("67890");
    output.append("abcde");

    expect(output.retainedBytes).toBe(10);
    expect(output.baseOffset).toBe(5);
    expect(output.endOffset).toBe(15);
    expect(output.read(0, 20)).toEqual({
      buffer: Buffer.from("67890abcde"),
      nextOffset: 15,
      outputLost: true,
      hasMore: false,
    });
    expect(output.read(output.baseOffset, 20)).toEqual({
      buffer: Buffer.from("67890abcde"),
      nextOffset: 15,
      outputLost: false,
      hasMore: false,
    });
  });

  test("releases raw bytes for a storage budget without rebasing later appends", () => {
    const output = new BoundedOutputBuffer(20);
    output.append("A😀BC"); // 41 f0 9f 98 80 42 43: seven bytes, four characters.

    expect(output.discardPrefix(2)).toBe(2);
    expect(output.retainedBytes).toBe(5);
    expect(output.baseOffset).toBe(2);
    expect(output.endOffset).toBe(7);
    // UTF-8 repair belongs to TaskManager.inspect, not this byte store.
    expect(output.read(0, 20)).toEqual({
      buffer: Buffer.from([0x9f, 0x98, 0x80, 0x42, 0x43]),
      nextOffset: 7,
      outputLost: true,
      hasMore: false,
    });
    expect(output.read(2, 2)).toEqual({
      buffer: Buffer.from([0x9f, 0x98]),
      nextOffset: 4,
      outputLost: false,
      hasMore: true,
    });

    expect(output.discardPrefix(100)).toBe(5);
    expect(output.retainedBytes).toBe(0);
    expect(output.baseOffset).toBe(7);
    expect(output.endOffset).toBe(7);
    expect(output.read(0, 20)).toEqual({
      buffer: Buffer.alloc(0),
      nextOffset: 7,
      outputLost: true,
      hasMore: false,
    });

    output.append("D");
    expect(output.baseOffset).toBe(7);
    expect(output.endOffset).toBe(8);
    expect(output.read(7, 20)).toEqual({
      buffer: Buffer.from("D"),
      nextOffset: 8,
      outputLost: false,
      hasMore: false,
    });
  });
});

describe("bounded, owned byte storage", () => {
  test("copies incoming slices and isolates returned pages from saved bytes", () => {
    const output = new BoundedOutputBuffer(100);
    const backing = Buffer.alloc(64_000, 0);
    const slice = backing.subarray(100, 103);
    slice.set(Buffer.from("abc"));
    output.append(slice);
    slice.set(Buffer.from("xyz"));

    const first = output.read(0, 100);
    expect(first.buffer.toString()).toBe("abc");
    // A caller can also mutate a returned page without changing saved output.
    first.buffer.fill(0);
    expect(output.read(0, 100).buffer.toString()).toBe("abc");
  });

  test("keeps the newest bytes ordered after many tiny writes", () => {
    const output = new BoundedOutputBuffer(1_000);
    for (let index = 0; index < 19_000; index++) output.append("x");
    for (let index = 0; index < 1_000; index++) output.append(String(index % 10));

    expect(output.retainedBytes).toBe(1_000);
    expect(output.baseOffset).toBe(19_000);
    expect(output.endOffset).toBe(20_000);
    expect(output.read(output.baseOffset, 2_000)).toEqual({
      buffer: Buffer.from("0123456789".repeat(100)),
      nextOffset: 20_000,
      outputLost: false,
      hasMore: false,
    });
  });

  test("replaces older chunks with an owned tail of one oversized write", () => {
    const output = new BoundedOutputBuffer(4);
    output.append("abc");
    const incoming = Buffer.from("0123456789");
    output.append(incoming);
    incoming.fill(0);

    expect(output.retainedBytes).toBe(4);
    expect(output.baseOffset).toBe(9);
    expect(output.endOffset).toBe(13);
    expect(output.read(9, 4)).toEqual({
      buffer: Buffer.from("6789"),
      nextOffset: 13,
      outputLost: false,
      hasMore: false,
    });
  });
});
