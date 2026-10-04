import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "./helpers";

// The history adapter patches SDK prototypes. Keep this test's owner in its own process.
const scenario = String.raw`
import { AgentSession, SessionManager, buildSessionProjection } from "@earendil-works/pi-coding-agent";
import { DiskEntryStore } from "./src/history/disk-entry-store.ts";
import { installDiskBackedSessionManager, disposeDiskBackedSessionManager } from "./src/history/session-manager.ts";
import { renderCompactFooter, renderDetailedFooter } from "./src/ui/footer.ts";
import { installShakeAccountingAdapter } from "./src/agent/manual-shake.ts";
import { MANUAL_SHAKE_ENTRY, InvalidShakeRecordError } from "./src/history/shake-record.ts";
import assert from "node:assert/strict";
const originalUsage = AgentSession.prototype.getContextUsage;
let computations = 0;
AgentSession.prototype.getContextUsage = function() { computations++; return originalUsage.call(this); };
installDiskBackedSessionManager();
const diskUsage = AgentSession.prototype.getContextUsage;
// Match CLI order: the shake accounting wrapper is installed after disk history.
installShakeAccountingAdapter();
const manager = SessionManager.create(process.env.ROOT, process.env.ROOT);
const usage = { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0, totalTokens: 1100, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const assistant = (input) => ({role:"assistant",content:[{type:"text",text:"Long saved paragraph. ".repeat(3000)}],api:"openai-completions",provider:"fixture",model:"model",usage:{...usage,input},stopReason:"stop",timestamp:1});
const first = manager.appendMessage({role:"user",content:"Original request",timestamp:1});
for(let i=0;i<80;i++) manager.appendMessage(assistant(1000+i));
let window = 200000;
const host = { sessionManager: manager, _limitsModel: () => ({ contextWindow: window }) };
const read = () => AgentSession.prototype.getContextUsage.call(host);
let materializations = 0;
const materialize = DiskEntryStore.prototype.materialize;
DiskEntryStore.prototype.materialize = function(...args) { materializations++; return materialize.apply(this,args); };
// Use the SDK's public projection builder and full native branch, not the
// cache-seeding manager method, for an independent estimator comparison.
const expected = () => originalUsage.call({
  _limitsModel: host._limitsModel,
  sessionManager: {
    buildSessionProjection: () => buildSessionProjection(manager.getEntries(), manager.getLeafId()),
    getBranch: () => manager.getBranch(),
  },
});
const theme = {fg: (_color,text) => text};
const ctx = {mode:"tui",sessionManager:manager,model:{provider:"fixture",id:"virtual-model",contextWindow:200000},modelRegistry:{isUsingOAuth:()=>false},getContextUsage:read,ui:{theme}};
const data = {getGitBranch:()=>undefined,getAvailableProviderCount:()=>1,getExtensionStatuses:()=>new Map()};
read();
materializations=0;
for(let i=0;i<20;i++) { renderCompactFooter(ctx,data,theme,100); renderDetailedFooter(ctx,data,theme,100); }
// First footer render separately totals costs; warm that small history summary too.
materializations=0;
for(let i=0;i<20;i++) { renderCompactFooter(ctx,data,theme,100); renderDetailedFooter(ctx,data,theme,100); }
assert.equal(materializations,0,"warm whole-footer renders must not materialize any historical bodies");
const now=Date.now; Date.now=()=>now()+10000; read(); Date.now=now;
assert.equal(materializations,0,"elapsed wall time must not periodically stall a repaint");
const check = (label) => { materializations=0; computations=0; const actual=read(); assert.equal(computations,1,label+" invalidates"); const want=expected(); assert.deepEqual(actual,want,label+" matches uncached SDK"); materializations=0; assert.deepEqual(read(),want); assert.equal(materializations,0,label+" is cached again"); assert.equal(computations,1,label+" does not recompute"); };
manager.appendMessage({role:"user",content:"One more request",timestamp:2});
materializations=0; computations=0;
const appendedUserUsage=read();
assert.equal(materializations,1,"appending a user reads only that new message");
assert.equal(computations,0,"appending a user reuses the unchanged prefix");
assert.deepEqual(appendedUserUsage,expected(),"incremental user estimate matches native SDK");
manager.appendMessage(assistant(3000)); check("append"); renderCompactFooter(ctx,data,theme,100); renderDetailedFooter(ctx,data,theme,100);
// Exercise the pinned SDK's actual pre-HTTP projection hook, including the
// system+user append that cannot use the guarded single-user shortcut.
const requestHost = {
  sessionManager: manager,
  agent: { state: { model: { provider: "fixture", id: "model" }, tools: [], thinkingLevel: "off" } },
};
AgentSession.prototype._installAgentRequestProjection.call(requestHost);
manager.appendMessage({role:"system",content:"Updated system instructions",timestamp:2});
manager.appendMessage({role:"user",content:"Actual submitted request",timestamp:2});
materializations=0; computations=0;
const request = await requestHost.agent.prepareRequest({context:{messages:[],tools:[]}},new AbortController().signal);
assert.ok(request.context.messages.some(message=>message.role==="user" && message.content==="Actual submitted request"));
assert.ok(materializations>1,"required request projection materializes its context");
assert.equal(computations,1,"request projection calculates its numeric estimate once");
const submittedWant=expected();
materializations=0;
assert.deepEqual(read(),submittedWant,"request-seeded usage matches native SDK");
renderCompactFooter(ctx,data,theme,100); renderDetailedFooter(ctx,data,theme,100);
assert.equal(materializations,0,"first whole-footer reads after system+user request prep load no bodies");
assert.equal(computations,1,"first whole-footer reads reuse the required projection estimate");
const checkProjection = (label) => {
  computations=0; manager.buildSessionProjection();
  assert.equal(computations,1,label+" required projection estimates once");
  const want=expected(); materializations=0;
  assert.deepEqual(diskUsage.call(host),want,label+" request-seeded usage matches native SDK");
  assert.equal(materializations,0,label+" seeded disk read loads no bodies");
  // Shake freshness may inspect the changed branch once; it remains the
  // outer owner of marker validation rather than part of this numeric cache.
  assert.deepEqual(read(),want,label+" shake wrapper preserves SDK usage");
  materializations=0; assert.deepEqual(read(),want);
  assert.equal(materializations,0,label+" warm wrapped read loads no bodies");
  assert.equal(computations,1,label+" cached read does not estimate again");
};
const leaf=manager.getLeafId();
manager.appendCustomEntry("bruv-cache-call",{}); materializations=0; computations=0; read(); renderCompactFooter(ctx,data,theme,100); renderDetailedFooter(ctx,data,theme,100); assert.equal(materializations,0,"bookkeeping does not read historical bodies"); assert.equal(computations,0,"bookkeeping does not change context usage");
manager.branch(leaf); read(); assert.equal(materializations,0,"returning to the same context keeps cached usage");
const priced = assistant(4000); priced.usage = {...priced.usage,cost:{...priced.usage.cost,total:1.25}};
manager.appendMessage(priced);
assert.ok(renderCompactFooter(ctx,data,theme,100).join(" ").includes("$1.250"),"new response cost invalidates the total");
manager.appendCustomEntry("bruv-compaction-attempt",{usage:{...usage,cost:{...usage.cost,total:0.25}}});
assert.ok(renderCompactFooter(ctx,data,theme,100).join(" ").includes("$1.500"),"recorded compaction cost invalidates the total");
manager.branch(first); checkProjection("branch");
manager.appendContextEdit(first,{content:"edited request"}); checkProjection("context edit");
manager.appendMessage({role:"user",content:[{type:"text",text:"After edit"},{type:"image",data:"",mimeType:"image/png"}],timestamp:3});
assert.deepEqual(read(),expected(),"user estimate after context edit includes images and matches native SDK");
manager.appendCompaction("summary",first,9000); checkProjection("compaction");
assert.equal(read().tokens,null,"post-compaction context stays unknown until valid assistant usage");
manager.appendMessage({role:"user",content:"Request after compaction",timestamp:4});
materializations=0; computations=0;
assert.equal(read().tokens,null,"trailing user preserves unknown post-compaction usage");
assert.equal(materializations,0,"unknown trailing-user estimate reads no bodies");
assert.equal(computations,0,"unknown trailing-user estimate does not recompute");
checkProjection("post-compaction user");
manager.appendMessage(assistant(100)); checkProjection("post-compaction assistant");
const beforeShake = manager.getLeafId();
manager.appendCustomEntry(MANUAL_SHAKE_ENTRY,{version:1,sessionId:manager.getSessionId(),assistantEntryIds:[],toolResultEntryIds:[],shakenAt:1});
manager.buildSessionProjection();
assert.equal(read().tokens,null,"shake hides stale usage even with a request-seeded estimate");
materializations=0; read(); assert.equal(materializations,0,"warm shake-accounting wrapper must not read bodies either");
manager.appendMessage({...assistant(0),stopReason:"error"}); assert.equal(read().tokens,null,"an error does not restore fresh usage");
manager.appendMessage(assistant(100)); check("fresh usage after shake");
const validLeaf=manager.getLeafId();
manager.appendCustomEntry(MANUAL_SHAKE_ENTRY,{version:99});
manager.buildSessionProjection();
assert.throws(read,InvalidShakeRecordError,"request-seeded usage cannot bypass invalid shake validation");
manager.branch(validLeaf); check("branch away from invalid shake");
manager.branch(beforeShake); check("branch before shake");
// The selected extension model is unchanged. Its hidden routed model limit changes.
renderCompactFooter(ctx,data,theme,100); renderDetailedFooter(ctx,data,theme,100);
const beforeLimits=read();
window=400000;
const routedWant=expected(); materializations=0; computations=0;
assert.deepEqual(read(),routedWant,"routed limits match native SDK");
assert.equal(read().tokens,beforeLimits.tokens);
assert.equal(read().percent,beforeLimits.percent/2);
assert.equal(read().contextWindow,400000);
renderCompactFooter(ctx,data,theme,100); renderDetailedFooter(ctx,data,theme,100);
assert.equal(materializations,0,"routed limits change percent without reloading bodies");
assert.equal(computations,0,"routed limits do not recalculate tokens");
window=0; assert.equal(read(),undefined,"zero limits retain native undefined behavior");
assert.equal(materializations,0,"unavailable limits do not load bodies");
window=400000;
manager.newSession(); checkProjection("new session");
manager.appendMessage(assistant(2000)); checkProjection("new-session append");
const other=SessionManager.create(process.env.ROOT,process.env.ROOT); other.appendMessage(assistant(5000));
const otherFile=other.getSessionFile(); disposeDiskBackedSessionManager(other);
manager.setSessionFile(otherFile); checkProjection("session switch");
const memory=SessionManager.inMemory(); memory.appendMessage(assistant(700));
const memoryHost={sessionManager:memory,_limitsModel:()=>({contextWindow:200000})};
assert.deepEqual(AgentSession.prototype.getContextUsage.call(memoryHost),originalUsage.call(memoryHost),"unowned in-memory managers retain native behavior");
disposeDiskBackedSessionManager(manager);
console.log(JSON.stringify({warmFooterMaterializations:0,checks:"append, branch-back, branch, edits, compaction, routed limits, new session, switch, in-memory parity"}));
`;

test("request projection seeds numeric usage for the whole footer independent of routed limits", async () => {
  const root = await mkdtemp(join(tmpdir(), "bruv-context-cache-"));
  try {
    const result = await run([process.execPath, "-e", scenario], {
      cwd: resolve(import.meta.dir, ".."),
      env: { ...process.env, ROOT: root },
    });
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).warmFooterMaterializations).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
