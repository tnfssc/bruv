import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
const base = resolve(import.meta.dirname),
  repo = resolve(base, "../../..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = {
  adapter: "pi-acp@0.0.34 unchanged npm tarball",
  engine: join(repo, "dist/bruv"),
  engineSha256: createHash("sha256")
    .update(readFileSync(join(repo, "dist/bruv")))
    .digest("hex"),
  steps: [],
};
const trace = join(base, "trace.ndjson");
writeFileSync(trace, "");
const log = (kind, data) => appendFileSync(trace, JSON.stringify({ time: Date.now(), kind, data }) + "\n");
const home = join(base, "home"),
  work = join(base, "work"),
  agentDir = join(base, "agent");
for (const d of [home, work, agentDir]) mkdirSync(d, { recursive: true });
const env = {
  PATH: dirname(process.execPath) + ":/usr/bin:/bin",
  HOME: home,
  XDG_CONFIG_HOME: join(home, ".config"),
  XDG_CACHE_HOME: join(home, ".cache"),
  BRUV_CODING_AGENT_DIR: agentDir,
  PI_CODING_AGENT_DIR: agentDir,
  BRUV_HOME: join(base, "bruv-home"),
  HERDR_ENV: "0",
  PI_ACP_PI_COMMAND: join(repo, "dist/bruv"),
  NO_COLOR: "1",
  TERM: "dumb",
  SHELL: "/bin/sh",
  LANG: "C.UTF-8",
  T3_ACP_MCP_ENDPOINT: "http://127.0.0.1:9/synthetic-only",
  T3_ACP_MCP_AUTHORIZATION: "Bearer synthetic-no-real-credential",
};
results.env = env;
let rid = 0;
const prose = (text) => ({
  type: "message",
  id: "msg_" + ++rid,
  role: "assistant",
  content: [{ type: "output_text", text, annotations: [] }],
  phase: "final_answer",
});
const tool = (id, code) => ({
  type: "function_call",
  id: "fc_" + id,
  call_id: id,
  name: "execute",
  arguments: JSON.stringify({ label: "Local bridge research", code }),
});
function fixture(body) {
  const input = body.input ?? [];
  const users = input.filter((i) => i.role === "user");
  const latest = JSON.stringify(users.at(-1)?.content ?? "");
  const called = new Set(input.filter((i) => i.type === "function_call_output").map((i) => i.call_id.split("|")[0]));
  if (latest.includes("CANCEL_PROBE")) return { delay: 12000, items: [prose("SHOULD_NOT_FINISH")] };
  if (latest.includes("LATE_PROBE")) {
    if (!called.has("launch-job"))
      return {
        items: [
          tool(
            "launch-job",
            'console.log(await shell("sleep 4; printf \\"LATE_SHELL_PROOF\\\\n\\"", {waitSeconds:0}));',
          ),
        ],
      };
    return { items: [prose("JOB_STARTED_RETURNING_EARLY")] };
  }
  if (latest.includes("EXECUTE_PROBE")) {
    if (!called.has("simple-execute"))
      return {
        items: [tool("simple-execute", 'console.log(await shell("env | grep ^T3_ACP_MCP_", {waitSeconds:1}));')],
      };
    return { items: [prose("EXECUTE_FINISHED")] };
  }
  if (latest.includes("RESUME_PROBE")) return { items: [prose("RESUME_OK_HISTORY_" + called.size)] };
  if (latest.includes("HELLO_PROBE")) return { items: [prose("HELLO_FROM_LOCAL_RESPONSES")] };
  return { items: [prose("AUTOMATIC_LATE_COMPLETION_OBSERVED")] };
}
function* events(items) {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    yield {
      type: "response.output_item.added",
      output_index: i,
      item: { ...item, status: "in_progress", ...(item.type === "message" ? { content: [] } : { arguments: "" }) },
    };
    if (item.type === "message") {
      yield {
        type: "response.content_part.added",
        output_index: i,
        content_index: 0,
        item_id: item.id,
        part: { type: "output_text", text: "", annotations: [] },
      };
      yield {
        type: "response.output_text.delta",
        output_index: i,
        content_index: 0,
        item_id: item.id,
        delta: item.content[0].text,
      };
    } else
      yield {
        type: "response.function_call_arguments.delta",
        output_index: i,
        item_id: item.id,
        delta: item.arguments,
      };
    yield { type: "response.output_item.done", output_index: i, item: { ...item, status: "completed" } };
  }
  yield {
    type: "response.completed",
    response: {
      id: "resp_" + ++rid,
      status: "completed",
      output: items,
      usage: { input_tokens: 80, output_tokens: 40, total_tokens: 120 },
    },
  };
}
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  log("model-request", { url: req.url, body });
  if (!req.url.endsWith("/responses")) {
    res.writeHead(404);
    res.end();
    return;
  }
  const f = fixture(body);
  if (f.delay) {
    log("cancel-model-start", {});
    res.on("close", () => log("cancel-model-closed", {}));
    await sleep(f.delay);
    if (res.destroyed) return;
  }
  res.writeHead(200, { "Content-Type": "text/event-stream", Connection: "close" });
  for (const ev of events(f.items)) res.write("event: " + ev.type + "\ndata: " + JSON.stringify(ev) + "\n\n");
  res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const endpoint = "http://127.0.0.1:" + server.address().port + "/v1";
writeFileSync(
  join(agentDir, "models.json"),
  JSON.stringify(
    {
      providers: {
        "wrapper-fixture": {
          baseUrl: endpoint,
          api: "openai-responses",
          apiKey: "synthetic-local-only",
          models: [
            { id: "bridge", name: "Bridge fixture", contextWindow: 32000, maxTokens: 2048 },
            { id: "bridge-2", name: "Second bridge fixture", contextWindow: 32000, maxTokens: 2048 },
          ],
        },
      },
    },
    null,
    2,
  ),
);
writeFileSync(
  join(agentDir, "settings.json"),
  JSON.stringify({
    defaultProvider: "wrapper-fixture",
    defaultModel: "bridge",
    quietStartup: true,
    checkForUpdates: false,
  }),
);
class Driver {
  constructor(label) {
    this.label = label;
    this.seq = 0;
    this.pending = new Map();
    this.events = [];
    this.requests = [];
    this.child = spawn(process.execPath, [join(repo, ".cache/acp-bruv-wrapper/package/dist/index.js")], {
      cwd: work,
      env,
    });
    let b = "";
    log(label + ":spawn", { pid: this.child.pid });
    this.child.on("exit", (code, signal) => log(label + ":exit", { code, signal }));
    this.child.stderr.on("data", (d) => log(label + ":stderr", d.toString()));
    this.child.stdout.on("data", (d) => {
      b += d;
      let n;
      while ((n = b.indexOf("\n")) >= 0) {
        const s = b.slice(0, n);
        b = b.slice(n + 1);
        if (!s) continue;
        let x;
        try {
          x = JSON.parse(s);
        } catch {
          log(label + ":invalid", s);
          continue;
        }
        log(label + ":rx", x);
        if (x.method && x.id != null) {
          this.requests.push(x);
          this.send({
            jsonrpc: "2.0",
            id: x.id,
            result:
              x.method === "session/request_permission"
                ? { outcome: { outcome: "selected", optionId: x.params.options[0].optionId } }
                : {},
          });
        } else if (x.id != null) {
          const p = this.pending.get(x.id);
          if (p) {
            this.pending.delete(x.id);
            clearTimeout(p.t);
            x.error ? p.reject(new Error(JSON.stringify(x.error))) : p.resolve(x.result);
          }
        } else this.events.push(x);
      }
    });
  }
  send(x) {
    log(this.label + ":tx", x);
    this.child.stdin.write(JSON.stringify(x) + "\n");
  }
  call(method, params = {}, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("timeout " + method));
      }, timeout);
      this.pending.set(id, { resolve, reject, t });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }
  notify(method, params) {
    this.send({ jsonrpc: "2.0", method, params });
  }
  init() {
    return this.call("initialize", {
      protocolVersion: 2,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: "bruv-through-published-pi-acp-research", version: "1" },
    });
  }
  async close() {
    this.child.stdin.end();
    await Promise.race([new Promise((r) => this.child.once("exit", r)), sleep(1500)]);
    if (this.child.exitCode == null) this.child.kill("SIGTERM");
    for (const p of this.pending.values()) clearTimeout(p.t);
  }
}
async function step(name, fn) {
  log("step:start", { name });
  try {
    const value = await fn();
    results.steps.push({ name, ok: true, value });
    console.log(name, JSON.stringify(value));
    return value;
  } catch (e) {
    results.steps.push({ name, ok: false, error: String(e) });
    console.log(name, String(e));
    return null;
  } finally {
    writeFileSync(join(base, "RESULT.json"), JSON.stringify(results, null, 2));
    log("step:end", { name });
  }
}
let d = new Driver("synthetic");
try {
  await step("initialize", () => d.init());
  const r = await step("session-new", () => d.call("session/new", { cwd: work, mcpServers: [] }));
  if (r)
    await step("synthetic-env-probe", () =>
      d.call("session/prompt", { sessionId: r.sessionId, prompt: [{ type: "text", text: "EXECUTE_PROBE" }] }),
    );
} finally {
  await d.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  writeFileSync(join(base, "RESULT.json"), JSON.stringify(results, null, 2));
}
