// Deterministic loopback model driving REAL T3 tools; never a T3 endpoint substitute.
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { modelId, modelsConfig, nativePermissionContext } from "./model.mjs";
export const workerProvider = "bruv-worker-acceptance",
  workerId = "local-normal-v1",
  workerSlug = `${workerProvider}/${workerId}`;
export const workerInstance = "bruv-native-normal";
export function workerModels(port) {
  const config = modelsConfig(port).providers["bruv-acceptance"];
  return {
    providers: {
      [workerProvider]: {
        ...config,
        api: "openai-responses",
        models: [{ ...config.models[0], id: workerId, name: "Local normal worker (not Claude)", reasoning: true }],
      },
    },
  };
}
const text = (m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""));
const content = (s) => ({ content: s });
function tool(body, name, input) {
  const found = body.tools?.find((t) => t.function.name.endsWith(name));
  if (!found) throw Error(`Actual injected tool missing: ${name}`);
  return {
    tool_calls: [
      {
        index: 0,
        id: `call_${body.__sequence}`,
        type: "function",
        function: { name: found.function.name, arguments: JSON.stringify(input) },
      },
    ],
  };
}
function objects(messages) {
  const out = [];
  const visit = (v) => {
    if (typeof v === "string") {
      try {
        visit(JSON.parse(v));
      } catch {}
    } else if (Array.isArray(v)) {
      for (const x of v) visit(x);
    } else if (v && typeof v === "object") {
      out.push(v);
      if (v.text) visit(v.text);
      if (v.content) visit(v.content);
    }
  };
  for (const msg of messages.filter((m) => m.role === "tool")) visit(msg.content);
  return out;
}
export async function reply(body, { state }) {
  if (!body.tools?.length) return content("Local delegation acceptance");
  const messages = body.messages ?? [];
  const lastUser = messages.findLastIndex((m) => m.role === "user" && !nativePermissionContext(m));
  const user = text(messages[lastUser] ?? {});
  const tools = messages.slice(lastUser + 1).filter((m) => m.role === "tool");

  // Normal children must fail both delegation routes and root-task access.
  if (body.model === workerId)
    return checkNormalWorkerScopeAndWait(body, state, tools, user.includes("APP_CHILD_CANCEL") ? "cancel" : "done");
  if (body.model !== modelId) throw Error(`Unexpected app-delegation model: ${body.model}`);

  // Root tools operate on native app-owned tasks, never Bruv registry jobs.
  if (user.includes("APP_DELEGATE_"))
    return launchAppTask(body, state, tools, user.includes("APP_DELEGATE_CANCEL") ? "cancel" : "done");
  if (user.includes("APP_CANCEL")) return cancelAppTask(body, state, tools);
  // Native completion delivery wakes this root; task_status inspects/ACKs the saved ID.
  return acknowledgeAppCompletion(body, state, tools);
}

// Each operation advances from the current turn's tool transcript, not a separate stage counter.
async function checkNormalWorkerScopeAndWait(body, state, tools, scenario) {
  const results = tools.map(text).join("\n");
  if (!tools.length)
    return tool(body, "__delegate_task", { task: "Worker must be denied", clientRequestId: "worker-denied" });
  if (!results.includes("App delegation needs root orchestrator. Normal workers cannot delegate."))
    throw Error(`Worker delegation was not denied: ${results.slice(0, 250)}`);
  if (tools.length === 1)
    return tool(body, "execute", {
      label: "Attempt local worker delegation",
      code: 'try { await subagent({prompt:"Must be denied",type:"normal"}); throw Error("unexpected admission"); } catch(e) { console.log("LOCAL_WORKER_DENIAL_REAL",e.message); }',
    });
  if (!results.includes("Only orchestrator agents can delegate"))
    throw Error(`Normal local worker delegation admitted: ${results.slice(-300)}`);
  if (tools.length === 2)
    return tool(body, "execute", {
      label: "Inspect scoped child environment",
      code: 'console.log("CHILD_SCOPE_REAL", JSON.stringify({rootControls:Object.keys(process.env).filter(k=>/^(T3_|BRUV_T3_|BRUV_ROOT_|BRUV_REMOTE_ROOT_)/.test(k)),jobs:(await jobs.list({count:100})).jobs.length}));',
    });
  if (!results.includes('"rootControls":[],"jobs":0'))
    throw Error(`Root controls leaked into execute: ${results.slice(-300)}`);
  if (tools.length === 3) {
    const until = Date.now() + 10000;
    let task;
    while (Date.now() < until) {
      try {
        task = JSON.parse(await fs.readFile(path.join(state, `${scenario}.task.json`), "utf8"));
        break;
      } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
    if (!task) throw Error("Root launch result unavailable for child-scope check");
    return tool(body, "__task_status", { taskId: task.taskId });
  }
  if (!results.includes("does not belong to thread"))
    throw Error(`Child credential could read root app task: ${results.slice(-400)}`);
  await fs.writeFile(path.join(state, `${scenario}.scope-denial.json`), results);
  await fs.writeFile(path.join(state, `${scenario}.started`), "real normal child model reached scoped execute");
  const until = Date.now() + 45000;
  while (Date.now() < until) {
    try {
      await fs.access(path.join(state, `${scenario}.release`));
      return content(`APP_CHILD_RESULT_REAL_${scenario}`);
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Child release timed out");
}

async function launchAppTask(body, state, tools, scenario) {
  const results = tools.map(text).join("\n");
  if (!tools.length) return tool(body, "__orchestrator_capabilities", {});
  if (tools.length === 1) {
    await fs.writeFile(path.join(state, "capabilities.json"), results);
    if (!results.includes(workerInstance) || !results.includes(workerSlug))
      throw Error("Real capabilities omit named worker/model");
    return tool(body, "__delegate_task", {
      task:
        "APP_CHILD_" +
        (scenario === "cancel" ? "CANCEL" : "DONE") +
        ": exercise denied delegation and scoped credentials, then wait for release.",
      title: `Native normal ${scenario}`,
      clientRequestId: `actual-native-${scenario}`,
    });
  }
  const task = objects(tools).find((o) => o.taskId && o.childThreadId);
  if (!task) throw Error(`Native server did not return a taskId/childThreadId: ${results.slice(-600)}`);
  await fs.writeFile(path.join(state, `${scenario}.task.json`), JSON.stringify(task));
  return content(`APP_TASK_PENDING_REAL_${scenario}`);
}

async function cancelAppTask(body, state, tools) {
  const results = tools.map(text).join("\n");
  const task = JSON.parse(await fs.readFile(path.join(state, "cancel.task.json"), "utf8"));
  if (!tools.length) return tool(body, "__task_cancel", { taskId: task.taskId });
  if (tools.length === 1) return tool(body, "__task_status", { taskId: task.taskId });
  const latest = objects(tools).findLast((o) => o.taskId === task.taskId && o.childThreadId && o.status);
  if (!latest || ["running", "pending", "cancel_requested"].includes(latest.status)) {
    await new Promise((r) => setTimeout(r, 100));
    return tool(body, "__task_status", { taskId: task.taskId });
  }
  if (latest.status !== "interrupted") throw Error(`Unexpected actual native cancellation terminal: ${latest.status}`);
  if (!results.includes("ROOT_JOBS_REAL"))
    return tool(body, "execute", {
      label: "Inspect actual root job registry",
      code: 'console.log("ROOT_JOBS_REAL", JSON.stringify((await jobs.list({count:100})).jobs));',
    });
  if (!results.includes("ROOT_JOBS_REAL []")) throw Error("App-owned native task duplicated in root Bruv registry");
  await fs.writeFile(path.join(state, "cancel.status.json"), results);
  return content("APP_CANCEL_CONFIRMED_REAL");
}

async function acknowledgeAppCompletion(body, state, tools) {
  const results = tools.map(text).join("\n");
  const task = JSON.parse(await fs.readFile(path.join(state, "done.task.json"), "utf8"));
  if (!tools.length) return tool(body, "__task_status", { taskId: task.taskId });
  if (!results.includes("APP_CHILD_RESULT_REAL_done"))
    throw Error(`Native task_status omitted child result: ${results.slice(-600)}`);
  await fs.writeFile(path.join(state, "done.status.json"), results);
  return content("APP_COMPLETION_ACK_REAL");
}

/** Actual Responses API fixture: the normal reasoning provider supports native summaries.
 * T3/connector packets still come only from their actual runtimes. */
export async function startWorkerModel({ state }) {
  const records = [];
  let sequence = 1000;
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url !== "/v1/responses") throw Error(`Unexpected worker API path: ${req.url}`);
      let input = "";
      for await (const chunk of req) input += chunk;
      const raw = JSON.parse(input),
        seq = ++sequence;
      const messages = (raw.input ?? []).map((item) =>
        item.type === "function_call_output"
          ? { role: "tool", content: item.output }
          : item.type === "function_call"
            ? {
                role: "assistant",
                content: "",
                tool_calls: [{ id: item.call_id, function: { name: item.name, arguments: item.arguments } }],
              }
            : {
                role: item.role,
                content:
                  typeof item.content === "string"
                    ? item.content
                    : (item.content ?? []).map((c) => c.text ?? "").join("\n"),
              },
      );
      const body = {
        ...raw,
        messages,
        tools: (raw.tools ?? []).filter((t) => t.type === "function").map((t) => ({ function: t })),
        __sequence: seq,
      };
      if (raw.model !== workerId || raw.reasoning?.effort !== "high" || raw.reasoning?.summary !== "auto")
        throw Error("Normal worker did not receive exact model/high reasoning/native summary");
      const delta = await reply(body, { state });
      records.push({
        sequence: seq,
        model: raw.model,
        reasoningEffort: raw.reasoning.effort,
        reasoningSummary: raw.reasoning.summary,
        messages,
        delta,
      });
      const fn = delta.tool_calls?.[0];
      const item = fn
        ? {
            type: "function_call",
            id: `fc_${seq}`,
            call_id: fn.id,
            name: fn.function.name,
            arguments: fn.function.arguments,
            status: "completed",
          }
        : {
            type: "message",
            id: `msg_${seq}`,
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: delta.content, annotations: [] }],
          };
      const events = [
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { ...item, ...(fn ? { arguments: "" } : { content: [] }) },
        },
        ...(fn
          ? []
          : [{ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: delta.content }]),
        { type: "response.output_item.done", output_index: 0, item },
        {
          type: "response.completed",
          response: {
            id: `resp_${seq}`,
            status: "completed",
            output: [item],
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          },
        },
      ];
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(
        events.map((e, i) => `event: ${e.type}\ndata: ${JSON.stringify({ ...e, sequence_number: i })}\n\n`).join(""),
      );
    } catch (e) {
      records.push({ sequence, error: e.message });
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: e.message, type: "worker_acceptance_error" } }));
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { port: server.address().port, records, close: () => new Promise((r) => server.close(r)) };
}
