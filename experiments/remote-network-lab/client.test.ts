import {test,expect} from 'bun:test';
import {Client} from './client';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('offline replica survives missing owner; cursor and event order validated before persistence',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'lab-test-'));const file=join(dir,'replica.json');
 const original=globalThis.fetch;
 try{
  globalThis.fetch=(async()=>new Response(JSON.stringify({v:1,events:[{v:1,seq:1,id:'t',kind:'question',text:'Mac input?',at:1}],next:1,more:false}))) as typeof fetch;
  const c=new Client(file);await c.catchup(1);
  globalThis.fetch=(async()=>{throw Error('offline')}) as typeof fetch;
  expect(new Client(file).show().tasks.t.status).toBe('waiting');
  expect(new Client(file).show().transcript[0]).toContain('Mac input?');
  globalThis.fetch=(async()=>new Response(JSON.stringify({v:1,events:[{v:1,seq:3,id:'t',kind:'done',text:'bad',at:2}],next:2,more:false}))) as typeof fetch;
  expect(c.catchup(1)).rejects.toThrow('invalid cursor page');
  expect(new Client(file).replica.cursor).toBe(1);
 }finally{globalThis.fetch=original;rmSync(dir,{recursive:true,force:true})}
});
