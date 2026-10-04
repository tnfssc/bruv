# Native filesystem history (history-only slice)

2026-10-03; task_294a9ed0. Owns only history.ts, focused history tests and this note. Read wisdom/values.md and the four absolute contract/checkpoint notes. Inspected stopped task_ece673d7: projection-history.md API freeze exists, but **no history.ts or partial history tests existed** in that tree. Reused its explicit configDir/source-entry/child-binding design; did not take projection code. task_4f0c9326 retains projection/manager-event ownership; task_1c3b7533 retains runtime/Pi bootstrap.

## Exact API: src/claude-compat/history.ts

- **await NativeHistory.open({ configDir, cwd, sessionId, sourceSessionId, projectKey? })** returns a root writer. configDir must be an explicit absolute **parent-SDK-visible** isolated config home. cwd is resolved through realpath. sessionId is the actual native session UUID; sourceSessionId is the actual canonical Pi session ID. Optional projectKey must match the parent SDK's explicit CLAUDE_CODE_PROJECT_DIR_NAME override.
- **await writer.append({ sourceMessageId, type: "user" | "assistant", message, timestamp, uuid?, parentUuid? })** returns the persistent native UUID. message is the complete native role/content object, including actual tool IDs/results. sourceMessageId is the actual Pi entry ID, not text, a task description, or a prose hash. Supply uuid to preserve an admitted native prompt UUID. Omitted UUID is freshly assigned once per source entry and survives reopen. Omitted parentUuid appends linearly; null starts a branch; explicit UUID must already exist. Runtime must supply actual branch parents rather than relabel linear storage as ancestry. Conflicting source replay fails.
- **await writer.child({ taskId, sourceSessionId, sourceCallId, parentAgentId? })** returns a child writer. taskId becomes agentId; sourceCallId is the actual causative tool-use ID. Its .meta.json sidecar exposes toolUseId/parentAgentId to the native SDK. Calling child() on a child writer places a nested transcript under that child's subdirectory; parentAgentId must still be supplied explicitly. No launch, discovery, scheduler, event subscription or task resurrection occurs. Runtime/projection owner supplies committed real bindings. Conflicting bindings fail.
- **await readNativeHistory({ configDir, cwd, sessionId, projectKey? })** reads native records, including source-entry IDs and SDK forkedFrom provenance. This is data, not permission to open the old Pi owner or restore tasks/questions.
- **nativeHistoryToPi(entries, sessionId)** strictly converts the selected UUID-parent chain; returns { messages, nativeUuids }. Selection is by identities/links, never matching prose. One native user record containing tool results can become multiple Pi entries.
- **await importNativeHistory({ configDir, cwd, sessionId, projectKey?, sessionDir })** validates first, then creates **new canonical Pi history** using SessionManager.create. Returns { sessionManager, sourceSessionId, sourceSessionFile, entries: [{ nativeUuid, piEntryId }], history, ownership: "imported-history-only" }. history is the ready writer for subsequent NEW messages in the native fork. The new Pi file has no parentSession and no task/question/owner restore. Completed tool calls/results are stored as history, never invoked. Fork provenance and entry mapping are durable custom Pi entries, not manager job records. Native files remain derived views/import inputs, not another canonical task authority.
- **await NativeHistory.resumeImported({ configDir, cwd, sessionId, sourceSessionId, projectKey? }, sessionManager)** reopens an imported writer after process restart. sessionManager must be the NEW imported Pi session. It verifies imported native UUIDs/content against that Pi session's durable map and messages before accepting inherited records. Ordinary open() rejects SDK forks even if SDK retained the old bruv sourceSessionId. Persist native-to-new-Pi routing through the runtime owner's real session state, not a scheduler or an unverified lookup of forkedFrom source IDs.
- **nativeProjectKey(cwd)** implements the pinned SDK's project path encoding, including its >200-character hashed suffix. Pass canonical cwd if using this helper independently.

One writer per root/child. append is serialized within that writer; no cross-process locking or parallel-writer merge. Runtime mirrors finalized canonical entries and starts projecting only NEW entries after import (earlier ones already exist in native storage). Native children report the root native session_id and actual Pi child identity in bruv.sourceSessionId. SDK forks do not copy child files or inherit live children.

## Proven with the actual SDK, not schema-only tests

Exact @anthropic-ai/claude-agent-sdk **0.3.276**, separate Node **v25.9.0** subprocesses, Bun **1.4.2** test runner. SDK subprocesses get isolated HOME/CLAUDE_CONFIG_DIR and no credentials. No query/model request/executable emulation. Published package tarball SHA-256: f65a23c8272467ec37da496c5a349b10b3b4d04f052209f239f028c5aabdc3ca. Package is ignored research input, not vendored source or production dependency.

- getSessionMessages: exact root UUIDs/session IDs, parent-linked branch selection, pagination and reopened source-entry mapping; no child text leaks into root.
- listSubagents/getSubagentMessages: depth-1 and nested filesystem paths; exact UUIDs, supplied actual toolUseId and nested parentAgentId.
- forkSession: actual checkpoint slicing, fresh UUID/session identities, remapped parents, retained forkedFrom AND retained bruv source-entry metadata. SDK provenance is usable; import nevertheless creates a new owner, never resurrects an old one.
- Import of an **actual SDK-created fork** into persisted/reopened real Pi SessionManager: tool call/result IDs/content preserved; excluded later text absent; durable map; new Pi identity; no parentSession or job records. New native prompt appended to the correct fork chain and read by SDK. Fork-of-fork also imports safely.
- SDK fork at an assistant checkpoint with pending tool_use is writable by SDK, but import refuses before creating Pi storage: no speculative execution of that tool. Unknown checkpoint rejected by SDK.
- Wrong isolated parent home really returns no messages and cannot fork. Aligned explicit project-key override works. Canonical symlink cwd and long-path encoding work through the actual SDK.
- Boundary tests preserve images/thinking/redacted thinking/error results; reject conflicting IDs/bindings/dangling chains/unsupported context; detect changed imported content on reopen.

Run: **BRUV_REQUIRE_CLAUDE_SDK=1 bun test tests/claude-compat-history.test.ts**. Default input: .cache/claude-compat-boundary/package/sdk.mjs; override BRUV_CLAUDE_SDK_PATH (adjacent package.json must prove exact version). BRUV_HISTORY_NODE optionally selects Node. Without local SDK and without require=1, the SDK group is explicitly skipped; local boundaries still run. For proof, npm pack @anthropic-ai/claude-agent-sdk@0.3.276, verify digest, extract under that ignored cache directory, and set require=1. Never count a skipped group as SDK proof.

Focused history + existing transport: **24 pass, 0 fail, 104 assertions**; history alone: **9 pass, 60 assertions**. Full TypeScript no-emit check passes after normal generated runtime asset preparation. No browser/native T3/provider/runtime acceptance is claimed.

## Deliberate limits / runtime handoff

- **Pre-fix SDK boundary:** executable-only homePath/configDir isolation is insufficient at official 2644. Parent SDK filesystem APIs consult parent process CLAUDE_CONFIG_DIR/project override, not child query env. UI-only setup requires the upstream provider-scoped history fix; verify availability and actual host parity. Do not align the server environment as setup or write real ~/.claude. Native fork may fail before Bruv starts; the connector cannot catch it. See [current setup](external-t3-setup.md) and [admission](ui-only-admission.md).
- Supported import context: text, stored base64 images, thinking/redacted thinking, ordinary tool_use/tool_result with complete ID-paired exchanges. Unknown blocks, selected compaction/system/attachment/progress context, missing parents, sidechain roots and incomplete tools fail explicitly rather than silently losing context. Genuine-Claude transcripts using other blocks are NOT claimed import-compatible.
- Import performs zero model/tool/job actions. Safe real model-loop bootstrap is runtime owner's responsibility: use imported history as context for a NEW prompt; do not execute a stored tool_call. Real Bruv job-event/owner-policy/question-permission integration is NOT proven by fixture bindings.
- No CLI/wire/runtime/MCP/projection edits, release/push/upstream source changes.

Values unchanged: existing one-owner, honest proof, safe migration and durable-ID rules already cover this boundary. The feature recipe and observed hard gate belong here, not in another general value.

## Actual unchanged T3 history acceptance — 2026-10-04

Recovered only paused task_dd42c4c4's four history harness modules and endpoint
test from its preserved worktree; inspected its last proof rather than restarting
research. That earlier run rendered all three context markers and empty authority,
but **failed overall** because the local fake model rejected genuine background
summary requests. No history.ts bug was observed or changed.

Current parent baseline **156e2450** (task/Live wiring and fixed Stop/cancellation)
was preserved. Compiled its actual connector with supported **Bun 1.4.2**, then
ran official unchanged **t3 v0.0.46-nightly.20261003.2623** with SHA-256
2cc42990ee8ad2ff30bbd43cdcf67686c9ca5aaff5e3ed36b5be40962cc53795,
a transparent connector tap, a real Pi model loop and local fake model. The
unchanged T3 parent and connector used the same explicitly aligned isolated
CLAUDE_CONFIG_DIR; no real credentials/provider calls/devices/global installation.

**PASS**, including parent post-run verifier and cleanup: committed sanitized
[observed proof](proof/native-history/observed/) (result.json, model-checks.json,
model/wire/disk projections, action statuses and reviewed chat screenshots).
Nine actual model requests, no rejected requests; one root execution and one
fresh child inspection. Actual completed shell result, paired model/tool IDs and
pending root question owner are retained as historical content, not authority.

Verified:
- Real UI Fork from this response at the completed root checkpoint; no execute
  call during the fork action, root counter remains exactly one.
- SDK-created fork imports four completed conversation entries into a distinct
  fresh canonical owner, with fresh native UUIDs, retained SDK provenance and
  valid durable native-to-source-entry mappings.
- Actual child jobs.list/questions.list output is empty (jobs total=0, questions=[]),
  canonical parentSession is absent and no root task-projection records were
  imported. The child does not execute the stored root call.
- Reopened original branch remains byte-identical through the final run (raw
  canonical SHA-256 e62d6e64cf2c407b699c75dd7dcf88e0a8237a9061fed82a03a4ad35fb82bd22),
  still shows later root-only context and no child response.
- Native Edit from here + Revert and keep changes selects the retained child
  checkpoint. Abandoned turns remain on disk, but the parent-linked active branch
  and actual rollback/reopen model requests exclude them. Reload and continuation
  retain the same child branch and original orchid-73 context.

Harness fixes, not runtime workarounds: answer the real summary request without
calling tools; verify the imported paired exchange on the first child request
before legitimate subsequent compaction; select the real persisted sidebar item
instead of a transitioning fork draft URL; wait for rendered history after
navigation; dismiss an obstructing native update toast with its close button.
Observed Chromium ENOSPC on crowded /tmp and socket-path overflow under a long
worktree temp path were eliminated using short disk-backed TMPDIR=/var/tmp.
No T3 source/artifact modification or fake native events.

Reusable command/options: scripts/claude-native-acceptance/README.md.
Supported focused checks: **21 passed, zero failed/skipped** across existing actual
SDK 0.3.276 history tests and new endpoint/evidence-verifier tests; no-emit typecheck
passes. Node endpoint tests are separate from native proof.

The old parent-home-alignment and actual T3 fork/rollback gates above are now
satisfied for this completed-tool context. Pending-tool/unknown transcript block
limits remain explicit boundary-test limits, not additional native UI claims.
No remaining concrete history runtime blocker. Human controls, app-owned
worker policy, packaging, release and the full combined acceptance remain owned
by the parent/other workers. Values unchanged.
