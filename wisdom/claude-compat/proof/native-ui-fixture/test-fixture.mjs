import assert from 'node:assert/strict';
import {spawnSync,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const executable=fileURLToPath(new URL('./fixture.mjs',import.meta.url));
const env={PATH:'/usr/bin:/bin'};
const denied=spawnSync(executable,['auth','status'],{env,encoding:'utf8'});
assert.equal(denied.status,1);assert.equal(JSON.parse(denied.stdout).loggedIn,false);
const local=spawnSync(executable,['auth','status'],{env:{...env,SPIKE_PROTOCOL_ONLY:'1'},encoding:'utf8'});
assert.equal(local.status,0);assert.deepEqual(JSON.parse(local.stdout),{loggedIn:true,authMethod:'local-research-fixture',fixture:true,providerCalls:0});
const direct=spawnSync(executable,[],{env,encoding:'utf8',input:JSON.stringify({type:'user',message:{role:'user',content:'not opted in'}})+'\n'});
assert.equal(direct.status,1);assert.equal(direct.stdout,'');assert.match(direct.stderr,/Explicit local fixture mode required/);
async function initialize(fixture){
 const child=spawn(executable,[],{env:{...env,...(fixture?{SPIKE_PROTOCOL_ONLY:'1'}:{})}});
 let text='';child.stdout.on('data',b=>{text+=b});
 child.stdin.write(JSON.stringify({type:'control_request',request_id:'test-init',request:{subtype:'initialize'}})+'\n');
 for(let i=0;i<100&&!text;i++)await new Promise(r=>setTimeout(r,10));
 child.stdin.end();await new Promise(r=>child.once('exit',r));
 return JSON.parse(text.trim());
}
assert.equal((await initialize(false)).response.subtype,'error');
const init=(await initialize(true)).response;
assert.equal(init.subtype,'success');assert.equal('account' in init.response,false);
console.log('PASS default refusal; explicit local readiness; initialize; no fabricated account fields');
