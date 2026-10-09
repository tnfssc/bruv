import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { parseConnectorArguments } from "../../src/claude-compat/arguments";
import { mcpFactory, nativeStorage, permissionBinding } from "../../src/claude-compat/binding";
import type { InjectedMcpSession } from "../../src/claude-compat/mcp";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { NativeHistory } from "../../src/claude-compat/history";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function home() {
  const cwd = await mkdtemp(join(tmpdir(), "bruv-binding-"));
  directories.push(cwd);
  return { cwd, agentDir: join(cwd, "agent"), configDir: join(cwd, "sdk-home") };
}

function args(...flags: string[]) {
  return parseConnectorArguments(["--input-format", "stream-json", "--output-format", "stream-json", ...flags]);
}

test("a new session persists its canonical identity before any response", async () => {
  const options = await home();
  const sessionId = randomUUID();
  const created = await nativeStorage(args("--session-id", sessionId), options);
  expect(created.manager.getEntries()).toEqual([]);
  const file = created.manager.getSessionFile()!;
  expect(JSON.parse((await readFile(file, "utf8")).trim()).id).toBe(created.manager.getSessionId());
  const resumed = await nativeStorage(args("--resume", sessionId), options);
  expect(resumed.manager.getSessionFile()).toBe(file);
  expect(resumed.manager.getSessionId()).toBe(created.manager.getSessionId());
  expect(resumed.history!.options.sourceSessionId).toBe(created.manager.getSessionId());
});

test("fresh import and reopened import branch through the same durable checkpoint map", async () => {
  const options = await home();
  const sessionId = randomUUID();
  const native = await NativeHistory.open({ ...options, sessionId, sourceSessionId: randomUUID() });
  const checkpoint = await native.append({
    sourceMessageId: "old-user",
    type: "user",
    message: { role: "user", content: "imported context" },
    timestamp: new Date().toISOString(),
  });
  await native.append({
    sourceMessageId: "old-assistant",
    type: "assistant",
    message: { role: "assistant", model: "fixture/model", content: [{ type: "text", text: "answer" }] },
    timestamp: new Date().toISOString(),
  });
  const imported = await nativeStorage(args("--resume", sessionId, "--resume-session-at", checkpoint), options);
  const user = imported.manager
    .getEntries()
    .find((entry) => entry.type === "message" && entry.message.role === "user")!;
  expect(imported.manager.getLeafId()).toBe(user.id);
  expect(imported.parentUuid).toBe(checkpoint);
  expect(imported.manager.getSessionId()).not.toBe(native.options.sourceSessionId);
  const reopened = await nativeStorage(args("--resume", sessionId, "--resume-session-at", checkpoint), options);
  expect(reopened.manager.getSessionId()).toBe(imported.manager.getSessionId());
  expect(reopened.manager.getLeafId()).toBe(user.id);
  expect(reopened.parentUuid).toBe(checkpoint);

  // An incomplete tool checkpoint must not move the canonical leaf or rewrite the binding.
  const invalid = await imported.history!.append({
    sourceMessageId: "unmapped-tool-call",
    type: "assistant",
    message: {
      role: "assistant",
      model: "fixture/model",
      content: [{ type: "tool_use", id: "pending-tool", name: "bash", input: { command: "echo unsafe" } }],
    },
    timestamp: new Date().toISOString(),
  });
  const index = join(options.agentDir, "native-sessions", sessionId + ".json");
  const bindingBefore = await readFile(index, "utf8");
  const canonicalFile = imported.manager.getSessionFile()!;
  const leafBefore = SessionManager.open(canonicalFile).getLeafId();
  await expect(nativeStorage(args("--resume", sessionId, "--resume-session-at", invalid), options)).rejects.toThrow(
    "incomplete tool exchange",
  );
  expect(SessionManager.open(canonicalFile).getLeafId()).toBe(leafBefore);
  expect(imported.manager.getLeafId()).toBe(user.id);
  expect(await readFile(index, "utf8")).toBe(bindingBefore);
});

test("permission responses must match the actual tool call", async () => {
  const gate = permissionBinding(args(), async () => ({ behavior: "allow", toolUseID: "another-call" }));
  await expect(
    gate.authorize({
      toolName: "execute",
      input: { code: "1" },
      toolUseId: "actual-call",
      effect: "arbitrary-typescript",
      owner: "bruv",
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow("Permission response did not match this tool call");
});

test("MCP error envelope keeps the upstream text", async () => {
  let tool: ToolDefinition | undefined;
  const upstream = "Upstream task failed";
  mcpFactory({
    tools: () => [{ name: "mcp__peer__task", description: "Upstream tool text", inputSchema: { type: "object" } }],
    callTool: async () => ({ isError: true, content: [{ type: "text", text: upstream }] }),
  } as unknown as InjectedMcpSession)({
    registerTool: (registered: ToolDefinition) => {
      tool = registered;
    },
  } as unknown as ExtensionAPI);
  expect(tool!.description).toBe("Upstream tool text");
  await expect(tool!.execute("actual-call", {}, new AbortController().signal, undefined, {} as never)).rejects.toThrow(
    "MCP tool error: " + upstream,
  );
});

test("MCP registration leaves absent prose empty instead of repeating the wire name", () => {
  const tools: ToolDefinition[] = [];
  const schema = { type: "object", properties: { text: { type: "string", description: "EXTERNAL_SCHEMA" } } };
  mcpFactory({
    tools: () => [
      { name: "mcp__peer__bare", inputSchema: schema },
      { name: "mcp__peer__empty", description: "", inputSchema: schema },
    ],
  } as unknown as InjectedMcpSession)({
    registerTool: (tool: ToolDefinition) => tools.push(tool),
  } as unknown as ExtensionAPI);
  expect(tools.map((tool) => tool.name)).toEqual(["mcp__peer__bare", "mcp__peer__empty"]);
  expect(tools.map((tool) => tool.description)).toEqual(["", ""]);
  for (const tool of tools) expect(tool.parameters).toBe(schema);
});
