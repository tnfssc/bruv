# Production engine API and handoff

Read wisdom/values.md and the parent implementation-plan, binary-contract, task-ui-contract, implementation-checkpoint notes. This task owns runtime.ts/frontend.ts only; it did not edit transport, root CLI/build, upstream T3, MCP implementation or publication. Named module exports were frozen before implementation; parent composition options were added without changing the handler seam.

## Exact exported seam

runtime.ts exports:
- createClaudeCompatRuntime(options): Promise<ClaudeCompatRuntime>
- ClaudeCompatRuntimeOptions, ClaudeCompatRuntime, CompatUserMessage, CompatControlRequest, CompatControlHandler (types)

Required options: cwd, agentDir, emit(frame). Optional: model (exact provider/id), modelRuntime, settingsManager, sessionManager, nativeSessionId, appendSystemPrompt, extensionFactories, tools, auxiliary, permissionMode, executablePath, diagnostic.

Return object:
- session: actual Pi AgentSession, not a proxy scheduler
- onUser(nativeUserFrame, AbortSignal): Promise<void>
- controls: initialize/get_usage/interrupt/set_model handlers; each accepts the transport's correlated ControlRequest and signal and returns its actual response body. All other controls remain absent and receive the transport's explicit error.
- close(): Promise<void> (idempotent owning shutdown)
- runAuxiliary(text, schema): Promise<CompatFrame> (only isolated auxiliary:true, single-use)

frontend.ts exports createClaudeCompatFrontend(options), CompatFrame and ClaudeCompatFrontendOptions. Its returned implementation object contains factory/onEvent/flush/fail/headlessUI/context/sessionHost/result/text/error/usage/cost/interrupt/checkpoint/commandHandled. Parent normally uses runtime.ts, not these internal projection helpers.

Bind directly into ClaudeCompatTransport: emit to transport.send, onUser to engine.onUser, controls to engine.controls. Structural compatibility was executed against the independently owned transport file in task_6d11fc27, not merely inferred. No runtime import of unfinished transport is needed. Parent MUST await engine.close when transport exits/errors and on process termination. stdin EOF/Stop process close owns background subtree teardown; interrupt alone is foreground-only. Parent must already perform normal Bruv product/path bootstrap and use the prepared Pi dependency. executablePath must be the actual owning Bruv binary (defaults to process.execPath); tests use a tiny facade over the real TypeScript runner with the same explicit exit as production CLI.

nativeSessionId is a retained external UUID owned/mapped by the parent storage service; it is not a replacement canonical Pi session ID. Without it, wire session_id equals the actual Pi session ID. Pass nativeSessionId for native --session-id/resume binding without rewriting source frames. Supplied sessionManager remains the canonical persistence authority; the default uses agentDir/sessions/Pi-style-cwd-directory. This module does NOT implement the native transcript/index/import/fork mapping.

extensionFactories/tools are composition seams for the separate MCP/permission worker through the same Pi loader/allowlist. Auxiliary ignores external factories, disables resources/context, and uses no tools. These hooks do not themselves implement MCP or permission policy. Native initializer currently reports no MCP servers; parent must supply actual MCP projection when those integrations exist.

## Implemented, real-path facts

- Reuses the existing assertBruvPiHost prepared-host gate. Direct createAgentSession/ModelRuntime, normal Bruv execute/tasks, agent-state, Live and remote extension factories, disk-backed session-manager installation, Bruv/project prompt selection and resource assembly. No second execution scheduler and no patched-T3 delegate adapter route.
- Model catalog uses exact provider/id from the actual configured runtime. No sonnet/default/haiku aliases, invented account, subscription, email or quota. initialize rejects missing selected-provider auth; successful readiness means locally configured only, explicitly access_verified:false. account:{} makes no genuine-Claude account claim. get_usage reports real cost and rate_limits_available:false, not invented subscription quota.
- ModelRuntime.create(refreshOnCreate:false) leaves hasConfiguredAuth's snapshot empty even with stored credentials. The necessary getAvailable() refresh restores LOCAL availability/auth facts without refreshing model catalogs over the network. Tests forbid fetch and count zero provider stream calls across create/init. No unconditional hasConfiguredAuth override is used in production or this fixture.
- Main sessions bind Pi **rpc** mode, not json/print. Production json/print agent_end deliberately waits for background work; rpc is the existing persistent mode with real Bruv notification delivery. The observed print-mode hang was corrected by choosing the actual lifecycle, not by adding another scheduler.
- Prompt/text/thinking/tool stream projection, actual assistant/tool result frames and terminal results with actual provider usage/cache/cost. Native task-call IDs on tool results are retained. native priority now calls actual Pi steer; ordinary followups use Pi's own queue. A small admission gate serializes only asynchronous Pi preflight, not turns.
- Interrupt/close during asynchronous preflight cannot start a late provider turn. close invokes actual session_shutdown, real TaskManager shutdown, and Pi dispose. Real background shell remained alive after interrupt and was gone after close. Real idle shell completion caused exactly one same-owner Pi continuation, with no connector-generated second prompt.
- Actual registered Pi extension commands terminate native turns from Pi's handled disposition, without model calls. Unsupported select/confirm/input/custom/editor UI throws an explicit native failure; it never grants consent.
- Auxiliary uses an in-memory tool-free session, the same selected Pi model, real generated JSON, TypeBox JSON-schema validation and structured_output. Invalid JSON/schema output fails explicitly, not fake structured output or a canned title.
- Rejects inherited T3_MCP_URL/T3_MCP_BEARER_TOKEN and BRUV_WEB_TASK_EVENTS=1; the separate env worker must scrub them before creation. This prevents old patched MCP calls or raw legacy task frames from leaking into upstream-native stdio.

## Checks and retained limitations

Bun 1.4.2, parent-prepared node_modules/runtime-assets symlinked locally for checks only (not committed):
- tests/claude-compat-runtime.test.ts: 15 tests / 65 assertions pass.
- tsc --noEmit --pretty false: pass.
- Biome format/check safe fixes applied; lint only has existing-style advisory warnings/infos, no errors.
- Ad-hoc actual transport+engine PassThrough binding: init 0 model calls, prompt 1 model call; correlated control_response then system/stream_event/assistant/result; real Pi fixture answer. Transport source was inspected only, never edited. This is NOT SDK/browser/native executable acceptance.
- Final combined focused + prompt-preview + cooperative-handoff check: 22 tests / 140 assertions pass; tsc also passes. Additional prompt-preview and cooperative-handoff checks passed (7 tests). Existing tests/attention-sdk.test.ts fails independently without importing this connector: expected >=8 provider fixture calls, got 2. It also failed in the combined run. No existing source file was changed here; parent must investigate that baseline/dependency-context failure rather than count the full gate green.

Full product acceptance is not complete:
1. Native task_started/progress/notification/background roster, child ownerToolUseId/subagent events, output-file/monitor UI, app-owned MCP tasks and nested cancellation still need actual typed owner projection and external T3 proof. Do not label every shell as a monitor or fake subagents.
2. Native transcripts, stable replay UUID/provenance, SDK filesystem fork/import, custom-home alignment and resume-at belong to the storage worker. Current projected frame UUIDs are fresh wire UUIDs, not a stable replay store. Original native user UUID is not yet a canonical Pi source-entry mapping; parent must retain it, not infer ancestry from prose.
3. CLI feature parity remains: interactive question resolution, menus/dialogs, terminal widgets, goal/settings/history/new/resume/fork command-context actions, remote placement/worktree/depth/Live controls, reasoning/effort and dynamic permission policies require adapters/real rendered acceptance. Extensions are loaded, not a promise that every TUI feature works through native protocol. Command notices currently go to diagnostic, not a finished T3 question/menu UX.
4. Only default bypassPermissions (aux dontAsk with no tools) is accepted; unsupported permission modes/controls fail. Native rate limits unavailable. duration_api_ms and modelUsage are not fabricated; separate provider-latency/per-model projection is not currently supplied.
5. External T3 infers authenticated from any successful initialization. This engine reports only honest locally configured readiness, no verified provider access. Actual rendered identity/account wording remains a host-owned acceptance gate, not evidence of genuine Claude authentication.
6. Parent still owns executable flags/dispatch, nonstream JSON emission/error exit, transport lifecycle wiring, packaging/removing old patched payloads and full unchanged-upstream T3 SDK/browser/compiled-terminal proof. No release or publication was attempted.

Values unchanged: existing single-owner execution, honest unknowns and real-path-proof values cover the findings. This feature wisdom records the concrete Pi lifecycle/auth-snapshot lessons instead of adding redundant general values.
