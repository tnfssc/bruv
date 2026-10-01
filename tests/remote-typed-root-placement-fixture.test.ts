import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ANSWER,
  questionText,
  response,
  stream,
  type RequestBody,
} from "./fixtures/remote-typed-root-placement/scenario";
import {
  assertOnePrompt,
  assertQuestion,
  assertSameRoot,
  assertSnapshot,
  assertWorkOnce,
  questionsFromReceipt,
} from "./fixtures/remote-typed-root-placement/proof";
const user = (content: string) => ({ role: "user", content });
const done = (id: string) => ({ role: "tool", tool_call_id: id, content: "ok" });
const request = (model: string, messages: RequestBody["messages"]): RequestBody => ({ model, messages });
const code = (r: any) => JSON.parse(r.tool_calls[0].function.arguments).code as string;
const first = user("ROOT_START_CLEAN");
const throughQuestion = [first, done("root-start-clean"), user("ROOT_NORMAL_DONE_CLEAN"), done("root-question-clean")];
describe("uniquely named typed root placement fixture (not binary acceptance)", () => {
  test("root is role0 server tools plus ordinary no-target child worktree", () => {
    const start = code(response(request("typed-root", [first])));
    expect(start).toContain("DIE_SUBAGENT_TYPE:-root");
    expect(start).toContain("DIE_SUBAGENT_DEPTH:-0");
    expect(start).toContain("/opt/fixture/typed-root-host");
    expect(start).toContain("test ! -e never-upload.txt");
    expect(start).toContain("git rev-list --count HEAD");
    expect(start).toContain('workspace:{kind:"worktree"}');
    expect(start).not.toContain("target:");
    expect(start).not.toContain("remote.launch");
  });
  test("normal is depth1 and validates actual orphan worktree", () => {
    const child = code(response(request("typed-root-normal", [user("ROOT_NORMAL_CLEAN")])));
    expect(child).toContain("test -f .git");
    expect(JSON.parse(child.match(/^const p=await shell\((.*),\{waitSeconds:3\}\)/)![1])).toContain(
      'DIE_SUBAGENT_DEPTH" = 1',
    );
    expect(child).toContain("ROOT_NORMAL_DELEGATION_REFUSED");
    expect(child).not.toContain("target:");
  });
  test("real question follows normal delivery; fake provider never answers", () => {
    expect((response(request("typed-root", [first, done("root-start-clean")])) as any).content).toBe(
      "ROOT_WAITING_NORMAL_CHILD_CLEAN",
    );
    const ask = code(
      response(request("typed-root", [first, done("root-start-clean"), user("ROOT_NORMAL_DONE_CLEAN")])),
    );
    expect(ask).toContain("jobs.inspect");
    expect(ask).toContain("questions.ask");
    expect(ask).toContain("questions.block");
    expect(ask).toContain(questionText("clean"));
    expect(ask).not.toContain("questions.answer");
    expect(ask).not.toContain("remote.answer");
  });
  test("assistant/tool answer marker is not a real user reply", () => {
    const waiting = response(
      request("typed-root", [
        ...throughQuestion,
        { role: "assistant", content: ANSWER },
        { role: "tool", content: ANSWER },
      ]),
    ) as any;
    expect(waiting.content).toBe("ROOT_WAITING_REAL_HUMAN_CLEAN");
    const answer = code(response(request("typed-root", [...throughQuestion, user(ANSWER)])));
    expect(answer).toContain("q.answer");
    expect(answer).toContain("questions.resolve");
    expect(answer).toContain("ROOT_RETURN_ONE");
  });
  test("second prompt checks same first edit, no start/child replay", () => {
    const history = [...throughQuestion, user(ANSWER), done("root-answer-clean")];
    expect((response(request("typed-root", history)) as any).content).toBe("ROOT_ANSWER_DONE_CLEAN");
    const second = code(response(request("typed-root", [...history, user("ROOT_SECOND_CLEAN")])));
    expect(second).toContain('current!=="ROOT_RETURN_ONE');
    expect(second).toContain("ROOT_RETURN_TWO");
    expect(second).not.toContain("subagent(");
    expect(
      (response(request("typed-root", [...history, user("ROOT_SECOND_CLEAN"), done("root-second-clean")])) as any)
        .content,
    ).toBe("ROOT_SECOND_DONE_CLEAN");
  });
  test("fresh drift scenario reads first source return and human included path", () => {
    const start = code(response(request("typed-root", [user("ROOT_START_DRIFT")])));
    expect(start).toContain("ROOT_RETURN_TWO");
    expect(start).toContain("ROOT_INCLUDED_BY_HUMAN");
    expect(start).not.toContain("ROOT_TRACKED_DIRTY");
    const second = code(
      response(
        request("typed-root", [
          user("ROOT_START_DRIFT"),
          done("root-start-drift"),
          done("root-question-drift"),
          user(ANSWER),
          done("root-answer-drift"),
          user("ROOT_SECOND_DRIFT"),
        ]),
      ),
    );
    expect(second).toContain("ROOT_DRIFT_RETURN_ONE");
    expect(second).toContain("ROOT_DRIFT_RETURN_TWO");
  });
  test("wrong local/legacy child profiles fail closed", () => {
    for (const model of ["placement-parent", "placement-orchestrator", "unknown", undefined])
      expect(() => response(request(model as string, []))).toThrow("server root settings/profile");
  });
  test("all generated tool programs parse without running or answering", () => {
    for (const side of ["clean", "drift"]) {
      const upper = side.toUpperCase();
      const base = [user("ROOT_START_" + upper)];
      const cases: RequestBody[] = [
        request("typed-root", base),
        request("typed-root-normal", [user("ROOT_NORMAL_" + upper)]),
        request("typed-root", [...base, done("root-start-" + side), user("ROOT_NORMAL_DONE_" + upper)]),
        request("typed-root", [...base, done("root-start-" + side), done("root-question-" + side), user(ANSWER)]),
        request("typed-root", [
          ...base,
          done("root-start-" + side),
          done("root-question-" + side),
          user(ANSWER),
          done("root-answer-" + side),
          user("ROOT_SECOND_" + upper),
        ]),
      ];
      for (const body of cases)
        expect(() => new Function("return async()=>{" + code(response(body)) + "}")).not.toThrow();
    }
  });
  test("SSE preserves tool finish and DONE boundaries", () => {
    expect(stream(request("typed-root", [first]))).toContain('"finish_reason":"tool_calls"');
    expect(stream(request("typed-root", []))).toContain('"finish_reason":"stop"');
    expect(stream(request("typed-root", [])).endsWith("data: [DONE]\n\n")).toBe(true);
  });
});
const state = () => ({
  requestId: "create",
  intent: { sessionId: "root", ownerId: "owner", epoch: "epoch", repoPath: "/remote/repo", role: "root", depth: 0 },
  record: { sessionFile: "/server/session.jsonl" },
  source: {
    head: "head",
    snapshot: "snapshot",
    selectedUntracked: [],
    omittedUntracked: ["never-upload.txt", "authorized.txt"],
    source: { kind: "current-tracked", history: "orphan-baseline", matchesCurrent: true },
  },
  commands: {},
});
describe("typed root receipt assertions reject weakened evidence", () => {
  test("reattach rejects changed root, source or server journal", () => {
    const before = state();
    assertSameRoot(before, state());
    for (const key of ["sessionId", "ownerId", "epoch", "repoPath"]) {
      const next = state();
      (next.intent as any)[key] = "changed";
      expect(() => assertSameRoot(before, next)).toThrow();
    }
    const next = state();
    next.record.sessionFile = "/different";
    expect(() => assertSameRoot(before, next)).toThrow();
    const source = state();
    source.source.snapshot = "recaptured";
    expect(() => assertSameRoot(before, source)).toThrow();
  });
  test("orphan history and explicit include provenance required", () => {
    assertSnapshot(state(), "head", []);
    const s = state();
    s.source.source.history = "full";
    expect(() => assertSnapshot(s, "head", [])).toThrow();
    expect(() => assertSnapshot(state(), "head", ["authorized.txt"])).toThrow();
  });
  test("unknown prompt cannot masquerade as completion or replay safely", () => {
    const s: any = state();
    s.commands.a = { command: { kind: "prompt", text: "first" }, receipt: { state: "unknown" } };
    expect(() => assertOnePrompt(s, "first")).toThrow();
    s.commands.a.receipt.state = "completed";
    assertOnePrompt(s, "first");
    s.commands.b = structuredClone(s.commands.a);
    expect(() => assertOnePrompt(s, "first")).toThrow();
  });
  test("human facet requires completed receipt and pending owner/version", () => {
    const q = {
      id: "q",
      text: questionText("clean"),
      status: "pending",
      owner: { sessionId: "s", branchId: "b" },
      version: 1,
    };
    assertQuestion(q, questionText("clean"));
    expect(() => assertQuestion({ ...q, status: "answered" }, q.text)).toThrow();
    expect(() => assertQuestion({ ...q, owner: {} }, q.text)).toThrow();
    const s: any = state();
    s.commands.a = { command: { kind: "questions.list" }, receipt: { state: "completed", result: [q] } };
    expect(questionsFromReceipt(s)).toEqual([q]);
    s.commands.a.receipt.state = "unknown";
    expect(() => questionsFromReceipt(s)).toThrow();
  });
  test("missing or duplicated root/child work fails", () => {
    const rows = ["root-start", "root-answer", "root-second"].map((phase) => ({
      phase,
      cwd: "/root",
      role: "root",
      depth: 0,
    }));
    rows.push({ phase: "child-start", cwd: "/worktree", role: "normal", depth: 1 });
    assertWorkOnce(rows);
    expect(() => assertWorkOnce([...rows, rows[0]])).toThrow();
    expect(() => assertWorkOnce(rows.slice(0, 3))).toThrow();
    expect(() => assertWorkOnce(rows.map((r) => (r.phase === "child-start" ? { ...r, cwd: "/root" } : r)))).toThrow();
  });
});
describe("typed fixture infrastructure safety", () => {
  const read = (f: string) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
  test("network none, no local inference, explicit binary, normal picker answer", () => {
    const runner = read("scripts/remote-root-placement-e2e.ts");
    expect(runner).toContain('"--network",\n    "none"');
    expect(runner).toContain("process.env.DIE_BIN");
    expect(runner).not.toContain("parentProvider");
    expect(runner).not.toContain("Bun.serve");
    expect(runner).toContain("new RemoteClient().connect");
    expect(runner).toContain("assert.deepEqual(files(agent), [])");
    expect(runner).toContain('type("/questions")');
    expect(runner).not.toContain('type("/questions answer');
    expect(runner).toMatch(/"--remote-include",\s*"authorized.txt"/);
    expect(runner).toContain("actualMissingProof");
  });
  test("SSH disallows TTY and forwarding; Dockerfile installs no tmux/packages", () => {
    const ssh = read("tests/fixtures/remote-typed-root-placement/sshd_config");
    expect(ssh).toContain("PermitTTY no");
    expect(ssh).toContain("AllowTcpForwarding no");
    const docker = read("tests/fixtures/remote-typed-root-placement/Dockerfile");
    expect(docker).not.toContain("apt-get");
    expect(docker).not.toContain("COPY runtime/tmux");
    const settings = JSON.parse(read("tests/fixtures/remote-typed-root-placement/settings.json"));
    expect(settings.defaultModel).toBe("typed-root");
  });
});
