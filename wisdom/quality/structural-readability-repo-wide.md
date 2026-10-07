# Whole-repository structural readability — ongoing

## State and delivery

Whole-repo run started; no whole-repo readability acceptance yet. Eight area orchestrators are launching per-file primary workers and independent judges. Exact IDs, durable paths and branches are in [area jobs](structural-readability-repo-wide-jobs.json). Integration checkout: `/home/tnfssc/.bruv/worktrees/t3-6b8c09c6-5442693331ce-task_e5546eb4`, branch `bruv/structural-readability-repo-wide`. Initial tree was clean at `118edf14db266c51d563c83342fef6dacdc5267b` (judge-accepted owner pilot), descended from upstream `886c4c84`. The rejected 662-file naming sweep is not imported. No source edits, push or PR creation in initialization.

Deliver one integrated result to **existing PR #45**, not area PRs or piecewise pilots. Keep progress quietly in the background until integrated. Read [values](../values.md), [guidance](structural-readability-guidance.md) and [pilot](structural-readability-owner-pilot.md); values already contain the judge lesson and are unchanged.

## Scope and ownership

`git ls-files -z` at the baseline has 3,389 tracked files. All 748 seed paths in `/tmp/bruv-structural-scope.json` are unique and tracked. Adjacent [coverage](structural-readability-repo-wide-coverage.json) retains them and adds 18 missed maintained inputs: **766 pending rows**, each with its baseline Git blob. The seed's five colocated module Markdown notes remain contextual review inputs, not forced code rewrites. Shipped prompts and generated fixture/cell JSON stay in scope and may be reviewed unchanged.

Added paths and reasons:
- `.gitattributes`, `.gitignore`, `site/.gitignore`: operational repository configuration.
- `native/live/Info.plist`: embedded by the maintained macOS helper build.
- `scripts/tmux.conf`: used by the terminal harness and tests.
- `tests/claude-compat/native-adapter-prompt-ownership.ts.txt`, `tests/fixtures/remote-owner-error.ts.txt`: source fixtures read by prompt-ownership and owner-lifecycle tests.
- `Dockerfile` and `sshd_config` in each of `tests/fixtures/remote-e2e`, `remote-placement-e2e`, `remote-typed-root-placement`: maintained SSH acceptance configuration.
- `site/assets/cli-settings.txt`: live extractor/build-test input; `site/assets/brand/bruv-icon.svg`, `bruv-wordmark.svg`, `bruv-wordmark-light.svg`: hand-authored markup, copied to the site or used by wordmark generation, not generated raster assets.
- `support/gpt-live-explained.html`: first-party HTML/CSS support page, not prose-only release history.

The other 2,623 tracked files are deliberately outside code cleanup: vendored `third_party` (9), dependency patches (2), root prose/licenses/lockfile (7), native README (1), script READMEs (3), site prose/licenses/lockfile/generated PNG/font assets and unused historical `cli-help.txt` (18), support release notes (63), fixture/release-shape prose (5), and wisdom (2,515). Wisdom is historical investigations/experiments/prototypes/proof/evidence; its live probes are investigation artifacts (two import retired orchestration), not maintained operational scripts. Task manifests/ledgers are bookkeeping, not application code. No other maintained-code gap found; add rediscovered files explicitly.

[Assignments](structural-readability-repo-wide-assignments.json) allocate every scoped path exactly once:

| Coordinator domain | Files |
| --- | ---: |
| Remote | 119 |
| Live / native audio | 140 |
| Compatibility / T3 | 83 |
| Agent / history / session / goals | 114 |
| Execution / tasks / questions | 98 |
| UI / terminal / CLI | 101 |
| Build / release / CI / tooling | 70 |
| Site / support | 41 |

Tests, fixtures and scripts accompany their code. Native audio stays with live; site keeps its build/tests. Live is larger to keep those lifetimes together. Groups are coordinator ownership, **not group-sized worker jobs** or edit walls.

## Why the prior approach failed

Edit-only-one-file cleanup let names/comments, file counts and tests substitute for untangling code. Start from concrete reading problems: coherent authority/responsibility, visible main path and lifetimes, no needless indirection. Names/comments must help that problem. Readable files may stay unchanged; no forced classes/frameworks or line-count goals. Guidance, not rules.

## Worker and independent-judge pipeline

1. Launch **one fresh primary worker per file** in a durable worktree. It may read anything and make coherent related edits; focus is not a rigid edit boundary. Coordinators manage overlaps, join/review patches, and never write source themselves. All source edits and judge-requested reworks go to file workers. Keep worker branches/worktrees for pickup, never temporary code checkouts.
2. Every primary result, including no-change, goes to an independent judge reading actual final source, callers and tests. ACCEPT and NO CHANGE NEEDED need concrete reading evidence about journeys, authority and lifetimes. Worker reports, counts and green tests cannot establish quality. Judges may REJECT cosmetic or worse structure; rework and rejudge.
3. Preserve purposeful safety, authority, replay and data-loss behavior. Intentional behavior fixes must be observed/reproduced, explicit and tested. No speculative defenses, feature cuts disguised as cleanup or speculative test matrices.
4. Record decisions, reasons and exact proof in compact area ledgers, not imported worker-note piles: file, primary/judge task IDs, durable workspace/branch and commit, reading evidence/verdict, focused checks/limits, **completed blob hash**. Coverage starts pending; do not accept the initial hash by inference. New helpers and related edits need their own primary-file coverage and judgment by the end. Later edits invalidate an accepted hash and require a fresh independent judge. Rejudge final combined code after overlapping edits, including cross-area joins.

Bounded launch recommendation: parent launches eight coordinators; each has **at most three primary code workers and three independent judges concurrently** (48 maximum leaf work). Coordinators may review/join, not become source writers. Reuse read-only dependencies at `/home/tnfssc/.t3/worktrees/bruv/t3-6b8c09c6/node_modules`; do not leave full builds in each of 748 seed-file worktrees (or added ones). Focused checks per real change; batch builds only when relevant.

## Proof, limits and next steps

Initialization proof: 766 baseline blob matches and pending rows; 766 assignments, no overlaps or missing seed paths; exclusion counts reconciled. Bun 1.4.2 / pinned Biome 2.5.15 formatting checked; documentation-only diff. No new source readability verdict, runtime test or full-gate claim. Pilot evidence is inherited, not rerun or repo-wide: actual-code judgments, 103 focused passes, prior Linux full gate (2,235 pass, 30 opt-in skips). Live-provider/authenticated SSH, macOS/device and remote-owner compiled-CLI parity limits remain.

Use Bun 1.4.2 at `/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin`, with PATH set inside a quoted `/bin/bash` script; automatic fish setup may fail while a worker still starts. Full gate: `SHELL=/bin/sh bun run ci`.

Next: parent launches area orchestrators from this initialization commit, runs the per-file pipeline and integrates durable worker commits here, reconciling hashes/ledgers. Refresh final inventory for additions/deletions explicitly. Done only when **every final first-party code file** has primary coverage and independent actual-code acceptance at its final hash, groups fit, full gates pass and integrated PR #45 is updated.

## Shared integration checkpoint

Joined committed, independently judged partial batches from all eight areas. Exact tips: [integration batches](structural-readability-integration-batches.json). No changed source overlap at this checkpoint. Related files are accepted as parts of coherent patches; their dedicated primary focus coverage still remains where area ledgers say pending. Two unused session-input files have judged removals, not missing hashes. This is common code for the remaining workers, not whole-repo acceptance or delivery. Parent integration typecheck is next; final quality audit and full gates remain.
