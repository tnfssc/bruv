import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "./helpers";

// The history adapter patches SDK prototypes. Keep this test's owner in its own process.
const scenario = String.raw`
import { AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { DiskEntryStore } from "./src/history/disk-entry-store.ts";
import { installDiskBackedSessionManager, disposeDiskBackedSessionManager } from "./src/history/session-manager.ts";
import { renderCompactFooter, renderDetailedFooter } from "./src/ui/footer.ts";
import assert from "node:assert/strict";
const originalUsage = AgentSession.prototype.getContextUsage;
let computations = 0;
AgentSession.prototype.getContextUsage = function() { computations++; return originalUsage.call(this); };
installDiskBackedSessionManager();
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
const expected = () => originalUsage.call(host);
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
manager.appendMessage(assistant(3000)); check("append");
const leaf=manager.getLeafId();
manager.appendCustomEntry("extra",{}); manager.branch(leaf); check("append then branch back to same leaf");
manager.branch(first); check("branch");
manager.appendContextEdit(first,{content:"edited request"}); check("context edit");
manager.appendCompaction("summary",first,9000); check("compaction");
assert.equal(read().tokens,null,"post-compaction context stays unknown until valid assistant usage");
manager.appendMessage(assistant(100)); check("post-compaction assistant");
// The selected extension model is unchanged. Its hidden routed model limit changes.
window=400000; check("routed model window"); assert.equal(read().contextWindow,400000);
manager.newSession(); check("new session");
manager.appendMessage(assistant(2000)); check("new-session append");
const other=SessionManager.create(process.env.ROOT,process.env.ROOT); other.appendMessage(assistant(5000));
const otherFile=other.getSessionFile(); disposeDiskBackedSessionManager(other);
manager.setSessionFile(otherFile); check("session switch");
const memory=SessionManager.inMemory(); memory.appendMessage(assistant(700));
const memoryHost={sessionManager:memory,_limitsModel:()=>({contextWindow:200000})};
assert.deepEqual(AgentSession.prototype.getContextUsage.call(memoryHost),originalUsage.call(memoryHost),"unowned in-memory managers retain native behavior");
disposeDiskBackedSessionManager(manager);
console.log(JSON.stringify({warmFooterMaterializations:0,checks:"append, branch-back, branch, edits, compaction, routed limits, new session, switch, in-memory parity"}));
`;

test("whole footer reuses numeric context usage until real history or routed limits change", async () => {
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
