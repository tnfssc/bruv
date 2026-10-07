import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("task restore uses keyed active-branch metadata and reads only the latest cursors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-checkpoint-contract-"));
  try {
    const script = join(dir, "check.ts");
    const source = (path: string) => JSON.stringify(join(process.cwd(), path));
    await writeFile(
      script,
      `
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SessionManager } from __SDK__;
import { bindNativeTasks } from __BINDING__;
import { nativeImportEntryMaps } from __NATIVE_HISTORY__;
import { DiskEntryStore } from __STORE__;
import { installDiskBackedSessionManager, getDiskBackedEntryMetadata, disposeDiskBackedSessionManager } from __HISTORY__;
installDiskBackedSessionManager();
const dir = process.argv[2];
const session = SessionManager.create(dir,dir);
session.appendMessage({role:"user",content:"start",timestamp:0});
const path = session.getSessionFile();
const root = {namespace:"bruv:contract",sourceSessionId:path,sessionId:session.getSessionId()};
const rootKey = JSON.stringify([root.namespace,root.sourceSessionId,root.sessionId]);
for(let round=0;round<200;round++) for(let job=0;job<2;job++) {
  const jobId = "job-"+job;
  session.appendCustomEntry("bruv-native-task-projection",{root,cursor:{
    link:{origin:"bruv",root,jobId,sourceId:path,kind:"shell",launchToolUseId:"call-"+job,parent:{sourceSessionId:path,launchToolUseId:null}},
    revision:round+1,agentCall:true,agentResult:true,childEntries:Array.from({length:300},(_,n)=>"old-child-"+n),tokens:0,toolUses:0,measuredUsage:false
  }});
}
const activeLeaf = session.getLeafId();
session.appendCustomEntry("bruv-native-task-projection",{root,cursor:{link:{jobId:"inactive-job"},revision:999,childEntries:[]}});
session.branch(activeLeaf);
session.appendMessage({role:"user",content:"active branch",timestamp:1});
session.appendCustomEntry("bruv-native-entry-map",{nativeSessionId:"fixture-native",entries:[]});
disposeDiskBackedSessionManager(session);
const reopened = SessionManager.open(path,dir);
const metadata = getDiskBackedEntryMetadata(reopened).filter(meta=>meta.customType==="bruv-native-task-projection");
assert.equal(metadata.length,401);
for(const meta of metadata) { assert.equal(meta.taskProjection.rootKey,rootKey); assert.ok(["job-0","job-1","inactive-job"].includes(meta.taskProjection.jobId)); }
const before = readFileSync(path);
let taskBodies=0;
const restored = [];
const materialize=DiskEntryStore.prototype.materialize;
DiskEntryStore.prototype.materialize=function(value,...rest){
  const meta=typeof value==="string"?this.byId.get(value):value;
  if(meta?.customType==="bruv-native-task-projection")taskBodies++;
  const entry = materialize.call(this,value,...rest);
  if(meta?.customType==="bruv-native-task-projection") restored.push([entry.data.cursor.link.jobId, entry.data.cursor.revision]);
  return entry;
};
reopened.getBranch=()=>{throw Error("Full branch must not be materialized for task restore");};
reopened.getEntries=()=>{throw Error("Import-map lookup must not materialize whole history");};
assert.equal(nativeImportEntryMaps(reopened).length,1);
const binding=bindNativeTasks({context:{sessionManager:reopened,cwd:dir},sourceSessionId:path,
  manager:{list:()=>[],subscribe:()=>()=>{}},appendEntry:(type,data)=>reopened.appendCustomEntry(type,data)},
  {root,emit:()=>{}});
await binding.flush();await binding.close();
assert.equal(taskBodies,2,"only the latest active cursor per job is read");
assert.deepEqual(restored.sort(),[["job-0",200],["job-1",200]]);
assert.ok(readFileSync(path).equals(before),"opening/restoring with no live jobs does not rewrite old history");
disposeDiskBackedSessionManager(reopened);
console.log("latest keyed task cursors restored");
`
        .replaceAll("__BINDING__", source("src/claude-compat/task-binding.ts"))
        .replaceAll("__NATIVE_HISTORY__", source("src/claude-compat/history.ts"))
        .replaceAll("__STORE__", source("src/history/disk-entry-store.ts"))
        .replaceAll("__HISTORY__", source("src/history/session-manager.ts"))
        .replaceAll("__SDK__", JSON.stringify(import.meta.resolve("@earendil-works/pi-coding-agent"))),
    );
    const child = Bun.spawn([process.execPath, script, dir], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000,
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toContain("latest keyed task cursors restored");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 15_000);
