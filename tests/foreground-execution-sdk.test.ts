import { afterEach, beforeAll, expect, test } from "bun:test";
import { runToolCall, type AgentTool, type AgentToolCall } from "@earendil-works/pi-agent-core";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseStreamingJson } from "@earendil-works/pi-ai";
import {
  AssistantMessageComponent,
  InteractiveMode,
  initTheme,
  ToolExecutionComponent,
  SessionManager,
  type ExtensionAPI,
  type ExtensionToolContext,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Container, getCapabilities, setCapabilities, stripTerminalSequences } from "@earendil-works/pi-tui";
import { registerExecuteTool } from "../src/typescript/extension";
import type { ExecutionResult } from "../src/typescript/execution";
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
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});
const plain = (component: { render(width: number): string[] }) =>
  component
    .render(120)
    .map(stripTerminalSequences)
    .map((line) => line.trimEnd())
    .filter(Boolean);
function fixture(
  args: AgentToolCall["arguments"] = {},
  options: { cwd?: string; executable?: string; sessionManager?: SessionManager } = {},
) {
  const handlers = new Map<string, () => void | Promise<void>>();
  let definition!: ToolDefinition;
  let redraws = 0;
  const cwd = options.cwd ?? "/fixture";
  const ctx = { cwd, sessionManager: options.sessionManager } as unknown as ExtensionToolContext;
  const execution = registerExecuteTool(
    {
      on(name: string, fn: () => void | Promise<void>) {
        handlers.set(name, fn);
      },
      registerTool(tool: ToolDefinition) {
        definition = tool;
      },
    } as unknown as ExtensionAPI,
    undefined,
    options.executable,
    () => 0,
  );
  // Shutdown stops preview timers and awaits any real executor still owned by this fixture.
  cleanups.push(async () => {
    await handlers.get("session_shutdown")?.();
  });
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
    cwd,
  );
  return {
    tool,
    definition,
    redraws: () => redraws,
    agentEnd: () => handlers.get("agent_end")?.(),
    stopForeground: (sessionManager = options.sessionManager) =>
      execution.stopForeground({ ...ctx, sessionManager } as ExtensionToolContext),
    execute: () => {
      const sdkTool: AgentTool = {
        ...definition,
        execute: (id, input, signal, onUpdate) => definition.execute(id, input, signal, onUpdate, ctx),
      };
      return runToolCall(
        { type: "toolCall", id: "call-1", name: "execute", arguments: args },
        {
          tools: [sdkTool],
          assistantMessage: { role: "assistant", content: [] } as never,
          context: { messages: [], tools: [sdkTool] },
        },
      );
    },
  };
}

async function executorFixture(args: AgentToolCall["arguments"], script?: string) {
  const directory = await mkdtemp(join(tmpdir(), "bruv-foreground-sdk-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  let executable = resolve(import.meta.dir, "../dist/bruv");
  if (script !== undefined) {
    executable = join(directory, "fixture-execute");
    await Bun.write(executable, script);
    await chmod(executable, 0o700);
  }
  // Keep the real manager and its output artifacts alive until executor shutdown has completed.
  const sessionManager = SessionManager.create(directory, join(directory, "sessions"));
  return { ...fixture(args, { cwd: directory, executable, sessionManager }), directory };
}

const success = {
  content: [{ type: "text", text: "Execution completed with exit code 0.\n\nstdout:\nSECRET_OUTPUT" }],
  details: { exitCode: 0 },
  isError: false,
};

test("SDK partial argument events keep one animated row from empty call through label/code/execution/partial output", async () => {
  const { tool, definition, redraws } = fixture();
  expect(
    Object.keys((definition.parameters as { properties: Record<string, unknown> }).properties).slice(0, 2),
  ).toEqual(["label", "code"]);
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
  const { tool, agentEnd, redraws } = fixture({ label: "Read README" });
  expect(plain(tool)).toEqual(["⠋ Read README"]);
  agentEnd();
  const stoppedRedraws = redraws();
  await Bun.sleep(100);
  expect(redraws()).toBe(stoppedRedraws);
});

test("real SDK rejected tool execution preserves actual failure output and concise rendering", async () => {
  const { tool, execute } = await executorFixture(
    { label: "Read README", code: "fixture" },
    "#!/bin/sh\nprintf 'ordinary output\\n'\nprintf 'permission denied\\n' >&2\nexit 7\n",
  );
  const outcome = await execute();
  expect(outcome.isError).toBe(true);
  const failure = outcome.result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
  expect(failure).toContain("Execution failed with exit code 7.");
  expect(failure).toContain("ordinary output");
  expect(failure).toContain("permission denied");
  tool.updateResult({ ...outcome.result, isError: outcome.isError });
  expect(plain(tool)).toEqual(["✗ Read README — permission denied"]);
});

test("real SDK foreground completion retains output and releases execution ownership", async () => {
  const { tool, execute, stopForeground, directory } = await executorFixture({
    label: "Read output",
    code: 'console.log("FOREGROUND_OUTPUT".repeat(1000))',
  });
  const outcome = await execute();
  expect(outcome.isError).toBe(false);
  const details = outcome.result.details as ExecutionResult;
  expect(details.exitCode).toBe(0);
  expect(details.cancelled).toBe(false);
  expect(details.stdoutPath).toContain(join(directory, "sessions"));
  expect(await readFile(details.stdoutPath!, "utf8")).toBe("FOREGROUND_OUTPUT".repeat(1000) + "\n");
  expect(stopForeground()).toBe(0);
  tool.updateResult({ ...outcome.result, isError: outcome.isError });
  expect(plain(tool)).toEqual(["✓ Read output"]);
});

test("real SDK foreground stop is owner-scoped and completion waits for worker exit", async () => {
  const { tool, execute, stopForeground, directory } = await executorFixture({
    label: "Wait",
    code: 'await Bun.write(process.cwd() + "/ready", String(process.pid)); await new Promise(() => {});',
  });
  const pending = execute();
  const readyPath = join(directory, "ready");
  const deadline = Date.now() + 3_000;
  // Bun.file retains an initial missing-file observation; poll with a fresh handle.
  while (!(await Bun.file(readyPath).exists())) {
    if (Date.now() > deadline) throw new Error("Foreground worker did not become ready");
    await Bun.sleep(10);
  }
  const pid = Number(await readFile(readyPath, "utf8"));
  expect(Number.isInteger(pid) && pid > 0).toBe(true);
  expect(stopForeground(SessionManager.inMemory(directory))).toBe(0);
  expect(() => process.kill(pid, 0)).not.toThrow();
  expect(stopForeground()).toBe(1);
  const outcome = await pending;
  expect(outcome.isError).toBe(true);
  expect(outcome.result.content).toEqual([
    expect.objectContaining({ type: "text", text: expect.stringContaining("Execution cancelled") }),
  ]);
  expect(() => process.kill(pid, 0)).toThrow();
  expect(stopForeground()).toBe(0);
  tool.updateResult({ ...outcome.result, isError: outcome.isError });
  expect(plain(tool)).toEqual(["✗ Wait — failed"]);
});
