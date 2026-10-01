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
test("reopen reconstructs canonical owners solely from persisted typed details", () => {
  restores.push(installSdkTaskRows(theme));
  const launchRows = JSON.parse(JSON.stringify([row()]));
  const terminalRows = JSON.parse(JSON.stringify([row("one", "failed", { exitCode: 1 })]));
  const parent = new Container();
  parent.addChild(tool(launchRows));
  parent.addChild(notice(terminalRows));
  parent.addChild(notice(launchRows));
  expect(plain(parent.render(100))).toEqual(["✗ Run tests — exit 1"]);
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

test("canonical SDK launch preserves actual native image components and avoids a checked launch", () => {
  const prior = getCapabilities();
  setCapabilities({ ...prior, images: "kitty" });
  try {
    restores.push(installSdkTaskRows(theme));
    const parent = new Container();
    const component = tool([row()]);
    component.updateResult({
      content: [{ type: "image", data: makePng().toString("base64"), mimeType: "image/png" }],
      details: { taskRows: [row()] },
      isError: false,
    });
    parent.addChild(component);
    const rendered = parent.render(100).join("\n");
    expect((component as any).imageComponents).toHaveLength(1);
    expect(rendered).toContain("↗ Run tests");
    expect(rendered).toContain("\x1b_G");
    expect(rendered).not.toContain("✓ Start tests");
  } finally {
    setCapabilities(prior);
  }
});
test("canonical SDK rows retain useful actual outer error after task launch", () => {
  restores.push(installSdkTaskRows(theme));
  const parent = new Container();
  const component = tool([row()]);
  (component as any).result.isError = true;
  parent.addChild(component);
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
