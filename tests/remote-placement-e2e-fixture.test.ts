import { describe, expect, test } from "bun:test";
import { ALIAS, ANSWER, QUESTION, response, stream, type RequestBody } from "./fixtures/remote-placement-e2e/scenario";
const request = (model: string, messages: RequestBody["messages"]): RequestBody => ({ model, messages });
const user = (content: string) => ({ role: "user", content });
const done = (tool_call_id: string) => ({ role: "tool", tool_call_id, content: "actual tool result" });
const code = (delta: any) => JSON.parse(delta.tool_calls[0].function.arguments).code as string;
describe("remote placement scripted inference fixture (not acceptance)", () => {
  test("ordinary parent questions API capture does not answer or relaunch", () => {
    const capture = code(response(request("placement-parent", [user("PLACEMENT_QUERY_QUESTIONS_1")])));
    expect(capture).toContain("questions.list()");
    expect(capture).not.toContain("questions.answer");
    expect(capture).not.toContain("subagent(");
    const complete: any = response(
      request("placement-parent", [user("PLACEMENT_QUERY_QUESTIONS_1"), done("question-query-1")]),
    );
    expect(complete.content).toBe("PLACEMENT_QUESTIONS_CAPTURED_1");
  });
  test("every generated execute stage parses without executing tools", () => {
    const cases: RequestBody[] = [
      request("placement-parent", [user("PLACEMENT_START_CLEAN")]),
      request("placement-parent", [
        user("PLACEMENT_START_CLEAN"),
        done("placement-launch-clean"),
        user("PLACEMENT_ORCHESTRATOR_DONE_CLEAN"),
      ]),
      request("placement-parent", [user("PLACEMENT_QUERY_QUESTIONS_1")]),
      request("placement-orchestrator", [user("PLACEMENT_ORCHESTRATOR_CLEAN")]),
      request("placement-orchestrator", [
        user("PLACEMENT_ORCHESTRATOR_CLEAN"),
        done("orch-start"),
        user("PLACEMENT_NORMAL_DONE_CLEAN"),
      ]),
      request("placement-orchestrator", [
        user("PLACEMENT_ORCHESTRATOR_CLEAN"),
        done("orch-start"),
        done("orch-question"),
        user(ANSWER),
      ]),
      request("placement-normal", [user("PLACEMENT_NORMAL_CHILD_CLEAN")]),
    ];
    for (const body of cases)
      expect(() => new Function("return async()=>{" + code(response(body)) + "}")).not.toThrow();
  });
  test("parent launches ordinary subagent only after reading human pinned alias", () => {
    const launch = code(response(request("placement-parent", [user("PLACEMENT_START_CLEAN")])));
    expect(launch).toContain("remote.status()");
    expect(launch).toContain(ALIAS);
    expect(launch).toContain('subagent({type:"orchestrator",target:state.connection.host');
    expect(launch).toContain('workspace:{kind:"worktree"}');
    expect(launch).not.toContain("remote.launch");
    expect(launch).not.toContain("remote.connect");
    expect(launch).not.toContain("model:");
  });
  test("destination orchestrator creates a normal server worktree with target omitted", () => {
    const start = code(response(request("placement-orchestrator", [user("PLACEMENT_ORCHESTRATOR_CLEAN")])));
    expect(start).toContain('subagent({type:"normal"');
    expect(start).toContain('workspace:{kind:"worktree"}');
    expect(start).not.toContain("target:");
    expect(start).not.toContain("model:");
    expect(start).toContain("DIE_SUBAGENT_TYPE");
    expect(start).toContain("orchestrator");
    expect(start).toContain("git rev-list --count HEAD");
    expect(start).toContain("never-upload.txt");
  });
  test("normal child probes real server tools, worktree and role refusal", () => {
    const child = code(response(request("placement-normal", [user("PLACEMENT_NORMAL_CHILD_CLEAN")])));
    expect(child).toContain("test -f .git");
    expect(child).toContain("DIE_SUBAGENT_DEPTH");
    expect(child).toContain("PLACEMENT_NORMAL_ROLE_REFUSED");
    expect(child).not.toContain("target:");
  });
  test("no human question before ordinary child completion", () => {
    const r: any = response(
      request("placement-orchestrator", [user("PLACEMENT_ORCHESTRATOR_CLEAN"), done("orch-start")]),
    );
    expect(r.content).toBe("PLACEMENT_ORCHESTRATOR_WAITING_CHILD");
    const ask = code(
      response(
        request("placement-orchestrator", [
          user("PLACEMENT_ORCHESTRATOR_CLEAN"),
          done("orch-start"),
          user("PLACEMENT_NORMAL_DONE_CLEAN"),
        ]),
      ),
    );
    expect(ask).toContain("jobs.inspect");
    expect(ask).toContain("questions.ask");
    expect(ask).toContain(QUESTION);
    expect(ask).toContain("questions.block");
    expect(ask).not.toContain("questions.answer");
    expect(ask).not.toContain("remote.answer");
  });
  test("answer marker in tool code/choices is not a saved human reply", () => {
    const r: any = response(
      request("placement-orchestrator", [
        user("PLACEMENT_ORCHESTRATOR_CLEAN"),
        done("orch-start"),
        { role: "assistant", content: ANSWER },
        done("orch-question"),
      ]),
    );
    expect(r.content).toBe("PLACEMENT_WAITING_FOR_REAL_HUMAN");
    const finish = code(
      response(
        request("placement-orchestrator", [
          user("PLACEMENT_ORCHESTRATOR_CLEAN"),
          done("orch-start"),
          done("orch-question"),
          user(ANSWER),
        ]),
      ),
    );
    expect(finish).toContain("questions.list()");
    expect(finish).toContain("q.answer");
    expect(finish).toContain("questions.resolve");
    expect(finish).toContain("PLACEMENT_REMOTE_RETURN");
  });
  test("restart after launch does not relaunch; result inspection follows delivery", () => {
    const base = [user("PLACEMENT_START_CLEAN"), done("placement-launch-clean")];
    const waiting: any = response(request("placement-parent", base));
    expect(waiting.content).toBe("PLACEMENT_PARENT_YIELDED_CLEAN");
    const result = code(response(request("placement-parent", [...base, user("PLACEMENT_ORCHESTRATOR_DONE_CLEAN")])));
    expect(result).toContain("jobs.inspect");
    expect(result).toContain("jobs.list");
    expect(result).not.toContain("subagent(");
  });
  test("drift normal child validates the second snapshot and completes the drift side", () => {
    const child = code(response(request("placement-normal", [user("PLACEMENT_NORMAL_CHILD_DRIFT")])));
    expect(child).toContain("PLACEMENT_REMOTE_RETURN");
    expect(child).not.toContain("PLACEMENT_TRACKED_DIRTY");
    const finished: any = response(
      request("placement-normal", [user("PLACEMENT_NORMAL_CHILD_DRIFT"), done("normal-tools")]),
    );
    expect(finished.content).toBe("PLACEMENT_NORMAL_DONE_DRIFT");
  });
  test("drift task has distinct question and result edit", () => {
    const messages = [user("PLACEMENT_ORCHESTRATOR_DRIFT"), done("orch-start"), done("orch-question"), user(ANSWER)];
    expect(code(response(request("placement-orchestrator", messages)))).toContain("PLACEMENT_REMOTE_DRIFT_RETURN");
  });
  test("unknown/local profiles fail instead of masquerading as remote defaults", () => {
    expect(() => response(request("placement-local-wrong", []))).toThrow("destination profile must be used");
  });
  test("OpenAI SSE has tool-call finish and DONE boundary", () => {
    const s = stream(request("placement-parent", [user("PLACEMENT_START_CLEAN")]));
    expect(s).toContain('"finish_reason":"tool_calls"');
    expect(s.endsWith("data: [DONE]\n\n")).toBe(true);
    expect(stream(request("placement-parent", []))).toContain('"finish_reason":"stop"');
  });
});
