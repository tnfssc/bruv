# Real native task binding

Implementation: src/claude-compat/task-binding.ts. This is the connector's observation/translation attachment, **not** a second task manager, scheduler, app-task adapter, model continuation or ACK protocol.

## Parent runtime binding

Exact exported seam (types live in task-binding.ts and tasks/task-owner.ts):

- `bindNativeTasks(owner: TaskOwnerAttachment, options: TaskBindingOptions): TaskOwnerBinding & { flush(): Promise<void> }`.
- `createTaskBindingExtension(options: Omit<TaskBindingOptions, "root"> & { root(owner: TaskOwnerAttachment): RootTaskSession; tasks?: Omit<NonNullable<Parameters<typeof tasksExtension>[1]>, "onTaskOwner"> }): ExtensionFactory`.
- `agentLaunchToolUseId(task: TaskSummary): string`; projector `nativeTaskId(link: TaskLink): string` supplies the exact SDK child-history ID.
- `TaskOwnerAttachment`: `manager`, `context`, `sourceSessionId`, `appendEntry(type: string, data: unknown): void`. `TaskOwnerBinding`: `close(): Promise<void>`.
- `TaskBindingOptions`: required `root` and `emit(frame: NativeTaskFrame | AgentCallFrame): void | Promise<void>`; optional `translateChildEntry(source: ChildEntrySource): ChildBody[] | Promise<ChildBody[]>`, `writeChildFrame(source: ChildEntrySource, frame: ChildFrame): void | Promise<void>`, `diagnostic(message: string): void`.


The wrapper defers loading the normal tasks extension until SDK factory activation, after Pi configuration/model bootstrap. Use ONE bruv-tools extension factory. Replace the existing normal tasks factory with createTaskBindingExtension; do not install this wrapper alongside the normal factory:

```ts
import { createTaskBindingExtension } from "./task-binding";
import { nativeTaskId } from "./task-projection";

const factory = createTaskBindingExtension({
  tasks: { executablePath },
  root: owner => ({
    namespace: "bruv:" + connectorHome,
    sourceSessionId: owner.sourceSessionId,
    sessionId: nativeSessionId(),
  }),
  emit: frame => nativeWriter({ ...frame }),
  translateChildEntry, // existing frontend message-block translator
  writeChildFrame: async ({ link, entry }, frame) => {
    if (frame.type === "stream_event") return; // only committed messages enter SDK history
    const child = await nativeHistory.child({
      taskId: nativeTaskId(link),
      sourceSessionId: link.child.sourceSessionId,
      sourceCallId: link.launchToolUseId,
    });
    await child.append({
      sourceMessageId: entry.id + ":" + frame.uuid,
      type: frame.type,
      message: frame.message,
      timestamp: entry.timestamp,
      uuid: frame.uuid,
    });
  },
  diagnostic,
});
// runtime InlineExtension: { name: "bruv-tools", factory, hidden: true }
```

Alternatively keep the runtime's existing tasks factory and pass its new typed onTaskOwner option. The callback receives TaskOwnerAttachment { manager, context, sourceSessionId, appendEntry }; return bindNativeTasks(owner, options). manager is the actual owning TaskManager. The extension calls the binding's async close AFTER manager.shutdown has observed/settled its actual children. bindNativeTasks exposes flush/close for explicit drains. Keep this attachment alive across root results/steering/queued user turns; only owning-session teardown closes it. Do not flush/close it per model turn.

root.sourceSessionId is the actual root journal identity (owner.sourceSessionId, normally the absolute Pi session file), root.sessionId is the runtime's real native UUID, and namespace is a stable connector/installation ownership scope. They are distinct IDs. Root mismatch throws. Do not use a display label or a new random namespace per turn.

emit accepts task envelopes, opaque complete rosters, exact translated child messages and derived root Agent launch/result messages. It must use the existing native ordered writer; it must not ask the model to continue. Derived Agent envelopes carry bruv launch evidence (sourceSessionId, sourceCallId, callIndex, prompt/profile, actual jobId). These are semantic records of the ONE observed spawn, not extra model/tool invocations; no root token usage is fabricated for them. Keep the real outer execute call/history intact.

translateChildEntry receives {link, entry}, with an actual committed Pi message entry read from that explicitly linked child's session file. The frontend owner must translate all supported message blocks/tool IDs without renaming arbitrary execute calls or reconstituting messages from AgentProgress summaries. Returning no translator produces an explicit diagnostic and no fake child frames. Child streaming deltas are not persisted Pi messages and are not reconstructed here.

writeChildFrame is awaited BEFORE publishing each translated child frame. Connect it to the real NativeHistory writer. For committed user/assistant bodies, use native.child({ taskId: nativeTaskId(link), sourceSessionId: link.child.sourceSessionId, sourceCallId: link.launchToolUseId }), then append the translated body with its stable frame.uuid and actual entry timestamp/source ID. Keep the translator's emitted-body source identity unique if it splits one entry into multiple bodies. Store derived root Agent launch/result messages via the runtime's existing root history writer too, preserving their launch evidence. Missing child writer is diagnosed; it is not SDK replay support.

## Real causal launch and event source

JobService already receives getJobRequestIdentity(signal) from the actual TypeScript job bridge: executeInvocationId is the original toolCallId and callIndex is the exact bridge helper request ordinal. withJobCancellation already preserves it. This binding does not parse model code, choose the nearest tool call, consume an execute label or infer causal identity from launch timing.

Minimal task owner hooks retain a copied LocalTaskLaunchIdentity on shell/worker/preparation snapshots: actual owning session, original sourceCallId/callIndex, and selected worker prompt/profile. Child sessionFile/parentSessionFile/model/depth come from real prepareAgentSession/TaskManager state. The old die:task-row-launch -> die-task-row path remains unchanged; the new seam also covers foreground shells and workers that complete BEFORE that post-response UI event. Launches without causal metadata are explicitly not projected.

Native shell tool_use_id remains the real outer execute sourceCallId. Native worker Agent tool_use_id is a deterministic hash of actual sourceSessionId/sourceCallId/callIndex/jobId. Batch workers therefore get distinct calls, preserving the original outer source ID in the journal and emitted launch evidence. The prompt/profile/depth and child source are actual launch facts, not a renamed execute or another task launch.

The binding subscribes to TaskManager.spawned/updated/activity/stopping/completed and starts from its real list snapshot. A running PID must actually exist before announcing a native launch; a real OS spawn failure never creates a fictitious live card. Worktree setup shells retain the causal identity of their actual subagent helper request too. It consumes measured usage/tool-call counts from committed child assistant journal entries, and actual elapsed source timestamps. No guessed zero token usage or percent complete; no shell task_progress. Terminal output uses manager.wait's retained bounded final answer (not the activity-log summary), and confirmed completedAt/manager process-close state. Stop request/stopping never becomes a native terminal without the real confirmed exit.

waitSeconds:0 local workers now have their actual background-delivery owner at spawn/preparation. This makes task_started.is_backgrounded=true truthful, including very fast exits. Foreground-to-background shell transfer emits an ordinary owning-manager updated event, exposing the real delivery-state transition to the complete roster. It introduces no extra notification owner or response ACK. A zero-budget return whose delivery was already background-owned remains background-owned even if the process has already exited: it is not also reclaimed as an inline/ACK-owned result. Other wait/response ACK handling stays unchanged.

## Persistence and opaque roster

Translation cursors are appended as bruv-native-task-projection custom entries in the ACTUAL root Pi journal. They include raw causal launch evidence, stable links, monotone observed-event revision, projection checkpoint, emitted Agent boundaries, consumed child entry IDs and measured counters. Loading a cursor never schedules/restores a process or inserts a job into the manager. An absent job cannot enter the roster; an unregistered historical terminal cannot invent a launch. Delivery failure is latched/diagnosed and surfaced on flush/close instead of silently emitting later events against a half-delivered projection. This is ordered delivery with stable message IDs, not a new exactly-once ACK guarantee.

Opaque background_tasks_changed is always a full replacement derived from this owner's real current manager jobs and their projection checkpoints. Workers are excluded. Actual shell start/background handoff/confirmed completion changes membership, including retaining another shell after one exits. This is real opaque shell monitoring, NOT an invented Monitor execution, task list renamed as a watcher, liveness heartbeat or app child.

**Observed ID compatibility fix:** the pure projector used bruv:<uuid>, but NativeHistory.child rejects ':' in its safe filename segment. Task native IDs now use bruv-<same deterministic UUID>, safe for the SDK's agent-<task_id>.jsonl path. The hash identity domains remain unchanged. This is a fresh-start binding correction, not a migration/replay of existing running processes. Actual SDK child-history readback below uses the exact emitted task_id, not a sanitized alternate ID.

## Proof and limits

Focused tests launch real local shell processes through JobService, exercise confirmed failure/stop/late output/background rosters, and create real local Pi worker subprocesses with real AgentSession journals. The Pi-only child harness uses deterministic offline ModelRuntime.streamSimple; a fetch guard rejects provider network. The unbundled test runner is not the shipped executable, so tests replace only that child command line with tests/fixtures/claude-task-worker.ts while retaining the real JobService preparation/identity/prompt/profile and manager lifecycle. This is not a mocked TaskManager/event mapping. It does not prove the shipped child's full Bruv extension/policy/device graph; that remains executable acceptance.

An additional real SDK root session uses the normal execute tool, actual TypeScript subprocess/job bridge, and the wrapper factory to launch two real shells plus a real local Pi worker in ONE execute call. It proves exact bridge ordinals 1/2/3, original toolCallId, one derived Agent call only for the actual subagent, real child messages, and final owner drain. The isolated test root does not inherit its outer test runner's worker role; production role/depth policy is unchanged.

The real worker history callback writes NativeHistory files from actual child journal entries. The actual pinned SDK 0.3.276 getSubagentMessages(root native UUID, EXACT emitted task_id) reads two committed user/assistant messages with identical native UUIDs and correct original launch parent_tool_use_id. No provider query is run by that SDK reader. Set BRUV_REQUIRE_CLAUDE_SDK=1 to require this proof; without a local SDK, only this optional reader check is omitted, not the real process/journal tests. Source path defaults to .cache/claude-compat-boundary/package/sdk.mjs or BRUV_CLAUDE_SDK_PATH.

Current bounded gaps, NOT silently synthesized:

- SSH/server-scoped native jobs live outside this local manager source. No owner-bound launch/session-message lifecycle source is available in this attachment. It neither invents local task_started for them nor duplicates T3 MCP/app-owned delegation. Their typed remote owner subscription/journal source needs separate parent integration.
- A local child orchestrator's own nested managers are in another process. Its ordinary execute/tools/text remain exactly journal-attributed to that child's launch, but nested tasks need a real cross-process launch/event source with exact parent call identity. This attachment does not guess nested tasks from stdout or timing.
- Preparation reservations emit no live worker until real child activation/session identities exist. Failed preparation has no runnable native child. No live task resume/import/process resurrection is implemented.
- A worker launched foreground and later promoted background preserves actual state; the pinned adapter has no consumed task_updated transition for workers. Do NOT send a duplicate task_started to fake this. Supported truthful async-worker registration here is an actual waitSeconds:0 launch. Parent acceptance must prove other supported wake paths or name this adapter limit.
- Complete committed child messages are available; real child streaming events, independent child-thread steering/close/wait/fork controls are not supplied by this source/pinned adapter. Existing jobs.stop/inspect remain the real control authority. Missing/pruned child journals produce an explicit diagnostic, never reconstructed stdout conversations.
- Actual T3 parent SDK/connector config-home alignment, native browser cards/monitor UI, model/device branding, root idle-wake/queued-user/steering ownership, policy replacement and the shipped executable's local child command line remain parent whole-product acceptance. The binder neither emits root result/wake nor starts a second model continuation. No unchanged-T3 whole-product acceptance/release is claimed here.

Values unchanged: existing one-owner, actual causal evidence, honest proof, safe storage and confirmed-exit rules suffice.

## Validation snapshot

Finished on top of composition `21d9a03a`, using supported Bun **1.4.2**. No runtime/frontend/CLI binding or T3 change is included; parent must wire this seam and bind actual T3 recovery after this commit.

- Full strict TypeScript no-emit check passes against the existing installed dependencies/generated runtime assets. Biome passes on the four new TypeScript files (with warnings); checking all touched sources also reports existing unordered imports in extension, job-service, task-manager and worktree tests. No unrelated formatting churn was applied.
- Relevant combined run: **113 pass, 0 fail, 931 assertions** across task-binding, task-projection, task-manager, job-service, job-bridge, job-bridge-protocol, task-lifecycle, agent-progress and worktree-workspace (9 files). All **8** binding cases pass, including real worker/journal/usage, actual SDK execute dispatch, pinned-SDK child-history readback, reattachment, stop/failure, full opaque rosters and fast-exit background ownership.
- SDK proof required `BRUV_CLAUDE_SDK_PATH=/home/tnfssc/Code/bruv/.cache/claude-compat-boundary/package/sdk.mjs` and `BRUV_REQUIRE_CLAUDE_SDK=1`. Combined log: `/tmp/task-binding-supported-nine.log`; typecheck: `/tmp/task-binding-supported-types.log`.
- The prior mixed-suite stdin timeout was observed with unsupported Bun 1.3.13. On supported 1.4.2, the same ordinary bridge test passes in the relevant combined suite (including task lifecycle); no test timeout was raised or production behavior bypassed. No env or executable-path leakage was found: worker fetch/model overrides run only in a separate child process, parent spawn spies are restored, parent depth/profile env changes are restored, and `process.execPath` is read, not mutated. The fixture installs the same one-time disk-backed SessionManager facade used by CLI/runtime; owned managers are disposed at teardown. No test-only process-global fetch/model/command override is installed in the parent.
- Ordinary bridge execution uses the existing compiled TypeScript worker binary, not a rebuilt/released connector. Temporary dependency/assets/binary links point to the parent checkout and are removed before commit; no preserved-tree symlinks were copied. No install, build, publish/release or trust-setting change was made. `SHELL=/bin/bash` keeps unrelated mise startup notices out of shell-result assertions.

## Rendered normal-worker ACK correction — 2026-10-04

The focused actual normal Bruv/T3 replay found that a JSON-text background Agent ACK
terminalized its running native card. Text results require the pinned adapter's actual
"Async agent launched successfully." prefix while the real background job is still active.
Terminal results remain actual terminal results; no second launch/usage/wake is introduced.
See [focused local subagent acceptance](local-subagent-acceptance.md) for real card,
SDK/source history, late completion, explicit killed-job wake, and Stop exit proof, plus
the remaining root navigation/busy UI gap. This is not runnable-child-control parity.
