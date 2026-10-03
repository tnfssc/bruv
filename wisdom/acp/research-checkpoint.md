# ACP instead of bundled T3: research checkpoint

## User direction

2026-10-03: user asked to research Bruv as an ACP agent, with independently run T3 Code as a client, instead of bundling T3. The web command could point to setup/connect docs. First validate actual experience, Bruv subagents, deeper orchestrator v2 integration, and T3-injected MCP. Report facts, gaps and options, then discuss together. This is research, not migration or release approval.

Prior release work is held; no publication/push was done. See ../releases/v0.15.29-nightly-activity.md for completed commits, known UI defects and paused worktree edits. Do not ship that candidate as-is.

## Research owners

- task_07215e34: actual current unmodified T3 ACP setup and bounded runtime/visible experience. Writes t3-upstream-experience.md.
- task_3b0115f7: Bruv/Pi ACP adapter seam, current protocol, local/nested/background lifecycle. Writes bruv-agent-feasibility.md.
- task_0019939e: injected MCP, task/thread identity and orchestrator-v2 ownership choices. Writes orchestration-mcp-boundary.md.
- Parent: compare evidence, packaging/web-command implications, risks and discussion options.

Workers research in shared workspace with own ignored evidence caches; no production source edits or releases. Use exact upstream refs and separate unmodified sources from the patched .cache/bruv-t3code checkout. A synthetic ACP fixture can prove host transport, not a complete Bruv experience.

## Open questions

Does current released T3 expose arbitrary ACP agent registration? Which transport and capabilities actually work? Who owns delegation, Stop, late wake, resume, permissions and saved questions? Does T3 inject its MCP through ACP and can Bruv consume it safely? What is lost if Bruv owns hidden child jobs instead of native T3 threads? Which custom patched contracts become unnecessary, and which need an upstream protocol/extension? What can the web command honestly document without pretending parity?

Values unchanged at kickoff: existing one-owner, actual-path proof and honest boundaries apply. Recheck after findings.

## Initial results and focused follow-up

Upstream worker found stable v0.0.45 lacks generic ACP registry registration. Current nightly fed41fa supports registry-backed agents; manual entry is an official registry ID, not arbitrary command registration. Protocol exchange passed with labeled fixture on unmodified artifact, but clean completed transcript/Stop/reconnect were not proved. task_4a32354f is doing one clean bounded UI follow-up with fresh independent Git project/base-dir and corrected fixture; artifacts under .cache/acp-t3-clean-followup.

Bruv feasibility worker found no current ACP adapter. Real SDK RPC-mode probe proved idle root auto-wake after background shell completion; 60 focused tests passed. ACP v1 stable and v2 draft lifecycle differ. This is Bruv engine proof, not standalone T3 acceptance. See bruv-agent-feasibility.md.

Parent source cross-check: do NOT reduce the late-wake question to "ACP v1 cannot do it." Pinned upstream AcpAdapterV2.ts implements post-settle buffering and provider continuation offers (acpPostSettleContinuationOfferEvidence around lines1244+, attach logic around3780+), including generic assistant text/terminal tool updates. It also accepts state_update and runtime initialize requests protocolVersion2. Those facts are not proof of complete draft-v2 lifecycle compliance or Bruv acceptance. Synthesis must compare the exact generic flavor and actual runtime result before treating asynchronous continuation as either solved or categorically blocked.

Parent resolved the generic late-wake source question on the exact published nightly: AcpAdapterV2.ts1424 enables post-settle continuations only when flavor.enablePostSettleContinuation is true AND a continuation service exists. Only GrokAdapterV2.ts327 opts in among production adapters. AcpRegistryAdapterV2 does not. Around3764, late events return without opening a continuation when disabled. Thus generic registry ACP does not inherit that Grok path. This is exact-source proof, not full runtime acceptance.

Protocol wording discrepancy to fix during synthesis: orchestration research calls v2 "stable" in places; pinned official docs/docs.json independently fetched by parent marks v1 Latest and v2 Draft at 937d3146. Do not repeat "stable v2" in the conclusion. T3 initializing with 2 does not change upstream protocol release status.

## Research complete; discussion next

Clean follow-up task_4a32354f passed actual upstream browser completion, second prompt, Stop with session/cancel, and reload with retained transcript/interrupted status. Parent inspected two final screenshots and RESULT.json. Fixture only, not Bruv ACP, real-agent registration, child behavior, or backend restart. All research jobs ended and owned runtime processes were cleaned. Research synthesis: direction-review.md.

No migration, bundle removal, registry submission or release was performed. Next step is user discussion of Bruv-owned versus T3-owned children, then a bounded real Bruv ACP prototype if approved. Existing values cover the findings; no new value was added.

## Extended research requested

User asked to finish remaining research and compare official registry agents/other ACP clients that may behave like Bruv. Migration/release still held. Research restarted with four bounded tracks:

- task_69d9d15c: actual published pi-acp 0.0.34, closest shared-engine peer. Owns .cache/acp-pi-peer and pi-acp-peer.md.
- task_ae11d395: 2–3 maintained multiagent peers (Claude/Codex/OpenCode/Goose as justified), generic registry versus dedicated T3 behavior. Owns .cache/acp-multiagent-peers and multiagent-registry-peers.md.
- task_56bfaff7: actual unmodified T3 late events, MCP consume/list/call, permissions/elicitation, config and load/resume/backend restart where feasible. Owns .cache/acp-t3-deep-probes and t3-deep-probes.md.
- task_fea3f191: registry submission/distribution contracts, custom registration and other ACP clients. Owns .cache/acp-registry-clients and registry-and-clients.md.

Fresh public registry snapshot: artifacts/acp/registry-followup.json. Workers may install published research tools only into owned isolated directories, use deterministic local model endpoints where possible, and must not copy real credentials or confuse a fixture with a maintained agent. Product implementation, external registry submissions and releases are not part of this request. Parent owns cross-checks and final synthesis.

Parent found a concrete reuse candidate: published pi-acp0.0.34 supports PI_ACP_PI_COMMAND and invokes compatible Pi RPC CLI arguments. Added task_7eca0da0: actual unmodified pi-acp around existing compiled Bruv using own .cache/acp-bruv-wrapper and bruv-through-pi-acp.md. This could use a legitimate registry adapter instead of unregistered Bruv ACP; actual lifecycle/MCP acceptance remains required.

pi-acp peer task_69d9d15c completed. Published pi-acp0.0.34 with published-matched Pi1.0.0 passed local deterministic model/config/tool/resume/restart/cancel and real optional Pi subagent success/cancel. Injected MCP canary was never launched; config is stored but not consumed. Actual post-prompt output is forwarded, but new client input during the autonomous run is rejected by Pi and converted to end_turn by adapter, dropping the input. Parent inspected RESULT-ext.json and raw Pi RPC race request/rejection. This is a maintained-adapter gap, not a hypothetical ACP limitation; user-facing T3 behavior and actual Bruv wrapper experiment are still pending.

Registry/client task_fea3f191 completed: registry is reviewed distribution/launch manifests, not behavior certification. All41 snapshot entries passed official schema; hypothetical Bruv manifest needed license_url and plain X.Y.Z (nightly root version rejected). Submission requires real artifact/auth flow/icon and maintainer review, not just schema pass. Zed/JetBrains have true custom command/args/env registration. Zed source requests ACPv1 and has external MCP/load/nested-thread infrastructure, but no installed Zed/Bruv or JetBrains acceptance was run. Direct future Bruv listing differs from using existing maintained pi-acp wrapper; wrapper viability pending task_7eca0da0.

Multiagent peer task_ae11d395 completed. Real published Claude ACP0.85.1 + actual SDK0.3.286 with local fake model proved background Agent, negotiated child-session events, HTTP MCP root/child tool exposure and cancel/load. Its root prompt stays open until child drain; live cancelled child replayed completed under synthetic different identity. Codex2.1.1 real initialize works but new session auth-gated; OpenCode1.18.34 artifact timed out after150s (source examined, no runtime claim). Dedicated T3 Grok mapping is not generic registry behavior. Report: multiagent-registry-peers.md.

Direct wrapper task_7eca0da0 completed with twelve real published-adapter/compiled-Bruv steps passing. Native MCP config ignored; execute/job UI unnormalized; late answer forwarded4.417s after root end_turn without running:true. Synthetic-only execute/shell probe confirmed T3_ACP_MCP_* reaches child environment. Full unfiltered T3 trial correctly withheld. Sanitized proof under wisdom/acp/proof/bruv-through-pi-acp.

Parent added task_177054c8 for ONE explicit research-only filtered composition test: unmodified T3 + published pi-acp + compiled Bruv, engine launcher strips injected credential/control vars. Must prove synthetic removal before actual scoped T3 bearer exists. This is a labeled test variant, not a product fix or unchanged production recommendation. Own .cache/acp-t3-bruv-filtered and t3-bruv-filtered-trial.md. It uses real pi-acp registry identity, not a borrowed agent ID.

Deep T3 task_56bfaff7 completed: real generic v1 late events absent from owned runs/history; actual injected MCP initialize/list/read-only call works; permission approve/decline, form answer/cancel, real agent/backend restart+session/load and category:model config plumbing worked. Parent found fixture v2 response {} omits official required messageId. Corrected note to v2-shaped/normalized lifecycle proof, not canonical v2 conformance. It proves same run waits for idle, not spontaneous new work after idle. No product correction required; this is research claim precision.

## Extended pass complete

Filtered full-chain task_177054c8 completed. Synthetic and real engine/shell filtering proved; actual official pi-acp registration and Bruv execute/file diff worked. Automatic late answer generated in Bruv but absent from T3/history; concurrent follow-up marked completed without reaching Bruv or getting reply. Reload retained the missing-result state. Parent inspected final screenshots and summaries. All owned processes cleaned and private auth/runtime state removed. Synthesis: registry-followup-review.md.

No migration/release is authorized or performed; next is discussion and choosing lifecycle/ownership requirements. No unfinished research jobs remain. Product code unchanged in this extended pass.

## User prefers changing pi-acp, not T3

New request: user is willing to change pi-acp and asks whether T3 changes can be avoided. Parent chose a bounded adapter-only feasibility spike, not release/migration. Candidate contract: keep ACP turn open while owned Bruv background work/continuation runs, preserve input ownership, isolate injected credential vars in adapter child launch. T3 and compiled Bruv remain unchanged. This may keep UI Working longer; do not promise native child-thread parity.

- task_0c77b9c0 owns isolated prototype/proof. Worktree /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_0c77b9c0; branch bruv/prove-pi-acp-only-lifecycle-change-with--0c77b9c0. Exact pi-acp published source may change only in its owned cache; save patch/tests/proof alongside wisdom. Prove with actual unmodified T3/browser and compiled Bruv. No product merge/removal or release.
- task_2ea5dade independently reviews no-T3-change contract, busy composer/steering/cancel and telemetry. Writes pi-acp-only-options.md in shared workspace.

Current thought is likely feasible for kept-open turn, not yet tested. Need distinguish foreground Stop from cancelling all owned jobs; no text inference or fixed grace delay may stand in for typed lifecycle.

User added explicit requirement during adapter-only proof: proper CLI steering must work through T3 UI. See steering-requirement.md. Queue-only input and keep-open lifecycle are NOT enough. Parent must require actual Steer behavior, no dropped input or unintended background-task cancellation, and distinguish it from Stop.

Added independent actual Steer-versus-Stop wire task (see normal job title) because exact generic source says supportsActiveSteering:false and supportsSteeringByInterruptRestart:true. Own .cache/acp-steering-wire and steering-wire-contract.md. Must verify cancellation reason/metadata and subsequent prompt, not infer real CLI steering from the UI label.

Read-only reviewer task_2ea5dade confirms generic ACP cannot invoke native engine steering: static capabilities false/interrupt-restart true, active steer method unsupported, Queue waits behind held run. Wire task_d9027497 still running. Parent found existing upstream PiAdapterV2 active steering true and prompt streamingBehavior:steer, so added native-Pi alternative research (normal job title) to check external T3 + configured Bruv binary, without bundling or T3 changes. This is a separate transport option, not silently changing user ACP architecture.

Steering wire owner: task_d9027497. Native Pi alternative owner: task_9c436381. The existing Pi route is source-supported, not yet runtime-proven with Bruv. Adapter-only keep-open task_0c77b9c0 remains separate and cannot by itself close the new steering acceptance gate.

Adapter-only task_0c77b9c0 finished: experimental pi-acp patch plus173tests/typecheck/build, repeated real unmodified T3/Bruv proof. Typed background launch + lifecycle + task-complete acknowledgement holds run through real automatic answer. UI Steer successfully retains followup and completion in original T3 run, but cancels/restarts provider attempt (not native engine steering). Stop foreground-only leaves managed shell alive; later output after Stop unowned. Evidence/prototype-only commit55f65b9a cherry-picked to parent for retention; no production implementation changed. Strict steering gate remains open pending wire/native-Pi results. Read pi-acp-only-lifecycle.md for exact bounded proof and failed early iterations.

Parent read prototype handoff and inspected actual completed/Stop frames. Both followup and automatic answer are visibly retained, but merged within one T3 run; early text may be withheld until drain, and Stop warning says foreground-only. Read steering-wire-contract.md draft: actual Steer and Stop both emit identical session/cancel with only sessionId; queued UI Steer then gets ordinary replacement prompt. Thus adapter-only progress cannot be advertised as in-place CLI steering. Await wire task final cleanup and native Pi alternative result before final direction answer.

## Steering/no-T3-change pass complete

Wire task_d9027497 confirmed identical cancel envelopes for Steer and Stop, followed by replacement prompt for Steer. Native Pi task_9c436381 proved safe-boundary engine steering in actual UI through an explicit research-only version shim; direct binaryPath fails version gate and native job APIs still require a new compatible ownership strategy. Parent read reports and inspected selected UI/wire proof. No production or T3 changes/release. All jobs finished and owned runtimes cleaned. Synthesis and next user choice: steering-decision.md.

User clarified deep child/monitor UI and possible split: T3 orchestration for orchestrator work, Bruv ownership for ordinary workers. Parent checked native Pi source: existing provider-native subagent UI hook exists, but execute metadata needs truthful mapping and completed outer tools force finished state. See hybrid-subagent-ui-direction.md. No new runtime proof or migration claim; next discussion is exact ownership/UI contract.
