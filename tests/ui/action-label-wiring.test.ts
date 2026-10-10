import { beforeAll, expect, test } from "bun:test";
import {
  type ExtensionAPI,
  initTheme,
  ToolExecutionComponent,
  CustomMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { registerExecuteTool } from "../../src/typescript/extension";
import { completionPreview } from "../../src/ui/execution-previews";
import { completionDiagnosticDetails } from "../../src/agent/extension";
import { formatCompletionNotification } from "../../src/tasks/completion-notification";

beforeAll(() => initTheme("dark", false));
function registeredTool() {
  let tool: any;
  registerExecuteTool(
    {
      on() {},
      registerTool(definition: unknown) {
        tool = definition;
      },
    } as unknown as ExtensionAPI,
    undefined,
    undefined,
    () => 0,
  );
  return tool;
}
function plain(rows: string[]) {
  return rows
    .map((row) => stripTerminalSequences(row).trimEnd())
    .filter(Boolean)
    .join("\n");
}

test("registered execute exports an optional string label and action-not-finding guidance", () => {
  const tool = registeredTool();
  expect(tool.parameters.properties.label).toEqual({ type: "string" });
  expect(tool.parameters.required).not.toContain("label");
  expect(tool.description).toContain("short plain");
  expect(tool.description).toContain("not a claim it worked");
  expect(tool.promptGuidelines).toBeUndefined();
});

test("native Pi tool component uses labels pending/settled and expands full source/output", () => {
  const tool = registeredTool();
  const args = { code: 'console.log("SOURCE_SENTINEL");', label: "Read task UI" };
  const component = new ToolExecutionComponent(
    "execute",
    "fixture_call",
    args,
    { showImages: false },
    tool,
    { requestRender() {} } as any,
    process.cwd(),
  );
  component.setArgsComplete();
  component.markExecutionStarted();
  expect(plain(component.render(100))).toMatch(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Read task UI$/);
  component.updateResult({
    content: [{ type: "text", text: "Execution completed with exit code 0.\nOUTPUT_SENTINEL" }],
    details: { exitCode: 0 },
    isError: false,
  });
  expect(plain(component.render(100))).toBe("✓ Read task UI");
  component.setExpanded(true);
  const expanded = plain(component.render(100));
  expect(expanded).toContain(args.code);
  expect(expanded).toContain("OUTPUT_SENTINEL");
  expect(expanded).not.toContain("Read task UI");
  component.setExpanded(false);
  component.updateResult({
    content: [{ type: "text", text: "failed evidence" }],
    details: { exitCode: 1 },
    isError: true,
  });
  expect(plain(component.render(100))).toBe("✗ Read task UI — failed evidence");
});

test("native Pi completion component receives explicit title metadata and retains expanded evidence", () => {
  const task = {
    id: "task_fixture",
    kind: "agent",
    title: "Inspect renderer",
    command: "not parsed as a title",
    status: "completed",
    output: "WORKER_SENTINEL",
    exitCode: 0,
  } as any;
  const evidence = formatCompletionNotification([task]);
  expect(evidence).toContain("Title: Inspect renderer");
  const component = new CustomMessageComponent(
    {
      role: "custom",
      customType: "task-complete",
      content: evidence,
      display: true,
      timestamp: Date.now(),
      details: completionDiagnosticDetails([task], []),
    },
    (message, options, theme) =>
      completionPreview(message.content, options.expanded, theme, options.outputPad, "task-complete", message.details),
    undefined,
    0,
  );
  expect(plain(component.render(100))).toBe("✓ Inspect renderer");
  component.setExpanded(true);
  expect(plain(component.render(100))).toContain("WORKER_SENTINEL");
});

test("native Pi attention component hides routine checks but retains expanded checkpoint evidence", () => {
  const evidence = "task_fixture needs a progress checkpoint.\nPROGRESS_SENTINEL";
  const component = new CustomMessageComponent(
    {
      role: "custom",
      customType: "task-attention",
      content: evidence,
      display: true,
      timestamp: Date.now(),
      details: { attention: [{ id: "task_fixture", reasons: ["quiet"], quietForMs: 300_000, elapsedMs: 360_000 }] },
    },
    (message, options, theme) =>
      completionPreview(message.content, options.expanded, theme, options.outputPad, "task-attention", message.details),
    undefined,
    0,
  );
  expect(plain(component.render(100))).toBe("");
  component.setExpanded(true);
  expect(plain(component.render(100))).toContain("PROGRESS_SENTINEL");
});
