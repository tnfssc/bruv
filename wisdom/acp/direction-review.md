# ACP direction review

Research date: 2026-10-03. User asked for validation and discussion before changing architecture. Release and migration remain held. Prior UI work has known defects; do not publish the held candidate.

## Follow-up changes

User requested deeper registry/peer research after this first review. Published pi-acp0.0.34 successfully wrapped the existing compiled Bruv through its documented PI_ACP_PI_COMMAND override: real tools, early shell return, automatic late output, cancel and root session restart/load. A new ACP implementation is therefore NOT required before transport prototyping. This is honest use of the listed pi-acp adapter, not a separate Bruv listing. See bruv-through-pi-acp.md.

Production gaps remain: injected MCP is ignored, generic execute has no native job mapping, late output has no new running lifecycle, and real Pi adapter tests found dropped input during a late run. Synthetic compiled-Bruv tests also confirmed new T3 ACP credential vars reach shell children. Do not recommend unchanged direct T3 use. The explicitly filtered full T3 trial passed execute but lost the late answer and concurrent follow-up. See registry-followup-review.md and t3-bruv-filtered-trial.md; this was not a production fix.

Zed/JetBrains permit custom command registration without registry admission. Their source/doc support is not installed Bruv UI acceptance. See registry-and-clients.md and multiagent-registry-peers.md. The older direct-agent-listing and own-adapter steps below are options, not mandatory first steps.

## Recommendation

ACP is a good boundary to explore. Start with Bruv owning its agents, local/SSH jobs, roles and worktrees, and T3 owning the frontend/root ACP session. Do not remove the bundle or promise parity until a small real Bruv ACP experiment passes. A docs-only web command comes after that, not before.

The decision is ownership, not just transport. Native T3 child-thread navigation/control does not follow automatically from Bruv tool output. If that UI is required, choose an explicit T3-owned delegation bridge instead and accept that profiles, cancellation, observation ACKs and placement need a new contract. Do not silently expose two interchangeable delegation owners.

## Verified findings

1. Latest stable v0.0.45 has no generic ACP registry registration. Published nightly v0.0.46-nightly.20261003.2623 (fed41fa) does. T3 is the ACP client; Bruv must become an ACP agent. Manual registration still resolves an official registry ID/distribution before accepting an executable override. Unregistered Bruv is not a supported arbitrary-command entry. Need a real registry listing or upstream custom registration support, not impersonating another agent.
2. Bruv currently has no ACP endpoint. The small adapter seam is a persistent Pi SDK AgentSession bound as RPC, with lifetime event subscription and owned session teardown. Not an LLM provider adapter. Existing local subagents/nested orchestration do not require bundled T3. A real SDK/extension/shell probe proved an idle root automatically wakes after completion; 60 focused existing tests passed.
3. That engine proof is not T3 compatibility. Exact nightly source has post-settle continuation machinery, but only the dedicated Grok flavor enables it; generic registry ACP does not. Returning an ACP v1 prompt response then emitting late work is not enough to establish a new owned T3 run with Stop/history. Keeping a prompt open or delaying delivery changes the experience. Draft v2 is a promising lifecycle, not a universal solved contract.
4. T3 normally supplies its MCP over stdio bridge or negotiated MCP-over-ACP, plus orchestration instructions. Injection does not prove the peer consumes it. Bruv exposes execute, not arbitrary discovered MCP tools, and its current native client understands patched bruv_* methods only. Upstream delegate_task/task_status/task_cancel are different contracts; task_status acknowledges terminal delivery. The current patch also supplies trusted lineage, profile/depth restrictions, replay identities, subtree cancellation and durable local-job notification handling.
5. Root injected credentials are thread/provider scoped, not transferable child identities. Existing Bruv scrubbing strips old T3_MCP_* names but not new T3_ACP_MCP_* names. This is a demonstrated sanitizer mismatch for the proposed seam, not an existing ACP production leak. Keep credentials host-only and mediate selected tools. A model-authored pending-request response must not become human approval for saved questions/capabilities.
6. Official ACP docs at 937d3146 mark v1 Latest and v2 Draft. Further v2 unstable child-session extensions are not baseline support. T3 initializing with2 does not by itself prove complete draft lifecycle behavior.

## Actual experience proof

Unmodified official nightly executable and a clearly labeled synthetic ACP agent passed actual browser acceptance in a clean follow-up: first completed response, next completed prompt, real Stop sending session/cancel, and browser reload retaining both responses and interrupted status. Read-only projections agree: completed, completed, interrupted. Parent inspected completed and reloaded screenshots. Evidence: .cache/acp-t3-clean-followup/RESULT.json and frames19–22. The first trial was inconclusive; the clean follow-up supersedes that narrow limitation. This is not real Bruv ACP or maintained-agent registration, and does not prove provider auth/model switching, tool approvals, backend restart or child behavior. Owned processes were stopped and temporary auth state removed. Raw caches contain private traces; do not publish wholesale.

## Choices for discussion

- **Bruv owns children (recommended first):** preserves Bruv behavior and independent-client goal. Show jobs honestly as tool/activity output initially. Native T3 child chat/tree controls are not promised. Solve registration, late lifecycle, Stop/reopen and saved decisions explicitly.
- **T3 owns children:** use an explicit bridge to upstream delegation; gain real app-owned child threads and T3 delivery. Rework Bruv profile/depth/SSH/workspace/observe/cancel semantics. This is deeper integration, even without bundling.
- **Both, only as explicit destinations:** possible later, with distinct controls and owners. Not the first experiment; ambiguous delegation and shared root authority are unsafe defaults.

## Small experiment before removal

After user chooses ownership: choose between improving/mediating the tested maintained pi-acp wrapper and a Bruv-owned compiled ACP entry, connect through an honest supported registration path, and run real root plus two children including one nested child. Validate visible output, idle late completion and concurrent user input, foreground/child/whole-work cancellation with actual process exit, reopen/resume with stable identities, injected MCP consumption/credential isolation, and saved human question recovery. Keep known gaps explicit. No full migration or release is part of this research approval.

External T3 setup needs its own versioned install/connection instructions. Existing ~/.bruv/web data is not assumed compatible with unmodified upstream; preserve it and prove migration separately. See packaging-and-web-command.md.

## Evidence

- [Upstream release, registration and real trial](t3-upstream-experience.md)
- [Bruv SDK seam, protocol and real late-wake probe](bruv-agent-feasibility.md)
- [Orchestration, MCP authority and contract differences](orchestration-mcp-boundary.md)
- [Packaging and old-state concerns](packaging-and-web-command.md)
- [Research ownership and paused work](research-checkpoint.md)

Values unchanged. These findings reinforce existing one-owner, actual-path proof and safe-resume values; the protocol-specific details belong here, not in a new general value.
