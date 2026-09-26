import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
const events = readFileSync(process.argv[2], "utf8").trim().split("\n").map((s) => JSON.parse(s));
assert(events.some((e) => e.type === "capability_resolved" && e.data.status === "denied"));
assert(events.at(-1).type === "outcome" && events.at(-1).data.state === "denied");
assert(!events.some((e) => e.type === "dependency_resumed"));
console.log("capability denial PASS");
