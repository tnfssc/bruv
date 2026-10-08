# Disk/footer main-thread performance

Completed-run captures/logs mentioned below are now historical Git evidence;
[recovery and retained inputs](../quality/completed-run-retirement.md). Conclusions remain here.

## Ownership and decision

Baseline: 9814f356345c450188306de2a7d5b20582c57be0, Pi 1.0.3, Bun 1.4.2, Linux x64 / Ryzen 9 7940HS. This work owns src/history/disk-entry-store.ts, src/history/session-manager.ts, src/tasks/session-costs.ts and dedicated tests. Only disk-entry-store production code changed. No SDK patches, selector/lifecycle modules, shared fixtures/harness/audit probes, existing notes or values changed. Read [values](../values.md) and [stall audit](terminal-stall-surface-audit.md). Values unchanged: existing measurement, complete-content and pickup guidance already covers this work.

**Minimal useful fix:** native Buffer.indexOf newline search replaces the JS byte loop; complete records are decoded once instead of twice; the final read-buffer fragment is borrowed only while synchronously consumed, while unfinished tails remain copied before buffer reuse. Full JSON parsing remains. No new cache, parser or async facade. Physical offsets/lengths, valid-index numbering, blank/CRLF/malformed/falsy handling, valid unterminated records, append repair, bounded byte cache and persistence transactions remain unchanged.

**Remaining measured blocker:** synchronous full-history materialization and footer usage-only scanning still parse huge content. This patch does NOT meet an all-actions <8 ms goal. Awaited reads do not make their following full-record parse nonblocking.

## Matched clean evidence

Raw evidence: [evidence/disk-footer (historical)](../quality/completed-run-retirement.md#recovery). before-journal.json / after-journal.json and before-cost.json / after-cost.json are from the **unchanged committed provider-free audit probes**. summary.json validates all journal work fingerprints, including full normalized content hashes and serialized materialization bytes. Source hashes are in raw files. Runs were serial on a shared host, with no long concurrent matrix or timing gates. Times are synchronous entry-to-return intervals including possible GC, preemption and synchronous filesystem latency, not pure CPU.

Three messages, two short users + one large tool result (not long history):

| Synchronous operation | Payload | Before ms | After ms |
| --- | --- | --- | --- |
| real saved-file open/index scan | 2 MiB | 14.830 | 5.196 |
| real saved-file open/index scan | 8 MiB | 32.126 | 13.969 |
| getBranch, five calls | 8 MiB | 28.599, 19.978, 15.131, 16.205, 13.410 | 23.466, 16.955, 17.564, 7.689, 17.760 |
| buildSessionProjection, five calls | 8 MiB | 26.084, 23.324, 19.807, 9.068, 20.691 | 11.607, 12.704, 18.219, 13.120, 8.755 |
| reopened getBranch | 8 MiB | 10.659 | 8.436 |

Only index scan changed. Branch/projection variation is **not** evidence of a materialization speedup. Each 8 MiB branch/projection still materializes three complete messages / 8,522,341 serialized bytes. Largest uninterrupted owned journal segment in the clean pair: before 32.126 ms open; after **23.466 ms getBranch**. The separately sampled after run reached **25.227 ms buildSessionProjection**; do not hide that with the clean-run number. Sampled open was 6.323 / 18.614 ms at 2 / 8 MiB (before sampled: 9.374 / 24.061). Complete opened, branch and projected role/content hashes match. Audit stop measurements remain in raw outputs but are not attributed to this disk patch.

Footer probe, one parent + one marked child with no usage on its huge tool result:

| Payload | Before max consume ms, three refreshes | After max consume ms, three refreshes | After whole refresh elapsed ms |
| --- | --- | --- | --- |
| 2 MiB | 3.747, 2.294, 1.566 | 4.566, 2.464, 1.464 | 7.643, 3.743, 6.035 |
| 8 MiB | 6.926, 9.138, 9.322 | 6.527, 10.186, 9.154 | 10.532, 14.224, 17.927 |

Maxima time individual synchronous consume callbacks after awaited reads; all callbacks remain in raw files. At 8 MiB: 129 callbacks / 8,389,555 bytes, accurate zero total, no pending bytes. Whole refresh elapsed includes disk waits, metadata/discovery and uninstrumented work: **never subtract it to infer CPU**. Cost code unchanged; no footer speedup claimed. Largest observed after final-record continuation is **10.186 ms**, despite 64 KiB read chunks.

## Exact parsing and byte-cache attribution

New standalone tests/history-disk-footer.probe.ts is outside the shared audit directory. before-attribution.json / after-attribution.json retain each decode/parse/materialization/cache hit, full content byte/hash, and each cost continuation. This is a labeled separate four-entry fixture (bruv-agent marker + three messages), with plain repeated ASCII rather than the audit journal's escaped newline rows. Timings include wrapper overhead; nested parse/decode/materialize spans **are not additive** with their parents.

- Open 8 MiB: before 25.252 ms with **two** decodes of the 8,388,844-byte tool record (3.256 + 3.517 ms) and one complete parse (4.991 ms); after 12.356 ms with **one** decode (2.981 ms) and one complete parse (3.613 ms). Scan reduction is independently supported by code/raw sampling, not a subtraction claiming CPU attribution.
- 2 MiB records fit the existing 4 MiB byte budget: repeated calls hit, but still decode/parse the **whole** 2,097,388-char record each call. First reopened materialization misses; next hits; both return exact complete text.
- 8 MiB exceeds that budget: each huge materialization misses, reads, decodes and parses all 8,388,844 chars. Short records hit. A larger byte budget does not eliminate parsing; a parsed-object cache would need to preserve fresh mutable results. No speculative cache added.
- Usage-only cost callback still makes one complete 8,388,844-char parse despite no usage. Instrumented after callback: 5.188 ms, decode 3.632 ms, parse 0.764 ms; whole awaited refresh 15.527 ms. This quieter sample does not negate clean callbacks >8 ms. Skipping by substring/regex is not safe: usage can occur on assistant/toolResult, compaction, branch_summary or bruv-compaction-attempt, and IDs from *noncost* entries participate in deduplication too. Malformed complete records must still be ignored.

Raw Bun .cpuprofile files and separate run outputs are in before-profile/after-profile and *-profile-journal.json. summary.json retains ancestor-filtered disk-store sample counts/stacks. Stacks include segment → getBranch/buildSessionProjection → materialize → JSON.parse/toString and open → rescan → scanJsonl → consume → JSON.parse. Whole profiles include setup, hashing and terminal stop; whole-run totals are not disk/stop CPU. Sparse sampling supplies attribution, not per-action timings.

## Correctness and acceptance

New dedicated tests verify scan-buffer-boundary newline/Unicode/escaped content, CRLF, blank/malformed/falsy records, exact physical slices and incomplete tail; multi-MiB saved content through real SessionManager.open/continueRecent, branch, createBranchedSession, forkFrom, exact disk records and returned-object mutation isolation; huge usage records split inside UTF-8/incremental reads, delayed newline, accurate totals, malformed cost-like text, noncost IDs followed by costly duplicates, compaction/branch/attempt usage and repeated refresh.

Focused existing tests cover short writes, partial-append rollback, publication/retry/collision, atomic replacement, spool cleanup, symlink aliases, migrations/lifecycle, projection parity, compaction originals and history retrieval. No durability relaxation or history truncation.

Reinstall completed without dependency changes; **prepare:assets ran after reinstall and before TypeScript**. Full TypeScript passed (typescript.txt is empty success output). Initial focused run: **27 backend tests pass**. Its first compiled-footer test failed because dist/bruv was not built (empty tmux frame); retained in tests.txt. Then bun run build passed, and compiled tmux footer acceptance **passed**, verifying nested totals, idle refresh, status display and quit/reopen persistence (build.txt / footer-acceptance.txt). Final combined rerun: **28 tests pass, zero failures, 127 assertions across 11 files** (final-tests.txt), with TypeScript passing again. One shell command was rejected by fish's assignment syntax before executing; rerun used Bash. Existing mise trust warnings did not prevent commands; no trust permission changed. No broad suite or live-provider acceptance claimed.

## Reproduction and worktree pickup

From repository root; do not run prototype-installing probes inside a live app:

    bun install
    bun run prepare:assets
    bun scripts/terminal-perf/audit-probes/journal-stop.ts /tmp/disk-journal.json
    bun scripts/terminal-perf/audit-probes/disk-callbacks.ts /tmp/disk-cost.json
    bun tests/history-disk-footer.probe.ts /tmp/disk-attribution.json
    bun --cpu-prof --cpu-prof-dir /tmp/disk-profile scripts/terminal-perf/audit-probes/journal-stop.ts /tmp/disk-profile-run.json
    bunx tsc --noEmit --pretty false
    bun test tests/history-disk-footer.test.ts tests/history-storage.test.ts tests/history-storage-io.test.ts tests/history-storage-lifecycle.test.ts tests/history-storage-cleanup.test.ts tests/history-publication-collision.test.ts tests/history-projection-parity.test.ts tests/history-disk-retrieval.test.ts tests/history-sdk-099.test.ts tests/session-costs.test.ts
    bun run build
    bun test tests/session-costs-tui.test.ts

Baseline source is the parent commit above. Attribution baseline temporarily restored only disk-entry-store to exact committed content, ran serially, and restored the changed source in a finally block. All other production hashes stayed fixed. One clean pair, one sampled pair, one small instrumented pair: not a universal performance guarantee.

Pickup worktree: /home/tnfssc/.bruv/worktrees/t3code-bbf9268f-5442693331ce-task_47626147. Cherry-pick the isolated commit reported at handoff; tests/evidence travel with it. No PR/push. Remaining work: decide whether usage-only scanning warrants complete correctness-preserving projection/validation or genuine off-main-thread work; do not hide heavy sync parsing behind await. Synchronous SDK history APIs still demand complete content. Coordinate API/lifecycle redesign with the separate SDK/selector owner; no overlapping SDK edits here. Huge-content app frames/submission latency are not established by disk leaf timings or backend full-content acceptance.
