import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ownedFixtureEnv, run } from "../helpers/helpers";

// Each journey owns a fresh subprocess: these real SDK adapters patch prototypes.
const diskActivityFixture = String.raw`
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { SessionManager, ToolExecutionComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, Text, stripTerminalSequences } from "@earendil-works/pi-tui";
import { DiskEntryStore } from "./src/history/disk-entry-store.ts";
import { installDiskBackedSessionManager, disposeDiskBackedSessionManager } from "./src/history/session-manager.ts";
import { ACTIVITY_BOUNDARY, ActivityController } from "./src/ui/rolling-activity.ts";
import { installConversationDensity } from "./src/ui/conversation-density.ts";
import { installSdkTaskRows } from "./src/ui/sdk-task-rows.ts";

const prior = process.env.PI_PACKAGE_DIR;
delete process.env.PI_PACKAGE_DIR;
initTheme("dark", false);
if (prior !== undefined) process.env.PI_PACKAGE_DIR = prior;
installDiskBackedSessionManager();
const undoDensity = installConversationDensity();
const undoTasks = installSdkTaskRows({ fg: (_color, text) => text });
const manager = SessionManager.create(process.env.ROOT, process.env.ROOT);
const user = (text) => manager.appendMessage({ role: "user", content: text, timestamp: 1 });
const assistant = (...ids) =>
  manager.appendMessage({
    role: "assistant",
    content: ids.map((id) => ({ type: "toolCall", id, name: "execute", arguments: {} })),
    api: "openai-completions",
    provider: "fixture",
    model: "fixture",
    timestamp: 1,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
  });
const firstUser = user("saved request");
const firstCalls = assistant("a", "b");
// Large irrelevant result bodies must not be read even on a membership miss.
manager.appendMessage({
  role: "toolResult",
  toolCallId: "a",
  toolName: "execute",
  content: [{ type: "text", text: "large result ".repeat(10000) }],
  isError: false,
  timestamp: 1,
});
function appendBookkeepingAndResult() {
  manager.appendCustomEntry("bruv-cache-call", { large: "ignored".repeat(10000) });
  manager.appendLabelChange(firstCalls, "saved label");
  manager.appendSessionInfo("renamed");
  manager.appendMessage({
    role: "toolResult",
    toolCallId: "b",
    toolName: "execute",
    content: [{ type: "text", text: "another result" }],
    isError: false,
    timestamp: 1,
  });
}
const chat = new Container();
const host = {
  chatContainer: chat,
  renderer: { mode: "fullscreen" },
  ui: { requestRender() {} },
  sessionManager: manager,
};
const state = new ActivityController(host);
state.attach();
const tool = (id) => {
  const component = new ToolExecutionComponent(
    "execute",
    id,
    { label: "Check " + id },
    {},
    {
      renderShell: "self",
      renderCall: (_args, _theme, ctx) => new Text(ctx.expanded ? "SOURCE " + id : "Check " + id, 0, 0),
      renderResult: (_result, options) => new Text(options.expanded ? "EVIDENCE " + id : "result " + id, 0, 0),
    },
    { requestRender() {} },
    process.env.ROOT,
  );
  component.updateResult({ content: [{ type: "text", text: "evidence " + id }], isError: false });
  return component;
};
const a = tool("a"),
  b = tool("b");
chat.addChild(a);
chat.addChild(b);
const originalMaterialize = DiskEntryStore.prototype.materialize;
// Count body materializations, including byte-cache hits; not physical disk reads.
const reads = [];
DiskEntryStore.prototype.materialize = function (...args) {
  const meta = typeof args[0] === "string" ? this.byId.get(args[0]) : args[0];
  reads.push(meta);
  return originalMaterialize.apply(this, args);
};
const render = () => chat.render(80).map(stripTerminalSequences).join("\n");
const identities = () => state.groups.map((group) => group.identity);
const expectReplay = (label, expectedReads) => {
  reads.length = 0;
  render();
  assert.equal(reads.length, expectedReads, label + ": only relevant bodies materialized");
  assert.ok(
    reads.every(
      (meta) =>
        (meta.type === "message" && ["user", "assistant"].includes(meta.messageRole)) ||
        (meta.type === "custom" && meta.customType === ACTIVITY_BOUNDARY),
    ),
    label + ": no bookkeeping or tool results",
  );
};
const expectCachedMembership = (label) => {
  reads.length = 0;
  for (let i = 0; i < 12; i++) {
    state.sync();
    render();
  }
  assert.equal(reads.length, 0, label + ": repeated sync and attached renders read zero bodies");
};
`;

async function runDiskActivityJourney(journey: string): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "bruv-activity-disk-"));
  const env = { ...ownedFixtureEnv(root), ROOT: root };
  // The fixture owns adapter teardown; retain its files and isolated HOME/config/SDK for inspection.
  const scenario = `${diskActivityFixture}
try {
${journey}
} finally {
  state.dispose();
  undoTasks();
  undoDensity();
  DiskEntryStore.prototype.materialize = originalMaterialize;
  disposeDiskBackedSessionManager(manager);
}
console.log("ok");
`;
  const result = await run([process.execPath, "-e", scenario], {
    cwd: resolve(import.meta.dir, "../.."),
    env,
  });
  expect(result.stderr).toBe("");
  expect(result.code).toBe(0);
  expect(result.stdout).toBe("ok\n");
}

// These are ordered phases, not independent fixtures. Their shared script scope
// preserves the branch roundtrip and settled live frame through owner replacement.
const membershipReplay = `
expectReplay("initial", 2);
assert.deepEqual(identities(), [firstUser]);
expectCachedMembership("initial warm");
appendBookkeepingAndResult();
expectCachedMembership("bookkeeping and tool-result append");
const boundary = manager.appendCustomEntry(ACTIVITY_BOUNDARY, { callIds: ["a"] });
expectReplay("boundary replay", 3);
assert.deepEqual(identities(), [boundary + ":" + firstUser, firstUser]);
expectCachedMembership("boundary warm");
const nextUser = user("next request");
expectReplay("new user alone", 4);
assert.deepEqual(identities(), [boundary + ":" + firstUser, firstUser]);
assistant("c", "d");
const c = tool("c"),
  d = tool("d");
chat.addChild(c);
chat.addChild(d);
expectReplay("new user and assistant", 5);
assert.deepEqual(identities(), [boundary + ":" + firstUser, firstUser, nextUser]);
const fullLeaf = manager.getLeafId();
manager.branch(firstCalls);
expectReplay("branch back", 2);
assert.deepEqual(identities(), [firstUser, "legacy"]);
manager.branch(fullLeaf);
expectReplay("branch forward", 5);
assert.deepEqual(identities(), [boundary + ":" + firstUser, firstUser, nextUser]);
expectCachedMembership("branch warm");
`;

const liveFrames = `
// Live IDs, child lists, status, mouse, and expansion must not be cached.
state.start();
const e = tool("e"),
  f = tool("f");
chat.addChild(e);
chat.addChild(f);
reads.length = 0;
render();
const live = state.groups.at(-1);
assert.ok(live.identity.startsWith("live-"));
assert.equal(state.count(live), 2);
const click = { type: "click", button: "left", x: 0, y: 0, width: 80, height: 1 };
assert.equal(e.handleMouse(click)?.handled, true);
assert.ok(render().includes("Check e"));
assert.equal(state.groups.at(-1).expanded, true);
e.updateResult({ content: [{ type: "text", text: "failed now" }], isError: true });
assert.ok(render().includes("1 failed"));
assert.equal(reads.length, 0, "live mouse/status/expansion reads zero bodies");
chat.removeChild(f);
render();
assert.equal(state.count(state.groups.at(-1)), 1);
assert.equal(reads.length, 0, "removing a live child still reads zero bodies");
assistant("e", "f");
state.settle();
expectReplay("settled live assistant", 6);
assert.equal(state.groups.at(-1).identity, nextUser);
assert.ok(state.groups.at(-1).tools.includes(e));
assert.equal(c.handleMouse(click)?.handled, true);
assert.ok(render().includes("Check e"));
assert.equal(state.groups.at(-1).expanded, true);
expectCachedMembership("settled live warm");
`;

const ownerTransitions = String.raw`
// Owner replacement must see the controller dirtied by branch navigation and live frames.
assert.deepEqual(state.groups.at(-1).tools, [c, d, e]);
assert.equal(state.groups.at(-1).expanded, true);
assert.equal(e.result.isError, true);

// Rewrite uses the same IDs but replaces the owner's metadata identity.
manager._rewriteFile();
expectReplay("rewrite same IDs", 6);
expectCachedMembership("rewrite warm");
// Reload the same path and IDs, with changed boundary data. No leaf-ID-only key suffices.
const file = manager.getSessionFile();
const entries = readFileSync(file, "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
entries.find((entry) => entry.id === boundary).data.callIds = ["b"];
writeFileSync(file, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
manager.setSessionFile(file);
expectReplay("reread same IDs, changed boundary", 6);
assert.deepEqual(identities().slice(0, 2), [firstUser, boundary + ":" + firstUser]);
expectCachedMembership("reread warm");

manager.newSession();
expectReplay("reset", 0);
assert.deepEqual(identities(), ["legacy"]);
expectCachedMembership("empty reset warm");
manager.appendCustomEntry("bruv-cache-call", { empty: true });
manager.appendSessionInfo("empty renamed");
expectCachedMembership("empty bookkeeping warm");
const resetUser = user("new session");
assistant("a", "b");
expectReplay("reset append", 2);
assert.equal(identities()[0], resetUser);
manager.setSessionFile(file);
expectReplay("session switch", 6);
assert.deepEqual(identities().slice(0, 2), [firstUser, boundary + ":" + firstUser]);
expectCachedMembership("session switch warm");

// Native/in-memory owners have no trustworthy metadata token. Recompute rather
// than guessing a leaf or retaining a branch array which might mutate in place.
const memory = SessionManager.inMemory();
const memoryUser = memory.appendMessage({ role: "user", content: "memory", timestamp: 1 });
memory.appendMessage({
  role: "assistant",
  content: [
    { type: "toolCall", id: "a" },
    { type: "toolCall", id: "b" },
  ],
});
host.sessionManager = memory;
render();
assert.equal(identities()[0], memoryUser);
const memoryBoundary = memory.appendCustomEntry(ACTIVITY_BOUNDARY, { callIds: ["a"] });
render();
assert.deepEqual(identities().slice(0, 2), [memoryBoundary + ":" + memoryUser, memoryUser]);
host.sessionManager = manager;
expectReplay("return to disk owner", 6);
expectCachedMembership("return warm");
`;

test("disk activity preserves membership and live state across branch and owner transitions", async () => {
  await runDiskActivityJourney(membershipReplay + liveFrames + ownerTransitions);
}, 30000);
