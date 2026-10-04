# PR #23 proposal reconciliation — 2026-10-04

## Ownership and source

- Existing PR: https://github.com/tnfssc/bruv/pull/23; base `develop`, head `bruv/draft-rolling-activity-transcript-propos-4abbe161` at `6ab524c610bccd973f0c981b96f0c902605c405f`. It remained OPEN; no push, PR edit, merge, close or release was performed.
- Persistent worktree: `/home/tnfssc/.bruv/worktrees/t3code-77767e18-5442693331ce-task_1cbf2c09`; local branch `bruv/review-and-tighten-pr-23-activity-propos-1cbf2c09`.
- Fetched develop: `ac720844bac745e6cef45b1478703517e99b890b`. Local merge commit `6333653458e755f6c3ad9e610b794745bcf58e7d` resolves only two add/add doc conflicts by preserving develop's files. Its tree initially matched develop exactly. Inherited runtime/dependency changes are base history, not this PR's implementation.
- Read values and both original docs. Refreshed source evidence in [research](rolling-activity-research.md); clarified target/current behavior and future gates in [proposal](rolling-activity-proposal.md). No runtime/dependency files edited.

## Review receipt and findings

`gh pr view 23 --repo tnfssc/bruv --json ...`, `gh api repos/tnfssc/bruv/pulls/23/comments` and `.../reviews` returned no submitted reviews or inline comments. The single issue comment was CodeRabbit's skipped automatic review. Nothing there selects a human product decision. GitHub reported CONFLICTING/DIRTY before local reconciliation; no claim is made about hosted state after an unpushed merge.

Develop copied the original docs in `1875ae90` and already has the tool-only runtime plus later disclosure UX. The open PR's original “not implemented” framing is stale. Fixed the following documentation gaps:

1. Distinguish lasting text/visible segment, agent-run end and background task settlement. Current groups split at prose/control boundaries; notices can have their own no-call group. This is not the original one-work-stretch count.
2. Describe actual intent routes without choosing one: phase-bearing provider text signature versus a future typed assistant-text signal. Execute labels, handoff results and hidden question delivery are not assistant intent. Unknown prose stays lasting; original screenshots are sketches.
3. State what the journal marker stores (call IDs only), when it is absent, and what it cannot reconstruct (yield reason/continuation cause). Saved-answer/completion delivery owners remain separate.
4. Replace the “host seam still missing” implication with actual direct-sibling projection and explicit-toggle anchoring. No group chevron and row/detail separation are later UX choices, not regressions to revert.
5. Keep original synthetic probes distinct from later compiled receipts and from this source/docs-only review.

## Proof and limits

- Relevant checks: scoped `git diff --check origin/develop -- wisdom/tasks-ui/rolling-activity-*.md`; local Markdown file-link resolution and conflict-marker scan for the three changed docs; docs-only changed-path verification against develop.
- Local Markdown file-link check: **38 links across 3 docs, 0 missing**. Conflict-marker scan: **0**. Scoped whitespace check against develop: **pass**. Changed-path check after staging: exactly the two existing docs plus this handoff, no runtime/dependency delta. No runtime tests/build/terminal/provider/remote execution was performed for this update. Existing compiled receipts were read, not rerun or relabeled as acceptance of a prose extension.
- A broad merge-stage `git diff --cached --check` reported whitespace in inherited develop research artifacts (for example `wisdom/experiments/t3/pr-15598-npm-review/checks-final.txt`). Those files are unchanged relative to develop and outside this PR; no cleanup was attempted. Use the scoped docs check for the actual PR delta.
- Shell startup reports an untrusted local `mise.toml`; git/gh still completed. No trust/configuration or dependency setup was changed.

## Open decisions and next action

- Keep next scope tool-only, add one provider-specific phase route, or approve a normalized typed route? Who emits intent, at text-block or message granularity, and how do live/saved mixed messages and important notes behave?
- Does future presentation need durable normal-yield/handoff/abort/error and continuation-cause distinctions beyond existing membership? If yes, choose owner and minimal journal facts; do not infer them from absent markers or prose.
- Does any future scope promise continuous anchoring for late height changes or other presenters? Current explicit-toggle anchoring and fullscreen scope do not establish that promise. Prove new behavior at the compiled host before claiming it.

Recommendation: after parent review and explicit publication instruction, update **existing PR #23** with this merge plus docs commit; do not open a replacement or implement these gates here. Suggested title: “Reconcile rolling activity proposal with current develop (docs only)”. Refresh its body to say tool-only runtime is already on develop and this delta documents remaining prose/boundary/host decisions. Require a docs-only diff against the then-current develop, recheck reviews/base movement, and do not merge merely because the docs are consistent.

Values unchanged: one owner, honest proof, safe recovery and persistent handoff already cover these lessons. No new general rule emerged.
