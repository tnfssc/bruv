// Loopback deterministic model; all native frames come from the actual connector.
import assert from "node:assert/strict";
import http from "node:http";

import { modelId, nativePermissionContext } from "./model.mjs";

function textResponse(content) {
  return { role: "assistant", content };
}

function executeResponse(code, sequence) {
  return {
    role: "assistant",
    tool_calls: [
      {
        index: 0,
        id: `history_${sequence}`,
        type: "function",
        function: {
          name: "execute",
          arguments: JSON.stringify({ label: "Native history actual tool exchange", code }),
        },
      },
    ],
  };
}

// Decide only from the supplied conversation. Forks import context, not a model
// session's progress or root authority; the child must inspect its own authority.
function historyReply(body, counter, nextToolSequence) {
  const messages = body.messages ?? [];
  const lastUser = messages.findLastIndex((m) => m.role === "user" && !nativePermissionContext(m));
  const user = JSON.stringify(messages[lastUser]?.content ?? "");
  const results = messages
    .slice(lastUser + 1)
    .filter((m) => m.role === "tool")
    .map((m) => JSON.stringify(m.content))
    .join("\n");
  const all = JSON.stringify(messages);

  if (
    user.includes("Write what next agent needs to continue the work.") &&
    user.includes("Summarize the whole conversation above.")
  ) {
    // Background summaries are genuine model requests, not another user action.
    const markers = [...new Set(all.match(/HISTORY_[A-Z_]+|orchid-73/g) ?? [])];
    return textResponse(`## Goal\nLocal native history acceptance.\n## Critical Context\n${markers.join(" ")}`);
  }
  if (!body.tools?.length) return textResponse("Local native history acceptance");

  if (user.includes("HISTORY_SEED")) {
    if (results.includes("HISTORY_TOOL_COMPLETED"))
      return textResponse("HISTORY_CHECKPOINT: original secret is orchid-73; completed tool recorded.");
    return executeResponse(
      `const fs = await import("node:fs/promises");
await fs.appendFile(${JSON.stringify(counter)}, "root-tool\\n");
const q = await questions.ask({
  text: "Native history root-only saved question (do not answer)",
  dedupKey: "history-root-authority",
  choices: ["Retain unanswered"],
  allowFreeText: false,
});
const j = await shell("/usr/bin/printf HISTORY_ROOT_JOB_COMPLETED", { waitSeconds: 3 });
console.log("HISTORY_ROOT_AUTHORITY", JSON.stringify({ question: q, job: j }));
console.log("HISTORY_TOOL_COMPLETED orchid-73");`,
      nextToolSequence,
    );
  }
  if (user.includes("HISTORY_ROOT_FUTURE")) return textResponse("HISTORY_ROOT_FUTURE_RESPONSE: original branch only.");

  if (user.includes("HISTORY_CHILD_CONTINUE")) {
    assert.ok(
      all.includes("orchid-73") && all.includes("HISTORY_TOOL_COMPLETED") && all.includes("HISTORY_CHECKPOINT"),
      "fork has complete checkpoint context",
    );
    assert.ok(!all.includes("HISTORY_ROOT_FUTURE"), "fork excludes later root branch");
    if (results) {
      assert.ok(results.includes("HISTORY_AUTHORITY_EMPTY"), "real child authority inspection");
      return textResponse("HISTORY_CHILD_CONTEXT_OK orchid-73");
    }
    return executeResponse(
      `const j = await jobs.list({ count: 100 });
const q = await questions.list();
console.log("HISTORY_AUTHORITY_INSPECTION", JSON.stringify({ jobs: j, questions: q }));
if ((j.jobs ?? []).length || (Array.isArray(q) ? q : q.questions ?? []).length)
  throw Error("Inherited authority");
console.log("HISTORY_AUTHORITY_EMPTY");`,
      nextToolSequence,
    );
  }
  if (user.includes("HISTORY_CHILD_FUTURE")) {
    assert.ok(
      all.includes("HISTORY_CHILD_CONTEXT_OK") && !all.includes("HISTORY_ROOT_FUTURE"),
      "later turn stays on hydrated child branch",
    );
    return textResponse("HISTORY_CHILD_FUTURE_RESPONSE: removable later turn.");
  }
  if (user.includes("HISTORY_AFTER_ROLLBACK")) {
    assert.ok(
      all.includes("orchid-73") && all.includes("HISTORY_CHILD_CONTEXT_OK"),
      "rollback retained selected child context",
    );
    assert.ok(!all.includes("HISTORY_CHILD_FUTURE"), "rollback excludes discarded turn");
    return textResponse("HISTORY_ROLLBACK_CONTEXT_OK orchid-73");
  }
  if (user.includes("HISTORY_REOPEN")) {
    assert.ok(
      all.includes("HISTORY_ROLLBACK_CONTEXT_OK") && !all.includes("HISTORY_CHILD_FUTURE"),
      "reopen correct branch",
    );
    return textResponse("HISTORY_REOPEN_CONTEXT_OK orchid-73");
  }
  throw Error(`Unrecognized history prompt: ${user.slice(0, 120)}`);
}

export async function startHistoryModel({ counter }) {
  const records = [];
  let toolSequence = 0;
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.writeHead(404);
      res.end();
      return;
    }
    let body;
    try {
      let input = "";
      for await (const b of req) input += b;
      body = JSON.parse(input);
      assert.equal(body.model, modelId);
      const delta = historyReply(body, counter, toolSequence + 1);
      if (delta.tool_calls) toolSequence++;
      records.push({ sequence: records.length + 1, messages: body.messages ?? [], delta });
      res.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = (d, f) => ({
        id: `history-local-${records.length}`,
        object: "chat.completion.chunk",
        created: 1,
        model: modelId,
        choices: [{ index: 0, delta: d, finish_reason: f }],
      });
      res.end(
        `${[chunk(delta, null), chunk({}, delta.tool_calls ? "tool_calls" : "stop")]
          .map((x) => `data: ${JSON.stringify(x)}\n\n`)
          .join("")}data: [DONE]\n\n`,
      );
    } catch (e) {
      records.push({ sequence: records.length + 1, error: e.message, messages: body?.messages });
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: e.message, type: "history_acceptance_error" } }));
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { port: server.address().port, records, close: () => new Promise((r) => server.close(r)) };
}

// Called only on records collected from the real connector. Unit-test inputs are
// explicitly separate from native acceptance evidence.
export function verifyHistoryModelRecords(records) {
  assert.ok(!records.some((r) => r.error), "all real model requests were accepted");
  const rootCalls = records.filter((r) =>
    r.delta?.tool_calls?.some((c) => c.function.arguments.includes("fs.appendFile")),
  );
  const inspections = records.filter((r) =>
    r.delta?.tool_calls?.some((c) => c.function.arguments.includes("jobs.list")),
  );
  assert.equal(rootCalls.length, 1, "exactly one real root execution request");
  assert.equal(inspections.length, 1, "exactly one fresh child inspection request");
  const content = (m) =>
    typeof m.content === "string" ? m.content : (m.content ?? []).map((b) => b.text ?? "").join("\n");
  const pairedResult = (record, marker) => {
    const result = record.messages.find((m) => m.role === "tool" && content(m).includes(marker));
    assert.ok(result, `actual tool result contains ${marker}`);
    assert.ok(
      record.messages.some((m) => m.role === "assistant" && m.tool_calls?.some((c) => c.id === result.tool_call_id)),
      "model sees ID-paired tool exchange",
    );
    return content(result);
  };
  const root = records.find((r) => r.delta?.content?.startsWith("HISTORY_CHECKPOINT:"));
  assert.ok(root, "root checkpoint model request");
  const rootOutput = pairedResult(root, "HISTORY_ROOT_AUTHORITY");
  const authority = JSON.parse(rootOutput.match(/HISTORY_ROOT_AUTHORITY ([^\n]+)/)[1]);
  assert.equal(authority.job.status, "completed");
  assert.equal(authority.job.exitCode, 0);
  assert.equal(authority.job.output, "HISTORY_ROOT_JOB_COMPLETED");
  assert.equal(authority.question.status, "pending");
  assert.ok(authority.question.owner.sessionId);
  const child = records.find((r) => r.delta?.content === "HISTORY_CHILD_CONTEXT_OK orchid-73");
  assert.ok(child, "child continuation model request");
  // Verify the imported exchange on the first child model request, before
  // Bruv may legitimately compact earlier context while executing inspection.
  pairedResult(inspections[0], "HISTORY_ROOT_AUTHORITY");
  const childOutput = pairedResult(child, "HISTORY_AUTHORITY_INSPECTION");
  const empty = JSON.parse(childOutput.match(/HISTORY_AUTHORITY_INSPECTION ([^\n]+)/)[1]);
  assert.deepEqual(empty.jobs.jobs, []);
  assert.equal(empty.jobs.total, 0);
  assert.deepEqual(empty.questions, []);
  for (const [response, required, absent] of [
    ["HISTORY_CHILD_CONTEXT_OK orchid-73", "HISTORY_CHECKPOINT", "HISTORY_ROOT_FUTURE"],
    ["HISTORY_ROLLBACK_CONTEXT_OK orchid-73", "HISTORY_CHILD_CONTEXT_OK", "HISTORY_CHILD_FUTURE"],
    ["HISTORY_REOPEN_CONTEXT_OK orchid-73", "HISTORY_ROLLBACK_CONTEXT_OK", "HISTORY_CHILD_FUTURE"],
  ]) {
    const r = records.find((r) => r.delta?.content === response);
    assert.ok(r, `actual continuation ${response}`);
    const context = JSON.stringify(r.messages);
    assert.ok(context.includes(required));
    assert.ok(!context.includes(absent));
  }
  return { completedPairedRootExchange: true, childAuthorityEmpty: true, actualContinuationContextVerified: true };
}
