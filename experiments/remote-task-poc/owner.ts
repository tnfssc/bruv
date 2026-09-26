import { checkReply, checkCapability } from "./dependency";
import { eventDecision } from "./bounded-log";
import { mkdirSync, readFileSync, openSync, writeSync, fsyncSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
const dir = "/work",
  file = dir + "/events.jsonl",
  token = process.env.LAB_TOKEN!;
if (!token) throw Error("LAB_TOKEN must be nonempty");
let versionProbe: ReturnType<typeof Bun.spawnSync>;
try {
  versionProbe = Bun.spawnSync(["/opt/die", "--version"], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HOME: dir, PI_CODING_AGENT_DIR: dir + "/agent", DIE_CODING_AGENT_DIR: dir + "/agent" },
  });
} catch (error) {
  throw Error("/opt/die --version unavailable: " + String(error));
}
const dieVersion = new TextDecoder().decode(versionProbe.stdout).trim();
if (versionProbe.exitCode !== 0 || !dieVersion)
  throw Error("/opt/die --version unavailable: " + new TextDecoder().decode(versionProbe.stderr));
mkdirSync(dir + "/agent", { recursive: true });
const old: any[] = existsSync(file)
  ? readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((s) => JSON.parse(s))
  : [];
const identity = old.find((x) => x.k === "identity")?.id ?? randomUUID(),
  epoch = (old.filter((x) => x.k === "epoch").at(-1)?.n ?? 0) + 1;
let events: any[] = old.filter((x) => x.k === "event"),
  accepted: any = old.find((x) => x.k === "accept");
let phase = accepted
    ? events.some((x) => x.type === "outcome" && x.data.state === "done")
      ? "done"
      : "unknown"
    : "ready",
  rpc: ReturnType<typeof Bun.spawn> | undefined,
  turns = 0,
  stderr = "",
  waiting = false,
  resumed = false;
const dependency = {
  question: old.find((x) => x.k === "question"),
  reply: old.find((x) => x.k === "reply"),
  capability: old.find((x) => x.k === "capability"),
  result: old.find((x) => x.k === "capability_result"),
};
const fixtureMode = () => accepted?.prompt.startsWith("DEPENDENCY:");
const sendPrompt = (message: string) => {
  const input = rpc as unknown as { stdin: { write(s: string): void } };
  input.stdin.write(JSON.stringify({ id: "prompt", type: "prompt", message }) + "\n");
};
function resumeIfReady() {
  if (!waiting || resumed || !dependency.reply || !dependency.result || !rpc) return;
  if (dependency.result.status === "denied") { terminal("denied", "local fixture permission denied"); return; }
  resumed = true;
  waiting = false;
  phase = "running";
  emit("dependency_resumed", { questionId: "q1", capabilityId: "c1" });
  sendPrompt("The explicit fixture reply and capability result are available. Fetch both via the lab dependency result tool and finish.");
}
const fd = openSync(file, "a"),
  t0 = Date.now();
function save(x: object) {
  writeSync(fd, JSON.stringify(x) + "\n");
  fsyncSync(fd);
}
if (!old.length) save({ k: "identity", id: identity });
save({ k: "epoch", n: epoch });
function terminal(state: "done" | "unknown" | "capped" | "denied", reason?: string) {
  if (events.some((x) => x.type === "outcome")) return;
  phase = state;
  const x = { k: "event", seq: events.length + 1, ms: Date.now() - t0, type: "outcome", data: { state, reason } };
  if (Buffer.byteLength(JSON.stringify(x)) > 20000) throw Error("terminal event too large");
  save(x);
  events.push(x);
  if (state === "capped" || state === "denied") rpc?.kill();
}
function emit(type: string, data: any) {
  if (phase === "capped" || events.some((x) => x.type === "outcome")) return;
  const x = { k: "event", seq: events.length + 1, ms: Date.now() - t0, type, data };
  const reason = eventDecision(events.length, Buffer.byteLength(JSON.stringify(x)));
  if (reason) {
    terminal("capped", reason);
    return;
  }
  save(x);
  events.push(x);
}
if (accepted && !events.some((x) => x.type === "outcome")) terminal("unknown", "owner restart; no replay");
const args = [
  "/opt/die",
  "--mode",
  "rpc",
  "--no-session",
  "--offline",
  "--provider",
  "loopback",
  "--model",
  "loopback-model",
  "--thinking",
  "off",
];
const respond = (x: unknown, status = 200) => Response.json(x, { status });
function sse(delta: object, finish: string) {
  const chunk = (d: object, f: string | null) =>
    "data: " +
    JSON.stringify({
      id: "fixture",
      object: "chat.completion.chunk",
      created: 0,
      model: "loopback-model",
      choices: [{ index: 0, delta: d, finish_reason: f }],
    }) +
    "\n\n";
  return new Response(chunk(delta, null) + chunk({}, finish) + "data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream" },
  });
}
const server = Bun.serve({
  hostname: "0.0.0.0",
  port: 8080,
  async fetch(req) {
    const url = new URL(req.url),
      path = url.pathname;
    if (path === "/v1/chat/completions") {
      if (req.headers.get("authorization") !== "Bearer " + token) return respond({ error: "unauthorized" }, 401);
      if (!rpc || phase !== "running") return respond({ error: "not running" }, 409);
      const body = await req.json();
      turns++;
      emit("model_turn", { turn: turns });
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
      if (fixtureMode()) {
        const serialized = JSON.stringify(body);
        if (turns === 1) return call("independent", 'console.log("INDEPENDENT_DONE:"+(await Bun.file("marker.txt").text()).trim())');
        if (turns === 2 && serialized.includes("INDEPENDENT_DONE:LINUX-CONTAINER-MARKER"))
          return call("request-dependencies", 'const base="http://127.0.0.1:8080"; const headers={authorization:"Bearer "+process.env.LAB_TOKEN,"content-type":"application/json"}; for(const path of ["question","capability"]){const r=await fetch(base+"/lab/"+path,{method:"POST",headers,body:"{}"}); console.log(path+":"+JSON.stringify(await r.json()))}');
        if (turns === 3 && serialized.includes("question:") && serialized.includes("capability:") && serialized.includes("q1") && serialized.includes("c1"))
          return sse({ role: "assistant", content: "WAITING_FOR_EXPLICIT_RESPONSES" }, "stop");
        if (turns === 4 && dependency.reply && dependency.result)
          return call("consume-responses", 'const r=await fetch("http://127.0.0.1:8080/lab/results",{headers:{authorization:"Bearer "+process.env.LAB_TOKEN}});console.log("ACTUAL_DEPENDENCIES:"+JSON.stringify(await r.json()))');
        if (turns === 5 && serialized.includes("ACTUAL_DEPENDENCIES:") && serialized.includes(dependency.reply.answer) && serialized.includes(dependency.result.content))
          return sse({ role: "assistant", content: "FINISHED_WITH_EXPLICIT_DEPENDENCIES" }, "stop");
        emit("fixture_error", { turn: turns });
        return respond({ error: "unexpected dependency turn" }, 500);
      }
      if (turns === 1)
        return call(
          "first",
          'const text=(await Bun.file("marker.txt").text()).trim(); const sh=await shell("pwd; sleep 3; printf FIRST_DONE",{waitSeconds:5}); console.log(JSON.stringify({text,sh}));',
        );
      if (
        turns === 2 &&
        JSON.stringify(body).includes("FIRST_DONE") &&
        JSON.stringify(body).includes("LINUX-CONTAINER-MARKER")
      )
        return call("second", 'console.log("SECOND_DONE:"+(await Bun.file("marker.txt").text()).trim())');
      if (turns === 3 && JSON.stringify(body).includes("SECOND_DONE:LINUX-CONTAINER-MARKER"))
        return sse({ role: "assistant", content: "FINISHED" }, "stop");
      emit("fixture_error", { turn: turns });
      return respond({ error: "unexpected turn" }, 500);
    }
    if (req.headers.get("authorization") !== "Bearer " + token) return respond({ error: "unauthorized" }, 401);
    // Lab-only explicit dependency transport. Not harness questions: RPC does not expose
    // an externally answerable /questions operation. No tool execution waits in place.
    if (path.startsWith("/lab/")) {
      if (!fixtureMode()) return respond({ error: "not a dependency fixture" }, 409);
      const op = path.slice(5);
      if (op === "results" && req.method === "GET")
        return dependency.reply && dependency.result
          ? respond({ answer: dependency.reply.answer, content: dependency.result.content })
          : respond({ error: "dependencies pending" }, 409);
      if (req.method !== "POST") return respond({ error: "POST required" }, 405);
      const raw = await req.text();
      if (raw.length > 1024) return respond({ error: "request too large" }, 413);
      let data: any;
      try { data = JSON.parse(raw); } catch { return respond({ error: "invalid JSON" }, 400); }
      if (op === "question" || op === "capability") {
        if (phase !== "running" || !rpc || Object.keys(data).length) return respond({ error: "invalid request" }, 409);
        if (op === "question") {
          if (!dependency.question) { dependency.question = { k: "question", id: "q1", text: "Choose a fixture label for this task" }; save(dependency.question); emit("question_pending", dependency.question); }
          return respond("q1");
        }
        if (!dependency.capability) { dependency.capability = { k: "capability", id: "c1", kind: "read-local-fixture", permission: "pending" }; save(dependency.capability); emit("capability_pending", dependency.capability); }
        return respond("c1");
      }
      if (op === "reply" && dependency.question) {
        const decision = checkReply(data, dependency.reply);
        if (decision === "invalid") return respond({ error: "invalid reply" }, 400);
        if (decision !== "new") return decision === "duplicate" ? respond({ accepted: true, duplicate: true }) : respond({ error: "conflicting reply" }, 409);
        dependency.reply = { k: "reply", questionId: "q1", replyId: data.replyId, answer: data.answer }; save(dependency.reply); emit("question_answered", dependency.reply); resumeIfReady();
        return respond({ accepted: true, duplicate: false });
      }
      if (op === "capability-result" && dependency.capability) {
        const decision = checkCapability(data, dependency.result);
        if (decision === "invalid") return respond({ error: "invalid capability response" }, 400);
        if (decision !== "new") return decision === "duplicate" ? respond({ accepted: true, duplicate: true }) : respond({ error: "conflicting capability response" }, 409);
        dependency.result = { k: "capability_result", ...data }; save(dependency.result); emit("capability_resolved", dependency.result); resumeIfReady();
        return respond({ accepted: true, duplicate: false });
      }
      return respond({ error: "not found or dependency absent" }, 404);
    }
    if (path === "/hello")
      return respond({
        protocol: 1,
        identity,
        epoch,
        dieVersion,
        defaultProfile: "fixture",
        profiles: {
          fixture: {
            provider: "loopback",
            model: "loopback-model",
            reasoning: "off",
            auth: "synthetic fixture; no paid auth verified",
          },
        },
        phase,
      });
    if (path === "/launch" && req.method === "POST") {
      const x = await req.json();
      if (x.v !== 1) return respond({ error: "version mismatch" }, 400);
      if (x.profile !== "fixture") return respond({ error: "unknown profile" }, 400);
      if (
        typeof x.id !== "string" ||
        !/^[a-zA-Z0-9_-]{1,64}$/.test(x.id) ||
        typeof x.prompt !== "string" ||
        x.prompt.length > 500
      )
        return respond({ error: "invalid launch" }, 400);
      const config = {
        profile: "fixture",
        provider: "loopback",
        model: "loopback-model",
        reasoning: "off",
        args: args.slice(1),
      };
      if (accepted)
        return accepted.id === x.id &&
          accepted.prompt === x.prompt &&
          JSON.stringify(accepted.config) === JSON.stringify(config)
          ? respond({ id: x.id, config, phase, duplicate: true })
          : respond({ error: "conflicting launch / capacity" }, 409);
      accepted = { k: "accept", id: x.id, prompt: x.prompt, config };
      save(accepted);
      emit("accepted", { id: x.id, config });
      phase = "running";
      rpc = Bun.spawn(args, {
        cwd: dir,
        env: {
          ...process.env,
          HOME: dir,
          PI_CODING_AGENT_DIR: dir + "/agent",
          DIE_CODING_AGENT_DIR: dir + "/agent",
          HERDR_ENV: "0",
          PI_OFFLINE: "1",
          DIE_SUBAGENT_DEPTH: "0",
          DIE_SUBAGENT_TYPE: "",
        },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      const child = rpc as unknown as {
        stdin: { write(s: string): void };
        stdout: ReadableStream<Uint8Array>;
        stderr: ReadableStream<Uint8Array>;
      };
      void (async () => {
        for await (const b of child.stderr) stderr = (stderr + new TextDecoder().decode(b)).slice(-1500);
      })();
      void (async () => {
        let p = "";
        for await (const b of child.stdout) {
          p += new TextDecoder().decode(b);
          if (Buffer.byteLength(p) > 262144) {
            terminal("capped", "RPC stdout line exceeds 262144 bytes");
            break;
          }
          const lines = p.split("\n");
          p = lines.pop()!;
          for (const line of lines) {
            if (!line) continue;
            const e = JSON.parse(line);
            if (
              ["tool_execution_start", "tool_execution_end", "message_end", "agent_end", "agent_start"].includes(e.type)
            )
              emit(e.type, e);
            if (e.type === "agent_end") {
              if (fixtureMode() && !resumed) {
                if (!dependency.question || !dependency.capability) terminal("unknown", "fixture did not request dependencies");
                else { waiting = true; phase = "waiting"; emit("waiting", { questionId: "q1", capabilityId: "c1" }); resumeIfReady(); }
              } else terminal("done");
            }
          }
        }
      })().catch((e) => {
        terminal("unknown", String(e).slice(0, 1000));
      });
      void rpc.exited.then((code) => {
        if (phase === "running" || phase === "waiting") {
          terminal("unknown", JSON.stringify({ code, stderr }));
        }
      });
      sendPrompt(x.prompt);
      return respond({ id: x.id, config, phase, duplicate: false });
    }
    if (path === "/events") {
      const cursor = Number(url.searchParams.get("cursor") ?? "0");
      if (url.searchParams.get("identity") !== identity || Number(url.searchParams.get("epoch")) !== epoch)
        return respond({ error: "identity/epoch mismatch", identity, epoch }, 409);
      if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > events.length)
        return respond({ error: "invalid cursor" }, 409);
      const page: any[] = [];
      let bytes = 0;
      for (const e of events.slice(cursor, cursor + 10)) {
        const size = Buffer.byteLength(JSON.stringify(e));
        if (size + bytes > 30000) break;
        page.push(e);
        bytes += size;
      }
      return respond({
        identity,
        epoch,
        events: page,
        next: cursor + page.length,
        hasMore: cursor + page.length < events.length,
        phase,
        bytes,
      });
    }
    return respond({ error: "not found" }, 404);
  },
});
await Bun.write(
  dir + "/agent/models.json",
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
await Bun.write(dir + "/marker.txt", "LINUX-CONTAINER-MARKER\n");
setTimeout(() => {
  rpc?.kill();
  server.stop(true);
}, 65000);
