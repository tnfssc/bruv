# PR #24 dependency conflict recovery (2026-10-04)

[PR #24](https://github.com/tnfssc/bruv/pull/24): develop ← automation/daily-dependencies.
Worktree: /home/tnfssc/.bruv/worktrees/t3code-77767e18-5442693331ce-task_7afc3051.
Local branch: bruv/pr24-recovery-7afc3051. Nothing pushed, merged on GitHub, closed, or released.

## Decision and review

Not superseded: develop ac720844bac745e6cef45b1478703517e99b890b still has
@google/genai 2.26.0; PR head 261829fcf29c9e101f2d914f2a7e51e2ae51a840 proposes 2.27.0.
The npm latest tag is 2.27.0 and its integrity matches the lock entry.
[Upstream release](https://github.com/googleapis/js-genai/releases/tag/v2.27.0)
adds Interactions model names and continuation_token; no Live API migration is described.

Merged current develop into the PR head locally. The two observed conflicts
were root dependency blocks in package.json and bun.lock: GenAI bump beside the
new direct @modelcontextprotocol/sdk 1.27.1. Kept both. All develop changes,
including aligned Pi 1.0.0 and its patch, version 0.16.7, and paired CLI packaging,
remain intact. Product diff versus develop: only three substitutions in those
two files. No broad update or lock regeneration.

No submitted reviews or inline comments; sole issue comment is CodeRabbit's
bot-author review skip. CodeRabbit success is not substantive review. No required
checks reported; branch protection returned 404 and branch rules returned [].
Existing Linux success belongs only to the old head and
[run 37119216605](https://github.com/tnfssc/bruv/actions/runs/37119216605).

## Local proof

- Read values, dependency workflow, tool-pin and shared CI wisdom.
- bun run ci, once, passed with Bun 1.4.2 / Node 24.21.0: frozen install,
  format, lint (existing warnings/infos), typecheck, fresh paired build,
  source + compiled offline OpenAI probe, complete root tests, paired smoke.
  1959 passed, 30 opt-in skipped, 0 failed; 35552 assertions across 272 files.
- bun run generate:notices passed: 211 production packages; output stays ignored.
- Offline installed GenAI 2.27.0 import/Live client construction and MCP/Pi/patch
  pin assertions passed; no real API request was made.
- git diff origin/develop --check passed. Merge-index whitespace check against
  the old parent flags existing develop research files, untouched versus develop.
- Logs: /tmp/bruv-pr24-linux-ci.log, artifacts/ci/, /tmp/bruv-pr24-notices.log.
  No real provider/device or macOS run. Remote head refs rechecked unchanged.

## Next step and blocker

Automation owns the bot branch and force-with-lease replaces it only after
validation. Prefer a maintainer-authorized update of existing PR #24 from this
recovery, not a new PR. It is a fast-forward from the old bot head: no force push
needed. Recheck remote heads and avoid racing automation. Refresh the PR body
and get CI on the new exact head; old success is not new proof. Ordinary PR CI
and the real macOS lane remain before merge. Later automation may replace this commit.

A plain workflow rerun is currently blocked: today's
[run 37200481788](https://github.com/tnfssc/bruv/actions/runs/37200481788) tried Pi 1.0.2
and failed prepare:assets with “Unsupported Pi host version: 1.0.2”, correctly
preserving the old PR. That Pi migration is separate work. Do not relax its guard
or widen this GenAI-only recovery to make publication pass.

Values unchanged relative to develop: scoped ownership, dependency semantics,
honest proof and durable handoff already cover this case.
