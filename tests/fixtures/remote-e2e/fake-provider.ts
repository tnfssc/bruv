/** Deterministic OpenAI-compatible stream; no real credentials or outbound requests. */
import { appendFileSync, writeFileSync, existsSync } from "node:fs";
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 18765,
  async fetch(request) {
    if (request.method !== "POST" || !new URL(request.url).pathname.endsWith("/chat/completions"))
      return new Response("not found", { status: 404 });
    const body = (await request.json()) as {
      messages?: Array<{ role: string; tool_call_id?: string; content?: unknown }>;
    };
    const questionTask = (body.messages ?? []).some(
      (m) => m.role === "user" && JSON.stringify(m.content).includes("REMOTE_FIXTURE_QUESTION"),
    );
    const answered = questionTask && (body.messages ?? []).some(
      (m) => JSON.stringify(m.content).includes("REMOTE_FIXTURE_ANSWER_ACCEPTED"),
    );
    const calls = (body.messages ?? []).filter(
      (item) => item.role === "tool" && item.tool_call_id === "fixture-remote-execute",
    );
    appendFileSync(
      "/tmp/fixture-owner-provider-requests",
      JSON.stringify({ calls: calls.length, at: Date.now() }) + "\n",
    );
    if (answered) writeFileSync("/tmp/fixture-native-answer-finished", "yes");
    const finished = !questionTask && existsSync("/tmp/fixture-owner-job-finished");
    if (finished) writeFileSync("/tmp/fixture-owner-finished-model", "yes");
    const delta = answered
      ? { role: "assistant", content: "REMOTE_FIXTURE_NATIVE_ANSWER_CONTINUED" }
      : calls.length
      ? {
          role: "assistant",
          content: questionTask
            ? "Waiting for the real native question answer"
            : finished
              ? "REMOTE_FIXTURE_FINISHED_ON_OWNER"
              : "REMOTE_FIXTURE_WAITING_FOR_JOB",
        }
      : {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "fixture-remote-execute",
              type: "function",
              function: {
                name: "execute",
                arguments: JSON.stringify({
                  code: questionTask
                    ? 'const q=await questions.ask({text:"REMOTE_FIXTURE_NATIVE_QUESTION",dedupKey:"remote-question"}); console.log(q); await questions.block({id:q.id,owner:q.owner,version:q.version,checkpoint:"Need real human answer",foreground:true})'
                    : "const r=await shell('sleep 3; pwd; git status --porcelain; echo REMOTE_FIXTURE_EXECUTED_ON_OWNER; touch /tmp/fixture-owner-job-finished', {waitSeconds:0}); console.log(r)",
                }),
              },
            },
          ],
        };
    const emit = (delta: object, finish_reason: string | null) => ({
      id: "remote-fixture",
      object: "chat.completion.chunk",
      created: 1,
      model: "fixture-model",
      choices: [{ index: 0, delta, finish_reason }],
    });
    const events = [emit(delta, null), emit({}, answered || calls.length ? "stop" : "tool_calls")];
    return new Response(events.map((e) => "data: " + JSON.stringify(e) + "\n\n").join("") + "data: [DONE]\n\n", {
      headers: { "content-type": "text/event-stream" },
    });
  },
});
console.error("fixture provider bound " + server.port);
