import { spawn } from "node:child_process";
import { writeFileSync, appendFileSync, existsSync, openSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { createServer } from "node:http";
const base = resolve(import.meta.dirname),
  repo = process.env.BRUV_PARENT_REPO ?? "/home/tnfssc/Code/bruv";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (kind, data) =>
  appendFileSync(join(base, "model-summary.ndjson"), `${JSON.stringify({ time: Date.now(), kind, data })}\n`);
let rid = 0;
const prose = (text) => ({
  type: "message",
  id: `msg_${++rid}`,
  role: "assistant",
  content: [{ type: "output_text", text, annotations: [] }],
  phase: "final_answer",
});
const tool = (id, code) => ({
  type: "function_call",
  id: `fc_${id}`,
  call_id: id,
  name: "execute",
  arguments: JSON.stringify({ label: "Filtered-launch local research", code }),
});
function fixture(body) {
  const input = body.input ?? [];
  const latest = JSON.stringify(input.filter((i) => i.role === "user").at(-1)?.content ?? "");
  const called = new Set(input.filter((i) => i.type === "function_call_output").map((i) => i.call_id.split("|")[0]));
  log("request", {
    marker:
      ["EXECUTE_PROBE", "LATE_PROBE", "CONCURRENT_PROBE", "asynchronous task completed"].find((x) =>
        latest.includes(x),
      ) ?? "other",
    toolOutputIds: [...called],
  });
  if (latest.includes("asynchronous task completed"))
    return { items: [prose("AUTOMATIC_LATE_COMPLETION_OBSERVED_FILTERED")] };
  if (latest.includes("EXECUTE_PROBE")) {
    if (!called.has("filtered-execute"))
      return {
        items: [
          tool(
            "filtered-execute",
            'console.log("ENGINE_T3_NAMES",Object.keys(process.env).filter(k=>/^(T3_|T3CODE_)/.test(k))); console.log(await shell("node -e \'console.log(JSON.stringify({shellT3Names:Object.keys(process.env).filter(k=>/^(T3_|T3CODE_)/.test(k)),electronPresent:!!process.env.ELECTRON_RUN_AS_NODE}))\'",{waitSeconds:1})); await Bun.write("execute-proof.txt","UNCHANGED_COMPILED_BRUV_EXECUTE_FILTERED\\n"); console.log("EXECUTE_REAL_BRUV_PROOF_FILTERED");',
          ),
        ],
      };
    return { items: [prose("EXECUTE_FINISHED_FILTERED")] };
  }
  if (latest.includes("STOP_PROBE")) {
    if (!called.has("stop-job"))
      return {
        items: [
          tool(
            "stop-job",
            "console.log(await shell(\"sleep 12; printf 'STOP_BACKGROUND_SURVIVED\\n'; printf 'survived\\n' > stop-survived.txt\",{waitSeconds:0}));",
          ),
        ],
      };
    return { items: [prose("STOP_JOB_STARTED")] };
  }
  if (latest.includes("LATE_PROBE")) {
    if (!called.has("filtered-late-job"))
      return {
        items: [
          tool(
            "filtered-late-job",
            "console.log(await shell(\"sleep 18; printf 'LATE_SHELL_PROOF_FILTERED\\n'; printf 'LATE_FILE_FILTERED\\n' > late-proof.txt\",{waitSeconds:0}));",
          ),
        ],
      };
    return { items: [prose("JOB_STARTED_RETURNING_EARLY_FILTERED")] };
  }
  if (latest.includes("CONCURRENT_PROBE"))
    return { delay: 1800, items: [prose("CONCURRENT_FOLLOWUP_COMPLETE_FILTERED")] };
  return { items: [prose("LOCAL_FILTERED_FIXTURE_READY")] };
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
      id: `resp_${++rid}`,
      status: "completed",
      output: items,
      usage: { input_tokens: 80, output_tokens: 40, total_tokens: 120 },
    },
  };
}

const fixtureServer = createServer(async (req, res) => {
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
  if (!req.url.endsWith("/responses")) {
    res.writeHead(404);
    res.end();
    return;
  }
  const f = fixture(body);
  if (f.delay) await sleep(f.delay);
  if (res.destroyed) return;
  log("response", { items: f.items.map((x) => ({ type: x.type, name: x.name, text: x.content?.[0]?.text })) });
  res.writeHead(200, { "Content-Type": "text/event-stream", Connection: "close" });
  for (const ev of events(f.items)) res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
  res.end();
});
await new Promise((r) => fixtureServer.listen(0, "127.0.0.1", r));
const agentDir = join(base, "agent"),
  home = join(base, "home");
writeFileSync(
  join(agentDir, "models.json"),
  JSON.stringify({
    providers: {
      "wrapper-fixture": {
        baseUrl: `http://127.0.0.1:${fixtureServer.address().port}/v1`,
        api: "openai-responses",
        apiKey: "synthetic-local-only",
        models: [{ id: "bridge", name: "Bridge research fixture", contextWindow: 32000, maxTokens: 2048 }],
      },
    },
  }),
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
const env = {
  PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
  HOME: home,
  XDG_CONFIG_HOME: join(home, ".config"),
  XDG_CACHE_HOME: join(home, ".cache"),
  BRUV_CODING_AGENT_DIR: agentDir,
  PI_CODING_AGENT_DIR: agentDir,
  BRUV_HOME: join(base, "bruv-home"),
  HERDR_ENV: "0",
  PI_ACP_BRUV_PROTOTYPE: "1",
  PI_ACP_PROOF_TRACE: join(base, "rpc-metadata.ndjson"),
  PI_ACP_PI_COMMAND: join(repo, "dist/bruv"),
  NO_COLOR: "1",
  TERM: "dumb",
  SHELL: "/bin/sh",
  LANG: "C.UTF-8",
};
const t3 = spawn(
  join(repo, ".cache/acp-t3-upstream-experience/platform/t3"),
  [
    "start",
    "--mode",
    "web",
    "--host",
    "127.0.0.1",
    "--port",
    String(process.env.PROOF_PORT ?? 18783),
    "--base-dir",
    join(base, "t3-base"),
    "--no-browser",
    "--auto-bootstrap-project-from-cwd",
    join(base, "project"),
  ],
  {
    cwd: join(base, "project"),
    env,
    stdio: [
      "ignore",
      openSync(join(base, "server-private.log"), "w", 0o600),
      openSync(join(base, "server-private-error.log"), "w", 0o600),
    ],
  },
);
writeFileSync(
  join(base, "runner-ready.json"),
  JSON.stringify({
    t3Pid: t3.pid,
    fixturePort: fixtureServer.address().port,
    launch: "EXPLICITLY MODIFIED RESEARCH LAUNCH",
    registeredExecutable: process.env.PROOF_ADAPTER,
  }),
);
let done = false;
const end = () => {
  if (done) return;
  done = true;
  t3.kill("SIGTERM");
  fixtureServer.closeAllConnections();
  fixtureServer.close();
};
process.on("SIGTERM", end);
process.on("SIGINT", end);
t3.on("exit", (code, signal) => {
  log("t3-exit", { code, signal });
  end();
});
const deadline = Date.now() + 300000;
while (!done && Date.now() < deadline && !existsSync(join(base, "runner-stop"))) await sleep(300);
end();
