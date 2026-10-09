import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const read=async name=>JSON.parse(await fs.readFile(new URL(name,import.meta.url),'utf8'));
const provenance=await read('provenance.json');
const baseline=await read('observed/baseline/wire.json');
assert.ok(baseline.some(r=>r.main&&r.type==='result'&&r.is_error===false&&r.result==='ADMISSION_CONFIRMED_REAL'));
assert.ok(baseline.some(r=>r.main&&r.kind==='stderr'&&r.value.includes('ConnectionRefused')));
assert.ok(baseline.some(r=>r.main&&r.kind==='exit'&&r.value===1));
for(const [name,turns,calls] of [['simple',1,1],['two-mcp',2,4]]){
 const result=await read(`observed/${name}/result.json`),wire=await read(`observed/${name}/wire.json`);
 assert.equal(result.connectorSha256,provenance.fixedBinarySha256);
 assert.equal(result.t3Sha256,provenance.t3Sha256);assert.equal(result.t3Sha256After,provenance.t3Sha256);
 assert.equal(result.modelCalls,calls);assert.equal(result.reply,true);assert.equal(result.idle,true);
 assert.equal(result.connectorExit,0);assert.equal(result.connectorStderrLines,0);
 assert.ok(wire.filter(r=>r.kind==='exit').every(r=>r.value===0));
 assert.equal(wire.filter(r=>r.main&&r.type==='result'&&r.is_error===false&&r.result==='ADMISSION_CONFIRMED_REAL').length,turns);
 assert.equal(wire.filter(r=>r.main&&r.type==='system'&&r.subtype==='session_state_changed'&&r.state==='idle').length,turns);
 if(turns===2){assert.equal(result.secondReply,true);const use=wire.filter(r=>r.main).flatMap(r=>r.tools??[]).filter(t=>t.type==='tool_use');assert.equal(use.length,2);assert.ok(use.every(t=>t.name.includes('orchestrator_capabilities')));}
}
console.log('Observed baseline refusal/exit1 and final simple + two real MCP turns/exit0 verified. Bounded Linux proof only.');
