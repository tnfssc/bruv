const dir = process.argv[2];
const read = async (s: string) => Bun.file(dir + "/" + s).text();
const es = (await read("replica.jsonl"))
  .trim()
  .split("\n")
  .map((s) => JSON.parse(s));
const before = JSON.parse(await read("progress")),
  after = JSON.parse(await read("sync"));
const assert = (v: unknown, msg: string) => {
  if (!v) throw Error(msg + " " + JSON.stringify(es).slice(-2500));
};
assert(JSON.parse(await read("retry")).duplicate, "retry not deduplicated");
assert(before.cursor < after.cursor, "no catchup");
assert(
  es.every((x, i) => x.seq === i + 1),
  "not contiguous exactly once in replica",
);
const turns = es.filter((x) => x.type === "model_turn");
assert(turns.length === 3, "three actual model turns");
assert(
  turns[1].seq > before.cursor && turns[2].seq > before.cursor,
  "later model turns did not happen after client exit",
);
assert(turns[2].ms < es[before.cursor - 1].ms + 4000, "final model turn not during no-request interval");
const tools = es.filter((x) => x.type === "tool_execution_end");
assert(tools.length === 2 && tools.every((x) => !x.data.isError), "two successful tool results");
assert(
  JSON.stringify(tools[0]).includes("FIRST_DONE") &&
    JSON.stringify(tools[1]).includes("SECOND_DONE:LINUX-CONTAINER-MARKER"),
  "full tool results missing",
);
assert(
  es.some((x) => x.type === "message_end" && JSON.stringify(x).includes("FINISHED")),
  "assistant answer missing",
);
assert(
  es.some((x) => x.type === "outcome" && x.data.state === "done"),
  "outcome missing",
);
const offline = JSON.parse(await read("offline"));
assert(offline.fullToolResults === 2 && offline.transcript.length === es.length, "offline disk replica unreadable");
assert(JSON.stringify(offline.transcript).includes("FINISHED") &&
  JSON.stringify(offline.transcript).includes("FIRST_DONE") &&
  JSON.stringify(offline.transcript).includes("SECOND_DONE:LINUX-CONTAINER-MARKER"), "offline CLI missing transcript");
console.log(
  JSON.stringify({
    result: "PASS",
    fakeProvider: true,
    stagedDie: JSON.parse(await read("provenance")),
    detachedAtMs: es.find((x) => x.seq === before.cursor)?.ms,
    finishMs: es.at(-1).ms,
    events: es.length,
    totalEventUtf8Bytes: es.reduce((n, e) => n + Buffer.byteLength(JSON.stringify(e)), 0),
    replicaFileBytes: Buffer.byteLength(await read("replica.jsonl")),
    catchupEventBytes: after.bytes,
    offline: true,
  }),
);

export {};
