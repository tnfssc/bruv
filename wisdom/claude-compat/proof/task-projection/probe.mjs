// Bounded original-source probes; no provider, SDK process, T3 build or patched adapter.
// bun wisdom/claude-compat/proof/task-projection/probe.mjs /path/to/pinned/ClaudeAdapterV2.ts
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  nativeTaskId,
  projectTask,
  projectBackgroundRoster,
  projectChildFrame,
} from "../../../../src/claude-compat/task-projection.ts";
const path = process.argv[2];
if (!path) throw Error("Supply the inspected official ClaudeAdapterV2.ts source path");
const source = readFileSync(path, "utf8");
const sha256 = createHash("sha256").update(source).digest("hex");
assert.equal(
  sha256,
  "566d806fa89ef3c4afda420659db542ff5bf7d2e3e8f018259b5b8c91655cbb2",
  "Use the inspected fed41fa8 adapter, not a patched source",
);
const names = [
  "isClaudeOpaqueBackgroundTaskType",
  "claudePendingBackgroundTask",
  "claudeTaskTypeFromSdkMessage",
  "isClaudeNonSubagentTask",
  "parseClaudeBackgroundTaskEntry",
  "inputRecordValue",
  "firstStringInputField",
  "rememberPendingClaudeSubagentLaunch",
  "rememberClaudeSubagentLaunch",
];
const functions = names.map((name) => {
  const start = source.indexOf(`function ${name}(`);
  const end =
    name === "rememberClaudeSubagentLaunch"
      ? source.indexOf("\ntype PendingClaudeRuntimeRequest", start + 1)
      : source.indexOf("\nfunction ", start + 1);
  assert.ok(start >= 0 && end > start, `Missing source function ${name}`);
  return source.slice(start, end);
});
const js = new Bun.Transpiler({ loader: "ts" }).transformSync(
  'const CLAUDE_OPAQUE_BACKGROUND_TASK_KINDS = new Map([["local_bash", "command"]]); const PENDING_CLAUDE_SUBAGENT_CAP = 64;\n' +
    functions.join("\n"),
);
const h = new Function(
  `${js}\nreturn {isClaudeNonSubagentTask,parseClaudeBackgroundTaskEntry,rememberClaudeSubagentLaunch}`,
)();
const root = { namespace: "probe-owner", sourceSessionId: "actual-root-fixture", sessionId: "native-root-fixture" };
const base = {
  root,
  sourceId: "local",
  jobId: "actual-shell-fixture",
  launchToolUseId: "shell-launch-fixture",
  origin: "bruv",
  kind: "shell",
  parent: { sourceSessionId: root.sourceSessionId, launchToolUseId: null },
};
const agent = {
  ...base,
  jobId: "actual-agent-fixture",
  launchToolUseId: "agent-launch-fixture",
  kind: "worker",
  child: { sourceSessionId: "actual-child-fixture", parentSessionId: root.sourceSessionId },
  prompt: "Actual child fixture prompt",
};
const monitor = {
  ...base,
  jobId: "actual-watcher-fixture",
  launchToolUseId: "monitor-launch-fixture",
  kind: "monitor",
};
const observation = {
  revision: 1,
  eventId: "actual-source-event-fixture",
  edge: "started",
  status: "running",
  description: "Actual linked job fixture",
  isBackgrounded: true,
};
const projected = [base, monitor, agent].map((link) => ({ link, projection: projectTask(link, observation) }));
assert.deepEqual(
  projected.map(({ projection }) => h.isClaudeNonSubagentTask(projection.frames[0])),
  [true, true, false],
);
const roster = projectBackgroundRoster(
  root,
  "actual-snapshot-fixture",
  projected.map(({ link, projection }) => ({ link, checkpoint: projection.checkpoint })),
);
const monitorLinks = new Map([[nativeTaskId(monitor), { toolUseId: monitor.launchToolUseId }]]);
const parsed = roster.tasks.map((entry) => h.parseClaudeBackgroundTaskEntry(entry, monitorLinks));
assert.equal(parsed.find((task) => task.taskId === nativeTaskId(base)).kind, "command");
assert.equal(parsed.find((task) => task.taskId === nativeTaskId(monitor)).kind, "monitor");
assert.equal(
  h.parseClaudeBackgroundTaskEntry({ task_id: nativeTaskId(agent), task_type: "local_agent" }, monitorLinks),
  null,
);
const launchBody = {
  type: "assistant",
  message: {
    id: "actual-nested-launch-message-fixture",
    role: "assistant",
    content: [
      {
        type: "tool_use",
        id: "nested-launch-fixture",
        name: "Agent",
        input: { prompt: "Actual nested prompt", model: "inherit" },
      },
    ],
  },
};
const routedLaunch = projectChildFrame(agent, {
  sourceSessionId: agent.child.sourceSessionId,
  eventId: "actual-child-event-fixture",
  body: launchBody,
});
const context = {
  subagentsByToolUseId: new Map(),
  pendingSubagentLaunchesByToolUseId: new Map(),
  input: { modelSelection: { model: "fixture-model" } },
};
const tool = routedLaunch.message.content[0];
h.rememberClaudeSubagentLaunch(
  context,
  tool.id,
  { type: "record", value: tool.input },
  routedLaunch.parent_tool_use_id,
);
assert.deepEqual(context.pendingSubagentLaunchesByToolUseId.get(tool.id), { ownerToolUseId: agent.launchToolUseId });
console.log(
  JSON.stringify(
    {
      revision: "fed41fa88bb27cb4325cb208d571393850bc63c2",
      adapterSha256: sha256,
      scope:
        "Production projection fixture through inspected original pure adapter functions; NOT SDK wire/browser/real execution proof",
      classification: { shell: true, monitor: true, worker: false },
      parsedRoster: parsed,
      nestedLaunch: { toolUseId: tool.id, ...context.pendingSubagentLaunchesByToolUseId.get(tool.id) },
    },
    null,
    2,
  ),
);
