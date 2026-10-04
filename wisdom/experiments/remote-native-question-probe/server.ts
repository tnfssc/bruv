import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { allowedAnswer, allowedScopedAnswer } from "./policy";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const root = "/work",
  token = process.env.PROBE_TOKEN!;
await mkdir(root + "/agent", { recursive: true });
await writeFile(
  root + "/agent/models.json",
  JSON.stringify({
    providers: {
      loopback: {
        baseUrl: "http://127.0.0.1:8080/v1",
        api: "openai-completions",
        apiKey: token,
        models: [{ id: "loopback-model", name: "fixture", contextWindow: 32000, maxTokens: 2000 }],
      },
    },
  }),
);
const ownerIdentity = randomUUID();
const experienceLog = process.env.EXPERIENCE_MODE === "1" ? new (await import("/opt/log.ts")).EventLog(root + "/experience-events.jsonl") : undefined;
const events: any[] = [],
  requests: string[] = [];
let repoTask: {id:string,snapshot:string,patch?:string}|undefined;
let fileMode=false;
let fileRequest: {id:string,task:string,path:string,status:"pending"|"ok"|"denied",text?:string,error?:string}|undefined;
let taskEnded=false;
function capEvent(type:string, detail:object){experienceLog?.append({type, ...detail});}

let error = "",
  started = false,
  answerSent = false,
  duplicateSent = false,
  launchId = "";
let rpc: ReturnType<typeof Bun.spawn>;
function startRpc() {
  rpc = Bun.spawn(
  [
    "/opt/die",
    "--mode",
    "rpc",
    "--session",
    "/work/probe.jsonl",
    "--offline",
    "--provider",
    "loopback",
    "--model",
    "loopback-model",
  ],
  {
    cwd: repoTask ? root + "/task-repo" : root,
    env: {
      ...process.env,
      HOME: root,
      PI_CODING_AGENT_DIR: root + "/agent",
      DIE_CODING_AGENT_DIR: root + "/agent",
      HERDR_ENV: "0",
      PI_OFFLINE: "1",
      DIE_SUBAGENT_DEPTH: "0",
      DIE_SUBAGENT_TYPE: "",
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  },
);
void (async () => {
  for await (const data of rpc.stderr) error += new TextDecoder().decode(data).slice(-1000);
})().catch((e) => (error += String(e)));
void (async () => {
  let pending = Buffer.alloc(0);
  for await (const data of rpc.stdout) {
    pending = Buffer.concat([pending, Buffer.from(data)]);
    let end: number;
    while ((end = pending.indexOf(10)) !== -1) {
      const lineBytes = pending.subarray(0, end);
      pending = pending.subarray(end + 1);
      if (process.env.EXPERIENCE_MODE === "1" && lineBytes.length > 65536) { error = "RPC event exceeds 65536 bytes; transcript incomplete"; rpc.kill(); return; }
      const line = new TextDecoder("utf-8", {fatal:true}).decode(lineBytes);
      if (line) {
        const event=JSON.parse(line);
        if(experienceLog) { try { experienceLog.append(event); } catch(e) { error=String(e)+"; transcript incomplete"; rpc.kill(); return; } }
        events.push(event);
        if(fileMode && event.type==="message_end" && event.message?.role==="assistant" && JSON.stringify(event.message.content).includes("FILE READ RESULT:"))taskEnded=true;
        if(experienceLog && events.length>180)events.shift();
        if (!experienceLog && events.length > 180) {
          error = "event cap";
          rpc.kill();
          return;
        }
      }
    }
    if (process.env.EXPERIENCE_MODE === "1" && pending.length > 65536) { error = "RPC line exceeds 65536 bytes; transcript incomplete"; rpc.kill(); return; }
  }
  if (pending.length) error = "incomplete RPC line at EOF; transcript incomplete";
})().catch((e) => (error += String(e)));
}
const ledger = async (): Promise<any[]> => {
  try {
    return JSON.parse(await readFile(root + "/probe.jsonl.questions.json", "utf8"));
  } catch {
    return [];
  }
};
const sse = (delta: object, finish: string) =>
  new Response(
    [
      { delta, finish_reason: null },
      { delta: {}, finish_reason: finish },
    ]
      .map(
        (x) =>
          "data: " +
          JSON.stringify({
            id: "fixture",
            object: "chat.completion.chunk",
            created: 0,
            model: "loopback-model",
            choices: [{ index: 0, ...x }],
          }) +
          "\n\n",
      )
      .join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  );
const call = (id: string, code: string) =>
  sse(
    {
      role: "assistant",
      tool_calls: [
        {
          index: 0,
          id,
          type: "function",
          function: { name: "execute", arguments: JSON.stringify({ code }) },
        },
      ],
    },
    "tool_calls",
  );
const server = Bun.serve({
  hostname: "0.0.0.0",
  port: 8080,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/v1/chat/completions") {
      if (req.headers.get("authorization") !== "Bearer " + token) return new Response("unauthorized", { status: 401 });
      const body = JSON.stringify(await req.json());
      requests.push(body.slice(-50000));
      if(fileMode){
        if(requests.length===1)return call('independent', 'console.log("INDEPENDENT REMOTE STEP completed before file request")');
        if(requests.length===2)return call('file-read', 'const headers={authorization:"Bearer "+process.env.PROBE_TOKEN,"content-type":"application/json"}; const url="http://127.0.0.1:8080/experience/file-request"; const p=await fetch(url,{method:"POST",headers,body:JSON.stringify({task:"'+launchId+'",owner:"'+ownerIdentity+'",path:"on-demand.txt"})}); if(!p.ok)throw Error("request rejected: "+await p.text()); const q=await p.json(); console.log("FILE REQUEST "+q.id); let result; for(let n=0;n<1200;n++){const r=await fetch(url+"?task="+q.task+"&id="+q.id,{headers});result=await r.json();if(result.status!=="pending")break; await new Promise(r=>setTimeout(r,100))} if(result.status==="pending")throw Error("file read still waiting; no result"); if(result.status!=="ok")throw Error("file read "+result.status+": "+result.error); console.log("REMOTE FILE CONTENT "+result.text);');
        if(requests.length===3)return sse({role:"assistant",content:"FILE READ RESULT: "+(body.includes("REMOTE FILE CONTENT CAPABILITY_FILE_OK: fresh offline-only fixture")?"CAPABILITY_FILE_OK":"FILE READ DENIED OR ERROR")},"stop");
        return new Response("unexpected file mode turn",{status:500});
      }
      if (requests.length === 1 && repoTask) return call("repo-edit", 'if(process.cwd()!=="/work/task-repo")throw Error("die outside task checkout"); const p="/work/task-repo/fixture.txt"; await Bun.write(p,(await Bun.file(p).text())+"remote-die-edit"); for(const cmd of [["config","user.email","fixture@example.invalid"],["config","user.name","Fixture"],["add","fixture.txt"],["commit","-m","fixture-edit"]]){const r=Bun.spawnSync({cmd:["git",...cmd],cwd:"/work/task-repo"}); if(r.exitCode!==0)throw Error(new TextDecoder().decode(r.stderr)); console.log(new TextDecoder().decode(r.stdout))} await Bun.write(p,(await Bun.file(p).text())+"remote-unstaged-edit");');
      const turn=requests.length-(repoTask ? 1 : 0);
      if (turn === 1)
        return call(
          "ask",
          'const q=await questions.ask({text:"Choose fixture target?",choices:["A","B"],allowFreeText:false,dedupKey:"fixture-target"}); console.log(JSON.stringify({id:q.id,owner:q.owner,version:q.version,status:q.status})); await questions.block({id:q.id,owner:q.owner,version:q.version,checkpoint:"Await explicit fixture answer",foreground:true});',
        );
      if (turn === 2 && body.includes("Await explicit fixture answer"))
        return sse({ role: "assistant", content: "WAITING FOR EXPLICIT ANSWER" }, "stop");
      if (
        turn === 3 &&
        body.includes("reply_") &&
        body.includes("Choose fixture target?")
      )
        return call(
          "read",
          'const q=(await questions.list()).find(x=>x.text==="Choose fixture target?"); console.log(JSON.stringify({id:q.id,status:q.status,answer:q.answer,replyId:q.replyId,owner:q.owner,version:q.version,delivery:q.delivery}));',
        );
      if (turn === 4 && body.includes("replyId") && body.includes("A"))
        return sse({ role: "assistant", content: "SAVED ANSWER OBSERVED" }, "stop");
      error = "unexpected model request " + requests.length + " " + body.slice(-600);
      return new Response(error, { status: 500 });
    }
    if (req.headers.get("authorization") !== "Bearer " + token)
      return new Response("unauthorized", { status: 401 });
    if(path==="/experience/cancel-file-task" && req.method==="POST" && process.env.EXPERIENCE_MODE==="1"){
      const input=await req.json().catch(()=>null);
      if(!fileMode || input?.owner!==ownerIdentity || input?.task!==launchId || !started || taskEnded)return new Response('stale or ended task',{status:409});
      taskEnded=true;capEvent('repo_file_task_cancelled',{task:launchId,request:fileRequest?.id});
      rpc.kill();return Response.json({task:launchId,ended:true});
    }
    if(path === "/experience/file-request" && process.env.EXPERIENCE_MODE === "1"){
      if(!fileMode || !started || taskEnded || !repoTask || repoTask.id!==launchId)return new Response("task unavailable",{status:409});
      if(req.method==="POST"){
        const input=await req.json().catch(()=>null);
        if(input?.owner!==ownerIdentity || input?.task!==launchId || input?.path!=="on-demand.txt")return new Response("owner/task/path mismatch",{status:409});
        if(!fileRequest){fileRequest={id:randomUUID(),task:launchId,path:input.path,status:"pending"};capEvent("repo_file_read_requested",{request:fileRequest});await writeFile(root+"/file-request.json",JSON.stringify(fileRequest));}
        return Response.json(fileRequest);
      }
      const u=new URL(req.url);
      if(u.searchParams.get('task')!==launchId || u.searchParams.get('id')!==fileRequest?.id)return new Response("stale request",{status:409});
      return Response.json(fileRequest);
    }
    if(path==="/experience/file-reply" && req.method==="POST" && process.env.EXPERIENCE_MODE==="1"){
      const input=await req.json().catch(()=>null);
      if(!fileMode || !started || !fileRequest || input?.owner!==ownerIdentity || input?.task!==launchId || input?.id!==fileRequest.id || !['ok','denied'].includes(input.status) || typeof input.text!=='string' || typeof input.error!=='string' || input.text.length>16384 || input.error.length>512) return new Response('stale or invalid reply',{status:409});
      if(fileRequest.status!=='pending')return fileRequest.status===input.status && fileRequest.text===input.text && fileRequest.error===input.error ? Response.json({duplicate:true,ended:taskEnded}) : new Response('conflicting reply',{status:409});
      if(taskEnded)return new Response('terminal task; late reply refused',{status:409});
      fileRequest={...fileRequest,status:input.status,text:input.text,error:input.error};
      capEvent('repo_file_read_resolved',{request:fileRequest});await writeFile(root+'/file-request.json',JSON.stringify(fileRequest));
      return Response.json({accepted:true});
    }
    if (path === "/experience/hello") return Response.json({protocol:1, identity:ownerIdentity, epoch:1, provider:"loopback", model:"loopback-model", reasoning:"off", auth:"FAKE provider; no credentials verified", phase: started ? "accepted" : "idle"});
    if (path === "/experience/events") {
      const url=new URL(req.url);
      if(experienceLog){
        let page;
        try { page=experienceLog.page(Number(url.searchParams.get("after")),url.searchParams.get("cursor")||"",url.searchParams.has("through")?Number(url.searchParams.get("through")):undefined); }
        catch(e){return new Response("gap/corrupt journal: "+String(e),{status:409})}
        return Response.json({identity:ownerIdentity,epoch:1,...page,error,questions:await ledger(),started,launchId,answerSent,fileRequest,taskEnded,fixtureComplete:events.some(e=>e.type==="message_end"&&e.message?.role==="assistant"&&JSON.stringify(e.message.content).includes("SAVED ANSWER OBSERVED"))});
      }
      return Response.json({identity:ownerIdentity, epoch:1, events, cap:180, error, questions: await ledger(), started, launchId, answerSent, fixtureComplete: events.some(e => e.type === "message_end" && e.message?.role === "assistant" && JSON.stringify(e.message.content).includes("SAVED ANSWER OBSERVED"))});
    }
    if (path === "/experience/repo" && req.method === "POST" && process.env.EXPERIENCE_MODE === "1") {
      const input = await req.json().catch(() => null);
      if (!input || input.identity !== ownerIdentity || input.epoch !== 1 || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.id || "") || !/^[a-f0-9]{40}$/.test(input.snapshot || "") || typeof input.bundle !== "string" || input.bundle.length > 8_000_000) return new Response("invalid repo input", {status:400});
      if (repoTask) return repoTask.id === input.id && repoTask.snapshot === input.snapshot ? Response.json({id:input.id,duplicate:true}) : new Response("repo already staged",{status:409});
      if (started) return new Response("already launched",{status:409});
      const bytes=Buffer.from(input.bundle,'base64');
      if (bytes.length > 6_000_000 || bytes.toString('base64') !== input.bundle) return new Response("invalid bundle",{status:400});
      await writeFile(root + '/input.bundle',bytes);
      const run=spawnSync('git',['clone','-q',root+'/input.bundle',root+'/task-repo']);
      if(run.status !== 0) return new Response('bundle clone failed', {status:400});
      const head=spawnSync('git',['-C',root+'/task-repo','rev-parse','HEAD']);
      if(head.status !== 0 || head.stdout.toString().trim() !== input.snapshot) return new Response('snapshot mismatch',{status:400});
      repoTask={id:input.id,snapshot:input.snapshot};
      return Response.json({id:input.id,snapshot:input.snapshot});
    }
    if (path === "/experience/repo-result" && process.env.EXPERIENCE_MODE === "1") {
      const url=new URL(req.url);
      if (!repoTask || !started || url.searchParams.get('id') !== repoTask.id || !events.some(e=>e.type==='message_end' && e.message?.role==='assistant' && JSON.stringify(e.message.content).includes('SAVED ANSWER OBSERVED'))) return new Response('task not complete', {status:409});
      if (!repoTask.patch) {
        const diff=spawnSync('git',['-C',root+'/task-repo','diff','--binary','--no-renames',repoTask.snapshot,'--'],{maxBuffer:6_000_000});
        if(diff.status!==0 || diff.stdout.length>4_000_000) return new Response('result too large or failed',{status:409});
        repoTask.patch=diff.stdout.toString('base64');
      }
      const others=spawnSync('git',['-C',root+'/task-repo','ls-files','--others','--exclude-standard','-z'],{maxBuffer:64_000});
      if(others.status!==0 || others.stdout.length>16_000) return new Response('untracked inventory failed or too large',{status:409});
      return Response.json({id:repoTask.id,snapshot:repoTask.snapshot,patch:repoTask.patch,sha256:createHash('sha256').update(Buffer.from(repoTask.patch,'base64')).digest('hex'),omittedRemoteUntracked:others.stdout.toString('utf8').split('\0').filter(Boolean)});
    }
    if (path === "/experience/launch" && req.method === "POST") {
      const input = await req.json().catch(() => null);
      if (!input || input.v !== 1 || input.profile !== "fixture" || typeof input.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.id)) return new Response("invalid launch", {status:400});
      if (input.identity !== ownerIdentity || input.epoch !== 1) return new Response("owner changed", {status:409});
      if (started) return launchId === input.id ? Response.json({id:launchId, duplicate:true, phase:"accepted"}) : new Response("owner busy", {status:409});
      if (repoTask && repoTask.id !== input.id) return new Response("repo task id mismatch",{status:409});
      if(input.fileRead && (!repoTask || repoTask.id!==input.id))return new Response("repo required for file read",{status:409});
      fileMode=input.fileRead===true;
      launchId = input.id;
      started = true;
      startRpc();
      await writeFile(root + "/launch.json", JSON.stringify({id:launchId}));
      rpc.stdin.write(JSON.stringify({id:"start", type:"prompt", message:fileMode?"Complete independent step, then read on-demand.txt via granted client capability; report file content.":"Ask fixture question with actual questions helpers and yield."}) + "\n");
      return Response.json({id:launchId, duplicate:false, phase:"accepted"});
    }
    if (path === "/start" && req.method === "POST") {
      if (started) return new Response("already started", { status: 409 });
      started = true;
      startRpc();
      rpc.stdin.write(
        JSON.stringify({
          id: "start",
          type: "prompt",
          message: "Ask fixture question with actual questions helpers and yield.",
        }) + "\n",
      );
    } else if (path === "/answer" && req.method === "POST") {
      const input = await req.json().catch(() => null);
      const q = (await ledger()).find((x) => x.id === input?.id);
      if (!(process.env.EXPERIENCE_MODE === "1" ? allowedScopedAnswer(input, q, answerSent, ownerIdentity, 1) : allowedAnswer(input, q, answerSent)))
        return new Response("invalid or already answered", { status: 409 });
      const duplicate = answerSent;
      answerSent = true;
      if (duplicate) duplicateSent = true;
      rpc.stdin.write(
        JSON.stringify({ id: duplicate ? "duplicate" : "answer", type: "prompt", message: "/questions answer " + q.id + " A" }) + "\n",
      );
    } else if (path !== "/status") return new Response("not found", { status: 404 });
    return Response.json({
      questions: await ledger(),
      journal: (await readFile(root + "/probe.jsonl", "utf8").catch(() => ""))
        .split("\n")
        .filter(Boolean)
        .slice(-24)
        .map((x) => {
          try {
            const e = JSON.parse(x);
            return {
              type: e.type,
              customType: e.customType,
              role: e.message?.role,
              id: e.id,
              parentId: e.parentId,
              sessionId: e.sessionId,
            };
          } catch {
            return x.slice(0, 80);
          }
        }),
      turns: requests.length,
      contexts: requests.map((x, i) => ({
        turn: i + 1,
        hasAnswer: x.includes("question-answer"),
        hasReplyId: x.includes("reply_"),
        hasA: x.includes('\"answer\":\"A\"'),
      })),
      events: events.map((e) => ({
        type: e.type,
        id: e.id,
        success: e.success,
        toolName: e.toolName,
        isError: e.isError,
        result: e.type === "tool_execution_end" ? e.result : undefined,
        ui: e.type === "extension_ui_request" ? e : undefined,
        message: e.type === "message_end" ? e.message : undefined,
      })),
      error,
      answerSent,
      duplicateSent,
    });
  },
});
setTimeout(() => {
  rpc?.kill();
  server.stop(true);
}, process.env.EXPERIENCE_MODE === "1" ? 900000 : 55000);
