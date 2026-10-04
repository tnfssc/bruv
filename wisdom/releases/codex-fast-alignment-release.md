# Codex fast alignment — PR and release

## Isolation and source

User explicitly requested “make prmerge. release”. Repository tnfssc/bruv, default develop. Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_aaa0030d. Branch: bruv/pr-merge-and-release-codex-fast-alignmen-aaa0030d. Started at origin/develop 8e687ef00bda8e58cb60f7b6ddd100698ce7f185. Cherry-picked only parent implementation e93d0953c0f95daaa9ab08c984b239b00d9b51f7 as 0f2538d2 and integration wisdom 7404ee328ce401b2724ae69568f5a141cce43166 as 580841c2. Parent and unrelated work untouched. PR: https://github.com/tnfssc/bruv/pull/27.

Read values, native-fast-mode wisdom, recent release records, Release workflow and prepare-manual-release.ts. No local binary installation, billable provider call or credential/trust change. SSH key warning did not prevent fetch/push.

## Observed failures and minimal correction

Previous Release 37188844249 failed 28 serial deterministic cases before publication because disk projection estimation captured a shake accounting wrapper requiring a full manager. An isolated adapter-order regression reproduced this. A provisional pristine-estimator production repair passed 53 real SDK tests / 265 assertions; it also required moving the existing cache-count spy before module capture (run 37189939505). **That provisional repair, regression and spy adjustment are removed from the shipped diff**: another owner independently delivered b39d0f4e, isolating the five SDK connector suites, then dispatched Release 37190223990 on cb32e158. Retain upstream recovery rather than ship redundant unrelated production work. Merged upstream locally without touching develop during its fixed-SHA window.

Initial PR CI 37189627215 failed separately: an oversized OpenAI GA realtime tool reply was not ready after a fixed 10 ms fixture sleep (JSON.parse(undefined)). The only retained release-blocker fix waits boundedly for the observable filesystem-backed tool reply, asserts it exists, and keeps truncation/path assertions. Protocol suite: 37 pass / 214 assertions.

Local tools: installed Bun 1.4.2 and explicit bash. Reused parent dependencies, first through an untracked symlink and then a private copy. A built unsharded run had 1993 pass / 28 skip / 5 fail: one estimator-spy mismatch and four startup cases. Investigation showed the reused parent dependencies lacked the tracked Pi grammar patch (not a proven symlink-mock failure). Applied only that existing patch to the private copy: startup plus cache checks 6 pass / 13 assertions. No parent dependency edits or dependency installation. Earlier unbuilt local run was stopped after missing compiled subprocess binaries; neither incomplete run is acceptance proof. Parent and integrated fast scopes both pass 117 tests / 781 assertions. Typecheck, format and diff checks passed.

## Release sequencing

PR CI 37190243165 passed Linux x64, macOS Live, docs planning and CI policy at 4d2596c8. Before merging, observed the separately owned v0.16.1 release in progress and held develop unchanged. That run 37190223990 succeeded and published v0.16.1 at 2026-10-04T09:00:12Z. Fast alignment is not in that tag.

Restored v0.16.1 notes unchanged. Official nextReleaseVersion(package.version, publishedTag) returned 0.16.2; support/release-v0.16.2.md contains human fast-mode notes. No package bump guessed or written; Release owns preparation. Fresh minimal-diff PR checks, merge, dispatch and publication verification pending. Hold develop fixed through gates; commit final evidence only after all fixed-SHA windows end. Verify metadata, exact expected nonempty assets and tag SHA without redundant binary downloads.

## Values

Reviewed values at start and finish planning. Existing whole-path proof, safe recovery, honest states, minimal changes, preserving unrelated work and useful handoffs cover this. No new reusable value warranted.
