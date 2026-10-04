import { test, expect } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { capturePane, shellQuote, tmuxRunner } from "./tui-helpers";

// Real compiled-terminal measurement. Capture polling is intentionally recorded (not presented as exact key/frame timestamps).
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const quantile = (xs: number[], q: number) => xs.slice().sort((a,b)=>a-b)[Math.min(xs.length-1, Math.floor((xs.length-1)*q))];

test("installed/candidate CLI PTY key echo and loading-frame cadence", async () => {
  const home = await mkdtemp(join(tmpdir(), "bruv-pty-latency-"));
  const socket = "bruv-latency-" + process.pid;
  const tmux = tmuxRunner(socket, join(home, "tmux.conf"));
  const binary = resolve(process.env.BRUV_BIN || "/home/tnfssc/.local/bin/bruv");
  let requestCount = 0;
  const requestPaths: string[] = [];
  const server = createServer(async (req, res) => {
    requestCount++;
    requestPaths.push(req.url || "");
    for await (const _ of req) { /* consume request */ }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    // Deliberately hold generation while spinner is observed, then finish as valid OpenAI chat-completions SSE.
    const timer = setTimeout(() => { res.write('data: {"choices":[{"delta":{"content":"controlled response"},"finish_reason":null}]}\n\n'); res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'); res.end("data: [DONE]\n\n"); }, 12000);
    res.on("close", () => clearTimeout(timer));
  });
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  const port = (server.address() as any).port;
  const runs: any[] = [];
  try {
    const agentDir = join(home,".bruv","agent");
    await mkdir(agentDir,{recursive:true});
    await writeFile(join(agentDir,"models.json"), JSON.stringify({providers:{fixture:{baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,api:"openai-completions",apiKey:"fixture",models:[{id:"fixture-model",name:"fixture",contextWindow:32000,maxTokens:1000}]}}}));
    await writeFile(join(home,"tmux.conf"),"set -g extended-keys on\nset -g extended-keys-format csi-u\n");
    for (const size of ["short", "long"]) {
      const manager = SessionManager.create(home, join(home,"sessions"));
      const turns = size === "short" ? 2 : Number(process.env.BRUV_LATENCY_LONG_TURNS || 100);
      for (let turn=0; turn<turns; turn++) {
        manager.appendMessage({role:"user",content:`Question ${turn}: summarize the rollout constraints and failure modes. Include a concise recommendation.`,timestamp:Date.now()});
        manager.appendMessage({role:"assistant",content:[{type:"text",text:(`## Decision ${turn}\n\nWe should preserve the existing API contract while reducing repeated work. The rollout needs staged validation, observable latency budgets, and a rollback path. Risks include stale caches, concurrent updates, partial failures, and misleading success signals.\n\n### Evidence and tradeoffs\nThe implementation should avoid rescanning unchanged historical records on every animation frame. Keep ownership and invalidation explicit; tests should exercise updates, errors, and pagination rather than just the happy path.\n\n`).repeat(4)}],api:"openai-completions",provider:"openai",model:"gpt-4o",usage,stopReason:"stop",timestamp:Date.now()});
        for (let j=0;j<(size === "short" ? 1 : 5);j++) {
          const id=`saved-${turn}-${j}`;
          manager.appendMessage({role:"assistant",content:[{type:"toolCall",id,name:"execute",arguments:{label:`Inspect module ${turn}/${j}`,code:"cat src/ui/task-list.ts"}}],api:"openai-completions",provider:"openai",model:"gpt-4o",usage,stopReason:"toolUse",timestamp:Date.now()});
          manager.appendMessage({role:"toolResult",toolCallId:id,toolName:"execute",content:[{type:"text",text:(`--- source excerpt ${turn}/${j} ---\nfunction updateVisibleRows(state) {\n  const items = state.messages.filter(message => message.visible);\n  return items.map(renderMarkdownAndToolResult).join("\n");\n}\n`).repeat(8)}],details:{exitCode:0,stdout:"tool output: parsed 184 files; 12 warnings; no changes",stderr:"",images:[]},isError:false,timestamp:Date.now()});
        }
      }
      manager.appendMessage({role:"assistant",content:[{type:"text",text:"HISTORY_READY_"+size}],api:"openai-completions",provider:"openai",model:"gpt-4o",usage,stopReason:"stop",timestamp:Date.now()});
      const launchedAt=Date.now();
      const cmd=["env",`HOME=${home}`,`BRUV_CODING_AGENT_DIR=${join(home,".bruv","agent")}`,"PI_OFFLINE=0","HERDR_ENV=0",binary,"--no-approve","--session",manager.getSessionFile()!,"--provider","fixture","--model","fixture-model"].map(shellQuote).join(" ");
      const created=await tmux("new-session","-d","-s","measure","-x","100","-y","32","-c",home,cmd);
      expect(created.code).toBe(0);
      let frame="";
      for(let i=0;i<300;i++){frame=(await capturePane(tmux,"measure")).stdout;if(frame.includes("HISTORY_READY_"+size))break;await Bun.sleep(50);}
      expect(frame).toContain("HISTORY_READY_"+size);
      await Bun.sleep(800); // startup/editor warmup, same for both cases
      const echo: number[]=[];
      for(let k=0;k<5;k++){
        const token=`ECHO_${size}_${k}`;
        const sent=performance.now(); await tmux("send-keys","-t","measure","-l",token);
        let echoed=false; for(let poll=0;poll<100;poll++){frame=(await capturePane(tmux,"measure")).stdout;if(frame.includes(token)){echoed=true;break;}await Bun.sleep(20);}
        expect(echoed, `input token ${token} must appear in terminal echo`).toBe(true);
        echo.push(performance.now()-sent); for(let c=0;c<token.length;c++) await tmux("send-keys","-t","measure","BSpace"); await Bun.sleep(100);
      }
      // Submit a request and sample actual tmux terminal frames during the held provider response.
      // Measure echo while generation is held, not just on an idle editor.
      await tmux("send-keys","-t","measure","-l","latency probe");
      await tmux("send-keys","-t","measure","Enter");
      const requestDeadline=Date.now()+5000; while(requestCount===0 && Date.now()<requestDeadline) await Bun.sleep(20);
      expect(requestCount).toBeGreaterThan(0);
      const loadingStart=performance.now(), echoDuring:number[]=[];
      for(let k=0;k<5;k++){const token=`HELD_${size}_${k}`;const sent=performance.now();await tmux("send-keys","-t","measure","-l",token);let echoed=false;for(let poll=0;poll<100;poll++){frame=(await capturePane(tmux,"measure")).stdout;if(frame.includes(token)){echoed=true;break;}await Bun.sleep(20);}expect(echoed,`held input ${token} must echo`).toBe(true);echoDuring.push(performance.now()-sent);for(let c=0;c<token.length;c++)await tmux("send-keys","-t","measure","BSpace");}
      // Spinner cadence: compare spinner-only row signatures, not arbitrary changed terminal frames.
      const spinnerGlyphs="⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⠁⠂⠄⡀⢀⠠⠐⠈◐◓◑◒|/-\\";
      const spinnerSamples:number[]=[]; let priorSpinner="", spinnerGaps:number[]=[]; let lastSpinnerAt=loadingStart; const observationMs=5000, pollMs=50;
      while(performance.now()-loadingStart<observationMs){const frameAt=performance.now();frame=(await capturePane(tmux,"measure")).stdout;const rows=frame.split("\n");const row=rows.find(line=>[...line].some(ch=>"⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏".includes(ch)));if(row){const signature=[...row].filter(ch=>spinnerGlyphs.includes(ch)).join("");if(signature&&signature!==priorSpinner){if(priorSpinner)spinnerGaps.push(frameAt-lastSpinnerAt);spinnerSamples.push(frameAt-loadingStart);priorSpinner=signature;lastSpinnerAt=frameAt;}}await Bun.sleep(pollMs);}
      expect(spinnerSamples.length).toBeGreaterThan(2);
      runs.push({size,turns:size==="short"?2:Number(process.env.BRUV_LATENCY_LONG_TURNS||100),elapsedStartupMs:Date.now()-launchedAt,echoMs:echo,echoP50Ms:quantile(echo,.5),echoP95Ms:quantile(echo,.95),echoDuringHeldMs:echoDuring,heldEchoP50Ms:quantile(echoDuring,.5),heldEchoP95Ms:quantile(echoDuring,.95),capturePollMs:pollMs,observationMs:observationMs,spinnerTransitions:spinnerGaps.length,spinnerCadenceP50Ms:quantile(spinnerGaps,.5),spinnerCadenceP95Ms:quantile(spinnerGaps,.95),capturePollingOverheadMs:pollMs});
      await tmux("kill-session","-t","measure");
    }
    expect(requestCount).toBe(2);
    expect(requestPaths.every(path => path === "/v1/chat/completions")).toBe(true);
    console.log(JSON.stringify({binary,controlledProviderRequests:requestCount,controlledProviderPaths:requestPaths,providerHoldMs:12000,results:runs},null,2));
  } finally { await tmux("kill-server"); server.close(); await rm(home,{recursive:true,force:true}); }
}, 90000);
