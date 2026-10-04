# Independent T3 → Bruv ACP: orchestration/MCP boundary

Research only, 2026-10-03. **Release and implementation remain held.** No product source changes, build, installation, push or release were performed by this worker. Read `wisdom/values.md`: one owner, accepted/delivered/acknowledged are different, and real-path proof govern this proposal. Companion workers own actual T3 experience and the Bruv ACP seam; this note does not claim either passed.

## Conclusion

Removing the bundled patch is feasible as a **new boundary**, not a transport-only replacement. Prefer **Bruv-owned children initially**, with one ACP root session and an explicitly mediated injected-MCP surface. This preserves Bruv's roles, local/SSH placement and task semantics without pretending that upstream T3 owns those jobs. Accept that genuine T3 child threads, graph controls and durable app-owned completion delivery are not automatically preserved. If those are requirements, select T3-owned delegation through an explicit bridge instead, and validate the changed semantics before migration.

Do not blindly expose both Bruv `subagent/jobs` and T3 `delegate_task/task_status/task_cancel` as interchangeable tools. Do not propagate a root T3 bearer to local children. Do not infer support from a registered tool, slash command, optimistic capability, draft protocol, or streamed activity row.

## Evidence and reproducibility

- Current official T3 main queried through GitHub API: **31a9da179ed0763335f05681c577474aec5d2309**, commit 2026-10-03 10:41:49Z, “keep delegated review rounds on the task API” (#15115). Unmodified archive downloaded to `/tmp/bruv-acp-boundary.4hxnC7`; no checkout patch applied. [Pinned official tree](https://github.com/pingdotgg/t3code/tree/31a9da179ed0763335f05681c577474aec5d2309).
- Official ACP repository main queried separately: **937d31461576d302019d65bd601ac0a5a77db001**. Download at `/tmp/bruv-acp-spec`. [Pinned docs](https://github.com/agentclientprotocol/agent-client-protocol/tree/937d31461576d302019d65bd601ac0a5a77db001/docs/protocol). Read the v1 baseline, v2 draft baseline and further unv2 draft baseline proposals; distinguish them below.
- Bruv root at inspection: `1875ae901fe05ef2b52d9623bfe4a126f4250d95`. Canonical bundled pin `integrations/t3/upstream/source.json`: **fed41fa88bb27cb4325cb208d571393850bc63c2**, nightly `v0.0.46-nightly.20261003.2623`. Canonical patch SHA-256 **f43e15a5add13e850c26a6f6a5d309c139fa56213800d399fb624459bc82f6e2**. Compared canonical patch with corresponding patched cache files, not with the old September research checkout.
- Read `integrations/t3/fixtures/native-task-contract.json`, `src/t3/tasks/{native-task,mcp-client,launch-identity,local-notifications}.ts`, `src/tasks/job-service.ts`, `src/delegation-environment.ts` and relevant `src/agent/extension.ts` paths.
- Official MCP [2025-06-18 HTTP transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports) and [tool safety](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) fetched successfully. Bruv's current native client requests that MCP version. ACP's current elicitation docs separately reference the newer MCP release-candidate; do not conflate negotiation versions.

### Source index (all T3 paths relative to the pinned tree)

| Boundary | Primary source |
|---|---|
| Injection context and selection | `apps/server/src/orchestration-v2/Adapters/AcpAdapterV2.ts`: `acpMcpContext` (681–715), `negotiatedCapabilities`, `makeRuntimeInput` (2014 onward); `provider/acp/AcpSessionRuntime.ts`: `sessionMcpServers` (2207–2218), session create/load/resume (2280–2325) |
| v1/v2 compatibility | `packages/effect-acp/src/client.ts`: v2 initialization translation (630–663); `compat.ts` |
| Credentials and scope | `mcp/McpSessionRegistry.ts`, `McpInvocationContext.ts`, `McpProviderSession.ts`; `orchestration-v2/ProviderSessionManager.ts`: `prepareMcpSession` (418–473) |
| Actual MCP task authority | `mcp/OrchestratorMcpService.ts`: `readTask` (1009–1149), `delegateTask` (1356 onward), `cancelTask` (1482 onward); `mcp/toolkits/orchestrator/tools.ts` |
| ACK/wake ownership | `orchestration-v2/Orchestrator.ts`: completion delivery transitions, wake text (483), acceptance (9090–9159); `Notification.ts` |
| Questions/permissions | `Adapters/AcpAdapterV2.ts`: pending runtime requests, elicitation (5640 onward), response acknowledgement (7598 onward); `mcp/toolkits/thread/{tools,handlers}.ts`; `mcp/threadAccess.ts` |
| Pi versus ACP | `Adapters/PiAdapterV2.ts` (387 onward), `piT3McpInjection.ts`, `piT3McpExtensionSource.ts`; `Adapters/AcpRegistryAdapterV2.ts` (187–235) |
| Patched-only authority/lifecycle | Canonical patch additions: `mcp/BruvTaskService.ts`, `BruvDelegationPolicy.ts`, `provider/BruvWebPi.ts`; changes to `ProviderSessionManager.ts`, `PiAdapterV2.ts`, `Orchestrator.ts` |

## 1. Is MCP injected into every ACP agent?

**Not an unconditional ACP rule.** Stable v1 allows clients to supply MCP servers and requires agents to support stdio; v2 draft baseline makes MCP transports advertised session capabilities (omitted/null means not advertised). T3 initiates version 2 and its compatibility layer also handles v1 peers.

**Current upstream T3 does inject its own server into normally configured V2 ACP sessions.** ProviderSessionManager prepares a per-thread credential by default. `configureMcp:false` is an internal manager option, not evidence of a user-facing per-agent disable setting. `acpMcpContext` returns no servers for null thread or absent prepared credential. Otherwise it supplies:

- a `t3-code` stdio descriptor running T3's own `acp-mcp-bridge` command;
- `T3_ACP_MCP_ENDPOINT` and `T3_ACP_MCP_AUTHORIZATION` in that descriptor's environment, not credential-bearing command arguments;
- an alternate MCP-over-ACP descriptor `{type:"acp",name:"t3-code",serverId:"t3-code"}`;
- corresponding process environment for the ACP agent itself, including the T3 executable/entrypoint.

Runtime chooses MCP-over-ACP when its normalized `mcpCapabilities.acp` is true; otherwise it sends the stdio descriptor. It does **not** use optional HTTP support here. Source comments cite codex-acp and pi-acp dropping HTTP configuration; that is upstream rationale, not a fresh runtime test of those packages by this worker.

Important current discrepancy: selection does not check normalized `mcpCapabilities.stdio`. It falls back to stdio even for v2 peers not advertising it. `negotiatedCapabilities` also reports `supportsMcpTools:true` on the premise that the stdio bridge exists. This proves what T3 offers, not that a peer consumes it. The source comment “stdio is ACP's required baseline” describes v1, not today's v2 draft baseline. Test the negotiated wire version and actual MCP initialization/list/call; do not use that capability as acceptance proof.

T3 also prepends browser/orchestration instructions to ACP prompts when its descriptor list is nonempty, initially and after relevant mode/tool-state changes (`provider/T3OrchestrationInstructions.ts:t3AcpPromptWithInstructions`). Instructions prefer native same-provider tools when suitable, but recommend `delegate_task` for other models/cross-provider/T3-owned work. A peer that ignores MCP can therefore receive instructions naming tools it does not have.

## 2. Toolkit visibility is not execution authority

Upstream has no universal ACP `allowedTools` policy that automatically constrains Bruv. ACP agents run their own tools; T3's adapter explicitly calls runtime policy `client-boundary` enforcement. It can answer permission requests, not intercept undisclosed tool executions.

Three distinct mechanisms:

1. **MCP discovery** registers the T3 toolkit. Registration/listing is not an authorization grant.
2. **Provider-specific approval configuration**: Claude attaches `mcp__t3-code__*` to `allowedTools` for ordinary sessions; for a read-only sandbox it preapproves only the annotated read-only subset. The source explicitly says SDK `allowedTools` preapproves calls while `tools` controls availability. This is not an ACP-wide allowlist.
3. **Backend scope and live-state checks** remain authoritative. Credentials bind environment, app thread, provider instance and credential-session ID. Tool handlers check capabilities and applicable project, active-run, mode and ownership constraints.

Claude's read-only subset at this pin: `orchestrator_capabilities`, `list_scheduled_tasks`, `t3_thread_list/wait/configuration/transfers/search`, `t3_pending_request_list/read`, `t3_worktree_status/list`, `t3_project_list/read`, `t3_preview_list`, `t3_environment_read`, `t3_queue_list/read` (all with MCP prefixes). **`task_status` is deliberately not read-only**: reading a terminal result acknowledges its delivery. `delegate_task` and `task_cancel` mutate state. Discovery/read-only does not imply a harmless “observe all children” API.

Upstream Pi's injected extension has its own blocking permission hook: `read/grep/find/ls` bypass confirmation; permitted edit tools bypass it in auto-accept-edits; other tools require UI confirmation except in full-access. It dynamically registers discovered MCP tools and adds T3 instructions. Pi core does not become a general MCP client merely because a descriptor exists.

The standard issuer always includes orchestration/worktree/pull-request capabilities, plus enabled browser/device capabilities. Supplying an empty requested capability set does not attenuate those defaults. The patched issuer adds `restrictToCapabilities`; **unmodified upstream does not have that Bruv-specific attenuation switch**. A local gateway can expose less, but cannot pretend it minted a narrower T3 credential.

## 3. Identity and origin determine the real owner

Keep these identities separate:

- T3 app `threadId` and durable `runId/nodeId`;
- T3 provider-thread ID and native ACP `sessionId`;
- MCP bearer credential's `providerSessionId`, which is an auth identity, not the ACP/Pi runtime session;
- transport `Mcp-Session-Id`, which is neither the task nor the agent conversation;
- Bruv session file, local job ID and existing SSH task namespace.

Upstream `delegate_task` requires an active parent run whose provider instance matches the credential. It creates an **`app_owned`** task backed by a new child thread/run, using only the supplied prompt rather than copying parent history. Child modes cannot exceed parent modes. Upstream `role` only prefixes a role instruction to the task prompt (`taskPrompt`, 553); it is not Bruv fast/normal/orchestrator authorization. The public `OrchestratorMcpDelegateTaskInput` has target/mode/wait budget and no workspace parameter; `t3_thread_launch` can allocate worktrees, but that creates an independent top-level thread, not the same delegated-task ownership contract. `task_status/task_cancel` locate app-owned tasks belonging to that calling parent thread. ACP native subagent observations are marked **`provider_native`**, not converted into app-owned tasks. A display row, matching ID string, or peer `_meta` cannot create app-owned authority.

Generic ACP registry capabilities initially say native subagents are unsupported; its concrete extraction hooks currently include a Devin-specific presentation exception. The v2 draft baseline defines no standard `subagent_update` ownership graph. Additional **unstable v2 extensions** (schema/v2/schema.unstable.json and docs/protocol/v2/draft) describe owned child sessions and mirrored state; that is not stable support and this T3 ACP path does not handle that variant. Rich child controls require both negotiated support and implementation, not registration alone.

## 4. Current patched integration contains more than transport

The existing fixture's `bruv_task_launch/observe/cancel/list` contract is **not upstream `delegate_task` under different names**:

- Bruv launch returns versioned task/child-thread/run/node identities, effective `fast/normal/orchestrator` profile/depth, and workspace preparation state. Root retains a durable execute-invocation/call/index launch identity; ambiguous replies replay the stable client request ID. Patched `OrchestratorMcpService.stableCommandId/stableThreadId` scope keys to durable **threadId**. Upstream scopes them to MCP credential **providerSessionId** (474 onward). Replaying the same clientRequestId after credential rotation can therefore produce a different command identity: restart-safe launch deduplication is not automatically preserved by the upstream tool. A bridge needs durable intent/task reconciliation, not blind retry with a new bearer.
- Patched backend trusts only built-in Pi when the server operator replaces its executable with Bruv (`BRUV_WEB_BRUV_BINARY`). Caller/provider environment is not the identity signal. Durable app-owned marked lineage derives effective role/depth. Fast/normal cannot delegate; spawned orchestrators cannot spawn another orchestrator; depth is bounded. Profiles resolve from trusted backend configuration.
- Trusted Bruv credentials receive `bruv-delegation` rather than generic `orchestration`. Dead/invalid lineage fails closed instead of falling through to generic authority. Generic orchestration tool names may still exist in discovery; capability rejection protects the real boundary.
- Bruv activates **only `execute`** in `src/agent/extension.ts`. MCP tool registration therefore does not mean automatic model visibility. The host native client itself allows only four task tools plus `bruv_local_job_notify`.
- Scoped native launches are async-only, reject explicit model/thinking overrides, cross-placement and runtime deadlines, and use backend workspace/profile policy. This differs from standalone Bruv and upstream wait/target semantics.
- Patched `bruv_task_observe` is a bounded read **without completion ACK**. Upstream `task_status` acknowledges terminal delivery. A naive observe→status rename changes ownership.
- Patched cancellation explicitly walks app-owned descendants ancestor-first with durable delivery disposal and a cancellation fence. Upstream task_cancel requests interruption of its child run and returns `cancel_requested`; it is not evidence that every independently running grandchild process stopped. Provider-native run projection terminalization is also not process teardown proof.
- Bruv emits `bruv_task_event` telemetry for local shell jobs; patched PiAdapter projects durable nodes. `bruv_local_job_notify` accepts host notifications only when those nodes belong to the current durable provider thread and state agrees. A bounded, fsync-backed Bruv outbox retries stable notification identities, clearing them only on committed/disposed acknowledgement. Upstream ACP has neither custom tool nor custom telemetry consumer.

Deleting the patch removes these agreements. Each must be retained in Bruv, deliberately replaced by an upstream contract, or explicitly dropped—not presumed absorbed by ACP.

## 5. Notifications, cancellation, resume and questions

**T3-owned children:** upstream persists completion delivery through pending/claimed/delivered/acknowledged/disposed states. Provider acceptance drains a wake batch but does not acknowledge its results; task_status does. Async completions wake the owning parent, steering when supported or queuing otherwise. A completed child turn with live nested work is not yet the completed delegated task. Terminal published results do not reopen when later child-thread work starts. Current official instruction requires a fresh delegate_task/clientRequestId for every delegated review round; the backing childThreadId is not a resume handle for that task.

**Bruv-owned children:** Bruv must remain the completion/wake owner. Draft ACP v2 allows background updates while foreground state is idle; it does not supply Bruv's durable outbox, a delegated-task result ACK, or an app-owned child graph. V1 has a different end-of-prompt boundary. T3 generic ACP's provider-native post-settle continuation mechanism is flavor-gated; do not assume Bruv's autonomous late wake is attached as a new app run. Explicitly validate late messages, user-turn races, duplicate wake suppression and restart. Merely emitting tool activity is not sufficient.

**Stop:** distinguish cancel current request, interrupt foreground work, cancel one child subtree, and stop session-owned work. ACP v1 confirms session cancellation through prompt's cancelled stop reason; v2 draft baseline uses idle state_update with cancelled stop reason after aborting operations. Pending permissions must receive cancelled. T3 ACP cancellation code intentionally preserves provider-native background work on certain soft steering/restart paths, and quarantines residual stopped-run updates. Bruv's speech interruption must not become stop-all. A bridge must preserve these meanings; cancellation acceptance is not exit.

**Resume:** T3 create/load/resume reinjects intended MCP configuration. ACP session load/resume is capability-gated; absence is an error, not a silent fresh session. Credentials are reused for an existing valid thread/provider binding where possible and otherwise rotate/revoke; never persist an injected bearer as a durable conversation identity. Bruv must bind resumed native session to its own session file/jobs, with fresh scoped client connections. Root resume does not prove child graph recovery, detached process discovery, question recovery or exactly-once completion delivery.

**Permission versus human question:** T3 ACP handles permission and form elicitation with live callback maps and generation fencing. Response success waits for outgoing native response acknowledgement; after a restart old deferred callbacks are not magically live. It declares approvals live-only and not generally originating from subagents. Standalone Bruv saved questions persist owner/version/checkpoints across turns/processes; forwarding an elicitation does not supply those durable semantics. Current Bruv explicitly disables its question runtime in `t3NativeSession` (`src/agent/extension.ts:543`), so this is not a claim of already-shipped native-web saved-question parity. The independent ACP design must choose and validate its supported question surface.

Also, upstream MCP `t3_pending_request_respond` can answer pending **user-input** requests (not permission approvals), including project-scoped targets allowed by caller policy. That is useful agent-to-agent control, but **not the same contract as a Bruv human-owned saved question**. Do not route human permission/source approval through a model-authored MCP answer, worker text or transcript inference. Decide which questions are agent-resolvable versus human-only and who closes/resumes each one.

## 6. Can injected MCP reach Pi/Bruv/local children?

**Technically yes, semantically not by simple inheritance.** Bruv ACP can consume session-provided stdio/HTTP descriptors or negotiated MCP-over-ACP in its host and proxy selected calls. Upstream's stdio descriptor invokes the independently installed T3 executable; its lifetime/path and environment must remain valid. Existing Bruv native client accepts only patched bruv_* tools, so it is not a general upstream MCP consumer. Reusing T3_MCP_* with an upstream bearer would switch current job-service into patched-native mode and then call nonexistent tools.

Passing descriptors to a Pi process requires an actual MCP extension/client (upstream T3's direct Pi adapter materializes one). Passing MCP-over-ACP to a raw Pi/local child requires an ACP host relay because the server lives on the parent's ACP connection, not a public child-accessible endpoint. Raw inheritance gives every local child the **root's thread/provider scope**: launches/results/ACKs/wakes are attributed to the root, not the local child; root role/depth policy is not independently enforced. It can also fail when the root run is no longer active.

A T3-owned delegated child naturally gets a separately prepared credential for its own thread/provider. A Bruv-owned local child does not. Keep root credentials host-only; either expose a narrow root-owned proxy with explicit caller policy and honest attribution, or use real T3 delegation. Do not claim proxy filtering changes T3's bearer scope.

**Concrete new leak hazard:** current Bruv environment scrubber removes T3_MCP_URL/T3_MCP_BEARER_TOKEN and Bruv root capabilities, but not T3_ACP_MCP_ENDPOINT/T3_ACP_MCP_AUTHORIZATION. Upstream ACP places those new names in the agent environment. If that environment reaches current model-directed execution/local children unchanged, the ACP credential survives the existing scrub. This is a demonstrated sanitizer mismatch, not proof of an actual new ACP agent leak (no such implementation exists yet). It must be part of seam validation.

MCP annotations are advisory/untrusted except from trusted servers; names/read-only labels are not capability grants. HTTP Origin/DNS-rebinding protection is separate from task origin. Official MCP requires Origin validation for HTTP connections and recommends loopback/authentication; authentication middleware was inspected, but this worker did not prove the complete upstream HTTP deployment's Origin enforcement. New proxies must not leak bearers through logs, prompts, redirects, shell args or arbitrary child env.

## 7. Architecture options and decisions

| Choice | Single authority | Gains | Deliberate cost / blocker |
|---|---|---|---|
| **A. Bruv owns children (recommended first experiment)** | Bruv starts/stops/recovers its jobs; T3 owns root ACP UI/run | Retains Bruv roles, local/SSH workflows, worktree behavior; avoids importing patched task policy | T3 child graph/control parity not promised. Need truthful aggregate/tool projection and verified late wake/resume. Mediate injected MCP to avoid a second default delegation surface. |
| **B. T3 owns children** | Bruv subagent facade calls upstream delegate_task; T3 owns child threads/runs/completion | Real app-owned T3 graph, provider catalog, notification persistence | Bruv must map profiles, target selection, workspaces, role/depth limits, observe ACK and cancellation semantics. Upstream does not enforce Bruv role restrictions. Native SSH source/capability workflows are not equivalent. |
| **C. Explicit bridge/mixed placement** | Exactly one owner per namespaced task; root routes once | Can use T3 for cross-provider app-owned work and Bruv for its native placement | Most coordination burden: ID ledger, ownership routing, wake/ACK/cancel/restart reconciliation, child permissions, one UI truth. Not the default merely to preserve every old affordance. |

For A, “mediate MCP” is an explicit product choice, not assume T3 can disable injection. Accept supplied configuration honestly; do not advertise MCP support without consuming it. Expose only agreed tools through execute/a controlled host API; omit duplicate delegate/task controls from normal model tools, or label T3-owned delegation as a separate explicit mode. T3 may still insert generic orchestration instructions; the prompt/tool surface must state the actual boundary. Choose how browser/worktree/project tools fit rather than dropping them accidentally.

For B, a facade alone cannot reconstruct patched backend security. Role/depth policy in an adapter is only as strong as the enforced call surface; if broad injected delegate_task remains directly callable, a worker bypasses it. Child sessions need the same enforced policy, and credential authority remains broader than Bruv's local allowlist. Specify reduced guarantees or seek upstream capability support.

**Open decisions for the user/parent:** Is native T3 child navigation/control required, or is a good root session with Bruv tasks sufficient? Should T3-owned cross-provider delegation remain an explicit option? Who resolves human saved questions on reconnect? Is current Bruv SSH placement/profile selection mandatory? Should Stop mean foreground-only, subtree, or session work in the T3 UI? Is losing patched native-task parity acceptable for a clean independent-client architecture?

## 8. Bounded probes performed and required validation

Performed in memory using Bun.Transpiler to execute the exact extracted upstream `acpMcpContext` and `sessionMcpServers` functions with mocked credential storage, plus the actual imported Bruv childAgentEnvironment. No providers/children launched and no production files altered:

| Input | Observed |
|---|---|
| Null app thread or missing credential | Empty server lists |
| Configured app thread | t3-code stdio command; credential env names, no bearer command arg |
| MCP capability absent or stdio:false | Still stdio fallback |
| acp:true | MCP-over-ACP descriptor selected |
| Child environment with both old/new fixture credential names | Old T3_MCP_* removed; new T3_ACP_MCP_* survived |

These are source-function probes, **not end-to-end ACP or provider acceptance**. Official source downloads/API calls succeeded. Existing product acceptance notes do not prove the proposed independent upstream path.

After ownership decision and explicit implementation approval, validate only the chosen boundary:

1. **Unmodified upstream, real Bruv:** negotiated version/capabilities → actual injected MCP initialize/list/call → visible execute/tool surface. Demonstrate advertised commands actually execute, rather than only appearing in UI. Test no-MCP configuration and v2 capability omission honestly.
2. **One ownership trace:** launch two children, one nested child, one local command; record root app/provider/native/MCP and Bruv identities. Confirm exactly one launch/result owner and no duplicate task rows or notifications. For B/C prove app-owned versus provider-native origin and cross-parent access denial.
3. **Completion and replay:** active/idle parent, concurrent user message, child failure, nested waiting, lost launch reply, lost completion ACK, disconnect/restart/resume. Measure accepted/delivered/acknowledged separately; verify one follow-up and stable terminal result. For A prove T3 actually captures late autonomous Bruv output; for B distinguish task_status ACK from Bruv inspect.
4. **Cancellation:** foreground interrupt versus stop-all, child/subtree versus sibling, cancellation while blocked on permission, late events, child completion race, and runtime restart. Inspect actual process exit/remaining grandchildren, not only green status rows. Ensure no disposed result resurrects work.
5. **Human decisions:** permission decline/cancel, saved question survives reconnect, exact owner/version, child clarification versus human-only source/capability grant. Demonstrate injected pending_request_respond cannot impersonate a human approval path.
6. **Credential authority:** read-only mode and direct/proxied injected tool calls; deny worker delegation/depth escalation for the chosen policy; wrong parent/provider/origin; retired bearer and same launch intent across credential rotation; no root credential in execution/subprocess env/logs. Validate descriptor refresh and MCP connection teardown separately from stopping tasks. Audit HTTP Origin protection for the deployed endpoint/proxy.
7. **Actual rendered experience:** child navigation where promised, question controls, Stop, resume after quitting, and bounded output with originals retrievable. Companion worker's real upstream experience is a required separate gate, not replaceable with this note's mocks.

Existing values already cover the lesson; no values change needed. The next step is discussion/ownership selection, not deleting the patch or publishing a release.

## Parent cross-check

Protocol status corrected after comparing both research tracks against pinned official docs/docs.json: v1 is Latest, v2 is Draft at 937d3146. The v2 baseline schema and its further unstable extensions are separate; neither is a promise that this T3 registry client supports child sessions. T3 requesting wire version2 does not make the upstream draft stable.

On the published nightly fed41fa, AcpAdapterV2.ts1424 requires flavor.enablePostSettleContinuation plus a continuation service. Only GrokAdapterV2.ts327 opts in among production adapters; generic AcpRegistryAdapterV2 does not. Around3764, generic post-settle traffic does not open that continuation. Source proof narrows the late-wake gap; a future Bruv adapter still needs a real client lifecycle test.
