import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { closeSync, createReadStream, openSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";
import { SessionManager, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import { CACHE_CALL_ENTRY, CacheCountdown, registerCacheCountdown } from "../../src/agent/cache-countdown";
import extension from "../../src/agent/extension";
import { registerNativeCodexCompaction } from "../../src/agent/native-compaction";
import { NATIVE_FAST_ENTRY, nativeFastEnabled } from "../../src/agent/native-fast-mode";
import { DiskEntryStore } from "../../src/history/disk-entry-store";
import { disposeDiskBackedSessionManager, installDiskBackedSessionManager } from "../../src/history/session-manager";
import remoteExtension from "../../src/remote/extension";
import { taskRowsFromSessionManager } from "../../src/ui/task-rows";

const root = process.env.PROBE_ROOT!;
const file = join(root, "session.jsonl");
const fd = openSync(file, "w");
const timestamp = "2026-10-07T00:00:00.000Z";
let leaf: string | null = null;
let sequence = 0;
const row = (data: Record<string, unknown>, parentId = leaf) => {
  const id = "row" + ++sequence;
  writeSync(fd, JSON.stringify({ ...data, id, parentId, timestamp }) + "\n");
  leaf = id;
  return id;
};
const custom = (customType: string, data: unknown) => row({ type: "custom", customType, data });
writeSync(fd, JSON.stringify({ type: "session", version: 3, id: "startup", cwd: root, timestamp }) + "\n");
const anchor = row({ type: "message", message: { role: "user", content: "start", timestamp: 1 } });
const aux = { version: 1, jobs: [{ transcript: "old checkpoint body".repeat(2048) }] };
for (let i = 0; i < 1600; i++) custom("bruv-native-task-projection", aux);
if (process.env.PROBE_CORRUPT_MIDDLE) {
  leaf = "corrupt-middle";
  writeSync(fd, '{"type":"custom","id":"corrupt-middle",broken}\n');
}
custom(CACHE_CALL_ENTRY, { provider: "p", model: "before-shake", timestamp: 50_000 });
custom("bruv-manual-shake", { malformed: "cache invalidation does not parse shake bodies" });
custom(CACHE_CALL_ENTRY, { provider: "p", model: "m", timestamp: 140_001 });
custom(CACHE_CALL_ENTRY, { provider: "p", model: "m", timestamp: 100_000 });
custom(CACHE_CALL_ENTRY, { provider: "p", model: "m", timestamp: "invalid" });
const fast = {
  version: 2,
  sessionId: "startup",
  provider: "openai",
  model: "m",
  oauth: false,
  enabled: true,
  costAcknowledged: true,
  timestamp: 1,
};
const obsoleteFastId = custom(NATIVE_FAST_ENTRY, { ...fast, enabled: false, costAcknowledged: false });
custom(NATIVE_FAST_ENTRY, fast);
custom(NATIVE_FAST_ENTRY, { ...fast, model: "other" });
custom("bruv-instruction-mode", { mode: "fast" });
custom("bruv-goal", {
  version: 1,
  operation: "set",
  at: timestamp,
  goal: {
    id: "goal",
    revision: 1,
    objective: "Restore indexed goal",
    criteria: ["verified"],
    constraints: [],
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
  },
});
row({
  type: "message",
  message: {
    role: "assistant",
    content: [{ type: "toolCall", id: "call", name: "execute", arguments: { label: "Required execute label" } }],
    timestamp: 2,
  },
});
row({
  type: "message",
  message: {
    role: "toolResult",
    toolCallId: "call",
    toolName: "execute",
    content: [],
    details: { tasks: [{ id: "task_done", kind: "command", status: "running", command: "long old preview" }] },
    timestamp: 3,
  },
});
custom("die-task-row", {
  id: "task_done",
  source: "local",
  status: "failed",
  terminal: true,
  exitCode: 7,
  sourceCallId: "call",
});
custom("die-task-row", {
  id: "task_running",
  source: "local",
  status: "running",
  terminal: false,
  sourceCallId: "call",
});
custom("die-task-row", { malformed: true });
const oldCompaction = row({
  type: "compaction",
  summary: "older summary",
  firstKeptEntryId: anchor,
  tokensBefore: 100,
});
const latestCompaction = row({
  type: "compaction",
  summary: "current summary",
  firstKeptEntryId: anchor,
  tokensBefore: 50,
});
custom("bruv-remote-active", { taskId: "restart" });
custom("bruv-remote-attention", { key: "irrelevant-old-key" });
const activeTip = leaf!;
// Physically newest records belong to an abandoned branch and must not restore.
leaf = anchor;
custom("bruv-agent", { type: "normal", depth: 3 });
custom("bruv-instruction-mode", { mode: "normal" });
custom("die-task-row", { id: "task_offbranch", source: "local", status: "failed", terminal: true });
custom(CACHE_CALL_ENTRY, { provider: "p", model: "m", timestamp: 250_000 });
closeSync(fd);
const originalSize = statSync(file).size;
const prefixHash = async () => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file, { start: 0, end: originalSize - 1 })) hash.update(chunk);
  return hash.digest("hex");
};
const originalHash = await prefixHash();

installDiskBackedSessionManager();
const manager = SessionManager.open(file);
manager.branch(activeTip);
if (process.env.PROBE_CORRUPT_MIDDLE) {
  const branch = manager.getBranch();
  assert.ok(!branch.some((entry) => entry.id === anchor));
  assert.equal(await prefixHash(), originalHash, "branch reads preserve corrupt original bytes");
  assert.equal(statSync(file).size, originalSize);
}
manager.getBranch = () => {
  throw Error("startup requested all original branch bodies");
};
manager.getEntries = () => {
  throw Error("startup requested all original journal bodies");
};
const materialize = DiskEntryStore.prototype.materialize;
const loaded: string[] = [];
DiskEntryStore.prototype.materialize = function (meta) {
  const metadata = typeof meta === "string" ? this.byId.get(meta)! : meta;
  assert.notEqual(metadata.customType, "bruv-native-task-projection", "old auxiliary body materialized");
  assert.notEqual(metadata.id, obsoleteFastId, "superseded provider state must not load");
  loaded.push(metadata.id);
  return materialize.call(this, meta);
};
const handlers = new Map<string, Function[]>();
const messages: any[] = [];
const statuses = new Map<string, string>();
const tools = new Map<string, any>();
const commands = new Map<string, any>();
const notices: string[] = [];
const pi: any = {
  on: (name: string, handler: Function) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
  events: { on: () => () => {}, emit() {} },
  appendEntry: (type: string, data: unknown) => manager.appendCustomEntry(type, data),
  registerCommand: (name: string, command: any) => commands.set(name, command),
  registerFlag() {},
  getFlag: () => false,
  registerMessageRenderer() {},
  registerTool: (tool: any) => tools.set(tool.name, tool),
  setActiveTools() {},
  sendMessage: (message: any) => messages.push(message),
  sendUserMessage() {},
};
const fire = async (name: string, event: unknown, ctx: any) => {
  let result: any;
  for (const handler of handlers.get(name) ?? []) result = await handler(event, ctx);
  return result;
};
const ui = {
  theme: { fg: (_color: string, text: string) => text },
  notify: (text: string) => notices.push(text),
  setStatus: (key: string, value: string) => statuses.set(key, value),
  getEditorComponent: () => ({}),
  setFooter() {},
  setHeader() {},
};
const ctx: any = {
  cwd: root,
  mode: "tui",
  hasUI: false,
  ui,
  sessionManager: manager,
  model: undefined,
  modelRegistry: { runtime: { streamSimple() {}, async prepareRequest() {} }, isUsingOAuth: () => false },
  scopedModels: [],
  isIdle: () => true,
  isProjectTrusted: () => true,
  abort() {},
  shutdown() {},
  hasPendingMessages: () => false,
  getContextUsage: () => undefined,
  getSystemPrompt: () => "base",
};
const settings = join(root, "missing-cache-settings.json");
extension(pi, { profilesPath: join(root, "missing-profiles.json"), cacheSettingsPath: settings });
remoteExtension(pi, {
  syncActive: async () => {},
  status: async () => ({
    tasks: {
      restart: { taskId: "restart", events: [], task: { state: "done" } },
    },
  }),
} as any);
// Also install the production countdown handler with an observable instance.
const countdown = new CacheCountdown(() => 200_000);
registerCacheCountdown(pi, countdown, settings);
try {
  await fire("session_start", {}, ctx);
  await Bun.sleep(30);
  assert.equal(statuses.get("bruv-mode"), "mode: fast");
  assert.equal(
    messages.filter((m) => m.content?.includes("Remote restart · done")).length,
    1,
    "active remote checkpoint must deliver its completion after reopen",
  );
  assert.deepEqual(countdown.estimate({ model: { provider: "p", id: "m" } } as any), {
    state: "active",
    text: "cache est 60m",
    nextUpdateMs: 1,
  });
  assert.equal(countdown.estimate({ model: { provider: "p", id: "before-shake" } } as any).state, "unknown");
  const fastCtx = {
    ...ctx,
    model: { provider: "openai", id: "m", api: "openai-responses", baseUrl: "https://api.openai.com/v1" },
  };
  assert.equal(nativeFastEnabled(fastCtx), true);
  await commands.get("fast").handler("status", fastCtx);
  assert.ok(notices.some((text) => text.includes("fast on")));
  // Exercise the installed native compaction first-context reader independently
  // of the other context transforms.
  const compactionHooks = new Map<string, Function>();
  registerNativeCodexCompaction({ on: (name: string, hook: Function) => compactionHooks.set(name, hook) } as any);
  const countBeforeContext = loaded.length;
  await compactionHooks.get("context")!({ messages: [] }, ctx);
  assert.deepEqual(loaded.slice(countBeforeContext), [latestCompaction]);
  assert.ok(!loaded.includes(oldCompaction));
  const emptyManager = SessionManager.create(root, root);
  emptyManager.getBranch = () => {
    throw Error("absent checkpoint reader requested all originals");
  };
  emptyManager.getEntries = () => {
    throw Error("absent checkpoint reader requested all originals");
  };
  try {
    const beforeEmptyContext = loaded.length;
    await compactionHooks.get("context")!({ messages: [] }, { ...ctx, sessionManager: emptyManager });
    assert.equal(loaded.length, beforeEmptyContext);
  } finally {
    disposeDiskBackedSessionManager(emptyManager);
  }
  const rows = taskRowsFromSessionManager(manager);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.id === "task_done")!.title, "Required execute label");
  const container = new Container();
  const tool = Object.create(ToolExecutionComponent.prototype);
  Object.assign(tool, {
    toolName: "execute",
    toolCallId: "call",
    expanded: false,
    args: {},
    render: () => ["NATIVE TOOL"],
    result: { content: [], isError: false },
  });
  container.addChild(tool);
  const visible = container.render(120).join("\n");
  assert.match(visible, /Required execute label — exit 7/);
  assert.match(
    visible,
    /Required execute label — status unknown/,
    "installed startup must convert restored running tasks to unknown",
  );
  const turn = await fire("before_agent_start", { systemPrompt: "base" }, ctx);
  assert.equal(typeof turn.systemPrompt, "string");
  assert.doesNotMatch(
    turn.systemPrompt,
    /You are a (?:normal|fast|orchestrator) sub-agent/,
    "a truncated root must not be demoted",
  );
  if (process.env.PROBE_CORRUPT_MIDDLE) {
    assert.ok(manager.buildSessionProjection().messages.length > 0);
    assert.ok(manager.buildContextEntries().length > 0);
  }
  await commands.get("goal").handler("status", ctx);
  assert.ok(notices.some((text) => text.includes("Restore indexed goal")));
  assert.ok(loaded.length < 100, "startup should load only state records, not auxiliary checkpoints");
  await fire("session_shutdown", {}, ctx);

  // Restart at the same active branch: persisted attention suppresses a duplicate.
  await fire("session_start", {}, ctx);
  await Bun.sleep(30);
  assert.equal(messages.filter((m) => m.content?.includes("Remote restart · done")).length, 1);
  await fire("session_shutdown", {}, ctx);

  // Malformed newest mode must not fall through to the earlier fast setting.
  manager.appendCustomEntry("bruv-instruction-mode", { mode: "invalid" });
  await fire("session_start", {}, ctx);
  assert.equal(statuses.get("bruv-mode"), "mode: orchestrator");
  await fire("session_shutdown", {}, ctx);

  manager.appendCustomEntry("bruv-agent", { type: "fast", depth: 1 });
  await fire("session_start", {}, ctx);
  const child = await fire("before_agent_start", { systemPrompt: "base" }, ctx);
  assert.match(child.systemPrompt, /You are a fast sub-agent/);
  await fire("session_shutdown", {}, ctx);

  manager.appendCustomEntry("bruv-agent", { type: "unknown", depth: 0 });
  manager.appendCustomEntry("bruv-instruction-mode", { mode: "invalid" });
  await fire("session_start", {}, ctx);
  const invalid = await fire("before_agent_start", { systemPrompt: "base" }, ctx);
  assert.match(invalid.systemPrompt, /You are a normal sub-agent/);
  await fire("session_shutdown", {}, ctx);
  assert.equal(await prefixHash(), originalHash);
  console.log(
    "installed startup restored rows, cache, goals, identity and remote attention without auxiliary originals",
  );
} finally {
  await fire("session_shutdown", {}, ctx);
  DiskEntryStore.prototype.materialize = materialize;
  disposeDiskBackedSessionManager(manager);
}
