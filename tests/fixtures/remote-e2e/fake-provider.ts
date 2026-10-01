/** Deterministic OpenAI-compatible stream; no real credentials or outbound requests. */
import { appendFileSync, writeFileSync, existsSync } from "node:fs";
const server = Bun.serve({
  hostname: process.env.FIXTURE_PROVIDER_HOST ?? "0.0.0.0",
  port: Number(process.env.FIXTURE_PROVIDER_PORT ?? "18765"),
  async fetch(request) {
    if (request.method !== "POST" || !new URL(request.url).pathname.endsWith("/chat/completions"))
      return new Response("not found", { status: 404 });
    const body = (await request.json()) as {
      model?: string;
      messages?: Array<{ role: string; tool_call_id?: string; content?: unknown }>;
    };
    if (body.model === "fixture-parent") {
      const messages = JSON.stringify(body.messages ?? []);
      const side = messages.includes("REMOTE_JOBS_PROOF_A")
        ? "A"
        : messages.includes("REMOTE_JOBS_PROOF_B")
          ? "B"
          : "?";
      const done = (body.messages ?? []).some((m) => m.role === "tool" && m.tool_call_id === "launch-" + side);
      const completion = messages.includes("SSH jobs completed:");
      const probe = (body.messages ?? [])
        .filter((m) => m.role === "user")
        .map((m) => JSON.stringify(m.content))
        .join("\n")
        .match(/REMOTE_JOBS_CHECK (ssh:[A-Za-z0-9_-]+) (ssh:[A-Za-z0-9_-]+)/);
      const probed = (body.messages ?? []).some((m) => m.role === "tool" && m.tool_call_id === "check-" + side);
      const delta = messages.includes("REMOTE_JOBS_PRINT_BOUNDARY")
        ? { role: "assistant", content: "REMOTE_JOBS_PRINT_JSON_OK" }
        : probe
          ? probed
            ? { role: "assistant", content: "REMOTE_JOBS_CHECKED_" + side }
            : {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: "check-" + side,
                    type: "function",
                    function: {
                      name: "execute",
                      arguments: JSON.stringify({
                        code: `const own=${JSON.stringify(probe[1])}, foreign=${JSON.stringify(probe[2])}; const listed=await jobs.list(); if(!listed.jobs.some(j=>j.id===own) || listed.jobs.some(j=>j.id===foreign)) throw Error("Session list isolation failed"); const inspected=await jobs.inspect(own); if(inspected.id!==own || inspected.status!=="completed") throw Error("Stable completed job missing"); const rejected=[]; for(const id of [foreign,"ssh:bm90LWEtZml4dHVyZS10YXNr"]) for(const method of ["inspect","stop"]) {let error;try{await jobs[method](id)}catch(e){error=String(e)}if(!error?.includes("Unknown SSH job"))throw Error("Foreign/unknown job accepted: "+method+" "+id+" "+error);rejected.push({id,method,error})} await Bun.write(process.env.HOME+"/check-${side}.json",JSON.stringify({listed,inspected,rejected})); console.log("REMOTE_JOBS_CHECKED_${side}")`,
                      }),
                    },
                  },
                ],
              }
          : completion
            ? { role: "assistant", content: "REMOTE_JOBS_PARENT_ACK_" + side }
            : done
              ? { role: "assistant", content: "REMOTE_JOBS_PARENT_YIELDED_" + side }
              : {
                  role: "assistant",
                  tool_calls: [
                    {
                      index: 0,
                      id: "launch-" + side,
                      type: "function",
                      function: {
                        name: "execute",
                        arguments: JSON.stringify({
                          code: `const discovery=await jobs.targets(); const target=discovery.targets.find(t=>t.name==="fixture-owner" && t.kind==="ssh" && t.authorized); if(!target) throw Error("Missing pinned fixture target"); const r=await subagent({target:target.name,type:"normal",prompt:"REMOTE_JOBS_PROOF_${side}",waitSeconds:0}); if(!r.id.startsWith("ssh:") || !r.background) throw Error("Expected stable async SSH job"); await Bun.write(process.env.HOME+"/jobs-${side}.json",JSON.stringify({discovery,launch:r})); console.log(r)`,
                        }),
                      },
                    },
                  ],
                };
      const emit = (delta: object, finish_reason: string | null) => ({
        id: "parent-proof",
        object: "chat.completion.chunk",
        created: 1,
        model: "fixture-parent",
        choices: [{ index: 0, delta, finish_reason }],
      });
      return new Response(
        [emit(delta, null), emit({}, "tool_calls" in delta ? "tool_calls" : "stop")]
          .map((e) => "data: " + JSON.stringify(e) + "\n\n")
          .join("") + "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      );
    }
    const userText = (body.messages ?? [])
      .filter((m) => m.role === "user")
      .map((m) => JSON.stringify(m.content))
      .join("\n");
    const jobsProof = userText.match(/REMOTE_JOBS_PROOF_([AB])/)?.[1];
    const normalPlacement = userText.includes("REMOTE_FIXTURE_NORMAL_PLACEMENT");
    const repoTask = userText.includes("REMOTE_FIXTURE_REPO_");
    const capabilityTask = userText.includes("REMOTE_FIXTURE_CAPABILITY");
    const cancelTask = userText.includes("REMOTE_FIXTURE_CANCEL");
    const menuTask = userText.includes("REMOTE_FIXTURE_MENU_");
    const questionTask = (body.messages ?? []).some(
      (m) =>
        (m.role === "user" && JSON.stringify(m.content).includes("REMOTE_FIXTURE_QUESTION")) ||
        JSON.stringify(m.content).includes("REMOTE_FIXTURE_MENU_"),
    );
    const answered =
      questionTask &&
      (body.messages ?? []).some((m) =>
        JSON.stringify(m.content).includes(
          menuTask ? "REMOTE_FIXTURE_MENU_CONTINUED" : "REMOTE_FIXTURE_ANSWER_ACCEPTED",
        ),
      );
    const calls = (body.messages ?? []).filter(
      (item) => item.role === "tool" && item.tool_call_id === "fixture-remote-execute",
    );
    appendFileSync(
      "/tmp/fixture-owner-provider-requests",
      JSON.stringify({ calls: calls.length, at: Date.now() }) + "\n",
    );
    if (answered) writeFileSync("/tmp/fixture-native-answer-finished", "yes");
    const finished =
      !questionTask &&
      existsSync(jobsProof ? "/tmp/fixture-jobs-proof-" + jobsProof : "/tmp/fixture-owner-job-finished");
    if (finished)
      writeFileSync(
        jobsProof ? "/tmp/fixture-owner-finished-" + jobsProof : "/tmp/fixture-owner-finished-model",
        "yes",
      );
    const delta = answered
      ? { role: "assistant", content: "REMOTE_FIXTURE_NATIVE_ANSWER_CONTINUED" }
      : calls.length
        ? {
            role: "assistant",
            content: repoTask
              ? "REMOTE_FIXTURE_REPO_FINISHED"
              : capabilityTask
                ? "REMOTE_FIXTURE_CAPABILITY_FINISHED"
                : cancelTask
                  ? "REMOTE_FIXTURE_CANCEL_WAITING"
                  : questionTask
                    ? "Waiting for the real native question answer"
                    : finished
                      ? jobsProof
                        ? "REMOTE_JOBS_PROOF_FINISHED_" + jobsProof
                        : "REMOTE_FIXTURE_FINISHED_ON_OWNER"
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
                    code:
                      (normalPlacement
                        ? `if(process.env.BRUV_SUBAGENT_TYPE!=="normal" || process.env.BRUV_SUBAGENT_DEPTH!=="1") throw Error("Destination normal/depth1 policy missing"); if(!${questionTask}){let denied; try {await subagent({target:"fixture-owner",prompt:"must not delegate"})} catch(e){denied=String(e)} if(!denied?.includes("Only orchestrator agents can delegate")) throw Error("Normal worker delegation was not denied: "+denied); } `
                        : "") +
                      (jobsProof
                        ? `if(process.env.BRUV_SUBAGENT_TYPE!=="normal" || process.env.BRUV_SUBAGENT_DEPTH!=="1") throw Error("Destination normal/depth1 policy missing"); let denied; try {await subagent({target:"fixture-owner",prompt:"must not delegate"})} catch(e){denied=String(e)} if(!denied?.includes("Only orchestrator agents can delegate")) throw Error("Normal worker delegation was not denied: "+denied); await Bun.write("/tmp/fixture-jobs-policy-${jobsProof}",denied); console.log(await shell("grep -q REMOTE_JOBS_CURRENT_SOURCE README.md && sleep 5 && touch /tmp/fixture-jobs-proof-${jobsProof} && echo REMOTE_JOBS_PROOF_TOOL_${jobsProof}",{waitSeconds:0}))`
                        : repoTask
                          ? 'console.log(await shell("sleep 2; printf \\"remote tracked edit\\\\n\\" > tracked.txt; echo REMOTE_REPO_TOOL_DONE",{waitSeconds:3}));'
                          : capabilityTask
                            ? 'console.log(await remote.requestCapability({kind:"repo.read",input:"on-demand.txt",requestId:"fixture_cap_file"})); console.log(await remote.requestCapability({kind:"tool:git-status",input:"",requestId:"fixture_cap_tool"})); console.log(await remote.requestCapability({kind:"skill:review",input:"",requestId:"fixture_cap_skill"})); console.log(await shell("touch /tmp/fixture-capability-finished"));'
                            : cancelTask
                              ? 'console.log(await shell("echo $$ > /tmp/fixture-cancel-pid; touch /tmp/fixture-cancel-started; sleep 120; touch /tmp/fixture-cancel-unwanted",{waitSeconds:0}));'
                              : questionTask
                                ? menuTask
                                  ? 'const q=await questions.ask({text:"REMOTE_FIXTURE_MENU_QUESTION",choices:["REMOTE_FIXTURE_MENU_FIRST","REMOTE_FIXTURE_MENU_SECOND_LONG_CHOICE_WITH_TAIL_VISIBLE_ON_NARROW_TERMINAL"],allowFreeText:true,dedupKey:"remote-menu-question"}); console.log(q); await questions.block({id:q.id,owner:q.owner,version:q.version,checkpoint:"Need menu answer",foreground:true})'
                                  : 'const q=await questions.ask({text:"REMOTE_FIXTURE_NATIVE_QUESTION",dedupKey:"remote-question"}); console.log(q); await questions.block({id:q.id,owner:q.owner,version:q.version,checkpoint:"Need real human answer",foreground:true})'
                                : 'console.log("REMOTE_LONG_TEXT_BEGIN"+"x".repeat(9000)+"REMOTE_LONG_TEXT_END"); const r=await shell(\'sleep 3; pwd; git status --porcelain; echo REMOTE_FIXTURE_EXECUTED_ON_OWNER; touch /tmp/fixture-owner-job-finished\', {waitSeconds:0}); console.log(r)'),
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
