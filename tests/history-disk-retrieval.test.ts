import { join } from "node:path";
import { run as runProcess } from "./helpers";
import { expect, test } from "bun:test";
import { createHistoryFixture, runHistoryFixture } from "./helpers/history-fixture";

test("disk history retrieval traverses metadata, preserving originals, branches, refs and live exclusions", async () => {
  const fixture = createHistoryFixture("bruv-disk-retrieval-");
  const { stdout, stderr, code } = await runHistoryFixture("history-disk-retrieval.ts", fixture);
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
  expect(stdout.trim()).toBe("ok");
});

test("old auxiliary checkpoints do not consume retrieval limits or materialize snapshot bodies", async () => {
  const fixture = createHistoryFixture("bruv-aux-retrieval-");
  const { root } = fixture;
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
    { cwd: join(import.meta.dir, ".."), env: fixture.env },
  );
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
  expect(stdout.trim()).toBe("ok");
}, 30_000);

test("shared SDK indexes survive failed reset and branch publication", async () => {
  const fixture = createHistoryFixture("bruv-shared-index-");
  const { root } = fixture;
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
    { cwd: join(import.meta.dir, ".."), env: fixture.env },
  );
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
  expect(stdout.trim()).toBe("ok");
});
