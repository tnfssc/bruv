# Reuse painted activity geometry; do not hide body work (2026-10-05)

Scope: production ActivityController anchor/control code and focused activity tests only. No SDK patch, wrapping, paste, shared harness, shared note or dependency-lock changes. Read values, terminal-interaction-lab, tool-interaction-mutation-probes and terminal-action-profiler.

## Actual path and change

Pi 1.0.3 Container.render records width, child identity and height in its mouseLayout. Before this change, withAnchor rendered the reveal prefix, walked/rendered the reading anchor, rendered the entire chat, then rendered prefixes/anchor again for restoration. The reveal path discarded its reading-anchor work in favor of the selected header.

Reuse the SDK's measured geometry, checking width and ordered child identities. No new persistent text/height cache. A replaced branch or first paint measures again. Non-reveal capture uses the last painted position; restoration reuses the synchronous fresh document's geometry. This intentionally fixes capturing a *future*, unpainted height as though the person had already read it. A focused growing-prefix test demonstrates it.

Reveal renders the affected group's actual native bodies synchronously, rather than the unrelated document. Wrapping still happens in the mutation. Its pending header identity is resolved from the next natural frame's fresh geometry, after resize/updates, immediately following ScrollView.updateLayout's content-height clamp and before layout translates/clips the scroll box. Pending state is consumed/detached and disposal clears it, as with the prior numeric pending anchor. Reading restoration still disables follow.

Callbacks remain native: Pi createResultRegion calls setExpanded/updateDisplay; activity header clicks use toggle/withAnchor, projected task-card clicks and picker selections use toggleDetails. Picker stable-item re-resolution, group visibility versus native expanded state, handoff controls, save warnings and SDK mouse routing remain intact. Ctrl+O runs Pi's original native traversal and changes group visibility, without inventing another native expansion traversal. Installed Pi has no separate transcript capture/restore method: ActivityController owns capture and its scoped ScrollView.updateLayout wrapper owns restoration.

## Measured evidence (not an 8ms claim)

Raw local files: artifacts/terminal-perf/activity-anchor/{parent-single-line-8,before-*,after-*,comparison,totals}.json. Supplied parent artifact was found under /home/tnfssc/.t3/worktrees/bruv/t3code-bbf9268f/artifacts/terminal-perf/tool-interactions-worker-baseline and copied verbatim. SHA256 417c2d04f3f684807b636a969dd600be500e5ec6e57c084c40a7e39effe7a63a. Its reveal mutation/frame pairs were 28.811/0.882, 11.225/0.432, 11.485/0.479ms.

Pinned Bun 1.4.2 / Pi 1.0.3, unchanged scripts/terminal-perf/tool-workloads.ts (7c6bc44255500501c7faa546d25d413a302c00be576c82a985d1b4da5edf76ec). Matched before/after sources use HEAD b3d7d785 versus this production change; compared with the supplied earlier artifact, sdk-task-rows/task-rows already differ on this branch. Native tool-execution hash is identical (84c0b25031d0702f7599f6a779642c3bf7822e1f89919a543901da733e817941).

Serial local runs, three repetitions per shape, history8:

| single-line reveal | mutation ms | following frame ms | total ms | peak sync ms |
|---|---|---|---|---|
| before 1 | 26.108 | 3.250 | 29.357 | 26.108 |
| before 2 | 9.842 | 0.399 | 10.242 | 9.842 |
| before 3 | 10.491 | 0.397 | 10.888 | 10.491 |
| after 1 | 24.991 | 0.696 | 25.687 | 24.991 |
| after 2 | 9.563 | 0.542 | 10.105 | 9.563 |
| after 3 | 10.951 | 0.461 | 11.412 | 10.951 |

**The large-line stall remains wrapping-bound. Warm total median even regresses slightly in these three samples; no sub-8ms or universal latency win is claimed.** Across all 162 non-setup interactions in six shapes (single-line, short, handoff, artifact-warning, task-rows, code-preview), mutation totals 108.712→106.030ms, frames 61.731→61.177ms, combined 170.443→167.207ms; peak mutation 26.108→24.991ms, peak combined interaction 29.357→25.687ms. Peak full-frame CPU across those interactions is 6.785→7.222ms (different error/complete samples), so frame tails do not uniformly improve. These are observations on a shared machine, not a clean performance gate; code-preview timing did not improve.

Real reveal work: document renders 2→1; branch calls 3→2 (63→42 entries); snapshot calls 2→1 (16→8 rows); native component renders stay 2 and expansions stay 1. No output writes escaped frames. All stages/repetitions of all six shapes have identical content, document, screen, output hashes, line counts and changed-row counts. Candidate single-line hashes also exactly match the supplied parent artifact, including its 425-line document. Content hash 35e67b8437fc665aa8d808f04f1845ed835ff348ed36584d69b6cf5eb8abdc39; document db90c1b21c076b8e5e4f8b83db84cc52aaef17f1f6ca8236c63afcfcb0017438.

Independent short/history100 reveal mutation/frame pairs: before 1.960/0.824, 1.363/0.843, 1.310/0.589ms; after 0.966/0.828, 0.251/0.605, 0.215/0.497ms. Focused counts prove unrelated history is rendered zero times in reveal mutation and exactly once in its frame; affected native items render once in each. Non-reveal uses one fresh prefix render instead of repeated offsets.

## Verification and honest blockers

- Typecheck and build pass. Activity/disk tests: 47 pass, 264 assertions (five new focused tests). Existing compiled long-thread test: 1 pass, 1,049 assertions; actual 1,000 toolResult preservation, first/last detail, draft, narrow resize, reopen and regular mode.
- Fresh compiled binary SHA256 7b26661ee39159297b93bdf07e095a65cba720bb7929447c528134f2eb39e694. Broad runtime rows and lifecycle pass with existing assertions, actual mouse bytes and picker/native independent detail state. Reviewed plain and ANSI frames, including subdued headers, Saved turn 0 plus exact DETAIL_saved-0-0 and retained draft.
- Shared runtime runner currently sends Home/End; Pi now advertises Ctrl+End and requires Ctrl+Home. Unmodified run fails navigation. A temporary runner maps only those inputs to current bindings; no repository harness edits or weakened assertions. Evidence /tmp/activity-anchor-runtime-final; exact executed inputs remain in commands.jsonl.
- Broad long_thread then fails long-narrow: Jump-to-latest indicator covers LONG_THREAD_READY at 48 columns. Unchanged baseline reproduces the identical failure/frame (/tmp/activity-anchor-runtime-baseline), while existing compiled long-thread/regular gate passes. Do not hide this view defect or call broad acceptance passed. Shared harness/SDK owners should resolve navigation and narrow overlay separately.
- Shared terminal-perf-tools tests have 13 stale assertions at line 77 requiring reveal.documentRenders > complete.documentRenders. The optimization intentionally makes both 1. Four other shared tests pass; all content evidence above is unchanged. Parent/harness owner must replace that work-inflation assertion with observed exact counts; this worker did not edit shared harness/tests.
- Build initially found a hard-linked installed markdown.js changed by parallel vendor work, importing absent markdown-blocks.js. This worker replaced only its installed Pi packages with private copies of pinned registry tarballs plus this branch's tracked patches; no SDK/lock changes committed. Before/after evidence above uses the repaired same install. Avoid modifying shared hard-linked vendor files in place.

Values unchanged: existing real-path measurement, visible-frame acceptance, bounded scope and honest-limit rules already cover this lesson. Next: integrate the independent wrapping fix, reconcile shared work-count assertions, rerun serial combined mutation/frame evidence and address the baseline narrow overlay; do not present this anchor improvement as the entire stall fix.
