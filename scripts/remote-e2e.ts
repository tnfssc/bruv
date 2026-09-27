/** Run real dist/die --mode rpc against isolated fake model and pinned Docker SSH host. */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { strict as assert } from "node:assert";
const die = process.env.DIE_BIN!;
const container = process.env.FIXTURE_CONTAINER!;
const home = homedir();
const statePath = join(home, ".die/remote/state.json");
const agentDir = process.env.DIE_CODING_AGENT_DIR!;
let localCalls = 0;
const provider = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  if (request.method !== "POST" || !new URL(request.url).pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 });
  const body = await request.json() as { messages: Array<{role:string}> };
  const response = body.messages.some((m) => m.role === "tool")
    ? { role: "assistant", content: "LOCAL_FIXTURE_ACK" }
    : { role: "assistant", tool_calls: [{ index: 0, id: "fixture-remote-launch", type: "function", function: {
      name: "remote", arguments: JSON.stringify({op: "launch", repoPath: "/fixture/repo", prompt: "Inspect the repository with execute and say REMOTE_FIXTURE_FINISHED_ON_OWNER"}),
    } }] };
  localCalls++;
  const event = (delta: object, finish_reason: string | null) => ({
    id: "local-fixture", object: "chat.completion.chunk", created: 1, model: "fixture-model", choices: [{index:0,delta,finish_reason}],
  });
  return new Response([event(response,null),event({},"tool_calls" in response ? "tool_calls" : "stop")]
    .map((chunk) => "data: " + JSON.stringify(chunk) + "\n\n").join("") + "data: [DONE]\n\n", { headers: {"content-type":"text/event-stream"} });
} });
mkdirSync(agentDir, {recursive:true});
writeFileSync(join(agentDir, "models.json"), JSON.stringify({providers:{fixture:{
  baseUrl: "http://127.0.0.1:" + provider.port + "/v1", api:"openai-completions", apiKey:"fixture-only", models:[
    {id:"fixture-model",name:"fixture",contextWindow:32000,maxTokens:1024},
  ],
}}}));
const state = () => JSON.parse(readFileSync(statePath,"utf8")) as {connection?:unknown;tasks:Record<string,{cursor:number;events:Array<{event:unknown}>;task?:{state:string}}>};
const launchRpc = () => {
  const child = spawn(die,["--mode","rpc","--provider","fixture","--model","fixture-model","--no-session"],{
    cwd:home, env:{...process.env,HOME:home,DIE_CODING_AGENT_DIR:agentDir}, stdio:["pipe","pipe","pipe"],
  });
  const events: any[] = []; let stderr = "", buffer = "";
  child.stderr.on("data",(chunk:Buffer) => stderr += String(chunk));
  child.stdout.on("data",(chunk:Buffer) => {
    buffer += String(chunk);
    for (let pos; (pos=buffer.indexOf("\n")) !== -1;) {
      const line=buffer.slice(0,pos);buffer=buffer.slice(pos+1);
      if (line) { try { events.push(JSON.parse(line)); } catch { throw new Error("Invalid RPC JSON: " + line); } }
    }
  });
  const send=(message:string) => child.stdin.write(JSON.stringify({type:"prompt",message})+"\n");
  const wait=async (predicate:()=>boolean,label:string,limit=20_000) => {
    const start=Date.now(); while (!predicate()) {
      if (child.exitCode !== null) throw new Error("RPC exited while " + label + ": " + stderr);
      if (Date.now()-start>limit) throw new Error("RPC timeout " + label + "; stderr=" + stderr + "; events=" + JSON.stringify(events.slice(-8)));
      await Bun.sleep(40);
    }
  };
  return {child,events,send,wait,stderr:()=>stderr};
};
const ssh=(...args:string[]) => spawnSync("ssh",["-F",process.env.FIXTURE_SSH_CONFIG!,"fixture-owner",...args], {encoding:"utf8",timeout:6000});
try {
  // SSH identity must be pinned; wrong host key cannot silently become trusted.
  const pinned = ssh("true"); assert.equal(pinned.status,0,pinned.stderr);
  const wrongKeyPath=join(home,"wrong_known_hosts");
  writeFileSync(wrongKeyPath,"[127.0.0.1]:1 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMy1tD58VMDxyLCjcHQEoiJFq93UpHzOd89Sn3AzBZTi\n");
  const wrong=spawnSync("ssh",["-F",process.env.FIXTURE_SSH_CONFIG!,"-o","UserKnownHostsFile="+wrongKeyPath,"fixture-owner","true"],{encoding:"utf8",timeout:6000});
  // A different known-hosts file must not authenticate this server.
  assert.notEqual(wrong.status,0,"SSH unexpectedly trusted an unpinned host key");
  const cli=launchRpc();
  cli.send("/remote connect fixture-owner /usr/local/bin/die");
  await cli.wait(()=>existsSync(statePath) && !!state().connection,"human /remote connect");
  cli.send("Launch the already-configured remote repo with the remote tool");
  await cli.wait(()=>Object.keys(state().tasks).length===1,"agent remote tool launch",30000);
  const [taskId] = Object.keys(state().tasks);
  assert(taskId);
  await cli.wait(()=>cli.events.some((e)=>e.type==="tool_execution_end" && e.toolName==="remote"),"real remote tool completion",30000);
  assert(cli.events.some((e)=>e.type==="tool_execution_end" && e.toolName==="remote" && !e.isError),JSON.stringify(cli.events.slice(-8)));
  // Client disappears before the independent owner model finishes. No provider calls on this client afterward.
  cli.child.kill("SIGKILL");
  await cli.wait(()=>cli.child.exitCode!==null,"client exit",5000);
  const callsAtDisconnect=localCalls;
  assert(callsAtDisconnect<=2,"unexpected local provider traffic");
  let ownerFinished=false;
  for (let i=0;i<120;i++) {
    const r=ssh("test -f /tmp/fixture-owner-finished-model");
    if(r.status===0) { ownerFinished=true; break; }
    await Bun.sleep(100);
  }
  assert(ownerFinished,"owner continued after local RPC client exit");
  assert.equal(localCalls,callsAtDisconnect,"disconnected client must not make provider calls");
  const reconnect=launchRpc();
  reconnect.send("/remote sync " + taskId);
  await reconnect.wait(()=>state().tasks[taskId]!.task?.state==="done","offline transcript sync after reconnect",30000);
  assert(state().tasks[taskId]!.cursor>0,"saved paginated owner events");
  const transcript=JSON.stringify(state().tasks[taskId]!.events);
  assert(transcript.includes("REMOTE_FIXTURE_EXECUTED_ON_OWNER"),"actual owner execute tool result absent");
  assert(transcript.includes("REMOTE_FIXTURE_FINISHED_ON_OWNER"),"actual owner final answer absent");
  reconnect.child.kill("SIGKILL");
  console.log("PASS normal CLI RPC agent remote tool, human connect, pinned SSH, independent owner, reconnect sync; events=" + state().tasks[taskId]!.cursor);
} finally { provider.stop(true); }
