// Isolated dependency regression, NOT native acceptance or SDK evidence.
// Inject a producer at the observed gap between an empty take and callback registration.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const root=path.resolve(process.argv[2]);
assert.equal(JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version,'4.0.0-rc.115');
const load=name=>import(pathToFileURL(path.join(root,'dist',`${name}.js`)).href);
const Effect=await load('Effect'), Scheduler=await load('Scheduler'), Queue=await load('Queue');
const fixedPath=path.join(root,'dist','Queue.waiter-recheck.mjs');
const source=await fs.readFile(path.join(root,'dist/Queue.js'),'utf8');
const needle='self.state.takers.add(resume);';
assert.equal(source.split(needle).length,2);
await fs.writeFile(fixedPath,source.replace(needle,`${needle}\n        if (self.messages.length > 0 || self.state.offers.size > 0) scheduleReleaseTaker(self);`));
const Fixed=await import(pathToFileURL(fixedPath).href);
async function reproduce(Q) {
 const q=await Effect.runPromise(Q.unbounded());
 const signal={type:'event',event:{type:'turn.terminal',status:'completed'}};
 let empty=false,injected=false,length=q.messages.length;
 Object.defineProperty(q.messages,'length',{get(){if(length===0)empty=true;return length},set(n){length=n}});
 const scheduler=new Scheduler.MixedScheduler();
 scheduler.shouldYield=()=>{
  if(empty&&!injected&&q.state.takers.size===0){injected=true;Q.offerUnsafe(q,signal);}
  return false;
 };
 const take=Effect.runPromise(Q.takeAll(q).pipe(Effect.provideService(Scheduler.Scheduler,scheduler)));
 const guarded=take.then(value=>({delivered:true,value}),error=>({delivered:false,error:String(error)}));
 let timeout;
 const result=await Promise.race([guarded,new Promise(resolve=>{timeout=setTimeout(()=>resolve({delivered:false,timeout:true}),250)})]);
 clearTimeout(timeout);
 if(result.delivered){assert.equal(result.value.length,1);assert.equal(result.value[0],signal);}
 const state={injected,delivered:result.delivered,messages:q.messages.length,takers:q.state.takers?.size,scheduled:q.scheduleRunning};
 await Effect.runPromise(Q.shutdown(q));await guarded;
 return state;
}
try {
 const original=await reproduce(Queue),fixed=await reproduce(Fixed);
 assert.equal(original.injected,true);assert.equal(original.delivered,false);
 assert.equal(original.messages,1);assert.equal(original.takers,1);assert.equal(original.scheduled,false);
 assert.equal(fixed.injected,true);assert.equal(fixed.delivered,true);assert.equal(fixed.messages,0);
 console.log(JSON.stringify({effectVersion:'4.0.0-rc.115',isolatedDependencyRegression:true,original,fixed},null,2));
} finally {await fs.rm(fixedPath);}
