import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run as runProcess } from "./helpers";

test("disk history retrieval traverses metadata, preserving originals, branches, refs and live exclusions", async () => {
  const root = await mkdtemp(join(tmpdir(), "bruv-disk-retrieval-"));
  try {
    const { stdout, stderr, code } = await runProcess(
      [
        process.execPath,
        "-e",
        String.raw`
      import { SessionManager } from "@earendil-works/pi-coding-agent";
      import { installDiskBackedSessionManager } from "./src/history/session-manager.ts";
      import { HistoryService } from "./src/history/service.ts";
      import { MANUAL_SHAKE_ENTRY, MANUAL_SHAKE_VERSION } from "./src/history/shake-record.ts";
      import { strict as assert } from "node:assert";
      installDiskBackedSessionManager();
      const manager = SessionManager.create(process.env.PROBE_ROOT, process.env.PROBE_ROOT);
      const user = (content) => ({ role: "user", content, timestamp: Date.now() });
      const first = manager.appendMessage(user("original exact evidence needle"));
      manager.appendMessage(user("inactive-secret-needle"));
      manager.branch(first);
      const assistant = manager.appendMessage({role:"assistant", api:"openai-responses",provider:"test",model:"test",content:[
        {type:"thinking",thinking:"private-reasoning-needle"},
        {type:"toolCall",id:"call",name:"execute",arguments:{text:"private-payload-needle"}},
        {type:"text",text:"public-needle"}
      ],stopReason:"stop",usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},timestamp:Date.now()});
      const tool = manager.appendMessage({role:"toolResult",toolCallId:"call",toolName:"execute",content:[{type:"text",text:"result-needle"}],isError:false,timestamp:Date.now()});
      manager.appendCustomMessageEntry("hidden", "hidden-custom-needle", false);
      const tail = manager.appendMessage(user("kept tail"));
      manager.appendCompaction("summary",tail,10000);
      const path = manager.getSessionFile();
      manager.setSessionFile(path);
      manager.getBranch = () => { throw new Error("full body branch must not be requested by history"); };
      const service = new HistoryService();
      const ctx = {sessionManager:manager};
      const search = (query, extra={}) => service.search({query,...extra},ctx);
      const original = (await search("original exact")).matches[0];
      assert.equal((await service.read({ref:original.ref},ctx)).text,"original exact evidence needle");
      for(const hidden of ["inactive-secret-needle","private-reasoning-needle","private-payload-needle","hidden-custom-needle"])
        assert.equal((await search(hidden)).matches.length,0);
      const priorTool = (await search("result-needle")).matches[0];
      const page = await search("needle", {limit:1});
      manager.appendCustomEntry(MANUAL_SHAKE_ENTRY,{version:MANUAL_SHAKE_VERSION,sessionId:manager.getSessionId(),assistantEntryIds:[assistant],toolResultEntryIds:[tool],shakenAt:Date.now()});
      assert.equal((await search("result-needle")).matches.length,0);
      await assert.rejects(service.read({ref:priorTool.ref},ctx),/excluded|unavailable/);
      if(page.nextCursor) assert.ok((await search("needle",{limit:1,cursor:page.nextCursor})).matches.every(m=>m.provenance.entryId!==tool));
      manager.setSessionFile(path);
      assert.equal((await search("result-needle")).matches.length,0);
      assert.equal((await search("public-needle")).matches.length,1);
      assert.equal((await service.read({ref:original.ref},ctx)).text,"original exact evidence needle");
      console.log("ok");
    `,
      ],
      { cwd: join(import.meta.dir, ".."), env: { ...process.env, PROBE_ROOT: root } },
    );
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(stdout.trim()).toBe("ok");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("old auxiliary checkpoints do not consume retrieval limits or materialize snapshot bodies", async () => {
  const root = await mkdtemp(join(tmpdir(), "bruv-aux-retrieval-"));
  try {
    const { stdout, stderr, code } = await runProcess(
      [
        process.execPath,
        "-e",
        String.raw`
      import { SessionManager } from "@earendil-works/pi-coding-agent";
      import { installDiskBackedSessionManager, getLatestDiskBackedCustomEntry } from "./src/history/session-manager.ts";
      import { DiskEntryStore } from "./src/history/disk-entry-store.ts";
      import { HistoryService } from "./src/history/service.ts";
      import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
      import { strict as assert } from "node:assert";
      import { createHash } from "node:crypto";
      import { join } from "node:path";
      installDiskBackedSessionManager();
      const file = join(process.env.PROBE_ROOT, "session.jsonl");
      const header = {type:"session", version:3, id:"aux-session", cwd:process.env.PROBE_ROOT, timestamp:"t"};
      const row = (id, parentId, rest) => ({id,parentId,timestamp:"2026-01-01T00:00:00.000Z",...rest});
      writeFileSync(file, JSON.stringify(header) + "\n" + JSON.stringify(row("user",null,{type:"message",message:{role:"user",content:"needle original evidence",timestamp:0}})) + "\n");
      let previous = "user";
      let batch = [];
      for (let i=0;i<100_005;i++) {
        const id = "aux"+i;
        batch.push(JSON.stringify(row(id,previous,{type:"custom",customType:"bruv-native-task-projection",data:{root:"correct",marker:i}})));
        previous=id;
        if (batch.length===1000) { appendFileSync(file,batch.join("\n")+"\n"); batch=[]; }
      }
      appendFileSync(file,batch.join("\n")+"\n");
      const hash = () => createHash("sha256").update(readFileSync(file)).digest("hex");
      const before=hash();
      const manager=SessionManager.open(file,process.env.PROBE_ROOT);
      assert.equal(hash(),before);
      const load = DiskEntryStore.prototype.materialize;
      const readIds=[];
      DiskEntryStore.prototype.materialize=function(meta) {readIds.push(typeof meta==="string"?meta:meta.id); return load.call(this,meta)};
      manager.getBranch=()=>{throw new Error("must not materialize branch")};
      const service = new HistoryService();
      const result=await service.search({query:"needle"},{sessionManager:manager});
      assert.equal(result.matches.length,1);
      assert.equal(result.scannedEntries,1);
      assert.equal(result.scanLimited,false);
      assert.deepEqual(readIds,["user"]);
      assert.equal((await service.read({ref:result.matches[0].ref},{sessionManager:manager})).text,"needle original evidence");
      assert.equal(getLatestDiskBackedCustomEntry(manager,"bruv-native-task-projection").data.marker,100_004);
      const oldLeaf=manager.getLeafId();
      manager.branch("user");
      const wrong=manager.appendCustomEntry("bruv-native-task-projection",{root:"wrong",marker:"wrong"});
      assert.equal(getLatestDiskBackedCustomEntry(manager,"bruv-native-task-projection",e=>e.data.root==="correct"),null);
      manager.branch(oldLeaf);
      manager.appendCustomEntry("bruv-native-task-projection",{root:"wrong",marker:"new wrong"});
      readIds.length=0;
      assert.equal(getLatestDiskBackedCustomEntry(manager,"bruv-native-task-projection",e=>e.data.root==="correct").data.marker,100_004);
      assert.equal(readIds.length,2);
      assert.ok(!readIds.includes(wrong));
      assert.equal(getLatestDiskBackedCustomEntry(manager,"absent"),null);
      assert.equal(getLatestDiskBackedCustomEntry(SessionManager.inMemory(),"absent"),undefined);
      console.log("ok");
      `,
      ],
      { cwd: join(import.meta.dir, ".."), env: { ...process.env, PROBE_ROOT: root } },
    );
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(stdout.trim()).toBe("ok");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

test("shared SDK indexes survive failed reset and branch publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "bruv-shared-index-"));
  try {
    const { stdout, stderr, code } = await runProcess(
      [
        process.execPath,
        "-e",
        String.raw`
      import { SessionManager } from "@earendil-works/pi-coding-agent";
      import { installDiskBackedSessionManager, getDiskBackedEntryMetadata } from "./src/history/session-manager.ts";
      import { writeFileSync } from "node:fs";
      import { join } from "node:path";
      import { strict as assert } from "node:assert";
      installDiskBackedSessionManager();
      const manager = SessionManager.create(process.env.PROBE_ROOT,process.env.PROBE_ROOT);
      const user=manager.appendMessage({role:"user",content:"preserved",timestamp:0});
      const custom=manager.appendCustomEntry("snapshot",{answer:42});
      const originalFile=manager.getSessionFile();
      const blocked=join(process.env.PROBE_ROOT,"blocked");
      writeFileSync(blocked,"not a directory");
      manager.sessionDir=blocked;
      for(const operation of [()=>manager.newSession(),()=>manager.createBranchedSession(custom)]) {
        assert.throws(operation);
        assert.equal(manager.getSessionFile(),originalFile);
        assert.equal(manager.getLeafId(),custom);
        assert.equal(manager.getEntryCount(),2);
        assert.equal(manager.getEntry(user).message.content,"preserved");
        assert.equal(manager.getEntry(custom).data.answer,42);
      }
      const metadata=getDiskBackedEntryMetadata(manager).find(e=>e.id===custom);
      assert.equal(metadata.timestamp,manager.getEntry(custom).timestamp);
      console.log("ok");
    `,
      ],
      { cwd: join(import.meta.dir, ".."), env: { ...process.env, PROBE_ROOT: root } },
    );
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(stdout.trim()).toBe("ok");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
