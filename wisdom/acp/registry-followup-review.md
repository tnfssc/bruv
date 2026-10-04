# Registry peers and remaining ACP research

2026-10-03. User asked to finish missing research and look at registry agents/other clients with behavior like Bruv. Research is complete for this bounded pass. No product migration, release, external submission or paid-provider call was made. All owned runtimes were stopped. The prior release remains held.

## What changed

A new ACP implementation is not required just to try Bruv. The real published pi-acp0.0.34 adapter supports PI_ACP_PI_COMMAND and successfully wraps the existing compiled Bruv. We also registered that real adapter in official T3 nightly and saw actual Bruv execute output/file changes in the browser. This is honest use of pi-acp with a configured engine, not a borrowed Gemini identity or Bruv's own registry listing.

It is not ready to replace the bundle. The full chain lost an automatic late answer and a concurrent follow-up. A synthetic credential test also proved that T3's new injected variables reach Bruv shell children. The full T3 trial used an explicit research-only credential-filtering launcher; it is not an unchanged or production-safe path.

## Tested peers and clients

| Peer/path | Actual proof | Relevant limit |
| --- | --- | --- |
| pi-acp0.0.34 + Pi1.0.0 | Real published adapter/engine, local deterministic model: config, tools, reload/restart, cancel, extension permissions and optional real Pi subagent success/cancel | MCP descriptors stored but unused; post-prompt updates forwarded without a new run owner; user input during late run was silently dropped |
| pi-acp0.0.34 + compiled Bruv | Twelve ACP steps passed: execute/file write, early shell return, real automatic wake/output, model switch, ordinary cancel, root load after adapter restart | No native job mapping, generic execute name, no late running:true signal, no saved-question UI proof |
| Official T3 nightly + pi-acp + Bruv, filtered launch | Actual official pi-acp registry setup, visible/persisted execute/file diff and early-return answer; browser reload | Actual late Bruv answer absent from T3/history; concurrent input marked completed but never reached Bruv model; research-only credential filter required |
| Claude ACP0.85.1 + SDK0.3.286 | Real background Agent, plain versus negotiated child updates, injected HTTP MCP exposure in root/child, root cancel and load, with fake local model only | Holds root ACP turn until subagents drain; live cancelled child replayed completed under different ID; process/subtree exit not proven by state |
| Codex ACP2.1.1 + engine0.159.3 | Real initialize, version negotiation | session/new blocked on authentication; child/MCP/replay claims source-only |
| OpenCode1.18.34 | Release source for async subagents/nested depth and ACP lifecycle | Binary download timed out after150s; no runtime acceptance |
| Grok in T3 | Exact source comparison | Dedicated adapter enables continuation/agent-specific mappings; selecting registry Grok does not inherit them. No real Grok run here |
| Zed / JetBrains | Current source/docs: genuine custom command/args/env registration; Zed source external MCP/load/nested-thread infrastructure | No installed GUI/Bruv trial; nested/source infrastructure is not generic live child ownership proof |

All real-model behavior above is deterministic local model input, not paid-provider quality/auth acceptance. The adapter/engine/tools/processes were real where marked. See linked per-track notes for exact version hashes and commands.

## Full T3 composition result

On unchanged published T3 nightly fed41fa and unchanged pi-acp/Bruv, with only an explicitly labeled engine-launch filter:

1. Bruv execute wrote a file; browser showed the result and diff.
2. A real shell returned early with a job ID. T3 displayed the early answer and completed the root run.
3. The shell finished. Bruv generated and persisted its automatic follow-up answer. T3 did not display or persist that answer, even after reload.
4. A user follow-up submitted near completion was saved by T3 as a completed run, but never appeared in Bruv history/model requests and had no reply.

This composed trial did not independently isolate idle-late delivery from the concurrent-input collision. Separate generic T3 fixture and real pi-acp/Pi race tests support both observed failure modes. Do not claim one uniquely proved code branch from the combined screenshots alone. Parent inspected the execute and reloaded frames plus summary.

Sanitized retained proof: [filtered full-chain proof](proof/t3-bruv-filtered/README.md), [actual wrapper/engine proof](proof/bruv-through-pi-acp/README.md).

## Remaining T3 paths we did verify

The deeper unmodified T3 fixture run proved actual injected MCP initialize/list and a thread-scoped read-only call, approval/decline, form answer/Stop cancellation, agent crash recovery, real backend PID restart with native session load, and model config application. It was not merely browser refresh or advertised capability. These are host/fixture capabilities, not proof that pi-acp consumes MCP or that Bruv saved human questions map safely.

A v2-shaped initialization experiment kept the same run active after prompt acceptance and completed on idle. Its empty prompt response omitted official required messageId; parent corrected the report. It proves T3's normalized in-flight lifecycle behavior, NOT current draft-v2 conformance or a new spontaneous run after idle. Official v1 is Latest; v2 is Draft. Do not promise that sending numeric version2 fixes Bruv's late-run problem.

## How the registry works

The official registry is a reviewed set of versioned install/launch manifests, not a runtime broker or behavioral certification. Clients prepare/run the selected distribution; engine, adapter and client each retain their own behavior. All41 entries in the saved index passed official schema, but the runtime probes found material compatibility gaps.

T3 generic registration requires a real registry identity. For our own identity, publish a real ACP distribution, usable auth/setup flow, manifest and icon, then submit for review. For experiments, real pi-acp's supported engine override already works. Zed/JetBrains custom entries also avoid registry admission for direct adapter development. Do not publish Bruv under another agent's identity.

Registry release schema uses plain X.Y.Z, pinned distributions and license_url; install/build/auth checks do not prove multiagent lifecycle or reconnect parity. Exact process and source links: [registry and clients](registry-and-clients.md).

## Recommended direction

Keep Bruv as the owner of its jobs/children, profiles, SSH placement and durable state. Use ACP as the external frontend boundary. The tests support this direction, but not removing bundled T3 yet.

Two honest lifecycle choices:

- **Keep the root turn open until child work drains.** Claude shows a working maintained pattern. This changes Bruv's early-return/idle behavior; do not introduce it silently.
- **Preserve early return plus automatic late wake.** Preferred if keeping current Bruv behavior matters. Fix adapter input ownership and work with T3's generic continuation/run lifecycle. Simply forwarding late text is proven insufficient.

For implementation, choose improvements to the maintained adapter or a thin Bruv-owned SDK adapter. Existing pi-acp is good prototype material, not a safe unchanged product dependency. Required work includes credential isolation, explicit MCP handling, truthful execute/job projection, late-run/concurrent-input ownership, Stop semantics and durable human-question handling. Do not offer Bruv and T3 delegation as interchangeable default tools.

Native T3 child navigation is a separate requirement. Negotiated Claude child sessions demonstrate such UI can exist with cooperating clients, not that generic T3 supports it today. If required, agree an upstream extension or choose an explicit T3-owned delegation bridge, with profile/placement/ACK/cancel semantics consciously remapped.

Only after the selected behavior passes real Bruv/client checks should we remove packaging/patches and make bruv web print connection docs. Preserve existing web data and prove migration separately. No existing user history was moved here.

## Still unproved

Paid authentication/provider runs; Codex session execution; OpenCode runtime; installed Zed/JetBrains interaction; arbitrary nested Bruv child graph in an ACP UI; persistent human questions through reconnect; active-work restart recovery; complete draft-v2 message identity/child semantics; real Grok path. These are explicit scope/prerequisite gaps, not blanket access claims or reasons to erase useful results. No production changes were made to enable them.

## Read next

- [Published pi-acp peer](pi-acp-peer.md)
- [Bruv through pi-acp](bruv-through-pi-acp.md)
- [Claude/Codex/OpenCode peers](multiagent-registry-peers.md)
- [T3 deep probes](t3-deep-probes.md)
- [Filtered full T3/Bruv composition](t3-bruv-filtered-trial.md)
- [Registry and independent clients](registry-and-clients.md)
- [First direction review](direction-review.md), [paused work and owners](research-checkpoint.md)

Wisdom added and initial recommendations corrected by actual runtime evidence. Values unchanged: one owner, real-path proof, safe recovery and honest boundaries already cover the lessons. Registry-specific details and reproduced adapter bugs belong with this feature research.
