import { readFileSync, writeFileSync } from "node:fs";
const dir = process.argv[2];
const read = (name: string) => readFileSync(dir + "/" + name, "utf8");
const json = (name: string) => JSON.parse(read(name));
const assert = (v: unknown, m: string) => {
  if (!v) throw Error(m);
};
const gate = read("gate.log")
  .trim()
  .split("\n")
  .map((s) => JSON.parse(s))
  .find((x) => x.gate === "blocked-response");
assert(
  gate?.requestBytes > 0 && gate.upstreamResponseBytes > 0 && gate.downstreamResponseBytes === 0,
  "gate did not block response",
);
assert(
  json("retry.json").id === "stable-a" && json("retry.json").duplicate === true,
  "stable retry did not deduplicate",
);
const acceptedEvent = (json("before.json").events as Array<any>).find((x) => x.type === "accepted");
assert(
  JSON.stringify(acceptedEvent.data.config) === JSON.stringify(json("retry.json").config) &&
    JSON.stringify(json("retry.json").config) === JSON.stringify(json("post-retry.json").config),
  "retry config differs from accepted config",
);
assert(
  read("lost.json").trim() === "" && read("lost.err").includes("ECONNRESET"),
  "missing ambiguous client transport failure",
);
const before = json("before.json").events as Array<any>;
assert(before.filter((x) => x.type === "accepted").length === 1, "accepted count");
assert(before.filter((x) => x.type === "model_turn").length === 1, "model run count before kill");
assert(
  before.some((x) => x.type === "tool_execution_start"),
  "kill not during execute",
);
assert(!before.some((x) => x.type === "tool_execution_end" || x.type === "outcome"), "kill too late");
const a = json("hello.json"),
  b = json("restarted.json");
assert(
  a.identity === b.identity && b.epoch === a.epoch + 1 && b.phase === "unknown",
  "restart must have unknown phase",
);
const after = json("after.json").events as Array<any>;
assert(
  after.filter((x) => x.type === "accepted").length === 1 && after.filter((x) => x.type === "model_turn").length === 1,
  "blind replay",
);
assert(after.filter((x) => x.type === "outcome" && x.data.state === "unknown").length === 1, "unknown outcome missing");
assert(
  !after.some((x) => x.type === "outcome" && (x.data.state === "done" || x.data.state === "failed")),
  "unknown mislabeled",
);
assert(json("post-retry.json").duplicate === true, "post restart retry not deduped");
assert(read("stale.err").includes("explicit reconciliation required"), "old epoch did not reject sync");
const disk = read("replica.jsonl");
assert(disk.includes("accepted") && disk.includes("model_turn"), "offline canonical replica missing");
writeFileSync(dir + "/damaged.jsonl", disk + '{"k":"event","seq":');
console.log(
  JSON.stringify({
    result: "PASS",
    gate,
    accepted: 1,
    modelTurns: 1,
    outcomes: { unknown: 1, done: 0 },
    oldEpoch: a.epoch,
    newEpoch: b.epoch,
    beforeEvents: before.length,
    afterEvents: after.length,
  }),
);
