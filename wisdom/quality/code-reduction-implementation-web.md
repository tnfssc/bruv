# Feature-preserving web cleanup (2026-10-02)

## Source and ownership

Implemented web-01–05 and worthwhile web-patch1/2/3 proposals; web-06 is retained, not a dead-code deletion. Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_349462fa. Owned upstream checkout: .cache/t3-source, HEAD 66a91077f9abf6e171aad0ceab2519d7272f3ff3. It was fetched at that exact revision, patched, and frozen-installed here; no parent source/dependencies were used. Canonical integrations/t3/upstream/bruv.patch is regenerated and source-verified. Logs and exact source-file list are retained under this worktree's .cache/.

## Done

- Derive new native/SSH intent IDs without sidecar writes, fsync, eviction or per-path serializers. Keep the bounded, strict legacy reader and old pending IDs (including die-v1). ACK does not erase old crash-replay identity. Concurrent, reopen, post-ACK, bound and same-intent tests retain identity assertions. JobService's outside-scope ACK caller still works via a validated no-op.
- One small OpenAI SSE encoder and execute delta builder for five acceptance fixtures. Routers, IDs/models/timestamps, response headers and timing remain local. Native production fixture separately shares its three fixed responses; delayed partial success streaming stays unchanged.
- Share the browser/worktree /proc identity/tree and detached-group teardown primitives; retain caller-owned discovery, proof assertions and five/six-second grace periods. No global PID scanning or new kill authority.
- Table-drive all six auth activation cases and both startup URL cases. Keep Origin/Host/fetch-site negatives and the no-auth pairing call that dies if invoked.
- One Effect-native delegation walk, called by the actual credential issuer and scoped policy tests. Keep loader error/environment/interruption, fail-closed logging, terminal/disposed fences and exact credential capability/profile/depth equality. Tests cover trusted roots, forged/foreign edges, nearest profile, depth, cycles, wrong relationship, loader failure and interruption.
- Narrow shared request-context Effect, static tool options, conservative owned-task predicate and scoped default service-test construction. Preserve custom worktree preparation/restart fixtures. Correct exact launch-schema assertions to include existing title/workspace fields.
- Merge all five local notification scenarios into DelegatedCompletionDelivery.test.ts's actual fixture. Keep a real WorkspacePaths + provideMerge(PlatformTestLayer) local variant; ordinary delivery retains its mock. Original two suites: 9 tests; merged suite: same 9 tests and scenario names. Scoped temp cleanup, durable receipts, concurrent queue ordinals and stale-attention checks remain.
- Remove only audited dead imports/PTY fake plumbing, unconsumed re-export and __testing object, self-exec utilities and boolean wrapper, unused shell-task field, redundant requestKey/branch assertions and transport/outbox branches. Actual bootstrap marker sanitation, PTY buffering, cancellation and notification persistence stay.

## Integration edits / unresolved boundaries

Required tooling-owner edit: scripts/ci-web-validation.sh, backend file selection: replace src/orchestration-v2/LocalJobNotification.test.ts with src/orchestration-v2/DelegatedCompletionDelivery.test.ts. The former source file is now deleted; the merged selection must remain mandatory. No scripts were edited here.

Optional runtime-owner follow-up: src/tasks/job-service.ts can remove #acknowledgeLaunch, its two native/SSH call sites and the three ACK-only imports. Then remove the validated no-op ledger acknowledge method and direct no-op calls in routing tests. Do not delete the legacy reader or mappings.

Keep the unused delegatedTaskMutationPermit in Orchestrator.ts (allocation near line 684). It promises cancellation/creation protection but has no consumer. This is an unresolved correctness boundary, not permission to remove protection or invent a locking fix.

No features/archives/diagnostics retired. No paid provider, release, hardware, full build or CI run. Packaged native/browser/worktree/RPC acceptance still needs the parent's combined reviewed binary. Compiled launcher cases could not run here because dist/bruv is absent; their assertions remain intact.

## Checks and reproducibility

Use Bun 1.4.2, Node 24.21.0 and pnpm 11.27.1 host tools from ~/.local/share/mise/installs/*/bin; pnpm selects pinned upstream 11.10.0. Include Bun on PATH for native PTY tests. Use SHELL=/bin/bash for root local-shell assertions: this worktree's untrusted mise config otherwise injects shell startup errors.

- Root bun test tests/t3/native-routing.test.ts tests/t3/local-notifications.test.ts tests/t3/web-fixtures.test.ts: 27 passed. production-bridge.test.ts: 19 passed.
- web-launcher.test.ts filtered to noncompiled settings/argument cases: 13 passed, 2 filtered. web-launcher-process.test.ts repeated-clean-backend case: 1 passed, 2 compiled cases filtered. Initial unfiltered attempts recorded missing dist/bruv, not a launcher regression.
- Patched apps/server pnpm test: BruvWebAuth, BruvDelegationPolicy, BruvTaskService, orchestrator/tools, DelegatedCompletionDelivery, ProviderSessionManager, serverRuntimeStartup, BunPtyAdapter, NodePtyAdapter and Adapters/PiAdapterV2: 164 passed across 10 files. Final scoped policy conversion separately: 5 passed. Shared hostProcess detector: 1 passed on its actual defaultValue, including absent builtin and false/true SEA; mocks restored. Context.Reference execution caches defaults, so repeatedly running the reference is not a detector test.
- Additional MCP/service/worktree-registration/EnvironmentAuth selection: 31 passed, 1 failed. Exact original patched runtime reproduces the same integration failure: OrchestratorMcpToolkit cross-provider task_cancel expects cancelled, gets interrupted (line 1825). Not weakened or speculatively fixed.
- Root tsc --noEmit after prepare-assets: passed. Patched server/shared typechecks: passed (final result in typecheck-final.log).
- Root Biome format/lint: completed, existing warnings/infos. Modified-source vp fmt: passed. Source vp lint: same 16 namespace-node-imports errors as the exact original patched files; no new lint errors after scoped test conversion. Initial missing lint-plugin closure was frozen-installed here, not bypassed.
- regenerate-patch + verifyWebSource: passed at exact pinned HEAD; git diff --check passed. .cache/original-source.index and source-reduction-numstat.txt permit source-level comparison without counting patch representation twice.

Net code: tracked Git diff +686/-990 (-304 lines), excluding this note. Counting actual patched source rather than its textual patch representation: -200 upstream source lines plus -115 root/helper/test lines = -315 maintained lines. New policy/fixture assertions are charged, not claimed as removals.

Values unchanged: replay identity, single ownership, bounded persistence, truthful proof and leaving owned work recoverable already cover these changes; parent owns values integration.
