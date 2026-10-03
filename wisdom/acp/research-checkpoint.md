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
