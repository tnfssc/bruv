/** Fake inference is server-only. No fixture code supplies a saved human answer. */
export type RequestBody = {
  model?: string;
  messages?: Array<{ role: string; content?: unknown; tool_call_id?: string }>;
};
export const ALIAS = "typed-root-owner";
export const ANSWER = "ROOT_HUMAN_APPROVED";
export const questionText = (side: string) => `ROOT_HUMAN_QUESTION_${side.toUpperCase()}`;
export const called = (body: RequestBody, id: string) =>
  (body.messages ?? []).some((m) => m.role === "tool" && m.tool_call_id === id);
const userHas = (body: RequestBody, marker: string) =>
  (body.messages ?? []).some((m) => m.role === "user" && JSON.stringify(m.content).includes(marker));
export const execute = (id: string, code: string) => ({
  role: "assistant",
  tool_calls: [{ index: 0, id, type: "function", function: { name: "execute", arguments: JSON.stringify({ code }) } }],
});
const say = (content: string) => ({ role: "assistant", content });
type Side = "clean" | "drift";

export function response(body: RequestBody): object {
  const side: Side = userHas(body, "ROOT_START_DRIFT") || userHas(body, "ROOT_NORMAL_DRIFT") ? "drift" : "clean";
  const upper = side.toUpperCase();
  if (body.model === "typed-root-normal") {
    if (!called(body, `root-normal-${side}`)) return execute(`root-normal-${side}`, normalStart(side));
    return say(`ROOT_NORMAL_DONE_${upper}`);
  }
  if (body.model !== "typed-root")
    throw Error(`unexpected model: ${body.model}; server root settings/profile must be used`);

  if (userHas(body, "ROOT_RUNNING_JOB")) {
    if (!called(body, "root-running-job")) return execute("root-running-job", runningJob);
    return say("ROOT_RUNNING_JOB_READY");
  }
  if (userHas(body, "ROOT_REPLY_LOSS")) {
    if (!called(body, "root-reply-loss")) return execute("root-reply-loss", replyLoss);
    return say("ROOT_REPLY_LOSS_DONE");
  }

  if (!userHas(body, `ROOT_START_${upper}`)) return say("ROOT_READY_FOR_NORMAL_PROMPT");
  if (!called(body, `root-start-${side}`)) return execute(`root-start-${side}`, rootStart(side));
  if (!called(body, `root-question-${side}`)) {
    if (!userHas(body, `ROOT_NORMAL_DONE_${upper}`)) return say(`ROOT_WAITING_NORMAL_CHILD_${upper}`);
    return execute(`root-question-${side}`, askAfterChild(side));
  }
  if (!called(body, `root-answer-${side}`) && userHas(body, ANSWER))
    return execute(`root-answer-${side}`, useHumanAnswer(side));
  if (
    called(body, `root-answer-${side}`) &&
    userHas(body, `ROOT_SECOND_${upper}`) &&
    !called(body, `root-second-${side}`)
  )
    return execute(`root-second-${side}`, secondTurn(side));
  if (called(body, `root-second-${side}`)) return say(`ROOT_SECOND_DONE_${upper}`);
  if (called(body, `root-answer-${side}`)) return say(`ROOT_ANSWER_DONE_${upper}`);
  return say(`ROOT_WAITING_REAL_HUMAN_${upper}`);
}
export function stream(body: RequestBody): string {
  const delta = response(body);
  const emit = (delta: object, finish_reason: string | null) => ({
    id: "typed-root-fixture",
    object: "chat.completion.chunk",
    created: 1,
    model: body.model,
    choices: [{ index: 0, delta, finish_reason }],
  });
  return `${[emit(delta, null), emit({}, "tool_calls" in delta ? "tool_calls" : "stop")]
    .map((e) => `data: ${JSON.stringify(e)}\n\n`)
    .join("")}data: [DONE]\n\n`;
}

// The provider selects a stage; these programs run through the server tools.
const inspectHelper = `async function inspectAll(id) {
  let offset = 0;
  const pages = [];
  for (let n = 0; n < 200; n++) {
    const p = await jobs.inspect(id, {offset, limit:5000});
    pages.push(p);
    if (!p.hasMore) return {...pages[0], output:pages.map(p => p.output).join("")};
    if (!(p.nextOffset > offset)) throw Error("bad inspection cursor");
    offset = p.nextOffset;
  }
  throw Error("inspection overflow");
}`;

function record(side: Side, phase: string): string {
  const log = JSON.stringify(`/tmp/root-proof-${side}.jsonl`);
  return `await Bun.write(${log},
  (await Bun.file(${log}).exists() ? await Bun.file(${log}).text() : "") +
  JSON.stringify({
    phase: ${JSON.stringify(phase)},
    cwd: process.cwd(),
    role: process.env.BRUV_SUBAGENT_TYPE??"root",
    depth: Number(process.env.BRUV_SUBAGENT_DEPTH??0)
  }) + "\\n"
);`;
}

function snapshotChecks(side: Side): string {
  const expected = side === "drift" ? "ROOT_RETURN_TWO" : "ROOT_TRACKED_DIRTY";
  return (
    `grep -qx "${expected}" tracked.txt; test ! -e never-upload.txt; test "$(git rev-list --count HEAD)" = 1; ` +
    (side === "drift" ? 'grep -qx "ROOT_INCLUDED_BY_HUMAN" authorized.txt; ' : "test ! -e authorized.txt; ")
  );
}

function normalStart(side: Side): string {
  const command =
    'set -eu; test "$BRUV_SUBAGENT_TYPE" = normal; test "$BRUV_SUBAGENT_DEPTH" = 1; test -f /opt/fixture/typed-root-host; test -f .git; ' +
    snapshotChecks(side) +
    "pwd > /tmp/root-child-" +
    side +
    "-cwd; echo ROOT_NORMAL_SERVER_WORKTREE_OK_" +
    side.toUpperCase();
  return `const p=await shell(${JSON.stringify(command)},{waitSeconds:3});
if (p.exitCode !== 0) throw Error(JSON.stringify(p));
console.log(p);
${record(side, "child-start")}
let refused = false;
try {
  await subagent({type:"normal", prompt:"ROOT_FORBIDDEN_GRANDCHILD"});
} catch (e) {
  refused = true;
  console.log("ROOT_NORMAL_DELEGATION_REFUSED", String(e));
}
if (!refused) throw Error("normal worker delegated");`;
}

function rootStart(side: Side): string {
  const command =
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Match literal interpolation syntax in the source fixture.
    'set -eu; test "${BRUV_SUBAGENT_TYPE:-root}" = root; test "${BRUV_SUBAGENT_DEPTH:-0}" = 0; test -f /opt/fixture/typed-root-host; ' +
    snapshotChecks(side) +
    "pwd > /tmp/root-" +
    side +
    "-cwd; echo ROOT_SERVER_ROLE0_OK_" +
    side.toUpperCase();
  return `const p=await shell(${JSON.stringify(command)},{waitSeconds:3});
if (p.exitCode !== 0) throw Error(JSON.stringify(p));
console.log(p);
${record(side, "root-start")}
const child = await subagent({type:"normal",prompt:"ROOT_NORMAL_${side.toUpperCase()}",workspace:{kind:"worktree"},waitSeconds:0});
console.log(child);
await Bun.write("/tmp/root-child-${side}.json", JSON.stringify(child));`;
}

function askAfterChild(side: Side): string {
  return `${inspectHelper}
const child = JSON.parse(await Bun.file("/tmp/root-child-${side}.json").text());
const result = await inspectAll(child.id);
console.log(result);
if (result.status !== "completed" && result.status !== "done") throw Error("child not completed: " + JSON.stringify(result));
await Bun.write("/tmp/root-child-result-${side}.json", JSON.stringify(result));
const q = await questions.ask({text:"${questionText(side)}", choices:["${ANSWER}"], allowFreeText:true, dedupKey:"typed-root-${side}"});
console.log(q);
await Bun.write("/tmp/root-question-${side}.json", JSON.stringify(q));
await questions.block({id:q.id, owner:q.owner, version:q.version, checkpoint:"Continue this same root after the human picker answer", foreground:true});`;
}

function useHumanAnswer(side: Side): string {
  const firstReturn = side === "drift" ? "ROOT_DRIFT_RETURN_ONE" : "ROOT_RETURN_ONE";
  return `const ledger = await questions.list();
const rows = Array.isArray(ledger) ? ledger : ledger.questions;
const q = rows.find(q => q.text === "${questionText(side)}");
if (!q || q.answer !== "${ANSWER}") throw Error("no saved human answer");
await questions.resolve({id:q.id, owner:q.owner, version:q.version, reason:"used human picker reply"});
await Bun.write("tracked.txt", "${firstReturn}\\n");
${record(side, "root-answer")}
console.log("ROOT_ANSWER_USED_${side.toUpperCase()}");`;
}

function secondTurn(side: Side): string {
  const firstReturn = side === "drift" ? "ROOT_DRIFT_RETURN_ONE" : "ROOT_RETURN_ONE";
  const secondReturn = side === "drift" ? "ROOT_DRIFT_RETURN_TWO" : "ROOT_RETURN_TWO";
  return `const current=await Bun.file("tracked.txt").text();
if(current!=="${firstReturn}\\n") throw Error("second turn did not see first turn work");
await Bun.write("tracked.txt", "${secondReturn}\\n");
${record(side, "root-second")}
console.log("ROOT_SECOND_TOOL_${side.toUpperCase()}");`;
}

const runningJob =
  'const p=await shell("exec /usr/local/bin/bun -e \'require(\\"node:fs\\").writeFileSync(\\"/tmp/root-running-pid\\",String(process.pid)); console.log(\\"ROOT_CANCEL_RUNNING\\"); setTimeout(()=>{require(\\"node:fs\\").writeFileSync(\\"/tmp/root-running-finished\\",\\"unexpected\\")},600000)\'",{waitSeconds:0});await Bun.write("/tmp/root-running-job.json",JSON.stringify(p));console.log(p);';
const replyLoss =
  'const fs=require("node:fs");fs.appendFileSync("/tmp/root-reply-loss-work.jsonl",JSON.stringify({role:process.env.BRUV_SUBAGENT_TYPE??"root",depth:Number(process.env.BRUV_SUBAGENT_DEPTH??0),cwd:process.cwd()})+"\\n");console.log("ROOT_REPLY_LOSS_WORK_ONCE");';
