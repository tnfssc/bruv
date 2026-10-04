# Maintained registry peers: delegation is not generic-host parity

Research: 2026-10-03. Read values, direction review and protocol correction. Three actual entries from `artifacts/acp/registry-followup.json`: Claude Agent, Codex, OpenCode. Pi belongs to another worker. OpenCode is the closer third example than a broader Goose survey: its release source has asynchronous subagents, automatic completion and nested-task depth controls. No production changes, global install, real credentials, sign-in or release.

## Recommendation refinements

Keep **Bruv owns children** as the first experiment, but refine the reasoning:

1. ACP child visibility is not categorically impossible: published Claude/Codex adapters implement negotiated draft child-session updates and extensions. Official registry installation does not give T3 those semantics. The pinned generic flavor does not negotiate/map these peers' child sessions or enable Grok's post-settle continuation machinery.
2. Claude offers a maintained alternative: emit root text early, but hold the ACP prompt until spawned subagents drain. This worked against the **published adapter and real SDK engine**, with a deterministic local model fixture. It does not preserve Bruv's root-yields-while-jobs-live semantics unchanged.
3. Replay is not a durable task ledger. Claude's live child was **cancelled**, while immediate load reconstructed a different child identity as **completed**. Do not replace Bruv job/cancel state with transcript inference.
4. T3 comments about codex-acp **1.2.0** dropping HTTP MCP are historical, not proof about **2.1.1**, whose published source maps HTTP URL/headers. Only Claude HTTP hookup/child tool exposure was runtime-proved here; Codex's session path remained auth-gated.

Parent's official-doc pin marks **v1 Latest, v2 Draft**. Both published adapters answered initialize(version=2) with **version=1**. Draft child extensions while negotiating v1 are not stable-v2 conformance.

## Distribution pins versus current upstream

Snapshot SHA-256: `6578af64cc7dffc9f12814f526196d8c94ab8e16fe43881677112095a9375d5e`. Copy, npm metadata, dependency lock, publish-commit sources, harnesses and wire logs: `.cache/acp-multiagent-peers`, especially `provenance.json`.

| Registry entry | Selected distribution | Publish/release source | Separate upstream head |
|---|---|---|---|
| claude-acp | `@agentclientprotocol/claude-agent-acp@0.85.1` | npm gitHead `686c0c99b3b89217b74d1f5de8272e7c9ef1aab4` | `a44c486019e98ad478c549c4902e7092f1418d0b`, Oct2 cancellation fix |
| codex-acp | `@agentclientprotocol/codex-acp@2.1.1` | npm gitHead `68d7d2d5ddfc0ed5746f9f6130892dda685e65dd` | `ca1d97173ad37b471d5a4e5847725a4657d34e29`, Oct2 MCP status/reconnect |
| opencode | `v1.18.34` Linux-x64 archive, `opencode acp` | tag commit `aec0b9a6d8898f68f923aaf08b7306d931fd9d76` | `907b3bc518fa48e90e8ec24dd327d13eee71c36c`, Oct3; service/task files match release |

Claude runtime SDK is pinned **0.3.286**. Codex adapter declares engine **^0.159.1**, resolving here to **0.159.3**: pinning the adapter alone does not pin its engine. ACP TS SDK resolved **1.6.0**. Lifecycle claims below use publish-commit or release-tag source, not silently substituted main-branch code.

## 1. Claude Agent ACP: strongest actual-path comparison

### Actual runtime

Launched published 0.85.1 entrypoint with isolated HOME/config/project, allowlisted environment and owned process groups. No user settings/auth files copied.

Credential-free: initialize succeeds; session/new succeeds; prompt returns **-32000 Authentication required**; session/load succeeds. Initialize(2) negotiates1.

Local fixture: fake Anthropic key/base URL points only at loopback. Valid streaming responses request a real Agent tool with `run_in_background:true` and delay its child response. Adapter, SDK query process, Agent execution and ACP updates are real; model selection/output is synthetic. Tool result explicitly says **Async agent launched successfully**.

Two client variants were exercised:

- **Plain**, without child capability: Agent is ordinary tool_call/tool_call_update including background input and launch result. No subagent_spawned; child text is not a separate session. Root text arrives **3544ms**, prompt settles **5128ms**, after background completion/follow-up. The first root answer does not end the ACP turn.
- **Negotiated**, clientCapabilities.subagents:{}: child spawn **2845ms**, root answer **2923ms**, child text in its own child session **4404ms**, child-completed update **4457ms**, prompt settles **4514ms**. Child capabilities:{} advertises no individual cancel/close control. Root/child text and child state replay on load.

These results establish one background Agent and a held root turn, not nested-agent acceptance, concurrent steering or post-settle host continuation. Published source explicitly defers settlement while spawned subagents live, but does not indefinitely hold for non-subagent background shells.

### MCP, permissions, cancel and reload

Injected a local **HTTP MCP** server through session/new. Observed initialize, notifications/initialized and tools/list. Captured model requests exposed `mcp__fixture__echo` in both root and spawned child requests. This proves **HTTP hookup and child tool exposure**, not a child tool invocation, T3 credential isolation, stdio hookup or authorization narrowing. The child request is identifiable by its exact user prompt; title-generation requests had no MCP tools.

The fixture Agent generated **zero session/request_permission calls**. Published canUseTool handles approval/AskUserQuestion and attributes SDK agentID to negotiated child sessions; otherwise it uses the root boundary. Saved human question durability and approval UI were not tested.

Cancellation run: real root session/cancel **4069ms**, live child cancelled **4078ms**, root prompt stopReason:cancelled **4130ms**. Immediate load announces synthetic `<root>:replay-subagent:toolu_fixture_child` **5691ms**, reconstructs it **completed** **5707ms**, rather than retaining live child ID/cancelled state. Source explains that task lifecycle frames are not persisted; replay recovers terminal state from launch tool_result/task notifications. This is a concrete mismatch for a durable job UI. **No assertion that session/cancel killed background OS work**: harness teardown separately terminated its owned process group. State publication is not process-exit proof.

Runtime evidence: logs/claude-plain.json, claude-plain-v2.json, claude-plain-fixture.json, claude-native-fixture.json, claude-native-fixture-cancel.json, model-requests.jsonl; probe.mjs and claude-model-fixture.mjs. Initial extraction-time probes were superseded after complete platform extraction.

Pinned source: [agent](https://github.com/agentclientprotocol/claude-agent-acp/blob/686c0c99b3b89217b74d1f5de8272e7c9ef1aab4/src/acp-agent.ts) (settlement4215+, cancel6832+, replay7714+, permissions7916+, MCP8825+), [child negotiation](https://github.com/agentclientprotocol/claude-agent-acp/blob/686c0c99b3b89217b74d1f5de8272e7c9ef1aab4/src/acp-subagents.ts). Types explicitly cite draft PR1992; AIR aliases and subagent-transcript are extensions, not portable baseline guarantees.

## 2. Codex ACP: child projection and persistent notifications; earlier auth gate

**Actual complete-install probe:** 2.1.1 initializes against real Codex0.159.3; initialize(2) answers1; session/new immediately returns **-32000 Authentication required**. Thus no real session/model/child/cancel/reload acceptance. No sign-in attempted. Logs: codex-plain.json, codex-plain-v2.json. Early extraction and initially absent isolated CODEX_HOME setup failures were corrected and superseded.

**Publish-source evidence, not runtime:**

- Negotiates the same draft child surface. Router discovers spawnAgent/subAgentActivity, registers child notification handlers synchronously, buffers pre-announcement output, supports nested discovery and state updates. Without negotiation, collaboration lifecycle stays ordinary tool calls; child-native interaction delivery is capability-gated.
- Session subscription outlives prompt: after root turn/completed/finally, promptNotificationsActive=false routes late events through handleSessionScopedNotification. This is an adapter late-update path, not host-owned root reawakening. Prompt cleanup also finalizes outstanding native child state: do not infer Bruv-style detached child survival just from a persistent subscription.
- session/cancel interrupts the **current root turn** via app-server turn/interrupt; no current turn means no-op. It is not a terminate-all-background-terminals/process-tree contract.
- MCP stdio maps command/args/env; HTTP maps URL/http_headers. SSE and ACP transports explicitly throw unsupported-transport errors. Thread config goes to app-server; child-specific credential filtering/grants were not proved. Do not mistake an engine's inherited config for a separate child permission ceremony.
- Load/resume reconnects engine threads and replays child generations/history and terminal restoration. Child approvals/elicitation handlers are registered on discovered thread boundaries; saved human decision recovery after restart remains unproved.

Pinned source: [server](https://github.com/agentclientprotocol/codex-acp/blob/68d7d2d5ddfc0ed5746f9f6130892dda685e65dd/src/CodexAcpServer.ts) (load839+, replay2125+, cancel2800+/3473+, persistent routing2944+/3319+), [router](https://github.com/agentclientprotocol/codex-acp/blob/68d7d2d5ddfc0ed5746f9f6130892dda685e65dd/src/subagents/CodexSubagentEventRouter.ts), [subscriptions](https://github.com/agentclientprotocol/codex-acp/blob/68d7d2d5ddfc0ed5746f9f6130892dda685e65dd/src/subagents/CodexSubagentSubscriptions.ts), [MCP](https://github.com/agentclientprotocol/codex-acp/blob/68d7d2d5ddfc0ed5746f9f6130892dda685e65dd/src/CodexAcpClient.ts#L940), [late handler](https://github.com/agentclientprotocol/codex-acp/blob/68d7d2d5ddfc0ed5746f9f6130892dda685e65dd/src/CodexEventHandler.ts#L275).

## 3. OpenCode: closer background ownership, not native ACP child exposure

**Runtime blocker:** official 57.85MiB archive download failed curl **exit28 after150s**, retaining only a partial archive. Neither checksum-verified nor executed. Expected registry SHA256 `0f22479647226d1d2dd99595d20082ee7bda3870b62dc6a90b41efc1a71d7e9a`. A redundant large source clone was stopped; exact release files/current-head comparison fetched successfully.

**Release-source evidence only:**

- Task background:true returns immediately and promises automatic completion, gated by **OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true**. Default subagent_depth1 bounds nesting; increased depth/task permission rules allow deeper children. Sessions carry parentID. This resembles Bruv-owned async work more directly than Claude's held turn.
- ACP part/delta forwarding requires the session to exist in its ACP session map. Task-created children are not automatically registered/announced as native ACP child sessions here. Root sees Task metadata/result, not automatically navigable child chat/tree. Background delivery must reach the root session to become visible.
- ACP cancel calls session.abort for the addressed backing session. SessionPrompt.cancel calls its session runtime cancel. Task connects foreground abort to background.cancel while waiting; the asynchronous branch returns before that waiting scope. Do not assert whole-background-subtree kill from root cancel. Stop/delivery races and restart durability were not tested.
- MCP stdio becomes local command/environment; HTTP/SSE becomes remote URL/headers. sdk.mcp.add is **directory-scoped**, not a child grant. Child permissions derive from session/agent rules. No runtime credential-isolation or propagation acceptance.
- load/resume restores backing session/model/mode, re-registers supplied MCP and replays transcript. Active background work and pending approval recovery are not proved.

Pinned source: [service](https://github.com/anomalyco/opencode/blob/aec0b9a6d8898f68f923aaf08b7306d931fd9d76/packages/opencode/src/acp/service.ts) (cancel362+, MCP1010+), [event filter](https://github.com/anomalyco/opencode/blob/aec0b9a6d8898f68f923aaf08b7306d931fd9d76/packages/opencode/src/acp/event.ts#L190), [Task](https://github.com/anomalyco/opencode/blob/aec0b9a6d8898f68f923aaf08b7306d931fd9d76/packages/opencode/src/tool/task.ts) (flag97+, depth107+, permissions140+, async return318, waiting cancel330+). Exact service/task files match observed current dev head; no claim every engine file matches.

## T3 generic registry versus dedicated adapters

Unmodified upstream pin: **0.0.46-nightly.20261003.2623 / fed41fa88bb27cb4325cb208d571393850bc63c2**. Raw pinned Grok/Acp/Claude files independently fetched and byte-matched parent's source tar. Stable0.0.45 has no generic registry driver. Other workers own full registry/client governance and real T3 lifecycle acceptance.

- Generic initialize advertises fs/terminal/auth/elicitation/meta, **not subagents**. Requests2, peers can choose1. Registry flavor only has special child normalization for Devin, not these peers. AcpAdapter does not dispatch subagent_spawned/subagent_state_update/async_task_* as native peer children. Standard cards/text are degraded projection, not child-session parity. [Runtime1893+](https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/provider/acp/AcpSessionRuntime.ts#L1893), [flavor187+](https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/orchestration-v2/Adapters/AcpRegistryAdapterV2.ts#L187).
- Generic MCP normally injects **t3 acp-mcp-bridge stdio**, host endpoint/authorization in env, regardless of advertised HTTP. ACP transport is selected only if explicitly advertised. These peers do not provide that ACP transport path. Claude's HTTP success neither changes T3's bridge selection nor proves root bridge credentials safe for Bruv children. [Injection685+](https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/orchestration-v2/Adapters/AcpAdapterV2.ts#L685), [selection2207+](https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/provider/acp/AcpSessionRuntime.ts#L2207).
- Dedicated Claude consumes SDK query protocol with tailored task/subagent/background mapping. Dedicated Codex consumes app-server with tailored child/terminal controls. Registry wrappers do not reuse these mappings.
- **Grok is the decisive same-agent comparison:** registry grok-build1.0.49 runs `@xai-official/grok@1.0.49 agent stdio`. Dedicated Grok supplies xAI child/tool/background normalization, persistent monitor/task IDs, task-completed wake detection, deferred finalization and **enablePostSettleContinuation:true**. Stop requests process-group restart/termination; steering can preserve background work. Generic registry flavor supplies none of these overrides. AcpAdapter1424 gates continuation on flag plus service;3764 offers no continuation when disabled. Same executable via registry is not same host behavior. [Grok235–327](https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/orchestration-v2/Adapters/GrokAdapterV2.ts#L235). Exact-source comparison, **not Grok runtime**.

## Bruv experiment consequences

Initially show children honestly as tool/activity output, with one lifecycle owner. Choose **hold root ACP turn** (Claude-like, a behavior change) or retain **true root yield** and solve host continuation/late wake explicitly. A registry ID does not solve this choice. Assert real process exit separately from cancelled UI state. Persist job IDs/terminal states instead of replay-inferred children. Mediate MCP instead of copying root authority into child env. Require actual independent-client and generic-T3 acceptance for idle completion, Stop, reopen and saved decisions before removing the patch.

Values unchanged: this reinforces existing one-owner, actual-path proof and safe-resume values. Protocol-specific lessons belong here.
