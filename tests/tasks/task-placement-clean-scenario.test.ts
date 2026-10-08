import { test, expect } from "bun:test";
import {
  response,
  stream,
  ANSWER,
  QUESTION,
  type RequestBody,
} from "../../scripts/fixtures/task-placement-clean/scenario";
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const tool = (body: any) => JSON.parse((response(body) as any).tool_calls[0].function.arguments);
test("presentation tools execute with the real question-list shape and write the notes", async () => {
  const body = { model: "studio", messages: [{ role: "user", content: ANSWER }] };
  const { code, label } = tool(body);
  const effects: string[] = [];
  const owner = { sessionId: "s", branchId: "b" };
  let written = "";
  const questions = {
    list: async () => {
      effects.push("list");
      return [{ id: "q", owner, version: 4, text: QUESTION }];
    },
    resolve: async (q: any) => {
      expect(q).toEqual({ id: "q", owner, version: 4, reason: "Used your preference" });
      effects.push("resolve");
    },
  };
  await new AsyncFunction("questions", "Bun", code)(questions, {
    write: async (path: string, text: string) => {
      effects.push("write");
      expect(path).toBe("NOTES.md");
      written = text;
    },
  });
  expect(effects).toEqual(["list", "resolve", "write"]);
  expect(written).toBe(
    "# Getting started\n\n1. Install dependencies.\n2. Run the development server.\n3. Open the local app.\n",
  );
  expect(label).toBe("Write getting-started notes");
});
test("do not emit a success statement after a tool failure", () => {
  expect(() =>
    response({
      model: "studio",
      messages: [
        { role: "user", content: ANSWER },
        { role: "tool", tool_call_id: "write-notes", content: "Execution failed with exit code 1." },
      ],
    }),
  ).toThrow("Notes write failed");
});
test("natural actions contain no fixture markers and keep default child target", () => {
  for (const body of [
    { model: "studio", messages: [] },
    { model: "helper", messages: [] },
    { model: "studio", messages: [{ role: "tool", tool_call_id: "review-guide", content: "ok" }] },
  ]) {
    const action = tool(body);
    expect(action.code).not.toMatch(/PLACEMENT_|ROOT_|nonce|receipt|RootCommand/);
    new AsyncFunction(action.code);
  }
  const first = tool({ model: "studio", messages: [] });
  expect(first.code).not.toContain("target:");
  expect(first.code).toContain('workspace:{kind:"worktree"}');
});

test("finished conversation stays short enough to leave actions visible", () => {
  const final = response({
    model: "studio",
    messages: [
      { role: "user", content: ANSWER },
      { role: "tool", tool_call_id: "write-notes", content: "ok" },
    ],
  }) as { content: string };
  expect(final.content.split("\n").length).toBeLessThanOrEqual(6);
  expect(final.content).toContain("Use /close");
});

test("the question operation blocks with the saved question ownership and version", async () => {
  const { code } = tool({
    model: "studio",
    messages: [{ role: "tool", tool_call_id: "review-guide", content: "ok" }],
  });
  const saved = { id: "q", owner: { sessionId: "s", branchId: "b" }, version: 4 };
  const effects: string[] = [];
  await new AsyncFunction("questions", code)({
    ask: async (input: unknown) => {
      expect(input).toEqual({ text: QUESTION, choices: [ANSWER, "Add more detail"], allowFreeText: false });
      effects.push("ask");
      return saved;
    },
    block: async (input: unknown) => {
      expect(input).toEqual({
        ...saved,
        checkpoint: "Write the getting-started notes",
        foreground: true,
      });
      effects.push("block");
    },
  });
  expect(effects).toEqual(["ask", "block"]);
});

test("SSE preserves the deterministic helper, question, answer and notes progression", () => {
  const done = (tool_call_id: string) => ({ role: "tool", tool_call_id, content: "ok" });
  const parent: Required<RequestBody> = { model: "studio", messages: [] };
  const helper: Required<RequestBody> = { model: "helper", messages: [] };
  const turn = (body: RequestBody, toolId?: string) => {
    const frames = stream(body).split("\n\n").filter(Boolean);
    expect(frames).toHaveLength(3);
    expect(frames[2]).toBe("data: [DONE]");
    const [first, last] = frames.slice(0, 2).map((frame) => JSON.parse(frame.slice("data: ".length)));
    expect(first.model).toBe(body.model);
    expect(first.choices[0].finish_reason).toBeNull();
    expect(first.choices[0].delta).toEqual(response(body));
    expect(last.choices[0]).toEqual({ index: 0, delta: {}, finish_reason: toolId ? "tool_calls" : "stop" });
    if (toolId) {
      const call = first.choices[0].delta.tool_calls[0];
      expect(call.id).toBe(toolId);
      expect(call.function.name).toBe("execute");
      new AsyncFunction(JSON.parse(call.function.arguments).code);
    } else {
      expect(first.choices[0].delta.tool_calls).toBeUndefined();
    }
  };
  turn(parent, "review-guide");
  turn(helper, "read-guide");
  helper.messages.push(done("read-guide"));
  turn(helper);
  parent.messages.push(done("review-guide"));
  turn(parent, "ask-detail");
  parent.messages.push(done("ask-detail"));
  turn(parent);
  parent.messages.push({ role: "user", content: ANSWER });
  turn(parent, "write-notes");
  parent.messages.push(done("write-notes"));
  turn(parent);
});
