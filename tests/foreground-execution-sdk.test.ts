import { afterEach, beforeAll, expect, test } from "bun:test";
import { runToolCall } from "@earendil-works/pi-agent-core";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseStreamingJson } from "@earendil-works/pi-ai";
import {
  AssistantMessageComponent,
  InteractiveMode,
  initTheme,
  ToolExecutionComponent,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Container, getCapabilities, setCapabilities, stripTerminalSequences } from "@earendil-works/pi-tui";
import { registerExecuteTool } from "../src/typescript/extension";
import { installQuietToolUi } from "../src/ui/quiet-tool-ui";
import { installConversationDensity } from "../src/ui/conversation-density";

beforeAll(() => {
  const packageDir = process.env.PI_PACKAGE_DIR;
  delete process.env.PI_PACKAGE_DIR;
  try {
    initTheme("dark", false);
  } finally {
    if (packageDir !== undefined) process.env.PI_PACKAGE_DIR = packageDir;
  }
});
const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});
const plain = (component: { render(width: number): string[] }) =>
  component
    .render(120)
    .map(stripTerminalSequences)
    .map((line) => line.trimEnd())
    .filter(Boolean);
function fixture(args: unknown = {}) {
  const handlers = new Map<string, Function>();
  let definition: any;
  let redraws = 0;
  registerExecuteTool(
    {
      on(name: string, fn: Function) {
        handlers.set(name, fn);
      },
      registerTool(tool: unknown) {
        definition = tool;
      },
    } as unknown as ExtensionAPI,
    undefined,
    undefined,
    () => 0,
  );
  cleanups.push(() => handlers.get("agent_end")?.());
  const tool = new ToolExecutionComponent(
    "execute",
    "call-1",
    args as never,
    {},
    definition,
    {
      requestRender() {
        redraws++;
      },
    } as never,
    "/fixture",
  );
  return { tool, definition, handlers, redraws: () => redraws };
}
const success = {
  content: [{ type: "text", text: "Execution completed with exit code 0.\n\nstdout:\nSECRET_OUTPUT" }],
  details: { exitCode: 0 },
  isError: false,
};

test("SDK partial argument events keep one animated row from empty call through label/code/execution/partial output", async () => {
  const { tool, definition, redraws } = fixture();
  expect(Object.keys(definition.parameters.properties).slice(0, 2)).toEqual(["label", "code"]);
  expect(plain(tool)).toEqual(["⠋"]);
  tool.updateArgs(parseStreamingJson('{"label":"Read'));
  expect(plain(tool)).toEqual(["⠋ Read"]);
  const beforeAnimation = redraws();
  await Bun.sleep(100);
  expect(redraws()).toBeGreaterThan(beforeAnimation);
  expect(plain(tool)[0]).toMatch(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Read$/);
  tool.updateArgs(parseStreamingJson('{"label":"Read README","code":"console.log('));
  expect(plain(tool)).toHaveLength(1);
  expect(plain(tool)[0]).toMatch(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Read README$/);
  tool.updateArgs({ label: "Read README", code: 'console.log("SECRET_CODE")' });
  tool.setArgsComplete();
  tool.markExecutionStarted();
  expect(plain(tool)[0]).not.toContain("SECRET_CODE");
  tool.updateResult(success as never, true);
  expect(plain(tool)).toHaveLength(1);
  expect(plain(tool)[0]).toMatch(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Read README$/);
  tool.updateResult(success as never, false);
  expect(plain(tool)).toEqual(["✓ Read README"]);
  const settledRedraws = redraws();
  await Bun.sleep(100);
  expect(redraws()).toBe(settledRedraws);
  tool.setExpanded(true);
  expect(plain(tool).join("\n")).toContain('console.log("SECRET_CODE")');
  expect(plain(tool).join("\n")).toContain("SECRET_OUTPUT");
  expect(plain(tool)[0]).toBe("Execute · TypeScript");
  tool.setExpanded(false);
  expect(plain(tool)).toEqual(["✓ Read README"]);
});

test("SDK code-first partial arguments never expose source or fabricate a label", () => {
  const { tool } = fixture();
  for (const partial of ['{"code":"SECRET', '{"code":"SECRET_CODE"', '{"code":"SECRET_CODE","label":"Read']) {
    tool.updateArgs(parseStreamingJson(partial));
    expect(plain(tool)).toHaveLength(1);
    expect(plain(tool)[0]).not.toContain("SECRET");
  }
  expect(plain(tool)).toEqual(["⠋ Read"]);
  tool.updateResult({
    ...success,
    details: { exitCode: 0, stdoutLost: true, images: [{}], backgroundJobs: ["one"] },
  } as never);
  expect(plain(tool)).toEqual(["✓ Read"]);
});

test("SDK final failure and save warning stay on the same action row, with full details expanded", () => {
  const { tool } = fixture({ label: "Read README", code: "SECRET_CODE" });
  tool.markExecutionStarted();
  tool.updateResult({
    content: [
      { type: "text", text: "Execution failed with exit code 1.\n\nstderr:\npermission denied\nFULL_DIAGNOSTIC" },
    ],
    details: { exitCode: 1, stderr: "permission denied\nFULL_DIAGNOSTIC" },
    isError: true,
  } as never);
  expect(plain(tool)).toEqual(["✗ Read README — permission denied"]);
  tool.setExpanded(true);
  expect(plain(tool).join("\n")).toContain("FULL_DIAGNOSTIC");
  tool.setExpanded(false);
  tool.updateResult({
    ...success,
    details: { exitCode: 0, stdoutLost: true, outputArtifactErrors: ["disk full"] },
  } as never);
  expect(plain(tool)).toEqual(["✓ Read README — ⚠ couldn’t save full output"]);
  tool.setExpanded(true);
  expect(plain(tool).join("\n")).toContain("execute could not save all output");
});

test("SDK image transport remains present when collapsed without count text", () => {
  const capabilities = getCapabilities();
  setCapabilities({ ...capabilities, images: "kitty" });
  cleanups.push(() => setCapabilities(capabilities));
  const { tool } = fixture({ label: "Show chart", code: "showImage()" });
  const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS5sAAAAASUVORK5CYII=";
  tool.updateResult({
    content: [{ type: "image", data, mimeType: "image/png" }],
    details: { exitCode: 0, images: [{}] },
    isError: false,
  } as never);
  const rows = tool.render(120);
  expect(rows.join("\n")).toContain("\x1b_G");
  expect(rows.map(stripTerminalSequences).join("\n")).toContain("✓ Show chart");
  expect(rows.join("\n")).not.toContain("1 image");
});

test("SDK hidden thinking has no placeholder, visible toggle and independent action spinner still work", () => {
  cleanups.push(installQuietToolUi());
  cleanups.push(installConversationDensity());
  const message = { role: "assistant", content: [{ type: "thinking", thinking: "Private reasoning" }] } as never;
  const assistant = new AssistantMessageComponent(message, true, undefined, "…", 0);
  const parent = new Container();
  parent.addChild(assistant);
  expect(assistant.render(120)).toEqual([]);
  assistant.updateContent(message, true);
  expect(assistant.render(120)).toEqual([]);
  const { tool } = fixture();
  parent.addChild(tool);
  expect(plain(tool)).toEqual(["⠋"]);
  assistant.setHideThinkingBlock(false);
  expect(plain(assistant).join("\n")).toContain("Private reasoning");
  assistant.setHideThinkingBlock(true);
  expect(assistant.render(120)).toEqual([]);
  assistant.updateContent(
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Private reasoning" },
        { type: "text", text: "Ordinary answer" },
      ],
    } as never,
    false,
  );
  expect(plain(assistant)).toEqual(["Ordinary answer"]);
});

test("SDK real output toggle hides only collapsed notice and retains expanded source/output notice", () => {
  cleanups.push(installQuietToolUi());
  const { tool } = fixture({ label: "Read README", code: "SECRET_CODE" });
  tool.updateResult(success as never);
  const mode = Object.create(InteractiveMode.prototype) as any;
  mode.chatContainer = new Container();
  mode.loadedResourcesContainer = new Container();
  mode.ui = { requestRender() {} };
  mode.chatContainer.addChild(tool);
  mode.setToolsExpanded(true);
  expect(plain(mode.chatContainer).join("\n")).toContain("Tool output: expanded");
  expect(plain(tool).join("\n")).toContain("SECRET_CODE");
  mode.setToolsExpanded(false);
  expect(plain(mode.chatContainer)).toEqual(["✓ Read README"]);
  mode.showStatus("Other status");
  mode.showStatus("Tool output: collapsed");
  expect(plain(mode.chatContainer).join("\n")).toContain("Other status");
});

test("SDK exception output selects the actual error rather than a source frame or ordinary stdout", () => {
  const { tool } = fixture({ label: "Read README", code: "SECRET_CODE" });
  tool.updateResult({
    content: [{ type: "text", text: "Execution failed with exit code 1.\n\nstdout:\nordinary output" }],
    details: {
      exitCode: 1,
      stderr:
        '12 | throw new Error("permission denied")\n             ^\nerror: permission denied\n    at /fixture/code.ts:12:1',
    },
    isError: true,
  } as never);
  expect(plain(tool)).toEqual(["✗ Read README — error: permission denied"]);
  tool.updateResult({
    content: [{ type: "text", text: "Execution failed with exit code 7.\n\nstdout:\nordinary output" }],
    details: { exitCode: 7 },
    isError: true,
  } as never);
  expect(plain(tool)).toEqual(["✗ Read README — exit 7"]);
  tool.updateResult({
    content: [{ type: "text", text: "permission denied\n    at /fixture/code.ts:12:1" }],
    isError: true,
  } as never);
  expect(plain(tool)).toEqual(["✗ Read README — permission denied"]);
});

test("SDK active action animation is stopped at agent end even without a result", async () => {
  const { tool, handlers, redraws } = fixture({ label: "Read README" });
  expect(plain(tool)).toEqual(["⠋ Read README"]);
  handlers.get("agent_end")?.();
  const stoppedRedraws = redraws();
  await Bun.sleep(100);
  expect(redraws()).toBe(stoppedRedraws);
});

test("real SDK rejected tool execution preserves actual failure output and concise rendering", async () => {
  const directory = await mkdtemp(join(tmpdir(), "die-foreground-error-"));
  try {
    const executable = join(directory, "fixture-execute");
    await Bun.write(executable, "#!/bin/sh\nprintf 'ordinary output\\n'\nprintf 'permission denied\\n' >&2\nexit 7\n");
    await chmod(executable, 0o700);
    let definition: any;
    registerExecuteTool(
      {
        on() {},
        registerTool(tool: unknown) {
          definition = tool;
        },
      } as unknown as ExtensionAPI,
      undefined,
      executable,
      () => 0,
    );
    const tool = {
      ...definition,
      execute: (id: string, args: unknown, signal: AbortSignal, onUpdate: unknown) =>
        definition.execute(id, args, signal, onUpdate, { cwd: directory }),
    };
    const outcome = await runToolCall(
      { type: "toolCall", id: "error-call", name: "execute", arguments: { label: "Read README", code: "fixture" } },
      {
        tools: [tool],
        assistantMessage: { role: "assistant", content: [] } as never,
        context: { messages: [], tools: [tool] },
      },
    );
    expect(outcome.isError).toBe(true);
    const failure = outcome.result.content.map((part: any) => part.text ?? "").join("\n");
    expect(failure).toContain("Execution failed with exit code 7.");
    expect(failure).toContain("ordinary output");
    expect(failure).toContain("permission denied");
    const component = new ToolExecutionComponent(
      "execute",
      "error-call",
      { label: "Read README", code: "fixture" },
      {},
      definition,
      { requestRender() {} } as never,
      directory,
    );
    component.updateResult({ ...outcome.result, isError: outcome.isError });
    expect(plain(component)).toEqual(["✗ Read README — permission denied"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
