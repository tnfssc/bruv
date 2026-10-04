# Native T3 → Claude Agent SDK → independent executable

Current production target: unchanged official **v0.0.46-nightly.20261004.2644**,
not older 2623. See [active external setup](external-t3-setup.md) and
[official 2644 proof](proof/official-2644/README.md). The dated research/provenance
below is retained, not an active pin recommendation; the upstream Effect race
remains unfixed despite 2644 passing bounded gates.

Research only, 2026-10-03. Owns the **native executable boundary**, not claude-acp, rich child/monitor mapping, or the other worker's actual Bruv binary proof. No product/T3 changes, credentials, sign-in, release, or copied SDK implementation in production.

## Decision in brief

**A separately implemented executable can speak this transport.** The published SDK really launches a configurable executable and exchanges ordinary NDJSON. A bounded synthetic probe against the exact SDK proved initialization, prompts with priority, permission callbacks, control success/error, usage, and interruption envelopes. There is no observed signature, genuine-Claude identity check, or authenticated handshake at this subprocess boundary. That is transport evidence, not permission to misrepresent the backend.

**It is not a completely replaceable subprocess contract.** T3's native provider owns Claude-specific catalog/presentation/auth assumptions, and SDK fork/history APIs read/write Claude's disk transcript format directly, without calling the configured executable. Honest interoperability therefore needs an explicitly labeled Bruv-owned compatibility entrypoint, truthful model/configuration facts, and a decision about the SDK-owned transcript surface. Passing a wire smoke test cannot settle those blockers.

Most consequential findings:

* At this pin, the real native health probe uses SDK initialize + get_usage, **not an auth status subprocess**. Older tests/comments about auth status are not the executed path.
* T3 marks **any successful initialization** as authenticated even when account is empty. Our fixture returns account:{}; the SDK accepts it. Do not interpret that as actual authentication. T3's inference is a host-owned honesty gap.
* Native steering is another user NDJSON frame with **priority:"now"** on the same persistent prompt queue. It is not interrupt, a control request, or ACP cancellation. Preserving Bruv's actual in-flight work needs a real priority/steering implementation beneath the serializer.
* Native Stop requests interrupt **and then closes the query**. Its comments explicitly rely on process close stopping process-owned background shells. This differs from Bruv CLI's foreground-only stop behavior and must be decided, not silently inherited.
* Native fork invokes the SDK's **forkSession(sessionId,{dir,upToMessageId})**. This is SDK filesystem manipulation, not a fork request to the executable. Wire-only session persistence is insufficient for that feature.

## Pins and source provenance

Official T3: **fed41fa88bb27cb4325cb208d571393850bc63c2**, published nightly **0.0.46-nightly.20261003.2623**. Prior ACP research's clean source cache was reused, **not** the patched Bruv T3 cache. Independently fetched official raw pnpm-lock.yaml, ClaudeAdapterV2.ts, ClaudeProvider.ts and ClaudeExecutable.ts at that full SHA: all four byte-matched the clean cache.

T3 apps/server/package.json declares **@anthropic-ai/claude-agent-sdk ^0.3.276**; pnpm-lock.yaml lines 514–516 resolves **0.3.276**, not the **0.3.286** used in earlier claude-acp research. This report's runtime test uses published **0.3.276**.

Published artifact: [npm exact version](https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/0.3.276), [tarball](https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/-/claude-agent-sdk-0.3.276.tgz). Downloaded tarball SHA-1 **d1429c4b93054cb672047495d1ecad9de2771bbc**, matches registry shasum. sdk.mjs SHA-256 **b1607967e0dfb39a0db45f143d3b57c7a85f2f6eaa77d6bee7d8184a9830a9f3**. Public [sdk.d.ts](https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.276/sdk.d.ts) and [sdk.mjs](https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.276/sdk.mjs) are the exact interface/runtime sources. Types' line references below refer to that tarball. Runtime method names refer to the published minified artifact; locally Prettier-formatted line numbers are inspection aids, not upstream source locations.

Exact T3 source references (all at the full SHA above):

* [Lockfile](https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/pnpm-lock.yaml#L514-L516).
* [Driver and environment setup](https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/provider/Drivers/ClaudeDriver.ts), [Claude home](https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/provider/Drivers/ClaudeHome.ts#L15-L52).
* [Executable resolution](https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/provider/Drivers/ClaudeExecutable.ts#L60-L108).
* [Native query/queue/control runner](https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L605-L724), [query options](https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L802-L896).
* [Health probe options](https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/provider/Layers/ClaudeProvider.ts#L186-L224), [initialize/usage probe](https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/provider/Layers/ClaudeProvider.ts#L329-L390), [version/auth snapshot](https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/provider/Layers/ClaudeProvider.ts#L450-L602).
* [Settings](https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/packages/contracts/src/settings.ts#L646-L686), [version parser/custom models](https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/provider/providerSnapshot.ts#L112-L152), [model catalog](https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/provider/ClaudeModelCatalog.ts), [model compiler](https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/claudeModelOptions.ts#L28-L70).
* [HTTP MCP injection](https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L933-L963), [approval response](https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L2151-L2183), [permission callback](https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L6491-L6545).
* [User messages](https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L1200-L1232), [resume decision/open](https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L6880-L6925), [Stop](https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L7178-L7242), [steering](https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L7266-L7315), [native fork](https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L7602-L7619).
* [Auxiliary direct JSON CLI generation](https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/textGeneration/ClaudeTextGeneration.ts#L145-L252).

Read [values](../values.md), [steering decision](../acp/steering-decision.md), [hybrid task direction](../acp/hybrid-subagent-ui-direction.md), [prior research checkpoint](../acp/research-checkpoint.md), and prior native-Pi/ACP findings. Relative requested acp/steering-decision.md lives under wisdom/acp here. Earlier Pi version/auth workarounds and ACP cancellation assumptions are **not** evidence for this native Claude contract.

## 1. Discovery, identity, version, auth and models

T3's native Claude instance already has binaryPath (default claude), homePath (CLAUDE_CONFIG_DIR), launchArgs, customModels and environment configuration. On non-Windows, configured executable path passes through unchanged; use an absolute path for a deliberate compatibility executable. SDK dispatches .js/.mjs/.ts/.tsx/.jsx through a JS runtime; otherwise it spawns the path directly. No shell for SDK launch. T3 has Windows-only PATH/PATHEXT and npm-shim resolution to claude.exe or cli.js; arbitrary .cmd/.bat/.ps1 launchers are unsuitable for SDK use. Native launchability/permissions still apply.

Health first executes **--version**, reads stdout and stderr, and extracts the first X.Y.Z with a generic regex. A nonzero result/errors fail health. It does not demand the words Claude Code. A compatibility executable can report **its own product/version**, e.g. Bruv …; do not emit a fabricated Anthropic version to unlock catalog models. T3 uses this number as Claude CLI compatibility when filtering built-in models and generating upgrade advice. That coupling does not make an honest Bruv semver a Claude capability version. No Pi-style global minimum was found on this health path; model-specific version filtering is separate.

The second probe launches an SDK query whose prompt iterable **never yields**. It asks initializationResult(), then get_usage, then aborts. Options: persistSession:false, user/project/local setting sources, disableAllHooks:true, allowedTools:[], explicit empty MCP servers, strictMcpConfig:true; connected claude.ai MCP and IDE discovery disabled by environment. A minimal binary must answer initialization **without receiving a user prompt**, and must not start model work, hooks or external MCP from this probe.

Initialization carries commands/agents/output styles/models/account. account's fields are optional; account:{} and models:[] were accepted by the exact SDK. T3 consumes initialization commands/account metadata and experimental usage. It sources its visible models from its own catalog plus customModels, **not init.models**. Thus returning an honest model list cannot on its own change T3's selector. Custom models can retain declared capabilities, but a bare slug receives Claude defaults; use explicit truthful capability metadata, and reject unsupported requested models rather than silently serving a different one. CompileClaudeModelSelection can add Claude-specific settings/effort/model suffixes; implementation must handle or explicitly reject those options.

T3 falls back to warning/auth unknown when capabilities initialization fails. If it succeeds, it sets ready/auth authenticated **unconditionally**, regardless of empty account or real credential availability. Its auth labels understand Anthropic subscription/token sources and selected API providers. Neither binary compatibility nor our no-credential fixture proves such facts. Do not return fabricated email, OAuth, subscription, Claude model access or quota. A truthful initialization can still trigger a misleading host auth badge; this is a decision blocker if accurate auth UI is required with zero T3 changes. Renaming an instance does not remove Claude-native runtime/catalog assumptions.

SDK default executable discovery is irrelevant once an explicit path is set. The dependency's default native binary/package machinery is not an implementation requirement for an independent executable.

## 2. Supported launch surface: scoped to actual native path

SDK runtime ProcessTransport.initialize assembles flags from Query options; there is no negotiated CLI grammar. Always observed: **--output-format stream-json --verbose --input-format stream-json**. The async prompt path did **not** include -p in our actual launch.

Required for T3's common paths / health:

* --model; --tools (comma list, default, or empty string); --allowedTools and --disallowedTools; --permission-mode; --allow-dangerously-skip-permissions; --permission-prompt-tool stdio when canUseTool exists.
* --include-partial-messages; --effort; --thinking / --max-thinking-tokens / --thinking-display when selected; --settings with JSON; repeated --add-dir.
* --session-id=UUID for new thread; --resume=UUID on process replacement; --resume-session-at=MESSAGE_UUID when rewinding/reopening; --no-session-persistence for probe.
* --mcp-config containing JSON {mcpServers:…}; --strict-mcp-config; --setting-sources=user,project,local (or empty).
* Parsed launchArgs become SDK extraArgs; settings can be merged into JSON. Unknown behavior-affecting flags must not silently succeed. Supporting arbitrary user launchArgs is not a minimum compatibility promise.

SDK also supports --continue, --fork-session, --resume-drops-turn, --json-schema, --max-turns, --max-budget-usd, --task-budget, --fallback-model, --agent, --betas, plugin flags, debug flags and other options. These are **SDK potential surface**, not all exercised by native T3. --await-initialize is conditional on plugin delivery, not emitted in the bounded common-path probe. No need to recreate every CLI command for an initial implementation decision.

Additional **non-SDK** native provider path: titles/branches/commit messages/PR content use direct CLI **-p --output-format json --json-schema … --model … [--effort …] --settings … --tools "" --disable-slash-commands --strict-mcp-config --permission-mode dontAsk**. Prompt is plain stdin text, not NDJSON; output must contain validated structured_output (single envelope or verbose message array). T3 places title generation in a temporary directory. These auxiliary features require a separate input/output mode; NDJSON-only compatibility will not cover them. Source-reviewed, not executed here.

## 3. NDJSON/control and initialization

One JSON object per stdout/stdin line. Keep stdout protocol-only and human diagnostics on stderr. SDK line reader tolerates/skips non-JSON stdout, but that is not a safe output contract. Persistent stdin, interleaved bidirectional controls and prompt streaming are essential. The SDK owns correlation and callback dispatch; the executable owns the actual execution/state/permission effects.

Bidirectional envelopes, exactly observed/declarative:

~~~json
{"type":"control_request","request_id":"id","request":{"subtype":"initialize"}}
{"type":"control_response","response":{"subtype":"success","request_id":"id","response":{"commands":[],"agents":[],"output_style":"default","available_output_styles":["default"],"models":[],"account":{}}}}
{"type":"control_response","response":{"subtype":"error","request_id":"id","error":"Unsupported request"}}
{"type":"control_cancel_request","request_id":"id"}
~~~

Success/error is **response.subtype**, not a top-level subtype. Reply using the received ID; IDs need not be UUIDs. Cancellation envelope declared/runtime-inspected, not exercised in the bounded probe. Unknown controls should get a correlated error rather than a fabricated success or hanging forever. SDK request cancellation can send control_cancel_request; receiving that must cancel only the corresponding pending operation. The SDK handles incoming cancel by aborting the callback's signal.

SDK types: ControlErrorResponse 314+, ControlResponse 337+; SDKControlInitializeRequest 4219+; SDKControlInitializeResponse 4298+; SDKControlRequest union 4682+; SDKControlResponse 4733+; cancel declaration locatable by SDKControlCancelRequest. Runtime: Query.initialize, request, readMessages, handleControlRequest, processControlRequest, streamInput.

Initialize may carry hook callback maps, sdkMcpServers/configs/manifests, jsonSchema, systemPrompt array, appendSystemPrompt, agent definitions, plugin delivery, supportedDialogKinds and other optional fields. T3 appends runtime/orchestration instructions using the claude_code preset; our actual launch delivered appendSystemPrompt **inside initialize**, not as a CLI flag. Do not ignore those instructions. Only advertise commands/agents/styles/capabilities the implementation can really provide. Probe-only initialization response does not substitute for later system/init conversation output.

A result does not inherently close an async multi-turn query. SDK streamInput closes stdin when its async iterable ends; T3 keeps its queue alive while the query is owned. SDK string prompts have different single-result stdin-close behavior. Implement EOF/abort/process cleanup deliberately.

## 4. User prompts and genuine native steering

Ordinary input: type:user, message:{role:user,content:string-or-content-blocks}, parent_tool_use_id:null, optional uuid. T3's makeClaudeUserMessage omits session_id; the session is already set by launch. Images/attachments are encoded by its attachment helper and must not be treated as arbitrary text. Native skill expansion is Claude-specific; treating /commands as implemented when they are not is not compatibility.

T3's steering offers the same message shape into the **same** queue with priority:"now". Its active-turn bookkeeping marks the turn steered, and has special handling for Claude steering abort results; genuine engine steering must still be proved. The SDK simply serializes the supplied message, including priority. It does not implement steering, interrupt the model, or deliver a Bruv instruction by magic. Our probe proves forwarding, not atomic safe-point uptake by Bruv.

Echo IDs matter. T3 correlates root frames with user UUID echoes and holds frames while waiting for the appropriate prompt echo; a serializer that drops UUID linkage can attach work to the wrong turn or stall projection. SDK partial-message type has user_message_uuid/user_message_uuids, parent_tool_use_id, uuid, session_id. Result success also supports user_message_uuid. Message/event mapping worker owns exact rich correlation details.

## 5. Permissions, dialogs and MCP handoff

With --permission-prompt-tool stdio, executable sends control_request request.subtype:can_use_tool with tool_name, input, tool_use_id; optional agent_id, permission_suggestions, blocked_path, decision_reason, display metadata and MCP provenance. SDK invokes T3's canUseTool callback with an AbortSignal and correlation IDs. Observed deny response:

~~~json
{"type":"control_response","response":{"subtype":"success","request_id":"synthetic-permission-1","response":{"behavior":"deny","message":"Synthetic denied","toolUseID":"synthetic-tool-1"}}}
~~~

T3 allow gives behavior:allow, updatedInput, toolUseID, decisionClassification, optional updatedPermissions for acceptForSession. Deny may include interrupt:true for cancellation. Use **updatedInput**, enforce actual deny/abort before execution, preserve session permission updates where promised, and do not treat a transport success as tool authorization. Tool naming/input shapes also affect native UI: AskUserQuestion, ExitPlanMode, Agent and Bash receive special treatment. Bruv's question/job ownership cannot be solved just by emitting these names. Types: SDKControlPermissionRequest 4488+; PermissionResult in published sdk.d.ts; runtime processControlRequest(can_use_tool).

T3 installs onUserDialog and supportedDialogKinds:["resume_return"]. request_user_dialog controls can carry dialog_kind, payload and tool_use_id; SDK forwards to the host with a callback signal. Only implement supported dialog kinds; never infer a human answer from another worker/event. Ordinary permission callbacks and these dialogs are distinct contracts.

**Actual native T3 MCP is HTTP**, supplied as mcpServers["t3-code"] with endpoint, Authorization header and timeout; allowedTools includes mcp__t3-code__* or the read-only allowlist. SDK serializes this config into --mcp-config JSON. An independent executable must actually initialize/list/call the provided HTTP MCP server and expose its tools, respecting scoped authorization and sandbox policy. Headers can contain a real scoped bearer when used in a real T3 run: do not log full argv/config, forward credentials to arbitrary child work, or reinterpret them as Bruv-wide credentials. This research used only localhost port 1 without headers, and made **no MCP network call**.

Distinct SDK in-process MCP path: sdk-type servers are hosted by SDK callbacks; initialize lists server names, and executable-originated mcp_message controls wrap JSON-RPC {server_name,message}. SDK replies with mcp_response and can send notifications back. This can be independently implemented, but is **not required merely to consume the native T3 HTTP handoff**. Same warning for hook_callback: SDK runs registered JS callbacks; binary must invoke hooks correctly if claiming support. Don't reconstruct every SDK remote/browser/bridge transport.

## 6. Cancellation, resume, fork and IDs

query.interrupt() emits request subtype:interrupt. SDK optionally supports cancel_queued:true and interrupt receipts {still_queued,cancelled}; T3's inspected call is **bare interrupt**. Our fixture ACK proves only correlation. Actual cancellation must stop the foreground engine work and avoid a late result resurrecting the stopped turn.

T3 then closes the query, waits up to ten seconds for its closed boundary, and resets process-scoped background state. SDK ProcessTransport.close ends stdin; on POSIX eventually sends SIGTERM, then SIGKILL after five seconds if needed. An executable must clean up **its owned task/process subtree** on EOF/signals; neither leak jobs nor call a global Bruv stop that could cancel unrelated sessions. Native T3 assumes its background jobs live with that process. Choosing detached/background survival would require reconciling that host ownership assumption, not simply ACKing interrupt.

New native thread launches with --session-id; reopening/resuming uses --resume after known opening, resumeSessionAt, or a persisted provider turn ordinal >1. Stable actual session identity is required in emitted session_id fields. Keep distinct T3 provider-session/provider-thread IDs, CLI/native session UUID, user/message UUID, control request ID, tool-use ID, task/agent IDs. A fresh random CLI ID per process defeats resume and correlation. --resume-session-at needs real truncation/context semantics; no silent resume-from-latest.

**Fork is outside the binary boundary.** T3 calls imported SDK forkSession directly. Published runtime exported h7t delegates to filesystem fork b9 unless an explicit sessionStore exists; T3 passes no sessionStore. b9 locates project transcript under Claude config projects, reads session JSONL, walks UUID parent chains/sidechains, filters progress, slices at upToMessageId, assigns new UUIDs/sessionId and writes a new transcript file. CLI --fork-session support would not satisfy this call. SDK list/getSessionInfo/getSessionMessages/getSubagentMessages likewise have local filesystem/store behavior; whether every host path uses each is the event/history worker's scope.

Therefore an independent executable can own straightforward durable resume, but native fork requires **compatible disk transcripts or a supported host/SDK storage substitution**. Zero T3 changes rules out pretending a wire fork ACK solves it. An independently written interoperable transcript writer may be feasible; schema/ownership/home alignment remains unproved here. T3 per-instance homePath flows into child env while fork options contain dir/upToMessageId, not that environment: SDK filesystem lookup uses the parent-side config context. Validate custom-home behavior before choosing storage; don't overwrite real Claude state.

## 7. Usage, output and errors

get_usage is an experimental control. Return factual usage/quota availability; our probe used rate_limits_available:false, rate_limits:{}. T3 tolerates optional usage failure under a separate deadline and maps unavailable limits. No Anthropic quota/subscription data is implied by Bruv model usage. Keep token accounting separate from provider subscription/rate limits.

Conversation output comprises system/init, assistant/user messages, stream_event partial Anthropic-style message events, tool results and terminal result. Result success/error carries UUID/session_id, duration_ms/duration_api_ms, num_turns, total_cost_usd, usage, modelUsage, permission_denials; success carries result/stop_reason and optional structured_output; errors have explicit error subtypes/errors. See SDKResultSuccess/SDKResultError at 5412+ and SDKUserMessage 5865+, SDKPartialAssistantMessage and SDKSystemMessage declarations. Rich mapping worker owns the actual projection requirements. Costs, usage, model IDs and capabilities must be real facts or honestly unsupported, never arbitrary numbers chosen to light up UI.

Control errors reject SDK control promises (tested get_settings error). Nonzero process exit/spawn failure becomes SDK error; SDK can replace a process-exit diagnostic with a preceding result's textual errors. Malformed/noisy stdout can be skipped; emitting unsupported success schemas may fail later. Use correlated explicit errors for unsupported controls, truthful terminal failure events for model/tool failures, and stderr for diagnostics. API/auth/transient retry classification should reflect the underlying provider, not invented Anthropic status.

## 8. Tested vs inferred, retained evidence and implementation gate

**Executed:** exact SDK 0.3.276 loaded standalone from downloaded package; Node 24.21.0, Linux; independent research fixture executable; isolated HOME/CLAUDE_CONFIG_DIR and env -i (no inherited credentials). 20-second process timeout, normal exit 0 in ~0.6 seconds. Observed argv, initialize, get_usage, set_model, set_permission_mode, mcp_status, two user frames including priority now, executable-originated permission request and SDK deny response, interrupt and get_settings error. supportedModels() returned cached initialize.models without an extra request. No model request, sign-in or credential access.

Retained sanitized [wire/argv log](proof/binary-contract/probe.ndjson), [SDK results](proof/binary-contract/results.json). Synthetic IDs/models/text, account empty. Fixture did not produce an assistant/result stream or implement real steering/cancel; none is claimed. First harness attempt failed on fixture newline quoting; fixed, re-ran the actual SDK path successfully. Official source byte comparison and tarball hash verification were executed.

**Source-reviewed/inferred:** real T3 probe outcome with empty account, T3 launch/resume/fork/stop policy, model catalog assumptions, permissions allow branch, HTTP and SDK MCP, user dialogs, rich stream/result field use, auxiliary JSON generation. **Not executed:** T3 browser/native provider acceptance, Bruv engine steering, real permission execution, MCP HTTP call, durable resume/fork/history, custom-home fork, genuine provider usage/auth, child/monitor UI. Other workers' proofs must not be silently counted as this test.

Minimum useful implementation slice:

1. Honest, explicitly Bruv-owned executable entrypoint and own --version; configured absolute binaryPath; isolated connector storage. Never borrow genuine-Claude auth or version identity.
2. Persistent NDJSON mode, init-before-prompt, truthful account/models/capabilities/usage; controls initialize/get_usage/interrupt and explicit errors. Support set_model/set_permission_mode/mcp_status only to the extent promised; the SDK probe verified them, not every T3 caller.
3. Common query/probe flags; append instructions; actual prompt/UUID/session handling and native priority now mapped to Bruv steering. Text + meaningful tool/permission/result events before expanding child/monitor coverage.
4. Real T3 HTTP MCP handoff with scope/security; permission approval/denial and cancellation; session-owned teardown on close.
5. Durable native session IDs/resume. Separately decide SDK disk fork/history compatibility; don't fabricate successful forks. Add direct -p JSON structured generation if auxiliary T3 features are required.

**Start an implementation decision, not an exhaustive replica:** transport looks feasible; a narrow independently implemented adapter is worth testing. Block full no-T3-change parity claims on (a) truthful auth/model presentation under host Claude assumptions, (b) SDK-owned transcript/fork/history format and config root, (c) semantic steering/stop/background ownership, and (d) actual native rich event projection. Matching protocol is interoperability; calling the backend genuine Claude, faking a subscription/version/model, or claiming authenticated based on an init ACK is not.

No production source changed. Research cache: .cache/claude-compat-boundary (published artifacts stay local). Retained proof contains only our synthetic envelopes/results, not proprietary SDK code.
