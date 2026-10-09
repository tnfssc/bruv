import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { demoIds } from "../demos";
import { liveDuration, liveFrame, livePrompt, liveReply } from "./readme-live";

const text = (at: number) =>
  liveFrame(at)
    .map((row) => row.map((cell) => cell.text).join(""))
    .join("\n");

test("Live storyboard uses current hold-to-talk states and finishes its transcript", () => {
  expect(text(1600)).toContain("/live start");
  expect(text(2400)).toContain("Voice · connecting");
  expect(text(4000)).toContain("Voice · hold Space to speak");
  expect(text(6000)).toContain("Listening · release Space to finish");
  expect(text(6000)).toContain("Partial transcript");
  expect(text(8500)).toContain("Thinking · hold Space to speak");
  expect(text(12000)).toContain("Speaking · hold Space to reply");
  const final = text(liveDuration - 200);
  expect(final).toContain(livePrompt);
  expect(final).toContain(liveReply);
  expect(final).not.toContain("Partial transcript");
  expect(final).toContain("Voice · hold Space to speak");
  const rows = liveFrame(liveDuration - 200);
  expect(rows.length).toBe(23);
  expect(rows.every((row) => row.length === 80)).toBe(true);
});

test("README links all four local looping GIF assets", async () => {
  const readme = await Bun.file(resolve(import.meta.dir, "../../README.md")).text();
  for (const id of [...demoIds, "live"]) {
    const path = "site/assets/demos/" + id + ".gif";
    expect(readme).toContain("(" + path + ")");
    const bytes = Buffer.from(await Bun.file(resolve(import.meta.dir, "../..", path)).arrayBuffer());
    expect(bytes.subarray(0, 6).toString()).toBe("GIF89a");
    expect(bytes.readUInt16LE(6)).toBe(840);
    expect(bytes.readUInt16LE(8)).toBe(534);
    expect(bytes.includes(Buffer.from("NETSCAPE2.0"))).toBe(true);
  }
});
