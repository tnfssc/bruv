import { expect, test } from "bun:test";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scanJsonl } from "../src/history/disk-entry-store";
import { SessionCostTracker } from "../src/tasks/session-costs";
import { createHistoryFixture, runHistoryFixture } from "./helpers/history-fixture";

const temporary = () => createHistoryFixture("bruv-disk-footer-test-").root;

test("index scan preserves offsets, full Unicode records, malformed lines and unterminated tail", () => {
  const path = join(temporary(), "session.jsonl");
  const large = JSON.stringify({ type: "custom", id: "large", data: '雪🙂\n\\"'.repeat(200000) });
  // Place a newline exactly at a read boundary, then split multibyte data over reads.
  const lines = [
    " ".repeat(65535),
    JSON.stringify({ type: "session", id: "session" }),
    "null",
    "false",
    "0",
    "{broken",
    large + "\r",
    "  ",
    JSON.stringify({ type: "custom", id: "tail", data: "complete without newline" }),
  ];
  const bytes = Buffer.from(lines.join("\n"));
  writeFileSync(path, bytes);
  const actual: any[] = [];
  scanJsonl(path, (record, index) => actual.push({ ...record, index }));
  expect(actual.map((r) => r.entry.id)).toEqual(["session", "large", "tail"]);
  expect(actual.map((r) => r.index)).toEqual([0, 1, 2]);
  for (const record of actual)
    expect(JSON.parse(bytes.subarray(record.offset, record.offset + record.length).toString())).toEqual(record.entry);
  expect(actual[1].entry.data).toEqual(JSON.parse(large).data);
  appendFileSync(path, "\n{incomplete");
  const ids: string[] = [];
  scanJsonl(path, ({ entry }) => ids.push(entry.id));
  expect(ids).toEqual(["session", "large", "tail"]);
});

test("real huge saved history reopens, resumes, branches and forks without truncation or cache aliasing", async () => {
  const fixture = createHistoryFixture("bruv-disk-footer-session-");
  const result = await runHistoryFixture("history-large-session.ts", fixture);
  expect(result).toEqual({ code: 0, stderr: "", stdout: "ok\n" });
});

test("huge usage scan waits for newline and preserves malformed, duplicate and incremental costs", async () => {
  const root = temporary();
  const parent = join(root, "parent.jsonl"),
    child = join(root, "child.jsonl");
  writeFileSync(parent, JSON.stringify({ type: "session", id: "parent" }) + "\n");
  const prefix = [
    { type: "session", id: "child", parentSession: parent },
    { type: "custom", id: "marker", customType: "bruv-agent", data: { parentSessionFile: parent } },
    { type: "message", id: "seen-no-usage", message: { role: "toolResult", content: [] } },
  ];
  writeFileSync(child, prefix.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const tracker = new SessionCostTracker(parent, root);
  const text = '雪🙂\n\\"usage": {"cost":{"total":900}}'.repeat(260000);
  const line = Buffer.from(
    JSON.stringify({
      type: "message",
      id: "large",
      message: { role: "toolResult", content: [{ type: "text", text }], usage: { cost: { total: 1.25 } } },
    }),
  );
  // End the first append inside a multibyte UTF-8 character.
  let split = 65535;
  while ((line[split]! & 0xc0) !== 0x80) split++;
  appendFileSync(child, line.subarray(0, split));
  expect(await tracker.refresh()).toBe(0);
  appendFileSync(child, line.subarray(split));
  expect(await tracker.refresh()).toBe(0);
  appendFileSync(child, "\r\n");
  expect(await tracker.refresh()).toBe(1.25);
  const usage = { cost: { total: 2 } };
  const more = [
    { type: "message", id: "large", message: { role: "assistant", usage } },
    { type: "message", id: "seen-no-usage", message: { role: "toolResult", usage } },
    { type: "compaction", id: "compact", usage },
    { type: "branch_summary", id: "summary", usage },
    { type: "custom", id: "attempt", customType: "bruv-compaction-attempt", data: { usage } },
  ];
  appendFileSync(
    child,
    '{"id":"malformed","type":"compaction","usage":{"cost":{"total":900}},broken}\nnull\nfalse\n0\n' +
      more.map((e) => JSON.stringify(e)).join("\n") +
      "\n",
  );
  expect(await tracker.refresh()).toBe(7.25);
  expect(await tracker.refresh()).toBe(7.25);
});
