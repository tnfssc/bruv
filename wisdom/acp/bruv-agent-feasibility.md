# Bruv as an ACP agent: feasibility and ownership

Research only, 2026-10-03. **Prior release remains on hold. No adapter, production edit, build, install, or release was made.** The proposal is Bruv as the agent, independently installed T3 as the client, and a documentation-only `bruv web` command. This note covers Bruv/Pi and the official protocol. Parallel researchers own standalone T3 runtime/registration and T3 MCP/orchestrator validation; do not treat the conclusions below as their client acceptance result.

Repository inspected: `1875ae901fe05ef2b52d9623bfe4a126f4250d95`. Existing other-worker/untracked release notes were left alone. Read `wisdom/values.md`, relevant T3 execution/lifecycle/delegation notes, and native checkpoint-switching notes. Values unchanged: one owner, actual-path proof, and truthful continuity boundaries already cover this decision.

## Short answer

**Bruv-local subagents and its bounded nested orchestrators do not fundamentally require bundled T3.** They are processes owned by Bruv's session-local TaskManager. An ACP root can retain that engine. ACP does not itself turn these jobs into T3 child threads.

**Automatic late job wake already works in the pinned SDK when the root stays alive and is bound as RPC.** An isolated real SDK + real Bruv extension + real delayed shell probe proved that a root first returned idle, then a completed job started another root model request without a user prompt. This is a runtime proof, **not an ACP/T3 acceptance proof**.

**The full claim “all that still works with unmodified standalone T3” is not established.** There is no Bruv ACP adapter today. Stable ACP v1 has a prompt-request-owned completion contract, not a separate agent-initiated foreground run lifecycle. An adapter can retain Bruv's late execution, but the unmodified client's interpretation/display/cancellation of updates after that prompt response needs actual validation. Current draft ACP v2 explicitly addresses this lifecycle; it is not the stable baseline or assumed T3 support.

A narrow ACP integration is plausible. Native T3 task-graph/sidebar/child-chat parity, durable post-disconnect delivery, and the saved-question experience are separate product decisions, not a byte-format translation.

## Current official ACP, checked from network/source

Fetched the official repository and docs, not remembered protocol shapes. Official main at inspection: [937d31461576d302019d65bd601ac0a5a77db001](https://github.com/agentclientprotocol/agent-client-protocol/commit/937d31461576d302019d65bd601ac0a5a77db001), commit time 2026-10-03T06:37:39Z.

Sources at that immutable revision:

- [v1 schema](https://github.com/agentclientprotocol/agent-client-protocol/blob/937d31461576d302019d65bd601ac0a5a77db001/schema/v1/schema.json), [method metadata](https://github.com/agentclientprotocol/agent-client-protocol/blob/937d31461576d302019d65bd601ac0a5a77db001/schema/v1/meta.json), [version marker](https://github.com/agentclientprotocol/agent-client-protocol/blob/937d31461576d302019d65bd601ac0a5a77db001/schema/v1/Cargo.toml): schema release **1.24.1**, protocol major **1**.
- [navigation/status](https://github.com/agentclientprotocol/agent-client-protocol/blob/937d31461576d302019d65bd601ac0a5a77db001/docs/docs.json): v1 is **Latest**; v2 is **Draft**.
- [v1 prompt turn](https://github.com/agentclientprotocol/agent-client-protocol/blob/937d31461576d302019d65bd601ac0a5a77db001/docs/protocol/v1/prompt-turn.mdx), [session setup](https://github.com/agentclientprotocol/agent-client-protocol/blob/937d31461576d302019d65bd601ac0a5a77db001/docs/protocol/v1/session-setup.mdx).
- [v2 schema](https://github.com/agentclientprotocol/agent-client-protocol/blob/937d31461576d302019d65bd601ac0a5a77db001/schema/v2/schema.json), [version marker](https://github.com/agentclientprotocol/agent-client-protocol/blob/937d31461576d302019d65bd601ac0a5a77db001/schema/v2/Cargo.toml): **2.0.0-alpha.7**; [draft lifecycle](https://github.com/agentclientprotocol/agent-client-protocol/blob/937d31461576d302019d65bd601ac0a5a77db001/docs/protocol/v2/prompt-lifecycle.mdx), [migration](https://github.com/agentclientprotocol/agent-client-protocol/blob/937d31461576d302019d65bd601ac0a5a77db001/docs/protocol/v2/migration.mdx).

The old root URL `schema/schema.json` returned 404. Versioned paths above succeeded. This matters: inspecting only a remembered older schema would miss stable session resume/close/config options/elicitation and the draft lifecycle changes.

### Stable v1 facts

- Stdio uses newline-delimited UTF-8 JSON-RPC, not Pi's command/event NDJSON. Stdout is protocol-only; logging belongs on stderr.
- Initialization negotiates protocol major and capabilities. `session/new` receives cwd and MCP servers. Capability-gated load/list/resume/close/delete/additional-directory facilities exist in the current schema; older clients need not implement them.
- `session/prompt` receives content blocks, emits `session/update`, and returns a `stopReason` when the turn ends. `session/cancel` cancels that turn; pending permission requests must be cancelled; final cancellation updates precede the prompt response.
- Tools map to tool-call/update content, locations/diffs/terminal references where applicable. Permissions use `session/request_permission` with permission options/outcomes, not a generic text answer.
- Baseline prompt support includes text and resource links. Images/audio/embedded context are advertised capabilities. Do not advertise formats merely because a JSON decoder accepts them.
- Session modes and config options exist. The inspected stable schema has **no standard subagent launch/observe/cancel graph API, no standard session/fork method, and no session/set_model method**. Model/thinking controls can use config options; fork is not baseline parity.
- Stable elicitation now exists (`elicitation/create` and `elicitation/complete`), capability-gated. This is potential UI support, not proof a specific T3 build supports it or that it implements Bruv's persistent owner/version ledger.

**Late-wake distinction:** v1 update notifications do not carry a prompt request ID, so it would be wrong to claim the schema categorically forbids all updates while idle. But there is no standard separate running/idle transition or agent-to-client “start another prompt” method. A client receiving chunks is not proof it owns another running turn, enables Stop, or persists the right run. The stable cancellation contract is explicitly tied to the original pending prompt.

### Draft v2 facts, not an adoption promise

The draft replaces prompt completion with an insertion acknowledgement: `PromptResponse.messageId`. Completion is reported through `state_update` (running/requires_action/idle, with stop reason), independently of the already-completed prompt request. The docs explicitly allow background session updates while idle and require running when foreground work starts or resumes. Message IDs and retained replay are explicit. Modes move to config options; authentication and session surfaces also change.

This is much closer to Bruv's automatic late root continuation. It does **not** make v1 clients v2-capable. Version negotiation, exact SDK support, and client runtime behavior must be checked before choosing it.

## Existing Bruv/Pi seams

Direct dependencies in `package.json` are `@earendil-works/pi-ai`, `pi-coding-agent`, `pi-server` and `pi-tui`, all pinned **1.0.0**. Installed transitive Pi agent-core/client/protocol packages were inspected too. Bruv has no ACP package dependency. Searching owned source and installed Pi declarations/implementation for ACP protocol identifiers found no ACP server/agent implementation.

### SDK is the smallest correct seam

Use **one owning AgentSession runtime per ACP session**, not a new LLM provider:

1. Preserve CLI initialization: runtime/product paths before importing Pi, Bun OAuth registration, Bruv host check, and disk-backed SessionManager installation (`src/cli.ts:134-145,200-207`; `src/history/session-manager.ts:191`).
2. Build cwd-bound loader/settings/model runtime and persistent session manager, with Bruv's composition extension (`src/agent/extension.ts`). `src/prompt-preview.ts:130-170` already demonstrates SDK assembly, but its in-memory/offline choices are a research fixture, not production persistence defaults.
3. Bind extensions explicitly as **RPC** using `AgentSession.bindExtensions`, supply frontend UI/abort/command actions, and subscribe to the **whole lifetime** event stream. Do not subscribe only inside `session/prompt` and do not dispose when that promise resolves.
4. ACP transport translates requests/events; Bruv/Pi continues to own prompt policy, history, tools, jobs, model execution, auth and questions. Maintain the association of opaque ACP session IDs to owned runtimes; do not accept arbitrary filesystem session paths as frontend IDs.
5. Use the existing `AgentSessionRuntime` lifecycle for new/resume/fork/reload/close where appropriate. Its teardown aborts, awaits `session_shutdown`, then disposes. Calling only synchronous `AgentSession.dispose()` bypasses Bruv's owned job shutdown hook.

Pinned API refs under `node_modules/@earendil-works/pi-coding-agent/dist/`:

- `core/sdk.d.ts` and `core/sdk.js`: createAgentSession, cwd/agentDir, ModelRuntime, SettingsManager, loader, tool selection, SessionManager.
- `core/agent-session.d.ts:153-176`: extension bindings, mode, prompt images/source/streaming behavior/preflight. `core/agent-session.js:1746-1791`: custom messages and idle triggerTurn behavior; `:2562`: binding and session_start.
- `core/agent-session-runtime.d.ts` and `.js:102-113,296-302`: owning runtime and awaited lifecycle teardown.
- `core/session-manager.d.ts:365-414`: branch creation, create/open/forkFrom/findById/list/listAll. Bruv's journal/projection remains authoritative; ACP history is a presentation/replay view, not a second model transcript.

The existing `src/session/host.ts` is a useful **in-session operation port**, not an ACP session factory or full protocol. It offers send/steer/context/job inspection/stop/subscription for an already-owned context; `src/session/operations.ts` contains only those operations, not initialization/auth/history replay/session creation. Do not force the whole ACP lifecycle into it or move the task scheduler there.

### Existing stdio/RPC is useful, but not ACP

`dist/modes/rpc/rpc-mode.js` consumes `{type:"prompt",message,...}` and emits Pi responses/events plus `extension_ui_request`. It forwards lifetime session events (`:263-271`), binds RPC UI dialogs, supports model/thinking/state/session commands, and acknowledges prompt **preflight** immediately (`:298-314`). ACP v1 requires the later stop reason; forwarding this ACK as ACP completion would be incorrect. RPC preflight disposition is also not draft-v2's returned inserted-message identity. Draft v2 requires consistent IDs for retained replay; it explicitly does not promise durable storage from insertion alone.

A subprocess Pi-RPC-to-ACP translator is an option, but adds a process, event translation, UI translation and lifecycle coordination. Direct SDK avoids that redundant protocol hop. Keep the subprocess design as a fallback if separation is intentionally wanted, not the default seam.

`pi-server`/`pi-protocol` expose Pi/chord server/session attachment services, their own envelopes/framing/CBOR, and a session router. They are not ACP JSON-RPC. See installed `pi-protocol/dist/protocol.d.ts`, `framing.d.ts` and `pi-server/dist/session-router.d.ts`.

`ProviderConfig.streamSimple` (`core/extensions/types.d.ts:1368ff`) is an LLM API adapter taking a normalized transcript and emitting assistant stream events. Using ACP there would invert ownership: ACP is the client-to-agent session boundary, not a model provider or a delegation backend. The existing provider seam supports custom LLM transports, not an ACP-hosted root out of the box.

## Local delegation and automatic event delivery: actual owners

### Launch

`src/tasks/job-service.ts` handles execute's helpers. When the authenticated T3 bridge is configured, it uses native T3 task APIs. Without that bridge, local launch goes through `TaskManager`:

- `canDelegate(depth,type)` in `src/tasks/subagent-profiles.ts` is `depth < 2 && (depth === 0 || type === "orchestrator")`. A root may launch any profile. A first-level orchestrator may launch a second-level child (the local policy allows any profile, unlike the separately authenticated native backend's restrictions). Fast/normal workers cannot delegate; second-level agents cannot delegate even when their profile is orchestrator. **“Nested orchestrators” is a bounded three-tier system, not arbitrary recursion.**
- Profiles choose child model/thinking, falling back to parent selection. Current-runtime explicit model/thinking overrides are rejected; SSH overrides are a different authorized surface.
- `prepareAgentSession` (`src/tasks/agent-session.ts`) writes a durable child header and `bruv-agent` identity (profile/depth/model/parent file/task ID).
- `JobService` prepares a command using **`process.execPath`**, `--session ... --mode json -p --model ... -- prompt`, and child depth/type environment (`src/tasks/job-service.ts:520-560`). TaskManager owns spawn, wait, timeout, cancellation, outputs and completion. Workspace/setup branches stay in that service.
- `src/delegation-environment.ts` strips T3 bridge and root-control authority from model code/children. ACP-launched roots should not inherit the bundled T3 bridge just because their client is called T3. Otherwise native routing is accidentally selected and saved questions disabled.

**Launch constraint:** an SDK adapter must retain Bruv's executable as the process entry. A standalone JS SDK host started with plain Bun/Node cannot assume `process.execPath --session ...` launches Bruv; it launches the interpreter. A compiled `bruv acp` entry would retain the existing child launch contract. A separate executable requires explicit child-launch plumbing; this is observed source behavior, not theoretical compatibility.

### Return, completion, nested work

Foreground wait can return a background ID while the TaskManager keeps the child/process. The extension owns a completion/attention batch and injects contextual completion messages through `pi.sendMessage(...,{deliverAs:"steer",triggerTurn:true})` when no native T3/root presentation owner is active (`src/agent/extension.ts:310-410`). Pi queues during streaming; while idle it starts a fresh _runAgentPrompt (`agent-session.js:1746-1775`).

`agent_end` differs by mode (`src/agent/extension.ts:714ff`):

- **RPC:** flush already-ready local notifications and return; runtime remains persistent.
- **Print/JSON:** when successful and jobs remain, wait for a completion or attention/abort boundary and queue continuation before the process exits. This is how a local child orchestrator can wait for its own background leaves and deliver its eventual result to its parent.
- Native patched T3 instead uses durable server-dispatched notifications and deliberately avoids unowned Pi turns. That existing native continuation design must not be reused half-way inside an unmodified ACP client.

JobAttentionScheduler and CompletionBatcher remain in `src/tasks/`. Local nested cancellation uses `src/tasks/local-agent-termination.ts` because detached descendants are not killed just by signalling their parent's process group; installed by `extension.ts:500ff`. Session shutdown closes the host/batches/attention and awaits `manager.shutdown()` (`extension.ts:950ff`; `task-manager.ts:575ff`).

**Cancellation boundary:** a foreground abort is not `jobs.stopWork`. `TaskManager.foreground` (`src/tasks/task-manager.ts:449ff`) races the wait against abort and transfers unfinished work to background notification ownership; it does not kill that job simply because the caller stopped waiting. Bruv has explicit job/subtree cancellation and whole-session shutdown separately. An ACP adapter must decide which of those owns `session/cancel`, and how later completion notifications behave after cancellation. Do not promise that forwarding only `session.abort()` stops all descendant work or prevents a later root wake. Stable-v1 cancellation requires final cancellation updates before the prompt response; that cannot be replaced by an unowned later turn.

**Lifetime boundary:** local jobs can survive root model handoff, not owning runtime shutdown. Closing the ACP session/process or replacing a runtime currently stops its owned local jobs. Resume reconstructs conversation/identity; it is not a promise to reattach still-running local TaskManager state after process death. Durable native T3/SSH delivery and local in-memory job ownership are distinct.

**Projection boundary:** `src/t3/tasks/events.ts` can write raw `bruv_task_event` NDJSON directly to fd 1 when RPC and `BRUV_WEB_TASK_EVENTS=1`. These are **not valid ACP messages**. An ACP root must not enable that old emitter on its protocol stdout; observe task events through the owning ports and deliberately project what is supported. Likewise arbitrary UI notices must not leak through console output.

## What maps cleanly; what needs a decision

| Surface | Engine fact / mapping | Remaining design or client support |
| --- | --- | --- |
| New/prompt/cancel | SDK session creation, prompt, abort and subscribed events exist. | Implement proper ACP negotiation/framing/error and stop-reason translation; never equate low-level agent_end with fully settled run if retries/continuations follow. |
| Text and images | Pi prompt accepts text plus ImageContent; execute tool results can contain images. | Preserve block order/context; translate supported MIME/base64/resource-link semantics; advertise image only for tested model/input paths. Pi has no baseline arbitrary audio prompt mapping. |
| Tools | Bruv exposes execute; Pi emits tool execution start/update/end and tool results. | Map actual tool-call IDs, status, text/images/diffs when available. An execute script can contain many helper calls; do not fabricate one ACP tool per inner job without corresponding ownership. |
| Files/terminals | Bruv execute owns local IO/shell and job pipes; Pi MCP supports stdio/HTTP server configuration. | ACP client FS/terminal APIs are not automatically used by arbitrary TypeScript execution. Choose local agent IO versus deliberate client-mediated operations. Do not claim a sandbox or remote editor authority that does not exist. |
| Auth/models | ModelRuntime has auth storage, login/logout, availability snapshots, provider registration; session.setModel/thinking exist. | Existing Bruv credentials can remain authoritative. ACP auth methods/config options need an explicit UX. Env/API-key auth is not interactive OAuth; don't report configured auth as verified provider access. |
| Modes | Root fast/normal/orchestrator instruction mode is persisted by `instruction-mode.ts`; model/thinking unchanged. | Can project v1 modes/config options through the same setter. Root instruction mode is not child role, permission policy or sandbox level. Don't imply “fast root” loses root delegation privileges. |
| Permissions | Existing UI confirmation is used for delegated stops; execute otherwise has broad local capability. | Wire genuine sensitive decisions to request_permission. ACP is not automatic sandboxing. A persistent question is not permission; never infer approval from agent text. Whole-script tool permission versus per-operation interception must be chosen, not inferred from labels. |
| Saved questions | Bruv persistent ledger supports ask/get/list/block/answer/resolve/cancel with owner/version; supports local root when native T3 bridge is absent. | Needs discoverable client UI and a human-authenticated answer path. Commands or capability-gated elicitation may help, but no existing ACP projection. Preserve answered/queued/delivered/used distinctions. |
| Resume/history | SessionManager journal/branch/projection and runtime switch support exist. | v1 load replays; resume explicitly does not replay. Session IDs, cwd validation, retained message identities and opaque native checkpoints must survive. Do not flatten signed/encrypted history or treat a T3 message copy as model authority. |
| Fork | Pi/Bruv can fork and retain child role identity. | No standard stable ACP fork method. A slash command is not automatically a new client thread. Requires extension or client-specific support, or omit this affordance honestly. |
| Subagents/background | Local engine/three-tier constraints, worktrees, jobs/attention remain. | No ACP standard child task graph and no automatic T3 sidebar/child-chat projection. Parent can inspect results through its tools, but client visibility must be chosen. |
| Late wake | Proven root engine continuation while SDK/RPC remains alive. | Stable-v1 client turn ownership, Stop state, transcript/run persistence, new user input races and reconnect need unmodified-T3 proof. Draft v2 provides a better lifecycle, not current client compatibility. |

### Saved questions deserve their own boundary

`src/agent/extension.ts:542-543` currently enables the question runtime for root (or authorized remote runtime) **only when not t3NativeSession**. ACP root absent the bundled MCP bridge would pass that engine predicate. That does not supply a frontend UI.

`src/questions/runtime.ts:56-110,112ff,197-206` dispatches a saved answer in a **new parent turn** using followUp/triggerTurn, after idle, with delivery bookkeeping. Cancel/abort pauses delivery. It does not resume a suspended execute stack or native child. `src/questions/extension.ts` supplies CLI menus and explicit `/questions answer ...` commands; menu custom UI is not ACP by itself. Current error text saying “parent CLI only” is current surface wording, not a new evidence-based ban on embedding the root engine.

Stable ACP elicitation could collect a human answer if negotiated and actually supported by T3. Still write it through the owning question service, preserve version/owner/dedup, and do not leave an RPC tool stack blocked waiting for the human. Unsupported clients need a truthful, usable alternate flow rather than a guessed reply. Unmodified T3 compatibility of that flow is not proved here.

## Proof performed (bounded, offline except source retrieval)

### Focused existing tests: PASS

Ran directly, **no build script**:

`bun test tests/job-service.test.ts tests/subagent-extension.test.ts tests/subagent-profiles.test.ts tests/completion-batcher.test.ts tests/job-attention.test.ts tests/agent-session.test.ts tests/questions-sdk.test.ts`

Result: **60 pass, 0 fail, 299 assertions, 7 files**. Includes real shell lifecycle plus fixture-backed child launch/policy, resumed child identity, root/first-orchestrator-only delegation, RPC agent_end flush, print/JSON wake, attention/completion dedup, question SDK behavior and shutdown ownership. These tests do **not** prove paid-provider child conversations, an ACP adapter, or T3 runtime behavior.

### New isolated late-completion SDK probe: PASS

Temporary source/output: `/tmp/bruv-acp-research/late-wake.ts`, `runner.ts`, `late-wake-result.json`. No repository implementation files changed. Private temporary cwd/auth path, in-memory session/settings, no project/global extensions/skills/themes; ModelRuntime refresh disabled and assistant stream fully replaced. No model/API calls. The helper runner invoked the existing `runTypeScriptFromStdin` in a temporary executable; it did not rebuild/replace Bruv.

Procedure: create SDK session with real Bruv extension and execute tool; bind RPC; deterministic first assistant calls `execute` with `shell("sleep 0.9; printf acp-late-proof",{waitSeconds:0})`; second assistant says root yielded; wait at most five seconds for an additional provider request. Subscribe throughout. Finally await session_shutdown, dispose and remove private cwd.

Captured evidence:

- Initial prompt returned at epoch ms **1791028640660**, with **2** fake provider calls and **idle=true**.
- Initial agent_settled was **1791028640660**.
- Completed command later caused agent_start at **1791028641881** (1.221 s after idle).
- Custom message was `task-complete`, with exit code 0 and `acp-late-proof` output.
- Third fake provider request ran, then agent_settled at **1791028641883**. Exactly **3** calls total; no user prompt between them.

Two setup mistakes were corrected without touching production: shell uses fish so the first `$?` wrapper was rejected before launch; Pi 1.0 exports `getModel` from `pi-ai/compat`, not main. The successful fixture used that actual pinned export.

This proves the narrow seam **real Bruv job completion → real pinned SDK RPC-mode idle root continuation**. It does not test ACP notification serialization or an unmodified T3 view. It deliberately did not claim persistent history or child-provider execution from its in-memory fake-provider session.

## Discussion options, not implementation

1. **Minimal stable-v1 agent with explicit limitations.** Retain Bruv-local execution and hidden jobs; present tool/output normally. Choose whether late results wait for next user input or whether the prompt remains open while dependencies run. Both change UX; neither is the current idle handoff + automatic later running turn. Do not call this full parity.
2. **Stable-v1 plus proven client behavior.** If the standalone T3 worker proves unsolicited updates maintain a real running/Stop/persistent turn after prompt completion, retain the persistent root and event subscription. Validate races and reconnect before promising this. Receiving an isolated chunk alone is insufficient.
3. **Supported lifecycle extension or future v2 client.** Agree explicit run state/message identity and agent-initiated continuation ownership. Better fit, but not “unmodified T3” unless that exact build already supports it. An ignored _meta/private notification cannot silently solve lifecycle ownership.
4. **Native T3-managed orchestration.** Only if the standalone client actually exposes the required authenticated MCP/task contract. Existing patched T3 ownership cannot be inferred from generic ACP MCP-server forwarding. This may preserve graph/child-thread features, but is a different task owner than Bruv-local jobs and must not create two schedulers.

Recommended next decision: make **Bruv own agent sessions and local children**, treat standalone T3 as presentation, and first validate the late-wake client contract. This minimizes coupling; accept loss of native graph/child-chat affordances unless independently supported. Do not remove bundled/native code or publish an ACP registration command before that decision and proof.

## Next acceptance work

- Merge the independent standalone T3 registration/runtime and MCP-owner findings; pin the exact upstream commit/release and ACP SDK/protocol version, not “latest”. Separate upstream source from the patched cache.
- Before any production adapter, use a disposable synthetic agent/client trace: delayed job after idle, one root continuation, user-input race, cancellation while waiting/running, session close/disconnect/restart, and visible transcript/Stop state. Synthetic proves host transport only.
- If that passes, a small SDK-backed adapter experiment must then prove **actual compiled Bruv root → local orchestrator → child**, child result after root handoff, subtree cancellation, no duplicate completion wake, root role persistence on resume, question answer ownership, images and one auth/model change. No expensive matrix needed; these are the proposed ownership boundaries.
- Define frontend task visibility, v1 long-open-prompt versus late-turn policy, session-close job policy, supported modes/config/auth, saved-question UI, history/fork scope and client MCP policy before advertising parity.
- Reuse current native checkpoint protections; presentation changes must not silently rewrite model context. Existing native model-switch notes caution that local test guards are not upstream capability proof.
- If adoption is chosen, packaging/docs/data migration are separate. See [packaging/web boundaries](packaging-and-web-command.md). Preserve existing web data and rollback; no implicit migration to upstream T3 state.

## Relevant local ownership references

- `src/agent/README.md`: composition root versus task/session ownership.
- `src/agent/extension.ts`; `src/tasks/{job-service,task-manager,agent-session,subagent-profiles,job-attention,completion-batcher,local-agent-termination}.ts`.
- `src/session/{host,operations,host-access}.ts`; `src/questions/{service,runtime,extension}.ts`; `src/history/{session-manager,disk-entry-store}.ts`.
- `src/delegation-environment.ts`; `src/t3/tasks/{events,local-notifications,mcp-client}.ts`: old native bridge/raw web projection must not leak into an ACP root.
- `wisdom/t3/t3-thread-execution-research.md` and `t3-v2-production-lifecycle-final.md`: T3 native run/continuation owner, historical acceptance limits.
- `wisdom/t3/t3-v2-delegation-status.md`: native backend authority, current-runtime/local distinction, workspace behavior.
- `wisdom/native/{checkpoint-model-switch-incident,codex-compatible-checkpoint-switching}.md`: preserved opaque context and actual upstream checks.

**Bottom line:** retain the proven Bruv engine; translate at its session boundary. Local delegation is not the blocker. **Client ownership of a late autonomous root run is the key unresolved compatibility question**, followed by usable questions and visibility. No release or implementation is authorized by this research.

Parent copied the temporary probe source/result into durable ignored artifacts/acp/bruv-feasibility/ after review. Original runner paths describe the research environment; these are evidence snapshots, not a packaged adapter.
