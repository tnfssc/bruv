# Native integration registry injection diagnosis (2026-10-02)

> Historical worker checkpoint. Parent integration resolved the blockers below;
> see [final migration evidence](upstream-first-migration.md) for shipped-candidate
> hashes, acceptance results and current gaps.

## Scope and observation

Owned only shared source apps/server/src/orchestration-v2/NativeBruvIntegration.production.test.ts in /home/tnfssc/.bruv/worktrees/t3-upstream-first-4eb8a4a8. Source HEAD remained 66a91077f9abf6e171aad0ceab2519d7272f3ff3. Actual compiled parent binary /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_4eb8a4a8/dist/bruv SHA256 e527452572afd877bed74ae2be780582f9990f72e38fbdf5817ecca0a03095aa.

The 45s timeout is not model API incompatibility or startup silence. Actual Pi reached the model, received execute, and failed subagent launch with "T3 MCP transport failed" twice. Parent backing transcript and projection show those failures. The fixture awaited successRequestReached forever, masking the cause.

## Concrete parent-scope need

ProviderReplayHarness.ts declares options.mcpSessionRegistryLayer but ignores it. At line 339 ProviderSessionManager dependencies hardcode McpSessionRegistryTestkit.layer. That mock issues endpoint http://127.0.0.1/mcp (port 80) with a mock token, even though this native test passes the real registryLayer. Required change in that harness: replace McpSessionRegistryTestkit.layer with options.mcpSessionRegistryLayer ?? McpSessionRegistryTestkit.layer. No harness file was edited by this worker. No production bug has been demonstrated; this is a test-harness injection bug.

## Evidence and owned edit

Temporary diagnostic runs logged the parent projection, endpoint, and unauthenticated connectivity. Endpoint was http://127.0.0.1/mcp; fetch failed. Diagnostics then failed at a bounded temporary barrier (not a timeout increase). All temporary instrumentation was removed.

Evidence outside tracked trees: /home/tnfssc/.bruv/native-fixture-proof-f7bfa7ab/diagnosis.log and diagnosis2.log; retained tmp/t3-integrated-real-1jVjMy and tmp/t3-integrated-real-pVBDRC contain state.sqlite and actual parent JSONL. The first reproduced 45s timeout; the second failed diagnostic barrier after 8.29s. No passing gate claimed.

Only durable shared test edit: on failed assertions retain its temp fixture directory when T3_V2_NATIVE_TEMP exists (the gate owns/removes the outer directory normally) or standalone T3_V2_KEEP_TEMP=1. This fixes evidence loss under the gate's KEEP_TEMP opt-in without weakening assertions/security or changing the 45s timeout. Source patch export/commit remains parent's responsibility.

Next: parent fixes the harness injection, then rerun the native acceptance gate with exact source HEAD/binary SHA opt-ins and private durable TMPDIR. Recheck any newly exposed failure rather than assuming this diagnosis is the last one.

Values unchanged: existing truthful evidence, single-owner, and built-entry-point values cover the lesson. Feature wisdom records the specific harness wiring trap; no new general principle needed.
