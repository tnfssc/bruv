// This is a deterministic test model, NOT Claude or a connector implementation.

import { readFileSync } from "node:fs";
import http from "node:http";
export const provider = "bruv-acceptance";
export const modelId = "local-deterministic-v1";
export const modelSlug = `${provider}/${modelId}`;
export function modelsConfig(port) {
  return {
    providers: {
      [provider]: {
        api: "openai-completions",
        baseUrl: `http://127.0.0.1:${port}/v1`,
        apiKey: "fixture-only-not-a-credential",
        models: [
          {
            id: modelId,
            name: "Local deterministic acceptance model (not Claude)",
            reasoning: false,
            input: ["text"],
            contextWindow: 32000,
            maxTokens: 2048,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        ],
      },
    },
  };
}
function text(m) {
  return typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
}

function nativePermissionContext(message) {
  const content =
    typeof message.content === "string"
      ? message.content
      : (message.content ?? []).map((block) => (block.type === "text" ? block.text : "")).join("\n");
  return /^Native permission state: [^.]+\. Available tools: [^\n]+\.$/.test(content);
}

function isCancellationNotice(user, messages, worker, state) {
  if (!user.includes("asynchronous task completed.") || !user.includes(" killed")) return false;
  // A full command identifies isolated inputs; actual job notices may shorten it.
  if (user.includes(worker) && user.includes(" cancel")) return true;
  const killedId = user.match(/(task_[a-z0-9]+) killed\b/)?.[1];
  if (!killedId) return false;
  // The launch saves its owned ID before stopping. A prior real inspection also
  // identifies the job when the notification's command preview was shortened.
  let actualCancelledId;
  try {
    actualCancelledId = readFileSync(`${state}/cancel.job-id`, "utf8").trim();
  } catch {}
  return (
    killedId === actualCancelledId ||
    messages.some(
      (m) =>
        m.role === "tool" && text(m).includes("CANCEL_INSPECT_REAL") && new RegExp(`\\b${killedId}\\b`).test(text(m)),
    )
  );
}
export function reply(body, { worker, state }) {
  if (body.model !== modelId) throw Error(`Wrong test model identity: ${body.model}`);
  const messages = body.messages ?? [],
    lastUser = messages.findLastIndex((m) => m.role === "user" && !nativePermissionContext(m));
  const user = text(messages[lastUser] ?? {}),
    tail = messages.slice(lastUser + 1),
    results = tail
      .filter((m) => m.role === "tool")
      .map(text)
      .join("\n");
  const execute = (code) => ({
    role: "assistant",
    tool_calls: [
      {
        index: 0,
        id: `acceptance_${body.__sequence ?? 1}`,
        type: "function",
        function: { name: "execute", arguments: JSON.stringify({ label: "Acceptance real runtime exercise", code }) },
      },
    ],
  });
  const content = (value) => ({ role: "assistant", content: value });
  const workerCommand = (scenario) =>
    `${JSON.stringify(process.execPath)} ${JSON.stringify(worker)} ${JSON.stringify(state)} ${scenario}`;
  const shellCode = (scenario, wait) => `
    const r = await shell(${JSON.stringify(workerCommand(scenario))}, {waitSeconds:${wait}});
    console.log(JSON.stringify(r));
  `;
  if (isCancellationNotice(user, messages, worker, state)) return content("CANCELLATION_COMPLETED_REAL");
  if (user.includes("Saved answer for ")) {
    if (results.includes("QUESTION_RESOLVED_ACTUAL")) return content("HUMAN_ANSWER_DELIVERED_ONCE_REAL");
    return execute(`
      const qs = await questions.list();
      const q = qs.find(q => q.dedupKey === "human-controls-acceptance");
      if (!q || q.answer !== "Use local fixture" || q.status !== "answered")
        throw Error("No saved human answer");
      const resolved = await questions.resolve({
        id: q.id, owner: q.owner, version: q.version,
        reason: "Acceptance used explicit saved human answer"
      });
      console.log("QUESTION_RESOLVED_ACTUAL", JSON.stringify(resolved));
    `);
  }
  if (user.includes("HUMAN_PERMISSION_")) {
    const scenario = user.match(/HUMAN_PERMISSION_(allow|deny|stop)/)?.[1];
    if (!scenario) throw Error("Unknown permission scenario");
    if (results) return content(`HUMAN_PERMISSION_${scenario}_RESULT_REAL`);
    return execute(`
      await Bun.write(${JSON.stringify(`${state}/permission-${scenario}.effect`)}, "actual side effect after consent");
      console.log("PERMISSION_SIDE_EFFECT_REAL");
    `);
  }
  if (user.includes("HUMAN_QUESTION_ASK"))
    return results
      ? content("HUMAN_QUESTION_SAVED_REAL")
      : execute(`
          const q = await questions.ask({
            text: "Acceptance saved human question", dedupKey: "human-controls-acceptance",
            choices: ["Use local fixture", "Cancel"], allowFreeText: false
          });
          await questions.block({
            id: q.id, owner: q.owner, version: q.version,
            checkpoint: "Use the saved human answer", foreground: false
          });
          console.log("QUESTION_SAVED_ACTUAL", JSON.stringify(q));
        `);
  if (user.includes("HUMAN_CONTINUE")) return content("HUMAN_CONTINUED_REAL");
  if (user.includes("ACCEPT_STEER_NOW")) return content("STEER_ADMITTED_REAL");
  if (user.includes("ACCEPT_EXECUTE"))
    return results.includes("BRUV_EXECUTE_REAL")
      ? content("EXECUTE_CONFIRMED_REAL")
      : execute('console.log("BRUV_EXECUTE_REAL")');
  if (user.includes("ACCEPT_STEER"))
    return results ? content("STEER_TOOL_RETURNED_REAL") : execute(shellCode("steer", 30));
  if (user.includes("ACCEPT_EARLY_RETURN")) {
    if (user.includes("MANAGED_DONE_early") || results.includes("MANAGED_DONE_early"))
      return content("TASK_COMPLETED_REAL");
    if (results.includes('"background":true') && /task_/.test(results)) return content("EARLY_RETURN_REAL");
    if (results) throw Error(`Expected actual managed background launch, got ${results.slice(0, 200)}`);
    return execute(shellCode("early", 0));
  }
  if (user.includes("ACCEPT_CANCEL")) {
    if (results) {
      if (!results.includes("CANCEL_INSPECT_REAL")) throw Error("Cancellation did not produce terminal inspection");
      return content("CANCEL_CONFIRMED_REAL");
    }
    return execute(`
      const job = await shell(${JSON.stringify(workerCommand("cancel"))}, {waitSeconds:0});
      if (!job.background) throw Error("Expected fresh owned background job");
      await Bun.write(${JSON.stringify(`${state}/cancel.job-id`)}, job.id);
      console.log(JSON.stringify(await jobs.stop(job.id)));
      const deadline = Date.now() + 10000;
      let inspected;
      do {
        inspected = await jobs.inspect(job.id);
        if (["killed", "cancelled", "stopped"].includes(inspected.status)) break;
        await new Promise(r => setTimeout(r, 25));
      } while (Date.now() < deadline);
      if (!["killed", "cancelled", "stopped"].includes(inspected.status))
        throw Error("Cancellation not confirmed: " + inspected.status);
      console.log("CANCEL_INSPECT_REAL", JSON.stringify(inspected));
    `);
  }
  if (user.includes("ACCEPT_STOP"))
    return results ? content("STOP_TOOL_RETURNED_REAL") : execute(shellCode("stop", 30));
  if (user.includes("ACCEPT_QUESTION"))
    return results
      ? content("SAVED_QUESTION_CREATED_REAL")
      : execute(`
          const q = await questions.ask({
            text: "Acceptance saved human question", dedupKey: "native-acceptance",
            choices: ["Use local fixture", "Cancel"], allowFreeText: false
          });
          console.log(JSON.stringify(q));
        `);
  if (user.includes("ACCEPT_PERMISSION"))
    return results ? content("PERMISSION_RESULT_REAL") : execute('console.log("PERMISSION_EXECUTE_REAL")');
  // Bruv wake messages contain real worker output; never manufacture completion.
  if (user.includes("MANAGED_DONE_early")) return content("TASK_COMPLETED_REAL");
  if (user.includes("ACCEPT_REOPEN")) return content("REOPEN_CONFIRMED_REAL");
  // T3 title/other auxiliary requests are local too; no fake schema output.
  if (!body.tools?.length) return content("Local acceptance thread");
  throw Error(`Unrecognized acceptance request: ${user.slice(0, 160)}`);
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
    let requestSequence;
    const controller = new AbortController();
    res.once("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      let input = "";
      for await (const b of req) input += b;
      const body = JSON.parse(input);
      requestSequence = ++sequence;
      body.__sequence = requestSequence;
      const chunk = (d, finish) => ({
        id: `local-acceptance-${requestSequence}`,
        object: "chat.completion.chunk",
        created: 1,
        model: body.model,
        choices: [{ index: 0, delta: d, finish_reason: finish }],
      });
      const emit = (delta) => {
        controller.signal.throwIfAborted();
        if (!res.headersSent) res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`data: ${JSON.stringify(chunk(delta, null))}\n\n`);
      };
      const delta = options.reply
        ? await options.reply(body, { ...options, signal: controller.signal, emit })
        : reply(body, options);
      records.push({
        sequence: requestSequence,
        model: body.model,
        reasoningEffort: body.reasoning_effort,
        messages: body.messages,
        delta,
      });
      if (!res.headersSent) res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(
        `${[
          chunk(delta, null),
          chunk({}, delta.tool_calls ? "tool_calls" : "stop"),
          ...(options.usage ? [{ ...chunk({}, null), choices: [], usage: options.usage }] : []),
        ]
          .map((v) => `data: ${JSON.stringify(v)}\n\n`)
          .join("")}data: [DONE]\n\n`,
      );
    } catch (e) {
      if (controller.signal.aborted) {
        records.push({ sequence: requestSequence ?? sequence, aborted: true });
        return;
      }
      records.push({ sequence: requestSequence ?? sequence, error: e.message });
      if (res.headersSent) {
        res.destroy(e);
        return;
      }
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: e.message, type: "acceptance_model_error" } }));
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    port: server.address().port,
    records,
    close: () => {
      server.closeAllConnections();
      return new Promise((r) => server.close(r));
    },
  };
}
