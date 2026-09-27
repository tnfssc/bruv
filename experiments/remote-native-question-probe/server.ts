import { randomUUID } from "node:crypto";
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
let error = "",
  started = false,
  answerSent = false,
  duplicateSent = false,
  launchId = "";
const rpc = Bun.spawn(
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
    cwd: root,
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
      if (requests.length === 1)
        return call(
          "ask",
          'const q=await questions.ask({text:"Choose fixture target?",choices:["A","B"],allowFreeText:false,dedupKey:"fixture-target"}); console.log(JSON.stringify({id:q.id,owner:q.owner,version:q.version,status:q.status})); await questions.block({id:q.id,owner:q.owner,version:q.version,checkpoint:"Await explicit fixture answer",foreground:true});',
        );
      if (requests.length === 2 && body.includes("Await explicit fixture answer"))
        return sse({ role: "assistant", content: "WAITING FOR EXPLICIT ANSWER" }, "stop");
      if (
        requests.length === 3 &&
        body.includes("reply_") &&
        body.includes("Choose fixture target?")
      )
        return call(
          "read",
          'const q=(await questions.list()).find(x=>x.text==="Choose fixture target?"); console.log(JSON.stringify({id:q.id,status:q.status,answer:q.answer,replyId:q.replyId,owner:q.owner,version:q.version,delivery:q.delivery}));',
        );
      if (requests.length === 4 && body.includes("replyId") && body.includes("A"))
        return sse({ role: "assistant", content: "SAVED ANSWER OBSERVED" }, "stop");
      error = "unexpected model request " + requests.length + " " + body.slice(-600);
      return new Response(error, { status: 500 });
    }
    if (req.headers.get("authorization") !== "Bearer " + token)
      return new Response("unauthorized", { status: 401 });
    if (path === "/experience/hello") return Response.json({protocol:1, identity:ownerIdentity, epoch:1, provider:"loopback", model:"loopback-model", reasoning:"off", auth:"FAKE provider; no credentials verified", phase: started ? "accepted" : "idle"});
    if (path === "/experience/events") {
      const url=new URL(req.url);
      if(experienceLog){
        let page;
        try { page=experienceLog.page(Number(url.searchParams.get("after")),url.searchParams.get("cursor")||"",url.searchParams.has("through")?Number(url.searchParams.get("through")):undefined); }
        catch(e){return new Response("gap/corrupt journal: "+String(e),{status:409})}
        return Response.json({identity:ownerIdentity,epoch:1,...page,error,questions:await ledger(),started,launchId,answerSent,fixtureComplete:events.some(e=>e.type==="message_end"&&e.message?.role==="assistant"&&JSON.stringify(e.message.content).includes("SAVED ANSWER OBSERVED"))});
      }
      return Response.json({identity:ownerIdentity, epoch:1, events, cap:180, error, questions: await ledger(), started, launchId, answerSent, fixtureComplete: events.some(e => e.type === "message_end" && e.message?.role === "assistant" && JSON.stringify(e.message.content).includes("SAVED ANSWER OBSERVED"))});
    }
    if (path === "/experience/launch" && req.method === "POST") {
      const input = await req.json().catch(() => null);
      if (!input || input.v !== 1 || input.profile !== "fixture" || typeof input.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.id)) return new Response("invalid launch", {status:400});
      if (input.identity !== ownerIdentity || input.epoch !== 1) return new Response("owner changed", {status:409});
      if (started) return launchId === input.id ? Response.json({id:launchId, duplicate:true, phase:"accepted"}) : new Response("owner busy", {status:409});
      launchId = input.id;
      started = true;
      await writeFile(root + "/launch.json", JSON.stringify({id:launchId}));
      rpc.stdin.write(JSON.stringify({id:"start", type:"prompt", message:"Ask fixture question with actual questions helpers and yield."}) + "\n");
      return Response.json({id:launchId, duplicate:false, phase:"accepted"});
    }
    if (path === "/start" && req.method === "POST") {
      if (started) return new Response("already started", { status: 409 });
      started = true;
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
  rpc.kill();
  server.stop(true);
}, process.env.EXPERIENCE_MODE === "1" ? 900000 : 55000);
