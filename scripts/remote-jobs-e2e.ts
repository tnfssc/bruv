/** Isolated compiled CLI -> Docker SSH -> existing jobs task-complete integration proof. */
import { spawn, spawnSync } from "node:child_process";
import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const home = homedir(), agentDir = process.env.DIE_CODING_AGENT_DIR!;
const statePath = join(home, ".die/remote/state.json");
const clients: ReturnType<typeof spawn>[] = [];
const requests: Array<{ side: string; messages: string }> = [];
const provider = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  if (request.method !== "POST" || !new URL(request.url).pathname.endsWith("/chat/completions"))
    return new Response("not found", { status: 404 });
  const body = await request.json() as { messages: Array<{ role: string; tool_call_id?: string; content?: unknown }> };
  const messages = JSON.stringify(body.messages);
  const side = messages.includes("REMOTE_JOBS_PROOF_A") ? "A" : messages.includes("REMOTE_JOBS_PROOF_B") ? "B" : "?";
  requests.push({side, messages});
  const done = body.messages.some(m => m.role === "tool" && m.tool_call_id === "launch-" + side);
  const completion = messages.includes("asynchronous task") && messages.includes("completed.");
  const response = completion ? {role:"assistant",content:"REMOTE_JOBS_PARENT_ACK_" + side} : done
    ? {role:"assistant",content:"REMOTE_JOBS_PARENT_YIELDED_" + side}
    : {role:"assistant",tool_calls:[{index:0,id:"launch-" + side,type:"function",function:{name:"execute",arguments:JSON.stringify({code:
      'console.log(await remote.launch({repoPath:"/fixture/repo",prompt:"REMOTE_JOBS_PROOF_' + side + '"}))'
    })}}]};
  const chunk = (delta: object, finish_reason: string | null) => ({id:"proof",object:"chat.completion.chunk",created:1,model:"fixture-model",choices:[{index:0,delta,finish_reason}]});
  return new Response([chunk(response,null),chunk({},"tool_calls" in response ? "tool_calls":"stop")].map(e=>"data: " + JSON.stringify(e) + "\n\n").join("") + "data: [DONE]\n\n",{headers:{"content-type":"text/event-stream"}});
}});
mkdirSync(agentDir,{recursive:true});
writeFileSync(join(agentDir,"models.json"),JSON.stringify({providers:{fixture:{baseUrl:"http://127.0.0.1:"+provider.port+"/v1",api:"openai-completions",apiKey:"fixture-only",models:[{id:"fixture-model",name:"fixture",contextWindow:32000,maxTokens:1024}]}}}));
const state = () => JSON.parse(readFileSync(statePath,"utf8")) as {tasks:Record<string,{task?:{state:string};cursor:number}>};
function launch(side:string, session: string) {
 const child = spawn(process.env.DIE_BIN!,["--mode","rpc","--provider","fixture","--model","fixture-model","--session",session],{cwd:home,env:{...process.env,HOME:home,DIE_CODING_AGENT_DIR:agentDir},stdio:["pipe","pipe","pipe"]});
 clients.push(child);
 const events:any[]=[];let buffer="",err="";
 child.stdout.on("data",(data:Buffer)=>{buffer+=String(data);for(let pos;(pos=buffer.indexOf("\n"))>=0;){const line=buffer.slice(0,pos);buffer=buffer.slice(pos+1);if(line)events.push(JSON.parse(line));}});
 child.stderr.on("data",(data:Buffer)=>err+=String(data));
 const send=(message:string)=>child.stdin.write(JSON.stringify({type:"prompt",message})+"\n");
 const wait=async (test:()=>boolean,label:string,ms=60000)=>{const start=Date.now();while(!test()){if(child.exitCode!==null)throw Error(side+" exited: "+err);if(Date.now()-start>ms)throw Error(side+" timed out "+label+"; stderr="+err+"; events="+JSON.stringify(events.slice(-8))+"; requests="+JSON.stringify(requests.map(x=>({side:x.side,last:x.messages.slice(-350)}))));await Bun.sleep(100);}};
 return {child,events,send,wait};
}
const ssh=(command:string)=>spawnSync("ssh",["-F",process.env.FIXTURE_SSH_CONFIG!,"fixture-owner",command],{encoding:"utf8",timeout:6000});
try {
 assert.equal(ssh("true").status,0,"pinned fixture SSH unavailable");
 const a=launch("A",join(home,"a.jsonl")), b=launch("B",join(home,"b.jsonl"));
 a.send("/remote connect fixture-owner /usr/local/bin/die");
 await a.wait(()=>existsSync(statePath) && !!JSON.parse(readFileSync(statePath,"utf8")).connection,"connect");
 a.send("REMOTE_JOBS_PROOF_A launch using execute");
 await a.wait(()=>Object.keys(state().tasks).length===1,"first remote launch");
 const [idA]=Object.keys(state().tasks);
 b.send("REMOTE_JOBS_PROOF_B launch using execute");
 await b.wait(()=>Object.keys(state().tasks).length===2,"second remote launch");
 const idB=Object.keys(state().tasks).find(id=>id!==idA)!;
 assert(idA && idB && idA!==idB);
 for(const [client,side] of [[a,"A"],[b,"B"]] as const){
  await client.wait(()=>client.events.some(e=>e.type==="tool_execution_end"&&e.toolName==="execute"&&!e.isError),"real execute launch");
  await client.wait(()=>client.events.some(e=>e.type==="message_end"&&JSON.stringify(e).includes("REMOTE_JOBS_PARENT_YIELDED_"+side)),"parent yielded");
 }
 await a.wait(()=>state().tasks[idA]?.task?.state==="done","A remote terminal",90000);
 await b.wait(()=>state().tasks[idB]?.task?.state==="done","B remote terminal",90000);
 await a.wait(()=>a.events.some(e=>e.type==="message_end"&&JSON.stringify(e).includes("REMOTE_JOBS_PARENT_ACK_A")),"A existing completion coordinator wake",45000);
 await b.wait(()=>b.events.some(e=>e.type==="message_end"&&JSON.stringify(e).includes("REMOTE_JOBS_PARENT_ACK_B")),"B existing completion coordinator wake",45000);
 const complete=(client:typeof a)=>client.events.filter(e=>e.type==="message_end" && e.message?.customType==="task-complete");
 assert(complete(a).length && complete(b).length,"missing existing task-complete envelope");
 assert(!JSON.stringify(complete(a)).includes(idB) && !JSON.stringify(complete(b)).includes(idA),"cross-session task completion leaked");
 const countA=complete(a).length,countB=complete(b).length;
 a.send("/remote sync " + idA); b.send("/remote sync " + idB);
 await Bun.sleep(1500);
 assert.equal(complete(a).length,countA,"repeat sync redelivered A"); assert.equal(complete(b).length,countB,"repeat sync redelivered B");
 a.child.kill("SIGKILL");b.child.kill("SIGKILL");
 const ar=launch("A-reconnect",join(home,"a.jsonl")),br=launch("B-reconnect",join(home,"b.jsonl"));
 ar.send("/remote status");br.send("/remote status");
 await Bun.sleep(2000);
 assert(!complete(ar).length && !complete(br).length,"reconnect redelivered completed task");
 console.log("PASS normal CLI execute remote.launch -> two parent yields -> Docker remote terminal -> existing task-complete parent wake, isolated sessions, repeat sync and reconnect");
} finally {for(const child of clients)if(child.exitCode===null)child.kill("SIGKILL");provider.stop(true);}
