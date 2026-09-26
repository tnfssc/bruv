import { readFileSync } from "node:fs";
const dir = process.argv[2];
const disk = readFileSync(dir + "/replica.jsonl", "utf8")
  .trim()
  .split("\n")
  .map((s) => JSON.parse(s));
const cached = JSON.parse(readFileSync(dir + "/offline.json", "utf8"));
if (JSON.stringify(disk) !== JSON.stringify(cached.transcript) || !disk.some((e) => e.type === "tool_execution_start"))
  throw Error("canonical transcript changed after damaged replica detection");
