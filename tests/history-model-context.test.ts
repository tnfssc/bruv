import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "./helpers";

const scenario = String.raw`
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, openSync, writeSync, closeSync } from "node:fs";
import { join } from "node:path";
import { getModel } from "@earendil-works/pi-ai/compat";
import { AgentSession, createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { DiskEntryStore } from "./src/history/disk-entry-store.ts";
import { installDiskBackedSessionManager, disposeDiskBackedSessionManager } from "./src/history/session-manager.ts";
const root=process.env.ROOT;
const adapted=process.env.ADAPTED === "1";
const model=getModel("openai","gpt-4o");
const source=SessionManager.inMemory(root);
const system=source.appendMessage({role:"system",content:"saved system",timestamp:1});
source.appendThinkingLevelChange("high");
source.appendModelChange(model.provider,model.id);
const user=source.appendMessage({role:"user",content:"original user",timestamp:2});
const usage=(input)=>({input,output:10,cacheRead:20,cacheWrite:30,totalTokens:input+60,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}});
const assistant=(input,text="assistant")=>({role:"assistant",content:[{type:"text",text}],provider:model.provider,model:model.id,api:model.api,usage:usage(input),stopReason:"stop",timestamp:3});
const keptMarker=source.appendCustomEntry("bruv-t3-checkpoint",{originalBoundary:true});
const response=source.appendMessage(assistant(123));
const custom=source.appendCustomMessageEntry("fixture-visible","original custom",true);
const tool=source.appendMessage({role:"toolResult",toolCallId:"call",toolName:"read",content:[{type:"text",text:"original tool"}],isError:false,timestamp:4});
source.appendContextEdit(user,{content:"edited user"});
source.appendContextEdit(tool,{content:"edited tool"});
source.appendContextEdit(custom,{content:"edited custom"});
const edited=source.appendContextEdit(response,null);
source.appendCustomEntry("pi.virtual-model-state",{provider:"fixture-router",modelId:"routed",state:{turn:7}});
const router=source.appendCustomEntry("pi.virtual-model-state",{provider:"other-router",modelId:"routed",state:{turn:99}});
const compact=source.appendCompaction("checkpoint one",keptMarker,500);
const unknown=source.appendMessage({role:"user",content:"after checkpoint",timestamp:5});
source.appendMessage(assistant(888,"fresh response"));
const known=source.appendMessage({role:"user",content:"trailing estimate",timestamp:6});
source.appendThinkingLevelChange("medium");
source.appendModelChange(model.provider,"gpt-4o-mini");
const repeated=source.appendCompaction("checkpoint two",compact,250);
source.branch(user);
const sibling=source.appendMessage(assistant(333,"sibling response"));
source.branch(unknown);
source.appendModelChange("fixture-router","routed");
source.appendMessage(assistant(444,"physical routed response"));
const failedRoute=source.appendMessage({...assistant(0),provider:"fixture-router",model:"routed",api:"pi-virtual",stopReason:"error"});
const entries=source.getEntries();
const header={...source.getHeader(),id:"model-context-fixture"};
const path=join(root,"fixture.jsonl");
const fd=openSync(path,"w");
writeSync(fd,JSON.stringify(header)+"\n");
const tails=new Map();
const auxTypes=["bruv-t3-checkpoint","bruv-cache-countdown","bruv-task-row-hint","bruv-instruction-state"];
let auxiliary=0;
for (let i=0;i<entries.length;i++) {
  const entry={...entries[i],parentId:tails.get(entries[i].parentId) ?? entries[i].parentId};
  writeSync(fd,JSON.stringify(entry)+"\n");
  let tail=entry.id;
  if (adapted) {
    const count=i===0 ? 100000-(entries.length-1)*1000 : 1000;
    let chunk="";
    for (let n=0;n<count;n++) {
      const id="aux-"+(auxiliary++);
      chunk+=JSON.stringify({type:"custom",id,parentId:tail,timestamp:entry.timestamp,customType:auxTypes[n%4],data:{checkpoint:"opaque auxiliary body",rows:[{body:"never parsed"}]}})+"\n";
      tail=id;
    }
    writeSync(fd,chunk);
  }
  tails.set(entry.id,tail);
}
closeSync(fd);
const hash=()=>createHash("sha256").update(readFileSync(path)).digest("hex");
const before=hash();
let materializations=0;
const materialize=DiskEntryStore.prototype.materialize;
if (adapted) {
  installDiskBackedSessionManager();
  DiskEntryStore.prototype.materialize=function(meta) {
    assert(!(meta.type === "custom" && auxTypes.includes(meta.customType)),"auxiliary original body must never be parsed by runtime context");
    materializations++;
    return materialize.call(this,meta);
  };
}
const manager=SessionManager.open(path);
manager.branch(tails.get(edited));
const runtime=await ModelRuntime.create({authPath:join(root,"auth.json"),modelsPath:null,refreshOnCreate:false});
runtime.hasConfiguredAuth=()=>true;
const settings=SettingsManager.inMemory({compaction:{enabled:true,reserveTokens:1000,keepRecentTokens:100},retry:{enabled:false}});
let preparation;
const loader=new DefaultResourceLoader({cwd:root,agentDir:root,noExtensions:true,noSkills:true,noThemes:true,noPromptTemplates:true,extensionFactories:[{name:"fixture",factory:(pi)=>{
  pi.on("session_before_compact",(event)=>{ preparation=event.preparation; return {cancel:true}; });
}}]});
await loader.reload();
const {session}=await createAgentSession({cwd:root,agentDir:root,sessionManager:manager,settingsManager:settings,resourceLoader:loader,modelRuntime:runtime,noTools:true});
assert(session instanceof AgentSession);
assert.equal(session.model.id,model.id);
assert.equal(manager.buildSessionProjection().thinkingLevel,"high");
assert.equal(session.agent.state.thinkingLevel,"off");
assert.equal(hash(),before,"startup preserves exact journal bytes");
const simplify=(messages)=>messages.map(({role,content})=>({role,content}));
const result=[];
for (const [name,leaf] of [["original",user],["edits",edited],["unknown",unknown],["known",known],["repeated",repeated],["sibling",sibling]]) {
  manager.branch(tails.get(leaf));
  const projection=manager.buildSessionProjection();
  const request={model:session.model,thinkingLevel:session.agent.state.thinkingLevel,context:{messages:[],tools:[]}};
  const prepared=await session.agent.prepareRequest(request);
  const next=await session._compactBeforeNextAssistantResponse(request.context);
  assert.deepEqual(simplify(prepared.context.messages),simplify(projection.messages));
  assert.deepEqual(simplify(next.messages),simplify(projection.messages));
  const preview=session._createBoundaryPreviewManager([]).buildSessionProjection();
  assert.deepEqual(simplify(preview.messages),simplify(projection.messages),"real SDK boundary preview preserves context");
  assert.equal(preview.thinkingLevel,projection.thinkingLevel);
  assert.deepEqual(preview.model,projection.model);
  const compactPreview=session._createBoundaryPreviewManager([{type:"compaction",summary:"boundary summary",firstKeptEntryId:null}]).buildSessionProjection();
  assert(JSON.stringify(compactPreview.messages).includes("boundary summary"));
  const contextEntries=manager.buildContextEntries();
  if(adapted) assert.equal(contextEntries.some((entry)=>entry.type==="custom" && auxTypes.includes(entry.customType)),false);
  const compacted=name==="unknown" || name==="known" || name==="repeated";
  assert.equal(contextEntries[0]?.type==="compaction",compacted);
  assert.equal(projection.entries[0]?.sourceEntry.type==="compaction",compacted);
  result.push({name,messages:simplify(projection.messages),thinkingLevel:projection.thinkingLevel,model:projection.model,usage:session.getContextUsage()});
}
assert.equal(result.find((row)=>row.name==="unknown").usage.tokens,null);
assert.equal(result.find((row)=>row.name==="repeated").usage.tokens,null);
assert(result.find((row)=>row.name==="known").usage.tokens > 888);
manager.branch(tails.get(repeated));
const {session:restored}=await createAgentSession({cwd:root,agentDir:root,sessionManager:manager,settingsManager:settings,resourceLoader:loader,modelRuntime:runtime,noTools:true});
assert.equal(restored.model.id,"gpt-4o-mini","startup restores settings across summarized history");
assert.equal(manager.buildSessionProjection().thinkingLevel,"medium");
restored.dispose();
const virtual={...model,provider:"fixture-router",id:"routed",api:"pi-virtual"};
const catalog=runtime.getModel.bind(runtime);
runtime.getModel=(provider,id)=>provider===virtual.provider && id===virtual.id ? virtual : catalog(provider,id);
manager.branch(tails.get(failedRoute));
const {session:virtualRestored}=await createAgentSession({cwd:root,agentDir:root,sessionManager:manager,settingsManager:settings,resourceLoader:loader,modelRuntime:runtime,noTools:true});
assert.equal(virtualRestored.model.api,"pi-virtual","virtual selection survives physical and failed routing responses");
virtualRestored.dispose();
await session.bindExtensions({mode:"print"});
manager.branch(tails.get(known));
// Force a cut with a tiny keep window, cancel before any provider request.
const compactionSettings=settings.getCompactionSettings.bind(settings);
settings.getCompactionSettings=(model)=>({...compactionSettings(model),keepRecentTokens:1});
await assert.rejects(()=>session.compact(),/Compaction cancelled/);
assert(preparation,"actual SDK compaction reaches the extension with filtered, relinked context");
assert.equal(preparation.tokensBefore,result.find((row)=>row.name==="known").usage.tokens);
manager.branch(tails.get(router));
session.agent.state.model=virtual;
runtime.resolveModel=async (_model,_messages,options)=>{
  assert.deepEqual(options.state,{turn:7},"virtual routing restores only the latest matching scope");
  return {model,thinkingLevel:"off"};
};
const routed=await session.agent.prepareRequest({model:session.agent.state.model,thinkingLevel:"off",context:{messages:[],tools:[]}});
assert.equal(routed.model.id,model.id);
assert.equal(hash(),before,"context reads never rewrite originals");
assert.equal(manager.getEntry(user).message.content,"original user");
assert.equal(manager.getEntry(tool).message.content[0].text,"original tool");
assert.equal(manager.getEntry(custom).content,"original custom");
const originalBytes=readFileSync(path);
manager.branch(tails.get(edited));
manager.appendContextEdit(tool,{content:"late tool edit"});
assert(JSON.stringify(manager.buildSessionProjection().messages).includes("late tool edit"));
assert.equal(manager.getEntry(tool).message.content[0].text,"original tool");
manager.branch(tails.get(known));
session._commitBoundaryDrafts([{type:"compaction",summary:"committed boundary",firstKeptEntryId:null}]);
assert(JSON.stringify(manager.buildSessionProjection().messages).includes("committed boundary"));
assert.deepEqual(readFileSync(path).subarray(0,originalBytes.length),originalBytes,"committed drafts append without changing any original byte");
if(adapted) assert(materializations<800,"body reads scale with real context, not checkpoint rows");
// Explicit original-history access remains lossless; only runtime reads above
// are forbidden from loading these bodies.
if(adapted) DiskEntryStore.prototype.materialize=materialize;
assert.deepEqual(manager.getEntry(keptMarker).data,{originalBoundary:true});
session.dispose();
if(adapted) disposeDiskBackedSessionManager(manager);
console.log(JSON.stringify({result,auxiliary,materializations}));
`;

test("100,000 auxiliary checkpoints stay opaque in actual SDK startup and model preparation", async () => {
  const roots = await Promise.all(
    ["native", "disk"].map((name) => mkdtemp(join(tmpdir(), "bruv-model-context-" + name + "-"))),
  );
  try {
    const results = await Promise.all(
      roots.map(async (root, index) => {
        const result = await run([process.execPath, "-e", scenario], {
          cwd: resolve(import.meta.dir, ".."),
          env: { ...process.env, ROOT: root, ADAPTED: String(index) },
        });
        if (result.code !== 0) throw new Error(result.stderr);
        return JSON.parse(result.stdout.trim().split("\n").at(-1)!);
      }),
    );
    expect(results[1].result).toEqual(results[0].result);
    expect(results[1].auxiliary).toBe(100000);
    expect(results[1].materializations).toBeLessThan(800);
  } finally {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  }
}, 30000);
