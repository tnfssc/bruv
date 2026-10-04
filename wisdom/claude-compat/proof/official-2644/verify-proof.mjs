import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const here=new URL('./',import.meta.url);
const read=async file=>JSON.parse(await fs.readFile(new URL(file,here),'utf8'));
const expected='53fbd1c78ab3a01ea91913f65dc17b9d7824f00a81564e06992a73e183054e48';
for(const name of ['command','subagent','human','native-workers','command-final']) {
 const r=await read(name+'/result.json');
 assert.equal(r.passed,true,name);
 assert.equal(r.t3BinarySha256,expected,name);
 assert.equal(r.t3Version,'t3 v0.0.46-nightly.20261004.2644');
 assert.notEqual(r.diagnosisOnly,true,name);
 const invocation=await read(name+'/invocation.json');
 assert.equal(invocation.connectorSha256,'fa50fecf8f9cf24c939206c269cb56c918d1c1b51f82b65f8f611846888dbdf6');
 assert.equal(invocation.normalRuntimeSha256,'5da33808892cf3c28ea9816a2e2271c183ddbcd792f7a2893483a40fcde13965');
}
for(const name of ['command','command-final'])assert.equal((await read(name+'/model-projection.json')).length,0);
const s=await read('subagent/result.json');
assert.equal(s.sameRootChildReturnReply,true);assert.equal(s.consumedPromptOwnership,true);
assert.equal(s.modelCompletionWakeCount,1);assert.equal(s.killedJobCompletionWakeCount,1);
const idle=await read('subagent/idle-evidence.json');
assert.equal(idle.sameRootChildReturnReply,true);assert.equal(idle.submitVisible,true);assert.equal(idle.stopVisible,false);
const h=await read('human/result.json');
assert.equal(h.answeredQuestionCallbacks,1);assert.equal(h.savedAnswerContinuationCount,1);
// This separate official UI defect is retained, not treated as fixed.
assert.equal(h.staleApprovalAfterStop,true);
const c=await read('source-comparison.json');
assert.equal(c.effectPatchByteIdentical,true);
assert.deepEqual(c.sdkStanzas.previous,c.sdkStanzas.current);
assert.equal(c.queueWaiterRecheckInOfficial,false);
console.log('PASS unchanged official 2644 bounded proof consistency');
