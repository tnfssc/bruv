import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("installed compaction carry-forward reads only the latest shake original", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-shake-disk-"));
  try {
    const source = (path: string) => JSON.stringify(join(process.cwd(), path));
    const script = join(dir, "probe.ts");
    await writeFile(
      script,
      `
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {SessionManager} from __SDK__;
import {DiskEntryStore} from __STORE__;
import {installDiskBackedSessionManager,disposeDiskBackedSessionManager} from __HISTORY__;
import {registerManualShake,buildShakePlan} from __SHAKE__;
installDiskBackedSessionManager();
const dir=process.argv[2],manager=SessionManager.create(dir,dir);
const usage={input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
manager.appendMessage({role:"user",content:"ask",timestamp:1});
manager.appendMessage({role:"assistant",api:"anthropic-messages",provider:"offline",model:"offline",content:[{type:"toolCall",id:"call",name:"execute",arguments:{code:"test"}}],stopReason:"toolUse",usage,timestamp:2});
manager.appendMessage({role:"toolResult",toolCallId:"call",toolName:"execute",content:[{type:"text",text:"result"}],isError:false,timestamp:3});
const record=buildShakePlan(manager.buildContextEntries(),manager.getSessionId()).record;
assert(record);
manager.appendCustomEntry("bruv-manual-shake",record);
for(let n=0;n<400;n++)manager.appendCustomEntry("bruv-native-task-projection",{padding:"x".repeat(4096)});
const path=manager.getSessionFile(),before=readFileSync(path);
manager.getBranch=()=>{throw Error("carry-forward must not materialize the full branch");};
manager.getEntries=()=>{throw Error("carry-forward must not materialize all originals");};
const materialize=DiskEntryStore.prototype.materialize;
DiskEntryStore.prototype.materialize=function(value,...rest){
 const meta=typeof value==="string"?this.byId.get(value):value;
 assert.notEqual(meta?.customType,"bruv-native-task-projection");
 return materialize.call(this,value,...rest);
};
const handlers=new Map(),appended=[];
registerManualShake({on:(name,fn)=>handlers.set(name,fn),registerCommand:()=>{},appendEntry:(type,data)=>{appended.push(data);manager.appendCustomEntry(type,data);}});
const ctx={sessionManager:manager,ui:{notify:()=>{}}};
handlers.get("session_compact")({},ctx);
assert.equal(appended.length,1);
assert.deepEqual(appended[0].assistantEntryIds,record.assistantEntryIds);
assert.deepEqual(appended[0].toolResultEntryIds,record.toolResultEntryIds);
assert(readFileSync(path).subarray(0,before.length).equals(before));
manager.appendCustomEntry("bruv-manual-shake",{invalid:true});
assert.throws(()=>handlers.get("session_compact")({},ctx));
disposeDiskBackedSessionManager(manager);
console.log("bounded carry-forward restored");
`
        .replaceAll("__SDK__", JSON.stringify(import.meta.resolve("@earendil-works/pi-coding-agent")))
        .replaceAll("__STORE__", source("src/history/disk-entry-store.ts"))
        .replaceAll("__HISTORY__", source("src/history/session-manager.ts"))
        .replaceAll("__SHAKE__", source("src/agent/manual-shake.ts")),
    );
    const child = Bun.spawn([process.execPath, script, dir], { stdout: "pipe", stderr: "pipe", timeout: 10000 });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toContain("bounded carry-forward restored");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);
