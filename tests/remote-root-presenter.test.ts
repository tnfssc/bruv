import { test, expect } from "bun:test";
import { RootControls, RootTranscript, type RootPresentationControls } from "../src/remote/root-presenter";
function fixture(receipt: Record<string, unknown> = {}) {
  const commands: any[] = [];
  const picks: string[] = [];
  const notices: string[] = [];
  const titles: string[] = [];
  const question = {
    id: "not-a-routine-copy-id",
    text: "Choose implementation",
    owner: { sessionId: "s", branchId: "b" },
    version: 3,
    status: "pending",
    choices: ["first", "second"],
  };
  let detached = false;
  const client: any = {
    read: () => ({ commands: {}, target: { name: "builder" } }),
    command: async (command: any) => {
      commands.push(command);
      return { commandId: "c", state: "completed", ...receipt };
    },
    result: async (command: any) => {
      commands.push(command);
      if (command.kind === "questions.list") return { questions: [question] };
      if (command.kind === "jobs.list") return { jobs: [{ id: "job", title: "Run tests", status: "running" }] };
      return { output: "test progress" };
    },
  };
  const ui: RootPresentationControls = {
    choose: async (title) => {
      titles.push(title);
      return picks.shift();
    },
    answer: async () => "second",
    notice: (text) => notices.push(text),
    detach: () => (detached = true),
  };
  return {
    commands,
    picks,
    notices,
    titles,
    question,
    controls: new RootControls(client, ui),
    detached: () => detached,
  };
}
test("empty local provider config: normal typed prompt and dedicated abort with detach separate", async () => {
  const f = fixture();
  await f.controls.submit("Do work");
  await f.controls.submit("/abort");
  await f.controls.submit("/detach");
  expect(f.commands).toEqual([{ kind: "prompt", text: "Do work" }, { kind: "abort" }]);
  expect(f.detached()).toBe(true);
});
test("/questions selects and answers actual owner/version without copying UUID", async () => {
  const f = fixture();
  f.picks.push(f.question.id);
  await f.controls.submit("/questions");
  const answer = f.commands.at(-1);
  expect(answer).toMatchObject({
    kind: "questions.answer",
    id: f.question.id,
    owner: f.question.owner,
    version: 3,
    text: "second",
  });
  expect(answer.replyId).toBeString();
});
test("/ps normal selected inspect and confirmed cancellation", async () => {
  const f = fixture();
  f.picks.push("job", "stop", "yes");
  await f.controls.submit("/ps");
  expect(f.titles[0]).toBe("Jobs on builder");
  expect(f.commands).toContainEqual({ kind: "jobs.inspect", id: "job", limit: 5000 });
  expect(f.commands.at(-1)).toEqual({ kind: "jobs.stop", id: "job" });
});
test("unresolved prompt blocks routine duplicate typing", async () => {
  const f = fixture();
  const c = new RootControls(
    {
      read: () => ({ commands: { c: { command: { kind: "prompt", text: "once" }, receipt: { state: "unknown" } } } }),
      command: async () => {
        throw Error("must not send");
      },
    } as any,
    { notice: () => {}, choose: async () => undefined, answer: async () => undefined, detach: () => {} },
  );
  await expect(c.submit("once")).rejects.toThrow("No duplicate");
});
test("normal user/assistant/tool progress and authoritative snapshot replace history", () => {
  const t = new RootTranscript();
  t.event({ type: "message_end", message: { role: "user", content: "hello" } });
  t.event({
    type: "message_update",
    message: { role: "assistant", content: [{ type: "text", text: "Working **now**" }] },
  });
  t.event({ type: "tool_execution_start", toolName: "shell" });
  expect(t.render(80).join("\n")).toContain("hello");
  expect(t.render(80).join("\n")).toContain("Working");
  expect(t.progress).toBe("Tool: shell");
  t.apply({
    record: { state: "running", messages: [{ role: "assistant", content: "authoritative" }] } as any,
    events: [],
    cursor: 0,
    hasMore: false,
  });
  expect(t.messages).toHaveLength(1);
  expect(t.render(80).join("\n")).toContain("authoritative");
});

test("completed control receipt does not hide an error or claim pending cancellation stopped", async () => {
  const rejected = fixture({ error: "runtime unavailable; outcome unknown" });
  await expect(rejected.controls.submit("/abort")).rejects.toThrow("outcome unknown");
  expect(rejected.notices).toEqual([]);
  const pending = fixture({ result: { stopped: false, pending: true } });
  pending.picks.push("job", "stop", "yes");
  await pending.controls.submit("/ps");
  expect(pending.notices.at(-1)).toContain("cancellation request completed");
  expect(pending.notices.at(-1)).toContain('"stopped":false');
  expect(pending.notices.at(-1)).toContain('"pending":true');
});

test("normal SDK dialogs are human answered with typed controls and detach never responds", async () => {
  const f = fixture();
  f.picks.push("yes");
  await f.controls.dialog({ id: "dialog", method: "confirm", title: "Stop active work?" });
  expect(f.commands.at(-1)).toEqual({ kind: "ui.respond", id: "dialog", confirmed: true });
  const detached = fixture();
  await detached.controls.dialog({ id: "pending", method: "input", title: "Enter choice" }, () => false);
  expect(detached.commands).toEqual([]);
});
