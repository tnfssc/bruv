import { expect, test } from "bun:test";
import { RootControls, type RootPresentationControls, RootTranscript } from "../src/remote/root-presenter";

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
  expect(t.progress).toBe("");
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

test("root transcript keeps tool protocol private by default and exposes explicit details", () => {
  const t = new RootTranscript();
  t.event({
    type: "message_end",
    message: {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "call-1",
          name: "execute",
          arguments: { label: "inspect", code: "await questions.ask({text:'secret'})" },
        },
      ],
    },
  });
  t.event({
    type: "message_end",
    message: {
      role: "toolResult",
      toolName: "execute",
      toolCallId: "call-1",
      content: "Question saved: q1",
      isError: false,
    },
  });
  t.event({
    type: "message_update",
    message: {
      role: "assistant",
      content: [{ type: "toolCall", name: "execute", arguments: { code: "partial source" } }],
    },
  });
  t.event({ type: "tool_execution_update", toolName: "execute", partialResult: { content: "partial protocol dump" } });
  const visible = t.render(120).join("\n");
  expect(visible).toContain("Action");
  expect(visible).toContain("partial source");
  expect(visible.split("inspect")).toHaveLength(2);
  expect(visible).not.toMatch(/Running|completed/);
  expect(visible).not.toContain("Question saved: q1");
  expect(visible).not.toContain("assistant");
  expect(visible).not.toContain("toolResult");
  expect(visible).not.toContain("JSON.stringify");
  expect(visible).not.toContain("secret");
  expect(visible).not.toContain("partial protocol dump");
  expect(t.progress).toBe("");
  t.toggleDetails();
  const detail = t.render(120).join("\n");
  expect(detail).toContain("questions.ask");
  expect(detail).toContain("Question saved: q1");
  expect(detail).toContain("Tool call call-1");
  t.toggleDetails();
  t.event({
    type: "message_end",
    message: { role: "toolResult", toolName: "execute", content: "permission denied", isError: true },
  });
  expect(t.render(120).join("\n")).toContain("✗ Failed · execute");
  expect(t.render(120).join("\n")).toContain("permission denied");
});

test("internal saved answers stay hidden in snapshots and streaming, even with tool details open", () => {
  const t = new RootTranscript();
  const hidden = {
    role: "custom",
    customType: "question-answer",
    display: false,
    content: 'Saved human answer: {"owner":"private-answer-owner"}',
  };
  t.apply({ record: { messages: [{ role: "assistant", content: "Notes are ready" }, hidden] }, events: [] } as any);
  t.event({ type: "message_update", message: hidden });
  for (const details of [false, true]) {
    t.details = details;
    const visible = t.render(120).join("\n");
    expect(visible).toContain("Notes are ready");
    expect(visible).not.toContain("private-answer-owner");
    expect(visible).not.toContain("Saved human answer");
  }
  expect(t.messages).toContain(hidden);
});

test("root action rows are quiet in flight and settled, with source fallback and useful speakers", () => {
  for (const [args, expected] of [
    [{ label: "Read output", code: "console.log(1)" }, "Read output"],
    [{ code: "console.log(1)" }, "console.log(1)"],
    [{}, "execute"],
  ] as const) {
    const t = new RootTranscript();
    t.messages = [
      { role: "user", content: "Please check" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will check." },
          { type: "toolCall", id: "call", name: "execute", arguments: args },
        ],
      },
    ];
    const inFlight = t.render(120).join("\n");
    expect(inFlight).toContain("Please check");
    expect(inFlight).toContain("I will check.");
    expect(inFlight.split(expected)).toHaveLength(2);
    t.event({ type: "tool_execution_start", toolCallId: "call", toolName: "execute" });
    expect(t.progress).toBe("");
    t.messages.push({
      role: "toolResult",
      toolCallId: "call",
      toolName: "execute",
      content: [{ type: "text", text: "RAW_OUTPUT_PRIVATE" }],
      isError: false,
    });
    t.event({ type: "tool_execution_end", toolCallId: "call", toolName: "execute", isError: false });
    expect(t.progress).toBe("");
    const settled = t.render(120).join("\n");
    expect(settled).toBe(inFlight);
    expect(settled).not.toMatch(/executing|executed|running|completed/i);
    expect(settled).not.toContain("RAW_OUTPUT_PRIVATE");
    t.toggleDetails();
    expect(t.render(120).join("\n")).toContain("RAW_OUTPUT_PRIVATE");
    if ("code" in args) expect(t.render(120).join("\n")).toContain(args.code);
  }
});

test("same-text actions pair only by identity and keep failed and orphan outcomes visible", () => {
  const t = new RootTranscript();
  t.messages = [
    {
      role: "assistant",
      content: [
        { type: "toolCall", id: "first", name: "execute", arguments: { label: "Read output", code: "first_source()" } },
        {
          type: "toolCall",
          id: "second",
          name: "execute",
          arguments: { label: "Read output", code: "second_source()" },
        },
      ],
    },
    { role: "toolResult", toolCallId: "second", toolName: "execute", content: "permission denied", isError: true },
    { role: "toolResult", toolCallId: "first", toolName: "execute", content: "PRIVATE_SUCCESS", isError: false },
    { role: "toolResult", toolCallId: "missing", content: "orphan failure", isError: true },
  ];
  const rows = t
    .render(120)
    .map((row) => row.trimEnd())
    .join("\n");
  expect(rows.split("Read output")).toHaveLength(3);
  expect(rows.indexOf("Read output")).toBeLessThan(rows.indexOf("✗ Failed · Read output"));
  expect(rows).toContain("permission denied");
  expect(rows).toContain("✗ Failed · Action\norphan failure");
  expect(rows).not.toContain("PRIVATE_SUCCESS");
  t.details = true;
  const expanded = t.render(120).join("\n");
  expect(expanded.indexOf("PRIVATE_SUCCESS")).toBeLessThan(expanded.indexOf("Tool call second"));
  expect(expanded).toContain("first_source()");
  expect(expanded).toContain("second_source()");
});

test("root cancellation and timeout remain clear, and display:false also hides action details", () => {
  const t = new RootTranscript();
  t.messages = [
    { role: "custom", display: false, content: '{"owner":"HIDDEN_OWNER","answer":"HIDDEN_ANSWER"}' },
    {
      role: "assistant",
      display: false,
      content: [
        {
          type: "toolCall",
          id: "hidden",
          name: "execute",
          arguments: { label: "HIDDEN_LABEL", code: "HIDDEN_SOURCE" },
        },
      ],
    },
    { role: "toolResult", display: false, toolCallId: "hidden", content: "HIDDEN_RESULT", isError: true },
    { role: "toolResult", content: "cancelled by user", details: { cancelled: true }, isError: false },
    { role: "toolResult", content: "time limit reached", details: { timedOut: true }, isError: false },
    { role: "custom", content: "Source return: pending · safety artifact retained" },
    { role: "custom", content: "Human action required: choose destination" },
    { role: "custom", content: "Remote outcome unknown" },
  ];
  for (const details of [false, true]) {
    t.details = details;
    const rows = t.render(120).join("\n");
    expect(rows).toContain("✗ Cancelled · Action");
    expect(rows).toContain("cancelled by user");
    expect(rows).toContain("✗ Timed out · Action");
    expect(rows).toContain("time limit reached");
    expect(rows).toContain("Source return: pending");
    expect(rows).toContain("Human action required");
    expect(rows).toContain("Remote outcome unknown");
    expect(rows).not.toContain("HIDDEN_");
  }
});
