import { mkdir, writeFile } from 'node:fs/promises';
// One actual die RPC process owns the loop; HTTP viewers only observe it.
const root='/work', token=process.env.PROBE_TOKEN!;
await mkdir(root+'/agent',{recursive:true});
await writeFile(root+'/marker.txt','LINUX-CONTAINER-MARKER\n');
const events:any[]=[], turns:number[]=[]; let phase='ready', detachedAt=-1, error='';
const started=Date.now();
const sse=(delta:object,finish:string)=>{
 const chunk=(d:object,f:string|null)=>'data: '+JSON.stringify({id:'probe',object:'chat.completion.chunk',created:0,model:'loopback-model',choices:[{index:0,delta:d,finish_reason:f}]})+'\n\n';
 return new Response(chunk(delta,null)+chunk({},finish)+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
};
const server=Bun.serve({hostname:'0.0.0.0',port:8080,async fetch(req){
 const path=new URL(req.url).pathname;
 if(path==='/v1/chat/completions'){
  const body=await req.json(); turns.push(Date.now()-started);
  const call=(id:string,code:string)=>sse({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name:'execute',arguments:JSON.stringify({code})}}]},'tool_calls');
  if(turns.length===1) return call('first','const fs = await import("node:fs/promises"); const p = await import("node:path"); const f = p.join(process.cwd(), "marker.txt"); const stat = await fs.stat(f); const text = await Bun.file(f).text(); const sh = await shell("pwd; sleep 3; printf FIRST_DONE", {waitSeconds: 5}); console.log(JSON.stringify({ cwd: process.cwd(), marker: text.trim(), file: stat.isFile(), sh }));');
  if(turns.length===2){ if(!JSON.stringify(body).includes('FIRST_DONE')||!JSON.stringify(body).includes('LINUX-CONTAINER-MARKER')){error='first result missing';return new Response(error,{status:500})} return call('second','console.log("SECOND_DONE:" + (await Bun.file("marker.txt").text()).trim())'); }
  if(turns.length===3&&JSON.stringify(body).includes('SECOND_DONE:LINUX-CONTAINER-MARKER')) return sse({role:'assistant',content:'FINISHED'},'stop');
  error='unexpected model turn'; return new Response(error,{status:500});
 }
 if(req.headers.get('authorization')!=='Bearer '+token) return new Response('unauthorized',{status:401});
 if(path==='/start'&&req.method==='POST') {if(phase!=='ready')return new Response('already started',{status:409}); phase='running'; rpc.stdin.write(JSON.stringify({id:'prompt',type:'prompt',message:'Inspect marker then complete follow-up execute.'})+'\n');}
 else if(path==='/detach'&&req.method==='POST'){if(phase!=='running'||events.some(e=>e.type==='tool_execution_end'))return new Response('too late',{status:409}); detachedAt=events.length;}
 else if(path!=='/status')return new Response('not found',{status:404});
 return Response.json({phase,detachedAt,modelTurns:turns.length,modelTimes:turns,events:events.map(e=>({type:e.type,id:e.id,success:e.success,toolName:e.toolName,isError:e.isError,result:e.type==='tool_execution_end'?e.result:undefined,message:e.type==='message_end'?e.message:undefined})),error,elapsedMs:Date.now()-started});
}});
await writeFile(root+'/agent/models.json',JSON.stringify({providers:{loopback:{baseUrl:'http://127.0.0.1:8080/v1',api:'openai-completions',apiKey:'loopback-not-a-secret',models:[{id:'loopback-model',name:'offline fixture',contextWindow:32000,maxTokens:2000}]}}}));
const rpc=Bun.spawn(['/opt/die','--mode','rpc','--no-session','--offline','--provider','loopback','--model','loopback-model'],{cwd:root,env:{...process.env,HOME:root,PI_CODING_AGENT_DIR:root+'/agent',DIE_CODING_AGENT_DIR:root+'/agent',HERDR_ENV:'0',PI_OFFLINE:'1',DIE_SUBAGENT_DEPTH:'0',DIE_SUBAGENT_TYPE:''},stdin:'pipe',stdout:'pipe',stderr:'pipe'});
void (async()=>{for await(const data of rpc.stderr) error+=new TextDecoder().decode(data).slice(-2000)})();
void (async()=>{let pending='';for await(const data of rpc.stdout){pending+=new TextDecoder().decode(data);const lines=pending.split('\n');pending=lines.pop()!;for(const line of lines)if(line){const e=JSON.parse(line);events.push(e);if(events.length>256)throw Error('event cap');if(e.type==='agent_end')phase='done';}}})().catch(e=>error+=String(e));
setTimeout(()=>{rpc.kill();server.stop(true)},55000);
