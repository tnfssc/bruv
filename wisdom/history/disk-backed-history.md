# Disk-backed original session history

Before making session, Die CLI installs own adapter for pinned Pi 0.99.1 SessionManager. Original JSONL stays source of truth. SDK can still read it. Compaction does **not** delete originals or swap in summaries. Reopen keeps IDs, branches, labels, compaction details, and history refs.

## Memory contract

- Each persistent manager keeps at most **4 MiB of serialized body-cache buffers**. Cache does not keep parsed old entry objects. Oversized entries skip it.
- Resident offset/tree index grows with entry count. IDs, timestamps, model settings, labels, titles and session header also use memory. Total metadata space is not constant.
- Normal context build uses metadata to pick compaction window. Then it loads only those bodies. Original-history read walks metadata. It loads chosen messages/shake records bit by bit.
- Load scans JSONL in chunks. Work grows with file size. Temporary parse still needs room for largest one record.
- Native `getEntries()`, `getBranch()` and `getTree()` stay full normal-array/tree APIs. Returned objects belong to callers. Explicit exports, native SDK compaction hooks, and callers that keep arrays can load whole history. Live model context is outside cache budget too. **This does not promise flat process RSS or peak heap.**
- Explicit SDK `SessionManager.inMemory()` stays in memory. Direct SDK users and source utilities want persistent bounded cache? They must install adapter. Import alone does not change SDK.

## Persistence and compatibility

New sessions keep Pi's delayed visibility. Before the first user or assistant message, originals go to private pending spool in same directory. First-user-or-assistant publication creates advertised path without overwriting an existing file. Reset/switch and normal process exit remove owned pending spools. Abrupt stop can leave pending spool. It is not recovered session. Pi 0.99.1 publishes at the first user message so interrupted first turns remain discoverable; setup-only sessions still stay hidden. See [upgrade evidence](../dependencies/pi-0.99.1-sol-upgrade.md).

Appends are synchronous. They retry short writes. Failed partial append rolls back new bytes. Rewrites/migrations write temporary journal, then atomically replace destination. Failure keeps prior file. SDK parity tests cover Version 1/2 migration, branch copies, forks, reload, labels and context settings. Rewrite keeps existing symlink aliases. Existing entries are read-only API values. Mutating object does not persist it.

No lossy sidecar. No required new session format. Load rebuilds offset index from original journal. Cache-affine compaction rebuilds it too after external rewrite and `setSessionFile()`.

Supported mode has one writer on local POSIX filesystem with hard links and atomic rename. It does not coordinate concurrent writers, independently rewritten/open hard-linked aliases, or external replacement without explicit reload. Normal appends keep Pi's synchronous, non-fsync durability semantics. No database-style power-loss transaction promise. No automatic history expiry or disk quota. User still must manage disk capacity.

Project owns integration in `src/history/session-manager.ts` and `disk-entry-store.ts`. The history adapter does not patch installed dependencies. A separate guarded host adaptation now fixes native resume scans: [resume scan abort](resume-scan-abort.md). Build/check setup verifies pinned SDK version and original or exact host-adapted SessionManager source hash. SDK upgrade needs direct adapter review. Private SDK entrypoints and private-field changes are not supported public APIs.

## Validation

Reproduce isolated probes without using a provider or existing user sessions:

```sh
bun scripts/history-storage-probe.ts
bun scripts/history-sdk-probe.ts
bun test --preload ./scripts/history-storage-preload.ts tests/history*.test.ts
```

First compares native/adapted managers with 136 MiB originals and 17 compactions. It checks original SHA-256 after reopen. It measures append/reset/resume. Second completes 16 real `AgentSession.compact()` calls through offline extension hook with 128 MiB original messages. This is real SDK lifecycle soak. It does not test provider-summary quality.

On measured Linux/Bun run, reopened retained heap was about **136 MiB lower** than native. Real SDK soak kept about **18–23 MiB JSC heap** across 128 MiB originals and two compacted context messages. Reset/resume returned to about 19 MiB. Full-array SDK compaction caused large temporary/allocator RSS around 0.9 GiB. It later reclaimed much of that. Measures support bounded old-history cache residency. They do not show bounded total app RSS. Exact final commands/results: `wisdom/resources/resource-fixes-history.md`.

## Existing native task journals: metadata reopen (2026-10-07)

The captured original was 11,884,666,735 bytes with 634,329 valid rows, dominated by repeated native task cursor snapshots. This was not just a task-binding writer problem: original reopen tripped the unchanged 512 MiB RSS watchdog before indexing completed (549.9 MiB, 16.4 s).

The resident index needs IDs, parent links, timestamps, physical offsets/lengths and small type-specific settings, not custom payloads or message content. Reopen validates/skips JSON directly from bytes and decodes only indexed fields. It does not build discarded snapshot graphs or a full JS string per row. JSONL line assembly reuses a growing buffer. Selected tokens are decoded from their own byte views. String-copy-only and full-row-string selective scans still exceeded the captured budget during investigation: a bounded serialized cache does not bound scanner allocations.

Custom rows share type vocabulary and canonical parent ID strings. Canonical ISO timestamps are stored as milliseconds and reconstructed exactly on access; noncanonical timestamps retain their original spelling. SDK internal maps/metadata share the owner index instead of duplicating it. Native reset/branch methods mutate maps in place, so they detach the SDK map first; failure recovery must keep the previous owner intact.

No journal format change, sidecar, history deletion, expiry or lossy cleanup was introduced. Original retrieval still parses original indexed bytes. Skipped JSON grammar is validated, including deep nesting, escapes, numeric syntax and duplicate-property last-value semantics. Malformed rows keep the loader ignore behavior. Migration/rewrite/publication behavior remains.

Retrieval walks auxiliary links but counts/loads only message records and manual-shake exclusion records. More than 100,000 old task checkpoints must not crowd conversation messages out of search or materialize snapshot bodies. Actual candidate, exclusion, text-byte and part limits remain. Search refs and cursor leaf IDs stay pinned to the original branch, including auxiliary cursor leaves.

Task-binding API: `getLatestDiskBackedCustomEntry(manager, customType, accept = () => true)` in `src/history/session-manager.ts`. Active branch, newest-first; materializes only matching custom types and stops at the first accepted record. Returns custom entry, `null` for no match, `undefined` for an unowned manager (use native fallback). It never selects an inactive sibling checkpoint.

Guarded local capture `artifacts/resource-harness/captured-3esH9I/report.json` indexed all 634,329 rows at 443.0 MiB RSS / 89.4 MiB reported heap in 40.35 s, source bytes unchanged. Standalone replay then failed at 548.3 MiB while the **old task-binding restore** materialized history; cursor restore did not complete. Another worker owns that integration. Parent must run the combined commit through the unchanged watchdog; no end-to-end pass is claimed here. Captures/reports remain private local evidence, not committed.

Focused tests cover >100,000 auxiliary rows, targeted latest custom selection, inactive branches, preserved originals/search refs, live shake exclusions, shared-map failure recovery, exact timestamp access, JSON grammar and SDK lifecycle parity. Values stayed unchanged: measured-resource and safe-recovery values already describe the lesson. See [resource harness](../resources/task-history-resource-harness.md).

Validation: 40 direct history tests across 11 files passed, including native/adapted SDK lifecycle parity and failed-reset/branch recovery. TypeScript passed. Focused Biome passed with existing adapter warnings and no errors; diff whitespace check passed. No task-binding or harness-cap edits. Full application/resource gate awaits parent integration.
