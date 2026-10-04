import { makePng } from "./image-fixture";
import { afterEach, beforeAll, expect, test } from "bun:test";
import { CustomMessageComponent, ToolExecutionComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, Text, stripTerminalSequences, getCapabilities, setCapabilities } from "@earendil-works/pi-tui";
import { TaskManager } from "../src/tasks/task-manager";
import { completionPreview } from "../src/ui/execution-previews";
import { installSdkTaskRows } from "../src/ui/sdk-task-rows";
import {
  formatTaskRow,
  taskRowFromLaunch,
  taskRowFromRemote,
  taskRowKey,
  taskRowsFromDetails,
  taskRowsFromSessionEntries,
  taskSummaryRowsFromDetails,
  upsertTaskRow,
  type TaskRow,
} from "../src/ui/task-rows";
const theme = { fg: (_color: string, text: string) => text } as any;
const restores: Array<() => void> = [];
afterEach(() => {
  while (restores.length) restores.pop()?.();
});
beforeAll(() => {
  const prior = process.env.PI_PACKAGE_DIR;
  delete process.env.PI_PACKAGE_DIR;
  try {
    initTheme("dark", false);
  } finally {
    if (prior !== undefined) process.env.PI_PACKAGE_DIR = prior;
  }
});
const plain = (lines: string[]) => lines.map((line) => stripTerminalSequences(line).trim()).filter(Boolean);
function row(id = "one", status = "running", extras: Record<string, unknown> = {}): TaskRow {
  return taskRowFromLaunch({ id, kind: "command", status, title: "Run tests", ...extras }, "call")!;
}
function tool(rows: TaskRow[], handoff?: string): ToolExecutionComponent {
  const component = new ToolExecutionComponent(
    "execute",
    "call",
    { code: "SOURCE" },
    {},
    {
      name: "execute",
      renderShell: "self",
      renderCall: () => new Text("✓ Start tests", 0, 0),
      renderResult: () => new Text("LAUNCH OUTPUT", 0, 0),
    } as any,
    { requestRender() {} } as any,
    process.cwd(),
  );
  component.updateResult({
    content: [{ type: "text", text: "EXPANDED TOOL EVIDENCE" }],
    details: { taskRows: rows, handoff },
    isError: false,
  });
  return component;
}
function notice(rows: TaskRow[], text = "EXPANDED NOTICE EVIDENCE"): CustomMessageComponent {
  return new CustomMessageComponent(
    { role: "custom", customType: "task-complete", content: text, details: { taskRows: rows }, display: true } as any,
    (message, options) =>
      completionPreview(message.content, options.expanded, theme, options.outputPad, "task-complete", message.details),
  );
}
test("typed outcomes use recorded facts and ID fallback, not output prose", () => {
  expect(formatTaskRow(row())).toBe("↗ Run tests");
  expect(formatTaskRow(row("one", "completed", { output: "FAILED" }))).toBe("✓ Run tests");
  expect(formatTaskRow(row("one", "failed"))).toBe("✗ Run tests — failed");
  expect(formatTaskRow(row("one", "failed", { exitCode: 1 }))).toBe("✗ Run tests — exit 1");
  expect(formatTaskRow(row("one", "killed", { exitCode: 1 }))).toBe("⊘ Run tests — cancelled");
  expect(formatTaskRow(row("one", "killed", { timedOut: true }))).toBe("✗ Run tests — timed out");
  expect(formatTaskRow(row("one", "running", { termination: { cause: "user-stop" } }))).toBe("↗ Run tests");
  expect(formatTaskRow(row("one", "unknown", { title: undefined }))).toBe("? one — status unknown");
  expect(formatTaskRow(row("one", "running", { actionable: "question" }))).toBe("? Run tests — needs your input");
  expect(taskRowFromLaunch("✓ tests passed")).toBeUndefined();
});
test("SSH terminal observation alone is unknown and pending stop is not cancellation", () => {
  expect(formatTaskRow(taskRowFromRemote({ taskId: "remote", title: "Review", state: "done" })!)).toBe(
    "? Review — status unknown",
  );
  expect(
    formatTaskRow(
      taskRowFromLaunch({ id: "ssh:cmVtb3Rl", title: "Review", status: "unknown", cancellationRequested: true })!,
    ),
  ).toBe("? Review — status unknown");
  expect(
    formatTaskRow(taskRowFromRemote({ taskId: "remote", title: "Review", state: "running", actionable: "grant" })!),
  ).toBe("? Review — needs your input");
  expect(formatTaskRow(taskRowFromRemote({ taskId: "remote", title: "Review", state: "cancelled" })!)).toBe(
    "⊘ Review — cancelled",
  );
});
test("replayed terminal truth cannot regress to old running or unknown owner snapshots", () => {
  const map = new Map<string, TaskRow>();
  upsertTaskRow(map, row("one", "completed"));
  upsertTaskRow(map, row("one", "running"));
  upsertTaskRow(map, { ...row("one", "unknown"), terminal: true });
  expect(map.size).toBe(1);
  expect(formatTaskRow(map.get(taskRowKey(row()))!)).toBe("✓ Run tests");
  expect(taskRowsFromDetails(JSON.parse(JSON.stringify({ taskRows: [...map.values()] })))).toHaveLength(1);
});
test("real SDK execute row updates in place, preserves prose and expansion, hides completion duplicate", () => {
  restores.push(installSdkTaskRows(theme));
  const parent = new Container();
  parent.addChild(new Text("Ordinary assistant prose", 0, 0));
  const launch = tool([row()]);
  parent.addChild(launch);
  expect(plain(parent.render(100))).toEqual(["Ordinary assistant prose", "↗ Run tests"]);
  const completion = notice([row("one", "completed")]);
  parent.addChild(completion);
  expect(plain(parent.render(100))).toEqual(["Ordinary assistant prose", "✓ Run tests"]);
  completion.setExpanded(true);
  expect(plain(parent.render(100))).toContain("EXPANDED NOTICE EVIDENCE");
  launch.setExpanded(true);
  expect(plain(parent.render(100))).toContain("LAUNCH OUTPUT");
});
test("multiple actual identities in one execute remain separate despite equal titles", () => {
  restores.push(installSdkTaskRows(theme));
  const parent = new Container();
  parent.addChild(tool([row("one"), row("two")]));
  parent.addChild(notice([row("one", "failed", { exitCode: 1 }), row("two", "completed")]));
  expect(plain(parent.render(100))).toEqual(["✗ Run tests — exit 1", "✓ Run tests"]);
});
test("orphan task owns its first typed notice and later updates do not duplicate", () => {
  restores.push(installSdkTaskRows(theme));
  const parent = new Container();
  parent.addChild(notice([row()]));
  parent.addChild(notice([row("one", "killed")]));
  expect(plain(parent.render(100))).toEqual(["⊘ Run tests — cancelled"]);
});
test("live typed lifecycle snapshots update launch row even when completion notice is absent", () => {
  let live = [row()];
  restores.push(installSdkTaskRows(theme, () => live));
  const parent = new Container();
  parent.addChild(tool([]));
  expect(plain(parent.render(100))).toEqual(["↗ Run tests"]);
  live = [row("one", "failed")];
  expect(plain(parent.render(100))).toEqual(["✗ Run tests — failed"]);
});
for (const installFirst of [true, false]) {
  test(
    "persisted task rows stay at launch when " + (installFirst ? "installed before build" : "built before install"),
    () => {
      if (installFirst) restores.push(installSdkTaskRows(theme));
      const launchRows = JSON.parse(JSON.stringify([row("one"), row("two"), row("three")]));
      const terminalRows = JSON.parse(
        JSON.stringify([row("one", "failed", { exitCode: 1 }), row("two", "completed"), row("three", "killed")]),
      );
      const root = new Container();
      const parent = new Container();
      root.addChild(parent);
      parent.addChild(new Text("Before launch", 0, 0));
      const launch = tool(launchRows);
      parent.addChild(launch);
      for (const [index, terminal] of terminalRows.entries()) {
        parent.addChild(new Text("Reply " + (index + 1), 0, 0));
        parent.addChild(notice([terminal]));
      }
      parent.addChild(notice(launchRows)); // Older replay must not undo terminal truth.
      if (!installFirst) {
        expect(plain(root.render(100))).toContain("✓ Start tests");
        restores.push(installSdkTaskRows(theme));
      }
      const expected = [
        "Before launch",
        "✗ Run tests — exit 1",
        "✓ Run tests",
        "⊘ Run tests — cancelled",
        "Reply 1",
        "Reply 2",
        "Reply 3",
      ];
      expect(plain(root.render(100))).toEqual(expected);
      const wrapped = launch.render;
      expect(plain(root.render(100))).toEqual(expected);
      expect(launch.render).toBe(wrapped);
      launch.setExpanded(true);
      expect(plain(root.render(100))).toContain("LAUNCH OUTPUT");
      (parent.children[3] as CustomMessageComponent).setExpanded(true);
      expect(plain(root.render(100))).toContain("EXPANDED NOTICE EVIDENCE");
      launch.setExpanded(false);
      (parent.children[3] as CustomMessageComponent).setExpanded(false);
      expect(plain(root.render(100))).toEqual(expected);
    },
  );
}
test("shutdown and reinstall use only the new session snapshot and restore SDK renders", () => {
  const originalAdd = Container.prototype.addChild;
  const originalRender = Container.prototype.render;
  const originalCustomRender = CustomMessageComponent.prototype.render;
  let oldReads = 0;
  const stopOld = installSdkTaskRows(theme, () => {
    oldReads++;
    return [row("one", "failed", { title: "Old session", exitCode: 1 })];
  });
  restores.push(stopOld);
  const parent = new Container();
  const oldLaunch = tool([]);
  const oldNotice = notice([row("one", "running", { title: "Old session" })]);
  parent.addChild(oldLaunch);
  parent.addChild(oldNotice);
  expect(plain(parent.render(100))).toEqual(["✗ Old session — exit 1"]);
  stopOld();
  restores.pop();
  expect(Container.prototype.addChild).toBe(originalAdd);
  expect(Container.prototype.render).toBe(originalRender);
  expect(oldLaunch.render).toBe(ToolExecutionComponent.prototype.render);
  expect(oldNotice.render).toBe(originalCustomRender);
  const readsAtShutdown = oldReads;
  // Pi replaces transcript children during the uninstalled gap, then session_start installs.
  parent.clear();
  const newLaunch = tool([]);
  const newNotice = notice([row("one", "running", { title: "New session" })]);
  parent.addChild(newLaunch);
  parent.addChild(newNotice);
  expect(plain(parent.render(100))).toContain("✓ Start tests");
  let live = [row("one", "running", { title: "New session" })];
  const stopNew = installSdkTaskRows(theme, () => live);
  restores.push(stopNew);
  expect(plain(parent.render(100))).toEqual(["↗ New session"]);
  live = [row("one", "completed", { title: "New session" })];
  expect(plain(parent.render(100))).toEqual(["✓ New session"]);
  expect(oldReads).toBe(readsAtShutdown);
  stopNew();
  restores.pop();
  expect(Container.prototype.addChild).toBe(originalAdd);
  expect(Container.prototype.render).toBe(originalRender);
  expect(newLaunch.render).toBe(ToolExecutionComponent.prototype.render);
  expect(newNotice.render).toBe(originalCustomRender);
  expect(plain(parent.render(100))).toContain("✓ Start tests");
});
test("handoff remains readable beside canonical launch rows", () => {
  restores.push(installSdkTaskRows(theme));
  const parent = new Container();
  const component = tool([row()], "Work continues. You can ask another question.");
  // The real handoff preview requires actual successful foreground execute details.
  (component as any).result.details.exitCode = 0;
  parent.addChild(component);
  expect(plain(parent.render(100))).toEqual(["↗ Run tests", "↪ Work continues. You can ask another question."]);
  (component as any).result.details.outputArtifactErrors = { stdout: "disk full" };
  expect(plain(parent.render(100))).toEqual([
    "↗ Run tests — ⚠ couldn’t save full output",
    "↪ Work continues. You can ask another question.",
  ]);
});
test("quiet/review notices are human-invisible but expanded evidence remains", () => {
  const details = { attention: [{ id: "one", reasons: ["quiet", "review"] }], omittedAttention: 3 };
  expect(completionPreview("CHECKPOINT EVIDENCE", false, theme, 0, "task-attention", details).render(100)).toEqual([]);
  expect(
    plain(completionPreview("CHECKPOINT EVIDENCE", true, theme, 0, "task-attention", details).render(100)),
  ).toEqual(["CHECKPOINT EVIDENCE"]);
});
test("capped summaries use only actual structured omitted outcomes", () => {
  expect(
    taskSummaryRowsFromDetails({
      tasks: [{ id: "one", status: "completed" }],
      taskStatusCounts: { completed: 1, failed: 2, killed: 3, running: 4, unknown: 1 },
    }).map((row) => row.text),
  ).toEqual(["✗ 2 more tasks failed", "⊘ 3 more tasks cancelled", "? 5 more tasks unresolved"]);
  expect(taskSummaryRowsFromDetails({ tasks: [], omittedTasks: 2 })).toEqual([
    { color: "warning", text: "? Task update — status unknown" },
  ]);
});
test("real shell manager launches and terminal events retain the actual task identity", async () => {
  const manager = new TaskManager(() => {});
  const rows = new Map<string, TaskRow>();
  const unsubscribe = manager.subscribe((event) => {
    const row = taskRowFromLaunch(event.task, "call");
    if (row) upsertTaskRow(rows, row);
  });
  try {
    const launched = manager.spawn({
      kind: "command",
      title: "Run tests",
      notifyOnComplete: false,
      command: "/bin/sh",
      args: ["-c", "sleep 0.03; exit 1"],
      displayCommand: "test",
      cwd: process.cwd(),
    });
    expect(launched.background).toBe(false);
    expect((await manager.foreground(launched.id, 0)).background).toBe(true);
    expect(manager.list()[0]?.background).toBe(true);
    expect(formatTaskRow(rows.get("local:" + launched.id)!)).toBe("↗ Run tests");
    const terminal = await manager.wait(launched.id);
    expect(terminal.exitCode).toBe(1);
    expect(rows.size).toBe(1);
    expect(formatTaskRow(rows.get("local:" + launched.id)!)).toBe("✗ Run tests — exit 1");
  } finally {
    unsubscribe();
    await manager.shutdown();
  }
});

test("already-built SDK launch preserves actual native image components and avoids a checked launch", () => {
  const prior = getCapabilities();
  setCapabilities({ ...prior, images: "kitty" });
  try {
    const parent = new Container();
    const component = tool([row()]);
    component.updateResult({
      content: [{ type: "image", data: makePng().toString("base64"), mimeType: "image/png" }],
      details: { taskRows: [row()] },
      isError: false,
    });
    parent.addChild(component);
    restores.push(installSdkTaskRows(theme));
    const rendered = parent.render(100).join("\n");
    expect(parent.render(100).join("\n")).toBe(rendered);
    expect((component as any).imageComponents).toHaveLength(1);
    expect(rendered).toContain("↗ Run tests");
    expect(rendered).toContain("\x1b_G");
    expect(rendered).not.toContain("✓ Start tests");
  } finally {
    setCapabilities(prior);
  }
});
test("already-built SDK rows retain useful actual outer error after task launch", () => {
  const parent = new Container();
  const component = tool([row()]);
  (component as any).result.isError = true;
  parent.addChild(component);
  restores.push(installSdkTaskRows(theme));
  expect(plain(parent.render(100))).toContain("↗ Run tests");
  expect(plain(parent.render(100))).toContain("LAUNCH OUTPUT");
});

test("native title can come from the actual typed launch input without parsing source", () => {
  const launched = taskRowFromLaunch(
    { id: "native-task", kind: "agent", deliveryMode: "native-async", status: "running" },
    "call",
    "Review guide",
  )!;
  expect(launched.source).toBe("native");
  expect(formatTaskRow(launched)).toBe("↗ Review guide");
  expect(
    formatTaskRow(
      taskRowFromLaunch(
        { id: "native-task", kind: "agent", deliveryMode: "native-async", status: "failed" },
        "call",
        "Review guide",
      )!,
    ),
  ).toBe("✗ Review guide — failed");
});

test("typed command previews recover legacy task IDs without replacing explicit names", () => {
  const rows = new Map<string, TaskRow>();
  upsertTaskRow(
    rows,
    taskRowFromLaunch({ id: "task_26de42bf", kind: "command", status: "running", title: "Run focused tests" })!,
  );
  upsertTaskRow(
    rows,
    taskRowFromLaunch({
      id: "task_26de42bf",
      kind: "command",
      status: "completed",
      command: "bun test tests/task-rows.test.ts",
      title: "  ",
    })!,
  );
  expect(formatTaskRow([...rows.values()][0])).toBe("✓ Run focused tests");
  expect(
    formatTaskRow(
      taskRowFromLaunch({
        id: "task_c9fcc1c8",
        kind: "command",
        status: "failed",
        exitCode: 2,
        command: "bun run check",
        output: "Everything succeeded",
      })!,
    ),
  ).toBe("✗ bun run check — exit 2");
  expect(
    formatTaskRow(
      taskRowFromLaunch({ id: "unknown", kind: "agent", status: "completed", output: "Readable but not metadata" })!,
    ),
  ).toBe("✓ unknown");
});

test("SDK replay recovers a name from typed launch details and keeps the recorded terminal outcome", () => {
  const entries = [
    {
      type: "message",
      message: {
        role: "toolResult",
        details: { tasks: [{ id: "task_c9fcc1c8", kind: "command", status: "running", command: "bun run check" }] },
      },
    },
    {
      type: "custom",
      customType: "die-task-row",
      data: {
        id: "task_c9fcc1c8",
        source: "local",
        status: "failed",
        terminal: true,
        exitCode: 1,
        sourceCallId: "call",
      },
    },
  ];
  const restored = taskRowsFromSessionEntries(JSON.parse(JSON.stringify(entries)));
  expect(restored).toHaveLength(1);
  expect(formatTaskRow(restored[0])).toBe("✗ bun run check — exit 1");
  const parent = new Container();
  parent.addChild(tool([taskRowFromLaunch({ id: "task_c9fcc1c8", kind: "command", status: "running" }, "call")!]));
  parent.addChild(notice(restored));
  restores.push(installSdkTaskRows(theme, () => restored));
  expect(plain(parent.render(100))).toEqual(["✗ bun run check — exit 1"]);
});

for (const [id, label] of [
  ["task_26de42bf", "Run final repaired root suite"],
  ["task_c9fcc1c8", "Check next release version and remote branch"],
])
  test("SDK resume prefers owning execute label over environment command: " + id, () => {
    const legacy = taskRowFromLaunch(
      { id, kind: "command", status: "running", command: "bash -lc 'ENV=long-command; run-tests'" },
      "call",
    )!;
    const terminal = { id, source: "local", status: "failed", terminal: true, exitCode: 1, sourceCallId: "call" };
    const entries = [
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "call", name: "execute", arguments: { label, code: "SOURCE" } }],
        },
      },
      { type: "message", message: { role: "toolResult", toolCallId: "call", details: { taskRows: [legacy] } } },
      { type: "custom", customType: "die-task-row", data: terminal },
    ];
    const restored = taskRowsFromSessionEntries(JSON.parse(JSON.stringify(entries)));
    expect(formatTaskRow(restored[0])).toBe("✗ " + label + " — exit 1");
    const parent = new Container();
    const component = tool([legacy]);
    (component as any).args.label = label;
    parent.addChild(component);
    parent.addChild(notice([terminal as TaskRow]));
    restores.push(installSdkTaskRows(theme, () => restored));
    expect(plain(parent.render(100))).toEqual(["✗ " + label + " — exit 1"]);
    component.setExpanded(true);
    expect(plain(parent.render(100)).join("\n")).toContain("LAUNCH OUTPUT");
  });

test("SDK label recovery without persisted labels keeps distinct IDs and explicit helper names", () => {
  const parent = new Container();
  const component = tool([
    taskRowFromLaunch({ id: "shell-a", kind: "command", status: "running", command: "long shell command" }, "call")!,
    taskRowFromLaunch({ id: "shell-b", kind: "command", status: "running" }, "call")!,
    taskRowFromLaunch({ id: "helper", kind: "agent", title: "Review guide", status: "running" }, "call")!,
  ]);
  (component as any).args.label = "Run final repaired root suite";
  parent.addChild(component);
  restores.push(installSdkTaskRows(theme));
  expect(plain(parent.render(100))).toEqual([
    "↗ Run final repaired root suite",
    "↗ Run final repaired root suite",
    "↗ Review guide",
  ]);
  (component as any).result.isError = true;
  expect(plain(parent.render(100))).toContain("LAUNCH OUTPUT");
});

test("ownership detail reads scale once per parent render, not once per child", () => {
  restores.push(installSdkTaskRows(theme));
  const parent = new Container();
  const count = 80;
  let detailReads = 0;
  for (let i = 0; i < count; i++) {
    const component = tool([row(String(i))]);
    const result = (component as any).result;
    const details = result.details;
    const taskRows = details.taskRows;
    Object.defineProperty(details, "taskRows", {
      configurable: true,
      get() {
        detailReads++;
        return taskRows;
      },
    });
    parent.addChild(component);
  }
  expect(plain(parent.render(100))).toHaveLength(count);
  expect(detailReads).toBe(count * 2);
});
