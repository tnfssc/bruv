# Shipped production → official T3 migration acceptance

Use this note when changing the independent migration gate, not as a substitute
for source, packaging, browser, or release gates. Read
[the migration checkpoint](upstream-first-migration-checkpoint.md) for ownership
and user authorization.

## Immutable input and dynamic destination

The shipped starting point is T3
`b488c57f3f9f1688e31c53daee99e29dd1d0baa2` plus Bruv's canonical patch at
`92f1f2bc543ef148a5d254c20c95e6ba8b9aa4be:integrations/t3/upstream/bruv.patch`.
The previous gate started at `a9b49a7`, which tested an older upgrade path.
The destination still comes from `integrations/t3/upstream/source.json`; do not
freeze it in the gate independently of the parent's pin.

The gate computes the production checksum directly from that historical Git
blob, even when an explicit production patch is supplied. Do not use the new
patch as the production patch or manually change a checksum to make an input
pass. Both source trees must equal HEAD plus their canonical patches, with
installed dependencies matching their lockfiles. Preparation is separate;
the gate never installs dependencies.

Use disposable/durable owned checkouts for the fixture runners. The harness
copies temporary TypeScript runners into each checkout and removes them after
completion. Never point it at a production reference checkout or an upstream
worker's checkout while that worker owns it. The reference at
`/home/tnfssc/Code/bruv/.cache/die-t3code-b488c57f3f9f1688e31c53daee99e29dd1d0baa2`
is read-only for this task.

## Official API/schema transition

At official T3 `66a91077f9abf6e171aad0ceab2519d7272f3ff3`, the former
`54:OrchestrationV2` ledger entry is moved to `55:OrchestrationV2`;
`54:ProjectionThreadsAutoSettleDisabledAt` is inserted and
`56:RemoveRedundantProjectionIndexes` runs. The production fixture asserts its
old V2 ledger name. Both destination processes assert all four ledger entries
from 53 through 56, not just a numeric maximum. Restart compares the ledger in
the semantic snapshot too. This path now exercises a numbered schema migration,
unlike the previous 54 → 54 gate.

Keep the native graph, 13 events, full normalized token/cost report, provider
session/thread/turn references, completed acknowledged native task, settings
schema/byte hash, visible history/order, and fresh-process restart assertions.
The gate seeds synthetic data through actual shipped production APIs; it does
not read anyone's live database and is not proof about every possible user DB.

Pristine official source has no `NativeUsageAccounting.ts`, while the existing
fixture exercises Bruv's `nativeThreadUsageReport` product API. Preserve that
assertion against the canonical prepared integration. A missing usage API is a
product integration incompatibility, not permission to compute an equivalent
report inside the fixture, skip the assertion, or add an optional import.
The official projection/persistence read APIs used by this fixture remain
available; their changed migration ledger is asserted explicitly.

## Validation and parent handoff

Focused regression tests:
`bun test tests/t3-migration-acceptance.test.ts`. They use unrelated temporary
repositories and prove tampered patch overrides and wrong production HEADs fail
before any fixture is copied, without touching either source owner's checkout.

After the source owner finishes and the parent merges the new pin and canonical
patch, run:

`TMPDIR=/var/tmp T3_V2_MIGRATION_PRODUCTION=<owned-b488-checkout> T3_V2_MIGRATION_PREVIEW=<canonical-prepared-source> bun integrations/t3/gates/migration-acceptance.ts`

A passing preflight test or production-only fixture is not a passing migration
gate. Require production seed → destination upgrade → destination restart on
the final canonical source. Do not hide new API incompatibility behind guards.

Independent handoff validation: the two focused tests passed. The production-only
fixture passed on an owned clone under `.cache/migration-acceptance/production`
with the historical canonical patch and a fresh frozen-lockfile, ignore-scripts
install. It produced 13 events at `54:OrchestrationV2`. After removing its runner,
source verification and installed-lockfile byte equality also passed. The full
upgrade/restart gate was deliberately not run while the upstream source owner
was still working. These results are not destination acceptance.

Values unchanged: existing values already require canonical inputs, honest
validation limits, fewer owned parts, and preserving essential data safety.

## Parent fixture reconciliation

The source migration retires custom NativeUsageAccounting and its own/subtree display. The preview fixture now uses the official projection provider-turn usage contract instead of importing the deleted presentation helper. Exact input, cached input, cache creation, output, reasoning, usage scope/completeness, subagent marker and total USD assertions remain unchanged. Restart snapshots now retain each provider turn ID and its complete normalized usage object verbatim. This removes a dependency on intentionally retired aggregation behavior, not a persisted-data assertion. Final actual upgrade/restart proof is still required.

## Exact-dependency gate reconciliation

A fresh frozen pnpm install passed, but pnpm prunes unshipped graph entries from node_modules/.pnpm/lock.yaml while keeping the upstream lock unchanged. The old byte-comparison guard therefore rejected legitimate scoped installs. The gate now compares all metadata/importer bindings exactly, every installed package/snapshot against its pinned entry, and traverses the entire server dependency closure (including workspace links, aliases, dev and optional edges) to reject missing required records. This is a provenance-preserving check, not a copied lockfile or skipped guard. Four regression tests cover source/patch rejection, allowed unrelated pruning, changed integrity/importer pins and missing required graph entries. The gate remains read-only and never installs.

Official SQL rows have null prototypes. The migration ledger now maps explicit numeric id/name fields before strict semantic comparison; exact ledger names/numbers are still asserted.
