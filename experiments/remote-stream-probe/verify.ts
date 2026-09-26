import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
const data = JSON.parse(readFileSync("experiments/remote-stream-probe/results.json","utf8"));
assert.equal(data.rows.length,14);
for(const row of data.rows) {
 assert.equal(row.events,row.tasks*(row.variant==="burst"?16:row.variant==="reconnect"?132:4),"missing transcript events");
 assert.equal(row.unavailable,false,"history unavailable: lost transcript");
 assert.ok(row.peakQueueBytes<=data.limits.queueBytes);
 assert.equal(row.frames,row.requests);
 for(const stat of Object.values(row.latencyMs) as {n:number;min:number;max:number}[]) {
   assert.ok(stat.n>0 && stat.min>=0 && stat.max>=stat.min);
 }
}
assert.equal(data.rows.find((r:any)=>r.variant==="reconnect")?.gap,true);
console.log("verified complete event delivery and bounded app queue across",data.rows.length,"runs");
