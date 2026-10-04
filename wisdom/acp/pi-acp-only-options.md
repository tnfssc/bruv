# pi-acp-only options: no T3 changes

Read-only source review, 2026-10-03. **Holding an ACP prompt open is feasible; real Bruv CLI steering through this T3 generic provider is not.** A codec upgrade does not change dispatch policy or execution ownership. The isolated worker owns runtime proof; this note makes no new browser acceptance claim.

## Sources

Read [values](../values.md), [pi peer](pi-acp-peer.md), [Bruv wrapper proof](bruv-through-pi-acp.md), [direction review](direction-review.md), [deep probes](t3-deep-probes.md), and the new [real-steering requirement](steering-requirement.md).

References use these exact roots:

- **T**: .cache/acp-t3-upstream-experience/source-nightly — official T3 **fed41fa88bb27cb4325cb208d571393850bc63c2**, not patched Bruv T3. Independently compared SHA-256s of AcpAdapterV2.ts, AcpSessionRuntime.ts and effect-acp/client.ts against files streamed from the cached official GitHub tarball: all match.
- **P**: .cache/acp-pi-peer/maintained — pi-acp **0.0.34 / b0581c9c1d675e634234674484247008b03d69b4**, per IDENTITY.json/npm metadata. Independently compared session.ts, agent.ts and process.ts against published bundle source-map contents: all match. This extracted directory is not its own Git checkout; git HEAD there reports the enclosing Bruv repository, not adapter provenance.
- **B**: this Bruv repository. **E**: node_modules/@earendil-works/pi-coding-agent/dist — installed engine 1.0.0 used by Bruv.

No builds, runtime probes, pushes or releases here. Values particularly relevant: one owner, truthful UI, actual shipped-path evidence.

## Three different lifetimes

### Plain v1: one held-open client prompt

Published pi-acp negotiates v1 (P/src/acp/agent.ts:236–242). It resolves on engine agent_settled, not agent_end (P/src/acp/session.ts:887–907, 460–482). Bruv RPC explicitly does **not** wait for jobs at agent_end; a later completion batch sends a message with deliverAs: steer, triggerTurn: true (B/src/agent/extension.ts:384–395, 714–725). Today's adapter therefore settles before background jobs finish.

Changing pi-acp can retain the original v1 prompt across engine-idle periods and forward completion-driven root replies **inside the still-owned T3 run**. No v2 needed. Do not resolve just because job count reached zero: delivery and its resulting root reply must settle too. Completed execute is not completed async work.

### Draft-v2: accepted prompt still in flight

T3 sends the prompt RPC then awaits state_update: idle; an early ACK is not run completion (T/packages/effect-acp/src/client.ts:1286–1317, 860–879). This can represent the same hold-open product with an acceptance ACK instead of a long-lived RPC response. Emit idle only at genuine root quiescence.

Canonical **current** draft-v2 must follow its actual schema, including accepted message identity/user echo, not merely protocolVersion: 2. The fed41fa generated PromptResponse is an older empty-ACK shape (T/packages/effect-acp/src/_generated/schema.gen.ts:1372–1386); earlier normalized-v2 fixtures are not proof of current canonical conformance. See deep-probes' parent correction, independently rechecked against official [937d3146 draft lifecycle](https://github.com/agentclientprotocol/agent-client-protocol/blob/937d3146/docs/protocol/v2/draft/prompt-lifecycle.mdx#L200-L219): acceptance is insertion, successful response requires messageId, and matching user-message updates are mandatory. Version drift does not change the ownership result.

### Spontaneous output after final idle

Not the same thing. Generic registry flavor does not enable post-settle continuation ownership (T/apps/server/src/orchestration-v2/Adapters/AcpRegistryAdapterV2.ts:187–236; AcpAdapterV2.ts:1424–1425). With no active context, late text can append loaded history, but state notifications do not allocate a new app-owned run; late tools do not become ordinary active work (AcpAdapterV2.ts:4084–4090, 4188–4257). Even valid v2 running notifications cannot alone allocate T3 run/attempt ownership or restore Stop. Do not promise autonomous post-idle delivery on this seam.

## Can a human continue talking while root jobs run?

**Typing/submitting: yes. Continuing CLI-style steering: no.** The busy composer offers Queue/Steer and Stop; running itself does not disable Send (T/apps/web/src/components/chat/ComposerPrimaryActions.tsx:115–123, 128–148, 260–309). ChatView records queued_turn versus steer (T/apps/web/src/components/ChatView.tsx:8617, 9099–9103).

The real provider constraints, beyond button labels:

- Generic ACP capabilities are static: supportsActiveSteering **false**, supportsSteeringByInterruptRestart **true**, supportsQueuedMessages **true** (T/.../Adapters/AcpAdapterV2.ts:538–563). Its steerTurn explicitly fails unsupported (:7290–7296).
- CommandPolicy selects **interrupt_restart**, not active steering, for this provider (T/apps/server/src/orchestration-v2/CommandPolicy.ts:249–268). T3 persists a steering_restart attempt (Orchestrator.ts:3953–3974). This is not Pi's steer RPC into the continuing agent loop.
- The preparation lock is startTurnUnlocked: rejects another start while activeTurn exists (AcpAdapterV2.ts:6707–6716). The send path is runtime prompt, serialized for the full normalized prompt lifetime (T/apps/server/src/provider/acp/AcpSessionRuntime.ts:2676–2740). v2 adds a per-session outstanding-prompt rejection (effect-acp/client.ts:1293–1297). These are the exact official equivalents of “prepare/sendPrompt”; there is no concurrent-prompt hole.
- P's FIFO (:358–393) only helps clients that actually send competing ACP prompts. T3 Queue is app-owned and waits behind the current run. Hold that run through long jobs and these followups wait too. T3 Steer interrupts the old attempt and starts a replacement; it does not enter pi-acp's FIFO as simultaneous steering.
- Engine real steer/follow_up exists (E/modes/rpc/rpc-mode.js:319–325; E/core/agent-session.js:1680–1692). Adding adapter methods cannot make unmodified T3's generic dispatch call them.

The user can queue future conversation, or interrupt/restart root while detached jobs continue under a foreground-only policy. They cannot get the required **rendered T3 Steer → continuing engine steering** by changing pi-acp alone. Secretly treating cancel+next prompt as non-cancelling steer conflates Stop with Steer: session/cancel supplies no intent distinction, and T3 already persisted a replacement attempt. This is a hard blocker for the new requirement, not an untested codec possibility.

## Cancellation versus job settlement

P cancel clears its FIFO and calls engine abort (:396–415). Engine abort awaits foreground idle, not TaskManager shutdown (E/core/agent-session.js:1873–1884). Bruv jobs.stopWork is different: requests descendants, then aborts foreground after execute-response acknowledgement (B/src/agent/extension.ts:664–704; B/src/tasks/foreground-stop.ts:9–48).

A held-open adapter must also release its held request on cancellation when engine is **already idle**: abort can be a no-op, with no fresh agent_settled. Serialize cancellation with replacement admission; cancelled generations must not settle later prompts. Stop is foreground-only unless a separate explicit Stop-all contract is implemented. Speaking again must not silently cancel detached children.

**T3's interrupted badge is not engine-exit proof.** Generic registry supplies no wait-for-prompt option (T/.../Adapters/AcpRegistryAdapterV2.ts:161–172). Default runtime cancellation interrupts its local prompt fiber, writes session/cancel, and can project interrupted before actual engine-idle confirmation (T/apps/server/src/provider/acp/AcpSessionRuntime.ts:2431–2447, 2707–2714). Adapter must still really abort and prevent replacement races.

Foreground-only cancellation leaves Bruv automatic completion wakes alive. These can start an engine turn after the cancelled ACP prompt ended: unsupported spontaneous-after-idle activity, not a successful held-open run. Silently dropping ACP output is not a product solution. Preserving jobs plus honest Stop requires a parent-delivery pause/reattach boundary until another client-owned prompt exists. Whole-runtime shutdown instead sacrifices local jobs.

## Is changing only pi-acp literally enough?

**Bounded local keep-open demonstration: plausibly yes; complete truthful lifecycle contract: not demonstrated, existing observation boundary incomplete.** The other worker owns actual proof.

Optional telemetry helps: B/src/t3/tasks/events.ts:9–43 emits local started/completed; :46–66 gates it solely by RPC mode + **BRUV_WEB_TASK_EVENTS=1**. P/src/pi-rpc/process.ts:117–139 parses engine NDJSON and forwards unknown types internally. Consume those records on the **engine pipe**, never raw bruv_task_event on ACP stdout. This flag alone does **not** enable native routing. Keep **T3_MCP_URL / T3_MCP_BEARER_TOKEN absent**: either sets t3NativeSession and disables ordinary Pi completion delivery (B/src/agent/extension.ts:903–915, 408–419, 721–725).

Telemetry is not authoritative quiescence. Terminal task event precedes notification scheduling (B/src/tasks/task-manager.ts:638–653); notificationBatch coalesces for 250/500ms (B/src/agent/extension.ts:405–406). There is no initial snapshot, delivery acknowledgement or session/branch identity. Zero jobs plus engine idle can coexist with an undelivered completion. A grace-window sleep is not an ownership invariant.

There **already is** a trusted non-model root API: B/src/remote/root-runtime.ts:36–82, enabled by BRUV_ROOT_RUNTIME_SOCKET/TOKEN (:89–94), exposes jobs list/inspect/stop, saved questions list/answer, and snapshot idle/pendingMessages/jobs/sessionId. It does not select patched-native routing; child scrubbing removes these root credentials (B/src/delegation-environment.ts:7–23). An adapter may reuse the private socket instead of inventing model-visible helpers. Its close facet means stop-work plus foreground abort, **not** “interrupt foreground, preserve jobs.”

But snapshot omits CompletionBatcher's private pending items/in-flight callback (B/src/tasks/completion-batcher.ts:5–8, 16–35), and exposes no parent-wake pause/reattach. Smallest justified **Bruv session API enhancement** for a maintained product: an owner-scoped quiescence/delivery boundary plus foreground-cancel/delivery-pause operation. Include pending root notifications; bind session/branch/generation; resume them only inside an explicitly admitted next ACP prompt. Reuse TaskManager/JobService, not another job registry. This is a Bruv change, **not T3**. It still cannot fix T3's true-steering dispatch blocker.

## What adapter magic does not deliver

- **Native child graph:** project execute/taskRows as labelled ordinary ACP tools/activity, preserving Bruv local profiles, nested children and IDs. Not T3-native child chats/transcripts/controls. Generic registry has no Bruv child extractor; MCP delegation creates a different T3-owned authority, not an import of TaskManager children.
- **Restart-active jobs:** session load restores conversation, not live TaskManager processes. session_shutdown shuts down manager (B/src/agent/extension.ts:950–967); restored running task rows become unknown (:891–895). No active local-job resurrection promise on backend/adapter death. SSH durability is a separate owner.
- **Permissions/saved human questions:** current P translates extension confirm/select to ACP permissions, cancels editor/input, and does not gate local execute/file/shell tools (P/src/acp/session.ts:915–1008). Bruv saved questions are a separate durable owner/version service. Existing root facets make a future **trusted adapter bridge** possible; no current pi-acp bridge or rendered saved-question UX is proved. Only a genuine host human response may call questions.answer, never model text or a tool/MCP reply. Translation alone is not T3-native durable permission recovery.
- **MCP/isolation:** pi-acp stores mcpServers but does not consume them (P/src/acp/agent.ts:280 onward; process.ts:159–170). T3 injects T3_ACP_MCP_ENDPOINT/AUTHORIZATION plus launcher metadata (T/.../Adapters/AcpAdapterV2.ts:701–713). P inherits process.env; Bruv scrubs **old** T3_MCP names, not new T3_ACP_MCP names. A pi-acp-only patch can retain these host credentials in the adapter and omit them from engine/children. Selected host-tool mediation is additional work. **Do not rename new credentials to old names:** that enables patched-native routing and a different delegation contract. Synthetic leak evidence already exists; no real bearer trial before isolation.

## Smallest honest product decision

1. Bruv remains sole local-job owner; T3 is root conversation UI. Jobs appear as honest tool/activity reports, not native child chats.
2. Prove **v1 hold-open through jobs and their resulting root reply** first. No need for v2 or autonomous post-idle promises. Close only after authoritative jobs plus root delivery settle; telemetry is a spike aid, not production authority.
3. Promise **Queue** and **interrupt/restart**, exactly what generic T3 supports. Foreground Stop is not descendant cancellation; solve paused completion delivery before calling detached-job preservation finished.
4. Preserve CLI/other capable clients for true live steering. **If continuing CLI-style steering from T3 UI is mandatory, no-T3-change blocks acceptance.** Neither v2 nor a pi-acp-only patch satisfies it.
5. No native child graph, restart-active local jobs, automatic MCP tools, or durable T3 question/permission UX promises. Adapter plus a small Bruv session boundary improvement preserves more Bruv than changing job owner, but the steering limitation remains.

**Unknowns for the isolated proof:** rendered held-open busy/Stop behavior with real Bruv; final completion reply drained versus terminal telemetry only; cancel at already-idle job wait; replacement attribution; genuine saved-question host interaction. Narrow actual-path evidence is needed, not another build/protocol matrix.
