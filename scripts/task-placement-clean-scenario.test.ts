import { test, expect } from "bun:test";
import { response, ANSWER, QUESTION } from "./fixtures/task-placement-clean/scenario";
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const tool = (body: any) => JSON.parse((response(body) as any).tool_calls[0].function.arguments);
test("presentation tools execute with the real question-list shape and write the notes", async () => {
  const body = { model: "studio", messages: [{ role: "user", content: ANSWER }] };
  const { code, label } = tool(body);
  let resolved = false;
  let written = "";
  const questions = {
    list: async () => [{ id: "q", owner: { sessionId: "s", branchId: "b" }, version: 4, text: QUESTION }],
    resolve: async (q: any) => {
      expect(q.id).toBe("q");
      resolved = true;
    },
  };
  await new AsyncFunction("questions", "Bun", code)(questions, {
    write: async (path: string, text: string) => {
      expect(path).toBe("NOTES.md");
      written = text;
    },
  });
  expect(resolved).toBe(true);
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
