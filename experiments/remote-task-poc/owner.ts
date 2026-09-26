import { mkdirSync, readFileSync, openSync, writeSync, fsyncSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
const dir = "/work",
  file = dir + "/events.jsonl",
  token = process.env.LAB_TOKEN!;
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
  stderr = "";
const fd = openSync(file, "a"),
  t0 = Date.now();
function save(x: object) {
  writeSync(fd, JSON.stringify(x) + "\n");
  fsyncSync(fd);
}
if (!old.length) save({ k: "identity", id: identity });
save({ k: "epoch", n: epoch });
function emit(type: string, data: any) {
  if (events.length >= 160 || Buffer.byteLength(JSON.stringify(data)) > 20000) {
    phase = "capped";
    rpc?.kill();
    return;
  }
  const x = { k: "event", seq: events.length + 1, ms: Date.now() - t0, type, data };
  save(x);
  events.push(x);
}
if (accepted && !events.some((x) => x.type === "outcome"))
  emit("outcome", { state: "unknown", reason: "owner restart; no replay" });
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
const respond = (x: object, status = 200) => Response.json(x, { status });
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
      if (req.headers.get("authorization") !== "Bearer " + token)
        return respond({ error: "unauthorized" }, 401);
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
    if (req.headers.get("authorization") !== "Bearer " + token)
      return respond({ error: "unauthorized" }, 401);
    if (path === "/hello")
      return respond({
        protocol: 1,
        identity,
        epoch,
        dieVersion: "0.15.3",
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
          const lines = p.split("\n");
          p = lines.pop()!;
          for (const line of lines) {
            if (!line) continue;
            const e = JSON.parse(line);
            if (
              [
                "tool_execution_start",
                "tool_execution_end",
                "message_end",
                "agent_end",
                "agent_start",
              ].includes(e.type)
            )
              emit(e.type, e);
            if (e.type === "agent_end") {
              phase = "done";
              emit("outcome", { state: "done" });
            }
          }
        }
      })().catch((e) => {
        phase = "unknown";
        emit("outcome", { state: "unknown", error: String(e) });
      });
      void rpc.exited.then((code) => {
        if (phase === "running") {
          phase = "unknown";
          emit("outcome", { state: "unknown", code, stderr });
        }
      });
      child.stdin.write(JSON.stringify({ id: "prompt", type: "prompt", message: x.prompt }) + "\n");
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
