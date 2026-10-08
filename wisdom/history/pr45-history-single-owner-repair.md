# PR45 history: remove the spare authority

From the bounded R1/R2 REJECT in task_ce9abd2c’s quality-intent-review.md, at product `0d8066e4` plus ownership note `484dc0ef`. See [original-intent follow-up](../quality/pr45-original-intent-followup.md) and [structural guidance](../quality/structural-readability-guidance.md). Repair worker task_b0b6084b verified actual calls as `openai-codex/gpt-6.1-sol` in its native session record.

## Reading burden removed

- Context restoration previously offered two range engines: shipped `modelContextMetadata` and unused `selectDiskBackedEntries`, with separate compaction/index arithmetic. Repository search found only two assertion callers for the latter. Remove it; readers now follow the actual context owner. Keep shipped branch selectors, bounded cycle walks and compact metadata/parser optimizations.
- Append previously constructed metadata inside rollback, discarded it, then constructed it again while registering keys. The manager’s count-based catch implied the SDK had already advanced its leaf. Native `_appendEntry` does that, but the owned override bypasses it. Append now prepares once, commits write/first-publication, interns/registers the same record, then returns it for SDK metadata publication. Rebuild registers metadata from its byte parser through the same helper.

Write/metadata-construction/link failures still truncate to the original byte length before indexes change. Collision uses the same no-overwrite link. Successful publication still tolerates redundant-spool unlink failure. Index interning/task-key registration and byte-cache insertion remain outside rollback; no new recovery framework. The removed count catch could not repair pre-index exceptions there, and allocation failures are not a second commit model. No new retained payloads, copied branches or per-walk ID sets.

## Assertions and proof

Only necessary assertion migration: checkpoint-at-index-zero now checks actual `buildContextEntries` and projection provenance in both native and adapted scenarios. Gap/self-cycle/multi-node-cycle/forward-link fixtures check shipped context and projection while full branch selectors still assert every original node once. Plain auxiliary custom records remain deliberately absent from context; native SDK gap comparison, 100,000-row opacity/materialization budget, original-byte checks and existing I/O collision/rollback/cleanup/cache assertions are retained.

Inspected source and effects before checks. `git diff --check` passed. Bun transpiler parsed all four changed source/assertion files and the embedded SDK scenario without executing it. Direct `./node_modules/.bin/tsc --noEmit` failed only with eight missing generated `runtime-assets` JSON imports in the two CLI files; no prepare/install retry or bypass. Runtime assertions, resource budgets and integration remain unexecuted here: parent owns isolated validation and independent exact-byte quality judgment. No provider/config/SDK mutation or publication.

Values unchanged: existing values 2, 3 and 7 already cover actual-code judgment, single ownership and test-kept spare implementations. This note is local guidance for disk-backed append/context work, not a reason to delete independent reference models or necessary recovery on other ownership paths.
