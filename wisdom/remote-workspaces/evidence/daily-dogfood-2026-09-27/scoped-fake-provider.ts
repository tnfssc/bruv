import { writeFileSync } from "node:fs";
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(r) {
    if (r.method !== "POST") return new Response("fixture only", { status: 404 });
    const b = (await r.json()) as { messages?: { role?: string; tool_call_id?: string }[] };
    const ms = b.messages ?? [];
    const launched = ms.some((m) => m.role === "tool" && m.tool_call_id === "daily-bounded");
    const completed = JSON.stringify(ms).includes("SSH jobs completed:");
    const d = completed
      ? { role: "assistant", content: "DAILY_COORDINATOR_REMOTE_COMPLETION_ACK" }
      : launched
        ? { role: "assistant", content: "DAILY_COORDINATOR_YIELD_LOCAL_AND_REMOTE" }
        : {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "daily-bounded",
                type: "function",
                function: {
                  name: "execute",
                  arguments: JSON.stringify({
                    code: 'console.log(await shell("sleep 12; echo DAILY_LOCAL_FINISHED", {waitSeconds:0})); console.log(await remote.launch({repoPath:"/fixture/repo",prompt:"REMOTE_JOBS_PROOF_A daily concurrent local and remote"}));',
                  }),
                },
              },
            ],
          };
    const event = (delta: typeof d | Record<string, never>, reason: "tool_calls" | "stop" | null) => ({
      id: "daily-fake",
      object: "chat.completion.chunk",
      created: 1,
      model: "daily-fixture",
      choices: [{ index: 0, delta, finish_reason: reason }],
    });
    return new Response(
      `${[event(d, null), event({}, d.tool_calls ? "tool_calls" : "stop")]
        .map((e) => `data: ${JSON.stringify(e)}\n\n`)
        .join("")}data: [DONE]\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    );
  },
});
writeFileSync("/tmp/dogfood-parent-provider-port", String(server.port));
console.log(`SCOPED DAILY FAKE PROVIDER ${server.port}`);
