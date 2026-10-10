#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";

const args = process.argv.slice(2);
const sessionPath = args[args.indexOf("--session") + 1];
const header = { type: "session", version: 3, id: "fixture", timestamp: new Date().toISOString(), cwd: process.cwd() };
writeFileSync(sessionPath, `${JSON.stringify(header)}\n`);
const task = args.at(-1)?.split("\n")[0] ?? "";
const edits = task.startsWith("fixture-edit ") ? (JSON.parse(task.slice(13)) as Record<string, string>) : undefined;
if (edits) for (const [path, content] of Object.entries(edits)) writeFileSync(path, content);
const message = fauxAssistantMessage(
  JSON.stringify({
    args,
    cwd: process.cwd(),
    depth: process.env.BRUV_DEPTH,
    fast: process.env.BRUV_FAST,
    separator: "one\u2028two",
  }) + (edits ? "\n\nchecks pass" : ""),
);
message.usage = {
  input: 7,
  output: 3,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 10,
  cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
};
for (const event of [
  header,
  { type: "agent_start" },
  { type: "turn_start" },
  { type: "tool_execution_start", toolCallId: "x", toolName: "read", args: {} },
  { type: "message_end", message },
  { type: "turn_end", message, toolResults: [] },
  { type: "agent_end", messages: [message], willRetry: false },
  { type: "agent_settled", aborted: false },
]) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}
