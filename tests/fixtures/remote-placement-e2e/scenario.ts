/** Scripted inference only. It never performs a network request or answers a human question. */
export type RequestBody = {
  model?: string;
  messages?: Array<{ role: string; content?: unknown; tool_call_id?: string }>;
};
export const ALIAS = "placement-owner";
export const QUESTION = "PLACEMENT_HUMAN_QUESTION";
export const ANSWER = "PLACEMENT_HUMAN_APPROVED";
const text = (body: RequestBody) => JSON.stringify(body.messages ?? []);
const called = (body: RequestBody, id: string) =>
  (body.messages ?? []).some((m) => m.role === "tool" && m.tool_call_id === id);
const userHas = (body: RequestBody, marker: string) =>
  (body.messages ?? []).some((m) => m.role === "user" && JSON.stringify(m.content).includes(marker));
export const execute = (id: string, code: string) => ({
  role: "assistant",
  tool_calls: [{ index: 0, id, type: "function", function: { name: "execute", arguments: JSON.stringify({ code }) } }],
});
const say = (content: string) => ({ role: "assistant", content });
const inspectHelper =
  'async function inspectAll(id){const pages=[];let offset=0;for(let n=0;n<200;n++){const page=await jobs.inspect(id,{offset,limit:5000});pages.push(page);if(!page.hasMore)return {...pages[0],output:pages.map(p=>p.output).join(""),pages:pages.length};if(!(page.nextOffset>offset))throw Error("inspection cursor failed to advance");offset=page.nextOffset;}throw Error("fixture result exceeded 1 MiB inspection bound");} ';
export function response(body: RequestBody): object {
  const all = text(body);
  const drift =
    all.includes("PLACEMENT_ORCHESTRATOR_DRIFT") ||
    all.includes("PLACEMENT_START_DRIFT") ||
    all.includes("PLACEMENT_NORMAL_CHILD_DRIFT");
  const side = drift ? "drift" : "clean";
  const expected = drift ? "PLACEMENT_REMOTE_RETURN" : "PLACEMENT_TRACKED_DIRTY";
  const question = drift ? "PLACEMENT_DRIFT_QUESTION" : QUESTION;
  if (body.model === "placement-parent") {
    const lastUser = (body.messages ?? []).filter((m) => m.role === "user").at(-1);
    const query = (JSON.stringify(lastUser?.content) ?? "").match(/PLACEMENT_QUERY_QUESTIONS_([0-9]+)/)?.[1];
    if (query) {
      const id = "question-query-" + query;
      if (!called(body, id))
        return execute(
          id,
          'const questionsSnapshot=await questions.list();console.log(questionsSnapshot);await Bun.write(process.env.HOME+"/placement-human-questions.json",JSON.stringify(questionsSnapshot));',
        );
      return say("PLACEMENT_QUESTIONS_CAPTURED_" + query);
    }

    // The harness, not inference, supplies the one human /remote connect command.
    if (!all.includes("PLACEMENT_START_")) return say("PLACEMENT_PARENT_READY");
    const launch = "placement-launch-" + side;
    const inspect = "placement-inspect-" + side;
    if (!called(body, launch))
      return execute(
        launch,
        'const state=await remote.status(); if(state.connection?.host!=="' +
          ALIAS +
          '") throw Error("fixture target not human-pinned"); ' +
          'const job=await subagent({type:"orchestrator",target:state.connection.host,prompt:"PLACEMENT_ORCHESTRATOR_' +
          side.toUpperCase() +
          '",workspace:{kind:"worktree"},waitSeconds:0}); console.log(job); ' +
          'await Bun.write(process.env.HOME+"/placement-job-' +
          side +
          '.json",JSON.stringify(job));',
      );
    // A real task-complete delivery must precede inspection. Never relaunch on restart.
    if (userHas(body, "PLACEMENT_ORCHESTRATOR_DONE_" + side.toUpperCase()) && !called(body, inspect))
      return execute(
        inspect,
        inspectHelper +
          'const launch=JSON.parse(await Bun.file(process.env.HOME+"/placement-job-' +
          side +
          '.json").text()); ' +
          "const list=await jobs.list({count:100}); const result=await inspectAll(launch.id); console.log({list,status:result.status,tail:result.output.slice(-2000)}); " +
          'await Bun.write(process.env.HOME+"/placement-result-' +
          side +
          '.json",JSON.stringify({list,result}));',
      );
    if (called(body, inspect)) return say("PLACEMENT_PARENT_RESULT_" + side.toUpperCase());
    return say("PLACEMENT_PARENT_YIELDED_" + side.toUpperCase());
  }
  if (body.model === "placement-orchestrator") {
    if (!called(body, "orch-start"))
      return execute(
        "orch-start",
        "const proof=await shell(" +
          JSON.stringify(
            'set -eu; test "$DIE_SUBAGENT_TYPE" = orchestrator; test "$DIE_SUBAGENT_DEPTH" = 1; test -n "$DIE_REMOTE_RUNTIME_STATE"; test -f /opt/fixture/placement-host; grep -qx "' +
              expected +
              '" tracked.txt; test ! -e never-upload.txt; test "$(git rev-list --count HEAD)" = 1; test -z "$(git remote)"; pwd > /tmp/placement-orchestrator-' +
              side +
              "-cwd; echo PLACEMENT_REMOTE_TOOLS_OK",
          ) +
          ",{waitSeconds:3}); if(proof.exitCode!==0) throw Error(JSON.stringify(proof)); console.log(proof); " +
          'const job=await subagent({type:"normal",prompt:"PLACEMENT_NORMAL_CHILD_' +
          side.toUpperCase() +
          '",workspace:{kind:"worktree"},waitSeconds:0}); console.log(job); await Bun.write("/tmp/placement-child-' +
          side +
          '.json",JSON.stringify(job));',
      );
    if (!called(body, "orch-question")) {
      if (!userHas(body, "PLACEMENT_NORMAL_DONE_" + side.toUpperCase()))
        return say("PLACEMENT_ORCHESTRATOR_WAITING_CHILD");
      return execute(
        "orch-question",
        inspectHelper +
          'const child=JSON.parse(await Bun.file("/tmp/placement-child-' +
          side +
          '.json").text()); const result=await inspectAll(child.id); console.log({status:result.status,tail:result.output.slice(-2000)}); await Bun.write("/tmp/placement-child-result-' +
          side +
          '.json",JSON.stringify(result)); ' +
          'const q=await questions.ask({text:"' +
          question +
          '",choices:["' +
          ANSWER +
          '"],allowFreeText:true,dedupKey:"placement-' +
          side +
          '"}); console.log(q); await questions.block({id:q.id,owner:q.owner,version:q.version,checkpoint:"Only the human may approve the safe return",foreground:true});',
      );
    }
    if (!called(body, "orch-finish") && userHas(body, ANSWER))
      return execute(
        "orch-finish",
        'const ledger=await questions.list(); const rows=Array.isArray(ledger)?ledger:ledger.questions; const q=rows.find(q=>q.text==="' +
          question +
          '"); if(!q||q.answer!=="' +
          ANSWER +
          '") throw Error("missing real saved human answer"); ' +
          'await questions.resolve({id:q.id,owner:q.owner,version:q.version,reason:"used explicit human approval"}); ' +
          'await Bun.write("tracked.txt","' +
          (drift ? "PLACEMENT_REMOTE_DRIFT_RETURN" : "PLACEMENT_REMOTE_RETURN") +
          '\\n"); console.log("PLACEMENT_USED_REAL_ANSWER_' +
          side.toUpperCase() +
          '");',
      );
    if (called(body, "orch-finish")) return say("PLACEMENT_ORCHESTRATOR_DONE_" + side.toUpperCase());
    return say("PLACEMENT_WAITING_FOR_REAL_HUMAN");
  }
  if (body.model === "placement-normal") {
    if (!called(body, "normal-tools"))
      return execute(
        "normal-tools",
        "const proof=await shell(" +
          JSON.stringify(
            'set -eu; test "$DIE_SUBAGENT_TYPE" = normal; test "$DIE_SUBAGENT_DEPTH" = 2; test -f /opt/fixture/placement-host; test -f .git; grep -qx "' +
              expected +
              '" tracked.txt; test ! -e never-upload.txt; pwd > /tmp/placement-normal-' +
              side +
              "-cwd; echo PLACEMENT_NORMAL_REMOTE_WORKTREE_OK",
          ) +
          ",{waitSeconds:3}); if(proof.exitCode!==0) throw Error(JSON.stringify(proof)); console.log(proof); " +
          'let refused=false; try { await subagent({type:"normal",prompt:"PLACEMENT_FORBIDDEN_GRANDCHILD",workspace:{kind:"worktree"}}); } catch(error) {refused=true; console.log("PLACEMENT_NORMAL_ROLE_REFUSED",String(error));} if(!refused) throw Error("normal worker unexpectedly delegated");',
      );
    return say("PLACEMENT_NORMAL_DONE_" + side.toUpperCase());
  }
  throw Error("unexpected model: " + body.model + "; destination profile must be used");
}
export function stream(body: RequestBody): string {
  const delta = response(body);
  const emit = (delta: object, finish_reason: string | null) => ({
    id: "placement-fixture",
    object: "chat.completion.chunk",
    created: 1,
    model: body.model,
    choices: [{ index: 0, delta, finish_reason }],
  });
  return (
    [emit(delta, null), emit({}, "tool_calls" in delta ? "tool_calls" : "stop")]
      .map((e) => "data: " + JSON.stringify(e) + "\n\n")
      .join("") + "data: [DONE]\n\n"
  );
}
