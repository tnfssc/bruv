import { expect, test } from "bun:test";
import { parseStreamingJson } from "@earendil-works/pi-ai";
import { taskRowFromLaunch, taskRowsFromDetails, taskRowsFromSessionEntries } from "../src/ui/task-rows";
import type { RootObservation } from "../src/remote/root-contract";
import { dispatchRootFacet } from "../src/remote/root-runtime";
import { RootControls, type RootPresentationControls, RootTranscript } from "../src/remote/root-presenter";

function replay(messages: unknown[], extraEvents: unknown[] = []): RootObservation {
  const events = [...messages.map((message) => ({ type: "message_end", message })), ...extraEvents];
  return {
    record: {
      state: "running",
      intent: { ownerId: "owner", epoch: "epoch", sessionId: "s", role: "root", depth: 0, repoPath: "/repo" },
    },
    events: events.map((event, index) => ({ seq: index + 1, event })),
    cursor: events.length,
    hasMore: false,
  };
}

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
test("normal user/assistant/tool progress and observations append completed messages", () => {
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
  t.apply(replay([{ role: "assistant", content: "authoritative" }]));
  expect(t.messages).toHaveLength(2);
  expect(t.render(80).join("\n")).toContain("hello");
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
  expect(visible).toContain("✓ inspect");
  expect(visible).not.toContain("partial source");
  expect(visible).not.toContain("Action");
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
  expect(t.render(120).join("\n")).toContain("✗ execute — permission denied");
  expect(t.render(120).join("\n")).toContain("permission denied");
});

test("internal saved answers stay hidden in replay and streaming, even with tool details open", () => {
  const t = new RootTranscript();
  const hidden = {
    role: "custom",
    customType: "question-answer",
    display: false,
    content: 'Saved human answer: {"owner":"private-answer-owner"}',
  };
  t.apply(replay([{ role: "assistant", content: "Notes are ready" }, hidden]));
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

test("normal execute events keep one animated row through partial label, preparation, and execution", () => {
  const t = new RootTranscript();
  const partial = (args: any) => ({
    role: "assistant",
    content: [{ type: "toolCall", id: "call", name: "execute", arguments: args }],
  });
  t.event({ type: "message_start", message: partial({}) });
  expect(
    t
      .render(120, 0)
      .map((row) => row.trimEnd())
      .filter(Boolean),
  ).toEqual(["⠋"]);
  expect(
    t
      .render(120, 80)
      .map((row) => row.trimEnd())
      .filter(Boolean),
  ).toEqual(["⠙"]);
  expect(t.pendingAction).toBe(true);
  t.event({ type: "message_update", message: partial(parseStreamingJson('{"code":"RAW_PRIVATE_SOURCE')) });
  expect(t.render(120, 0).join("\n")).not.toContain("RAW_PRIVATE_SOURCE");
  expect(t.render(120, 0).join("\n")).not.toContain("execute");
  t.event({ type: "message_update", message: partial(parseStreamingJson('{"label":"Read RE')) });
  expect(t.render(120, 0).join("\n")).toContain("⠋ Read RE");
  const complete = partial({ label: "Read README", code: "RAW_PRIVATE_SOURCE" });
  t.event({ type: "message_update", message: complete });
  const preparing = t.render(120, 0);
  t.event({ type: "message_end", message: complete });
  t.event({
    type: "tool_execution_start",
    toolCallId: "call",
    toolName: "execute",
    args: complete.content[0].arguments,
  });
  t.event({
    type: "tool_execution_update",
    toolCallId: "call",
    toolName: "execute",
    partialResult: { content: "RAW_PRIVATE_PARTIAL" },
  });
  expect(t.render(120, 0)).toEqual(preparing);
  const result = {
    role: "toolResult",
    toolCallId: "call",
    toolName: "execute",
    content: "RAW_PRIVATE_OUTPUT",
    isError: false,
    details: { exitCode: 0 },
  };
  t.event({ type: "tool_execution_end", toolCallId: "call", toolName: "execute", result, isError: false });
  t.event({ type: "message_end", message: result });
  const settled = t.render(120, 0).join("\n");
  expect(settled).toContain("✓ Read README");
  expect(settled.split("Read README")).toHaveLength(2);
  expect(settled).not.toMatch(/RAW_PRIVATE|executing|executed|Action/);
  expect(t.pendingAction).toBe(false);
  expect(t.progress).toBe("");
  const reopened = new RootTranscript();
  reopened.apply(replay(t.messages));
  expect(reopened.render(120, 0)).toEqual(t.render(120, 0));
  reopened.toggleDetails();
  const expanded = reopened.render(120, 0).join("\n");
  expect(expanded).toContain("Tool call call");
  expect(expanded).toContain("RAW_PRIVATE_SOURCE");
  expect(expanded).toContain("RAW_PRIVATE_OUTPUT");
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
  expect(rows.indexOf("Read output")).toBeLessThan(rows.indexOf("✗ Read output — permission denied"));
  expect(rows).toContain("permission denied");
  expect(rows).toContain("✗ Action — orphan failure");
  expect(rows).not.toContain("PRIVATE_SUCCESS");
  t.details = true;
  const expanded = t.render(120).join("\n");
  // Expanded details keep original message order; compact actions alone pair by call identity.
  expect(expanded.indexOf("Tool call second")).toBeLessThan(expanded.indexOf("PRIVATE_SUCCESS"));
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
    if (details) {
      // Keep the shipped expanded transcript, including the actual result text.
      expect(rows).toContain("Action");
      expect(rows).toContain("cancelled by user");
      expect(rows).not.toContain("✗ Timed out · Action");
      expect(rows).toContain("time limit reached");
    } else {
      expect(rows).toContain("✗ Action — cancelled");
      expect(rows).toContain("✗ Action — timed out");
    }
    expect(rows).toContain("Source return: pending");
    expect(rows).toContain("Human action required");
    expect(rows).toContain("Remote outcome unknown");
    expect(rows).not.toContain("HIDDEN_");
  }
});

function renderedRows(t: RootTranscript) {
  return t
    .render(120, 0)
    .map((line) => line.trimEnd())
    .filter(Boolean);
}
function launchMessages(jobs: any[], id = "launch") {
  return [
    {
      role: "assistant",
      content: [
        { type: "toolCall", id, name: "execute", arguments: { label: "Start tasks", code: "RAW_LAUNCH_SOURCE" } },
      ],
    },
    {
      role: "toolResult",
      toolCallId: id,
      toolName: "execute",
      isError: false,
      content: "RAW_LAUNCH_OUTPUT",
      details: { taskRows: jobs.map((job) => taskRowFromLaunch(job, id)), exitCode: 0 },
    },
  ];
}

test("normal root facet snapshots and task completion update a single canonical row per identity", async () => {
  const t = new RootTranscript();
  const jobs = [
    { id: "tests", kind: "command", title: "Run tests", status: "running" },
    { id: "guide", kind: "agent", title: "Review guide", status: "running" },
  ];
  t.messages = launchMessages(jobs);
  expect(renderedRows(t)).toEqual(["↗ Run tests", "↗ Review guide"]);
  const ctx: any = {
    sessionManager: { getSessionId: () => "s", getSessionFile: () => "session.jsonl", getBranch: () => [] },
    isIdle: () => true,
    hasPendingMessages: () => false,
  };
  const services: any = {
    questions: { service: { list: () => [] }, sync: async () => {} },
    jobs: async (_ctx: any, method: string, params: any) => {
      expect(method).toBe("jobs.list");
      return params.cursor ? { jobs: [jobs[1]] } : { jobs: [jobs[0]], nextCursor: "page2" };
    },
  };
  const facets = await dispatchRootFacet(ctx, services, { kind: "snapshot" });
  t.event({ type: "root_ready", facets });
  expect(renderedRows(t)).toEqual(["↗ Run tests", "↗ Review guide"]);
  const completion = {
    role: "custom",
    customType: "task-complete",
    display: true,
    content: "do not infer outcome from this prose",
    details: {
      tasks: [
        { ...jobs[0], status: "failed", exitCode: 1 },
        { ...jobs[1], status: "completed" },
      ],
    },
  };
  t.event({ type: "message_end", message: completion });
  expect(renderedRows(t)).toEqual(["✗ Run tests — exit 1", "✓ Review guide"]);
  t.event({ type: "root_facets", jobs }); // A delayed running snapshot cannot reopen completion.
  expect(renderedRows(t)).toEqual(["✗ Run tests — exit 1", "✓ Review guide"]);
  const reopened = new RootTranscript();
  reopened.apply(replay(t.messages, [{ type: "root_ready", facets }]));
  expect(renderedRows(reopened)).toEqual(renderedRows(t));
  t.toggleDetails();
  const expanded = t.render(120, 0).join("\n");
  expect(expanded).toContain("RAW_LAUNCH_SOURCE");
  expect(expanded).toContain("RAW_LAUNCH_OUTPUT");
  expect(expanded).toContain(completion.content);
});

test("unknown, input, cancellation, timeout and orphan tasks use typed facts rather than prose", () => {
  const t = new RootTranscript();
  t.event({
    type: "root_facets",
    jobs: [
      { id: "orphan", kind: "agent", status: "unknown", title: "Review guide" },
      { id: "ssh:inspect", status: "done", title: "Inspect destination" },
      { id: "cancelled", kind: "command", status: "killed", title: "Run tests" },
      { id: "failed", kind: "agent", status: "failed", title: "Review code" },
      { id: "timeout", kind: "command", status: "failed", timedOut: true, exitCode: 143, title: "Run slow check" },
      { id: "input", kind: "agent", status: "running", actionable: "permission", title: "Read repository" },
      { id: "fallback", kind: "agent", status: "running" },
    ],
  });
  t.event({
    type: "message_end",
    message: {
      role: "custom",
      customType: "task-attention",
      content: "quiet5m review10m",
      details: { attention: [{ id: "orphan", reasons: ["quiet", "review"] }] },
    },
  });
  t.event({ type: "job", title: "MODEL_PROSE_CLAIM_SUCCEEDED", status: "completed" });
  expect(t.progress).toBe("");
  expect(renderedRows(t)).toEqual([
    "? Review guide — status unknown",
    "? Inspect destination — status unknown",
    "⊘ Run tests — cancelled",
    "✗ Review code — failed",
    "✗ Run slow check — timed out",
    "? Read repository — needs your input",
    "↗ fallback",
  ]);
  t.event({
    type: "message_end",
    message: { role: "custom", customType: "task-complete", content: "Task certainly succeeded!" },
  });
  expect(renderedRows(t)).toContain("? Task update — status unknown");
});

test("failure diagnostics and storage warning stay on the same compact action row", () => {
  const t = new RootTranscript();
  t.messages = [
    {
      role: "assistant",
      content: [
        { type: "toolCall", id: "read", name: "execute", arguments: { label: "Read README", code: "RAW_CODE" } },
      ],
    },
    {
      role: "toolResult",
      toolCallId: "read",
      toolName: "execute",
      isError: true,
      content: "FULL_ERROR_DETAIL",
      details: { exitCode: 1, stderr: "permission denied\nEXTRA_ERROR_DETAIL" },
    },
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "save", name: "execute", arguments: { label: "Read large file" } }],
    },
    {
      role: "toolResult",
      toolCallId: "save",
      isError: false,
      content: "RAW_OUTPUT",
      details: {
        exitCode: 0,
        stdoutLost: true,
        images: [{ mimeType: "image/png" }],
        outputArtifactErrors: { stdout: "disk full" },
      },
    },
  ];
  expect(renderedRows(t)).toEqual([
    "✗ Read README — permission denied",
    "✓ Read large file — ⚠ couldn’t save full output",
  ]);
  t.toggleDetails();
  const expanded = t.render(120, 0).join("\n");
  expect(expanded).toContain("FULL_ERROR_DETAIL");
  expect(expanded).toContain("RAW_OUTPUT");
});

test("hidden thinking and display:false tasks stay absent in streaming, replay and expanded details", () => {
  const t = new RootTranscript();
  const hidden = {
    role: "custom",
    display: false,
    customType: "task-complete",
    content: "HIDDEN_TASK_NOTICE",
    details: { tasks: [{ id: "hidden", title: "HIDDEN_TASK_TITLE", kind: "agent", status: "failed" }] },
  };
  t.apply(replay([hidden, { role: "assistant", content: [{ type: "thinking", thinking: "PRIVATE_THINKING" }] }]));
  t.event({ type: "message_update", message: hidden });
  expect(renderedRows(t)).toEqual([]);
  expect(t.pendingAction).toBe(false);
  t.toggleDetails();
  const expanded = t.render(120, 0).join("\n");
  expect(expanded).toContain("PRIVATE_THINKING");
  expect(expanded).not.toContain("HIDDEN_TASK");
});

test("cached event replay restores background launch identity and orphan outcomes", () => {
  const messages = launchMessages([
    { id: "batch-a", kind: "command", status: "running", title: "Run tests" },
    { id: "batch-b", kind: "agent", status: "running", title: "Review guide" },
  ]);
  const events = [
    ...messages.map((message) => ({ type: "message_end", message })),
    {
      type: "root_facets",
      jobs: [
        { id: "batch-a", kind: "command", status: "completed", exitCode: 0, title: "Run tests" },
        { id: "batch-b", kind: "agent", status: "failed", title: "Review guide" },
        { id: "orphan", deliveryMode: "native-async", status: "unknown" },
      ],
    },
  ];
  const original = new RootTranscript();
  const reopened = new RootTranscript();
  for (const event of events) original.event(event);
  for (const event of JSON.parse(JSON.stringify(events))) reopened.event(event);
  expect(renderedRows(original)).toEqual(["✓ Run tests", "✗ Review guide — failed", "? orphan — status unknown"]);
  expect(renderedRows(reopened)).toEqual(renderedRows(original));
});

test("typed capped completion summaries preserve adverse omitted outcomes", () => {
  const t = new RootTranscript();
  t.event({
    type: "message_end",
    message: {
      role: "custom",
      customType: "task-complete",
      content: "RAW_AGGREGATE_NOTICE",
      details: {
        tasks: [{ id: "retained", kind: "agent", status: "completed", title: "Review guide" }],
        taskStatusCounts: { completed: 1, failed: 2, killed: 3, running: 1, unknown: 1 },
        omittedTasks: 7,
      },
    },
  });
  expect(renderedRows(t)).toEqual([
    "✓ Review guide",
    "✗ 2 more tasks failed",
    "⊘ 3 more tasks cancelled",
    "? 2 more tasks unresolved",
  ]);
});

test("direct execution exceptions expose a useful error, not formatter header or stdout", () => {
  const t = new RootTranscript();
  t.messages = [
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "call", name: "execute", arguments: { label: "Read README" } }],
    },
    {
      role: "toolResult",
      toolName: "execute",
      toolCallId: "call",
      isError: true,
      content:
        "Execution failed with exit code 1.\n\nstdout:\nNOT_AN_ERROR\n\nstderr:\n12 | code_line()\n   | ^\nError: permission denied\n    at source.ts:12:3",
    },
  ];
  expect(renderedRows(t)).toEqual(["✗ Read README — Error: permission denied"]);
  t.messages[1].content = "Execution failed with exit code 1.\n\nstdout:\nNOT_AN_ERROR";
  expect(renderedRows(t)).toEqual(["✗ Read README — failed"]);
});

test("typed root task facets replace an in-flight launch row before the execute result", () => {
  const t = new RootTranscript();
  const messages = launchMessages([{ id: "job", kind: "command", title: "Run tests", status: "running" }]);
  t.event({ type: "message_end", message: messages[0] });
  expect(renderedRows(t)).toEqual(["⠋ Start tasks"]);
  const taskRows = taskRowsFromSessionEntries(
    taskRowsFromDetails(messages[1].details).map((data) => ({ type: "custom", customType: "die-task-row", data })),
  );
  t.event({
    type: "root_facets",
    taskRows,
    jobs: [{ id: "job", kind: "command", title: "Run tests", status: "running" }],
  });
  expect(renderedRows(t)).toEqual(["↗ Run tests"]);
  t.event({ type: "message_end", message: messages[1] });
  expect(renderedRows(t)).toEqual(["↗ Run tests"]);
});

test("root job snapshots do not duplicate inline foreground work but keep orphan background tasks", () => {
  const t = new RootTranscript();
  t.messages = launchMessages([]);
  t.event({
    type: "root_facets",
    jobs: [
      { id: "inline", kind: "agent", title: "Fast helper", status: "completed", exitCode: 0, background: false },
      { id: "orphan", kind: "agent", title: "Background helper", status: "running", background: true },
    ],
  });
  expect(renderedRows(t)).toEqual(["✓ Start tasks", "↗ Background helper"]);
});

test("root canonical launch preserves handoff, output-save warning and independent outer failure", () => {
  const t = new RootTranscript();
  t.messages = launchMessages([{ id: "guide", kind: "agent", title: "Review guide", status: "running" }]);
  const result = t.messages[1];
  result.details.handoff = "Work continues. You can ask another question.";
  result.details.outputArtifactErrors = { stdout: "disk full" };
  const handoff = renderedRows(t);
  expect(handoff).toContain("↗ Review guide — ⚠ couldn’t save full output");
  expect(handoff).toContain("Work continues. You can ask another question.");
  expect(handoff.join("\n")).not.toContain("✓ Start tasks");
  delete result.details.handoff;
  delete result.details.outputArtifactErrors;
  result.isError = true;
  result.details.exitCode = 1;
  result.details.stderr = "permission denied";
  expect(renderedRows(t)).toEqual(["↗ Review guide", "✗ Start tasks — permission denied"]);
});

test("expanded root transcript keeps shipped message order, captions and raw details", () => {
  const t = new RootTranscript();
  t.messages = [
    {
      role: "assistant",
      content: [
        { type: "text", text: "Inspecting the guide." },
        {
          type: "toolCall",
          id: "original-call",
          name: "execute",
          arguments: { label: "Read guide", code: "readGuide()" },
        },
      ],
    },
    { role: "toolResult", toolName: "execute", toolCallId: "original-call", content: "guide output", isError: false },
    { role: "custom", display: false, content: "hidden answer" },
  ];
  t.details = true;
  const rows = t
    .render(120, 0)
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\x1b\[[0-9;]*m/g, "");
  expect(rows).toContain("Assistant");
  expect(rows).toContain("Inspecting the guide.");
  expect(rows).toContain('Tool: execute {"label":"Read guide","code":"readGuide()"}');
  expect(rows).toContain("Action\nTool call original-call\nRead guide completed\nguide output");
  expect(rows.indexOf("Inspecting the guide.")).toBeLessThan(rows.indexOf("Action"));
  expect(rows).not.toContain("hidden answer");
  expect(rows).not.toContain("✓ Read guide");
});

test("root replay keeps a readable launch name through unnamed native completion snapshots", () => {
  const launched = {
    id: "task_26de42bf",
    kind: "agent",
    deliveryMode: "native-async",
    status: "running",
    title: "Inspect renderer",
  };
  const messages = launchMessages([launched]);
  const t = new RootTranscript();
  t.messages = messages;
  expect(renderedRows(t)).toEqual(["↗ Inspect renderer"]);
  const entries = [
    { type: "message", message: messages[1] },
    {
      type: "custom",
      customType: "die-task-row",
      data: taskRowFromLaunch({ ...launched, title: undefined, status: "completed" }, "launch"),
    },
  ];
  t.event({
    type: "root_facets",
    taskRows: taskRowsFromSessionEntries(JSON.parse(JSON.stringify(entries))),
    jobs: [{ ...launched, title: undefined, status: "completed", background: true }],
  });
  expect(renderedRows(t)).toEqual(["✓ Inspect renderer"]);
});

test("root resume correlates unnamed shells to execute labels before command previews", () => {
  const jobs = [
    { id: "task_26de42bf", kind: "command", status: "running", command: "bash -lc ENV=huge-command" },
    { id: "second-shell", kind: "command", status: "running", command: "another command" },
    { id: "helper", kind: "agent", title: "Review guide", status: "running" },
  ];
  const messages = launchMessages(jobs);
  (messages[0].content[0] as any).arguments.label = "Run final repaired root suite";
  const next = launchMessages(
    [{ id: "task_c9fcc1c8", kind: "command", status: "running", command: "bash -lc ENV=other-huge-command" }],
    "next",
  );
  (next[0].content[0] as any).arguments.label = "Check next release version and remote branch";
  messages.push(...next);
  const entries = [
    ...messages.map((message) => ({ type: "message", message })),
    {
      type: "custom",
      customType: "die-task-row",
      data: {
        id: "task_26de42bf",
        source: "local",
        status: "failed",
        terminal: true,
        exitCode: 1,
        sourceCallId: "launch",
      },
    },
    {
      type: "custom",
      customType: "die-task-row",
      data: { id: "task_c9fcc1c8", source: "local", status: "succeeded", terminal: true, sourceCallId: "next" },
    },
  ];
  const t = new RootTranscript();
  t.messages = JSON.parse(JSON.stringify(messages));
  expect(renderedRows(t)).toEqual([
    "↗ Run final repaired root suite",
    "↗ Run final repaired root suite",
    "↗ Review guide",
    "↗ Check next release version and remote branch",
  ]);
  t.event({ type: "root_facets", taskRows: taskRowsFromSessionEntries(JSON.parse(JSON.stringify(entries))), jobs: [] });
  expect(renderedRows(t)).toEqual([
    "✗ Run final repaired root suite — exit 1",
    "↗ Run final repaired root suite",
    "↗ Review guide",
    "✓ Check next release version and remote branch",
  ]);
  t.details = true;
  expect(t.render(120, 0).join("\n")).toContain("RAW_LAUNCH_SOURCE");
});
