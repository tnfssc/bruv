// Deterministic loopback model. Both root connector and real normal Bruv use this exact identity.
import http from "node:http";
import path from "node:path";
import { provider, modelId, modelSlug, modelsConfig } from "./model.mjs";
export { provider, modelId, modelSlug, modelsConfig };
export const cancelTitle = "Actual local cancelled normal worker";
export const stopTitle = "Actual local Stop-owned normal worker";
export const title = "Actual local normal acceptance worker";
const text = (m) => (typeof m?.content === "string" ? m.content : JSON.stringify(m?.content ?? ""));
export function reply(body, { state }) {
  if (body.model !== modelId) throw Error(`Wrong model identity: ${body.model}`);
  const messages = body.messages ?? [],
    last = messages.findLastIndex((m) => m.role === "user");
  const user = text(messages[last]),
    results = messages
      .slice(last + 1)
      .filter((m) => m.role === "tool")
      .map(text)
      .join("\n");
  const answer = (content) => ({ role: "assistant", content });
  const execute = (code) => ({
    role: "assistant",
    tool_calls: [
      {
        index: 0,
        id: `actual_subagent_${body.__sequence}`,
        type: "function",
        function: { name: "execute", arguments: JSON.stringify({ label: "Actual local subagent acceptance", code }) },
      },
    ],
  });
  // Actual async notification, including killed jobs: never discard a real terminal wake.
  if (user.includes("asynchronous task completed.")) {
    if (user.includes("CHILD_ANSWER_REAL")) return answer("ROOT_COMPLETION_ONCE_REAL");
    if (/killed|cancelled/.test(user)) return answer("ROOT_KILLED_COMPLETION_REAL");
    throw Error(`Unexpected real completion: ${user.slice(0, 200)}`);
  }
  if (/CHILD_(?:LOCAL|CANCEL|STOP)_REAL/.test(user)) {
    const scenario = user.includes("CHILD_CANCEL_REAL")
      ? "cancel"
      : user.includes("CHILD_STOP_REAL")
        ? "stop"
        : "child";
    if (results.includes("CHILD_TOOL_RESULT_REAL")) return answer("CHILD_ANSWER_REAL");
    if (results) throw Error(`Child tool failed: ${results.slice(0, 300)}`);
    return execute(`
      const fs = await import("node:fs/promises");
      await fs.writeFile(${JSON.stringify(path.join(state, `${scenario}.ready`))}, String(process.pid));
      const until = Date.now() + 30000;
      while (true) {
        try {
          await fs.access(${JSON.stringify(path.join(state, `${scenario}.release`))});
          break;
        } catch {}
        if (Date.now() > until) throw Error("Child release timeout");
        await new Promise(r => setTimeout(r, 50));
      }
      console.log("CHILD_TOOL_RESULT_REAL");
    `);
  }
  if (user.includes("ACCEPT_LOCAL_CANCEL") || user.includes("ACCEPT_LOCAL_STOP")) {
    const stop = user.includes("ACCEPT_LOCAL_STOP"),
      scenario = stop ? "stop" : "cancel";
    if (results) {
      if (!stop && !results.includes("CANCEL_INSPECT_REAL")) throw Error("Actual cancellation not confirmed");
      return answer(stop ? "UNEXPECTED_STOP_RETURN" : "ROOT_CANCEL_CONFIRMED_REAL");
    }
    // Both roots wait for the real child's tool to start before exercising cancellation.
    const launchAndWait = `
      const fs = await import("node:fs/promises");
      const r = await subagent({
        type: "normal",
        title: ${JSON.stringify(stop ? stopTitle : cancelTitle)},
        prompt: ${JSON.stringify(
          stop
            ? "CHILD_STOP_REAL: run the actual waiting child tool."
            : "CHILD_CANCEL_REAL: run the actual waiting child tool.",
        )},
        waitSeconds: 0,
      });
      if (!r.background) throw Error("Not backgrounded");
      const task = await jobs.inspect(r.id);
      await fs.writeFile(${JSON.stringify(path.join(state, `${scenario}.worker.pid`))}, String(task.pid));
      const until = Date.now() + 30000;
      while (true) {
        try {
          await fs.access(${JSON.stringify(path.join(state, `${scenario}.ready`))});
          break;
        } catch {}
        if (Date.now() > until) throw Error("Worker did not execute");
        await new Promise(r => setTimeout(r, 50));
      }
    `;
    if (stop) {
      // Keep the root tool alive: native Stop, not this tool, must close the owned subtree.
      return execute(`${launchAndWait}
        await fs.writeFile(${JSON.stringify(path.join(state, "stop.root-tool.pid"))}, String(process.pid));
        await new Promise(r => setTimeout(r, 30000));
      `);
    }
    // An explicit cancellation report is not enough; observe the terminal job as well.
    return execute(`${launchAndWait}
      console.log(JSON.stringify(await jobs.stop(r.id)));
      let final;
      do {
        final = await jobs.inspect(r.id);
        if (final.status === "killed") break;
        await new Promise(r => setTimeout(r, 25));
      } while (Date.now() < until);
      if (final.status !== "killed") throw Error("Cancel not terminal: " + final.status);
      console.log("CANCEL_INSPECT_REAL", JSON.stringify(final));
    `);
  }
  if (user.includes("ACCEPT_LOCAL_SUBAGENT")) {
    if (results) {
      if (!results.includes('"background":true') || !results.includes("task_"))
        throw Error(`Not an actual background launch: ${results}`);
      return answer("ROOT_BACKGROUND_RETURN_REAL");
    }
    return execute(`
      const r = await subagent({
        type: "normal",
        title: ${JSON.stringify(title)},
        prompt: "CHILD_LOCAL_REAL: execute the local acceptance tool and return its actual result.",
        waitSeconds: 0,
      });
      console.log(JSON.stringify(r));
    `);
  }
  if (user.includes("ACCEPT_LOCAL_AFTER_CHILD")) return answer("ROOT_AFTER_CHILD_REAL");
  if (user.includes("ACCEPT_LOCAL_FOLLOWUP")) return answer("ROOT_FOLLOWUP_REAL");
  if (!body.tools?.length) return answer("Local normal worker acceptance");
  throw Error(`Unknown local-subagent request: ${user.slice(0, 200)}`);
}
export async function startModel(options) {
  const records = [];
  let sequence = 0;
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      let input = "";
      for await (const b of req) input += b;
      const body = JSON.parse(input);
      body.__sequence = ++sequence;
      const delta = reply(body, options);
      records.push({ sequence, model: body.model, messages: body.messages, delta });
      const chunk = (d, finish) => ({
        id: `actual-local-${sequence}`,
        object: "chat.completion.chunk",
        created: 1,
        model: modelId,
        choices: [{ index: 0, delta: d, finish_reason: finish }],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
      });
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(
        `${[chunk(delta, null), chunk({}, delta.tool_calls ? "tool_calls" : "stop")]
          .map((v) => `data: ${JSON.stringify(v)}\n\n`)
          .join("")}data: [DONE]\n\n`,
      );
    } catch (e) {
      records.push({ sequence, error: e.message });
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: e.message, type: "acceptance_model_error" } }));
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { port: server.address().port, records, close: () => new Promise((r) => server.close(r)) };
}
