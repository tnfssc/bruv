# Terminal optimization layer — stacked pickup

## Source and scope

- Verified combined source: `134f7bcd` on `t3code/terminal-ui-frame-performance`; extracted against `origin/develop = 2683847d`, not by replacing its tree with the old source tree.
- Branch: `perf/terminal-render-optimizations`. Worktree: `/home/tnfssc/.bruv/worktrees/t3code-bbf9268f-5442693331ce-task_eb5bf53c`.
- Production fixes: lazy collapsed activity/task bodies, frame-local ScrollView render reuse, painted anchor geometry, fresh task-row adoption, paste preprocessing, large-text block tokenization and ANSI/grapheme utilities, selector projection/count bookkeeping, journal chunk decoding, expanded execute-row clipping, and repeated-row stop restoration.
- Includes pinned SDK patches, the matching session-manager host-adaptation digest pair, production regressions/compiled acceptance, and focused feature notes/evidence. Existing prepare-assets behavior is sufficient; it is not changed.
- Preserves upstream release/live/CI changes and the Pi TUI focus-report forwarding hunk. Upstream already has the production package/lockfile patch registration, so neither file needs a delta. No benchmark commands, harness implementation/tests/guides, README edits, or values changes are copied.
- **Second-layer ownership exception:** `scripts/terminal-perf/selector-lifecycle.test.ts` and `selector-lifecycle-behavior.ts` are SDK production regression coverage. Keep both out of PR 1 and include them in PR 2. The historical selector timing probe is not extracted: it depends on the first-layer navigation harness. Feature-note harness links/commands are intended for the final stacked checkout.

## Fresh setup and checks

Logs and machine-readable results: [evidence/stacked-optimization-extraction](evidence/stacked-optimization-extraction/).

1. Removed only this worktree's node_modules; `bun install --frozen-lockfile`, `bun run prepare:assets`, `bun run check` passed.
2. Also proved pristine setup with `bun install --frozen-lockfile --backend=copyfile --cache-dir=artifacts/terminal-optimization-extraction/dependency-cache` after removing this worktree's node_modules, followed by prepare:assets and check: passed.
3. Focused production tests: **152 pass / 72,050 assertions / 15 files** (editor, rolling activity, task rows, execute rendering, scroll layout, Markdown/text utilities, stop restore, disk footer/history, selector lifecycle). The initial command also contained a nonexistent pi-host-adaptation.test.ts argument; Bun ran the 15 real files. Actual host coverage is the separate pi-host.test.ts run below.
4. `bun run build` passed. Host/history/cost/cancellation tests: **33 pass / 182 assertions / 5 files**. Initial pre-build run had two ENOENT failures because dist/bruv did not yet exist; both passed after build. That failed log is retained, not hidden.
5. Compiled PTY acceptance: **4 pass / 1,114 assertions** — execution-previews-tui, long-thread-tui, sdk-large-text-tui, session-costs-tui. Covers narrow/details/error output, full saved thread navigation/resize/input, complete rich megabyte content, regular-screen details and footer restore.
6. `git diff --check` passed. Bun 1.4.2, Linux x64. Shell emitted a mise-untrusted warning, but commands ran successfully.

The reported first-layer setup blocker is a strict session-manager fingerprint mismatch, not grounds to loosen adapters. This production patch adds typed count support to that SDK file: pristine digest `9d01f720…45f27a`, prepared digest `344b8310…75202` (full digests in evidence). Only this matching pair changes; unrelated host seams remain untouched. The default-cache fresh reinstall returned already-adapted bytes, while the isolated-cache copyfile reinstall returned the pristine digest and verified the adaptation transition. A warm/shared hardlink cache is not proof of pristine registry bytes. For PR 1, retain its baseline patch/adaptation pair and use isolated-copy setup if needed; do not borrow PR 2's digests alone. No sibling/main dependency tree was modified.

## Performance evidence and limits

These are **historical matched source measurements**, not newly rerun timings:

- [Frame-local scroll reuse](scroll-content-frame-cache.md): 1,000-execute input p50 **18.008 → 9.270 ms**, document renders **2 → 1**, all 738 cold/steady fingerprint pairs match. Still exceeds 8 ms.
- [Journal scan](disk-footer-main-thread-performance.md): saved-file open/index **14.830 → 5.196 ms** at 2 MiB and **32.126 → 13.969 ms** at 8 MiB. Full body materialization and post-await footer parsing still block; no footer speedup claim.
- [Stop restoration](terminal-stop-restore-performance.md): repeated-row preparation roughly **19–22 → 2–3 ms**, restored bytes unchanged. Actual PTY write remained about **42 ms**, or **156 ms** under backpressure.
- Other scoped evidence/limitations remain in the lazy-body, anchor, row-adoption, paste, selector, large-text, text-wrap and execute-render notes. No all-actions-under-8-ms claim, truncation, hidden async facade, terminal-paint proof or stable megabyte end-to-end victory.

No timing matrix was run during sibling worker tests. Remaining costs include full-history traversal/materialization, large synchronous text layout, actual terminal output/backpressure, and unobserved startup/async/physical-paint work. Counting-terminal CPU and elapsed input lateness are not interchangeable.

## Parent stacking/publication

After task_cd4f43cf finishes PR 1, create the PR 2 branch **from perf/terminal-measurement-harness** and cherry-pick this branch's single optimization delta commit. Inspect ownership (especially selector tests), resolve only genuine overlap, then rerun clean frozen install → prepare:assets → check, combined focused tests/build/compiled acceptance. Run any joined timing comparison serially after other tests stop; retain the source boundaries and raw evidence. Parent owns final inspection, push, second PR and the first-PR base relationship. This worker does not push/open a PR.

Values unchanged: existing measured-path, honest-boundary, behavior-preservation and durable-handoff guidance covers the work. Only focused feature/pickup wisdom was added.

## Joined branch

Parent rebased the single optimization delta onto harness commit `53fb4d97` (PR #38). Package commands and harness source stay owned by layer 1. The first joined suite found the expected 13 exact render-count failures: base does two full document renders, and reveal adds a third. Layer 2 changes those deterministic assertions to one/one, with all visibility, output and lifecycle assertions kept. This test change belongs in the optimization PR, not the harness PR. Final joined checks are pending.

Joined parent verification passed: `bun run check`, 123 harness/selector tests / 5,204 assertions, build, four compiled terminal tests / 1,114 assertions. No timing matrix was rerun for the split. The optimization branch is based on harness commit `53fb4d97`; layer 1 runtime remains unchanged. Performance limitations above remain open. Values unchanged; layer 1 owns the measurement-principle update.

Hosted CI failed repository formatting before running the full executable checks. Parent formatted the probe files and saved JSON summaries; all five formatted JSON files parse to exactly the same data as before. Format:check and lint pass, with existing warnings. The stack now includes the T3-action commit and harness formatting fix. Full hosted validation remains required; earlier focused checks were not a full CI pass. Values unchanged.

Full local CI found four saved-transcript startup fixture failures: its fake session manager lacked the new `getEntryCountByType` SDK method. The fixture now implements the empty compaction count and checks the requested type. Startup ordering/grammar/painting assertions stay unchanged. Ten other local shell-bridge failures contained mise initialization warnings; rerun with `SHELL=/bin/sh`, as the repository T3 CI action already declares, rather than change runtime output rules. Hosted validation still needs completion.
