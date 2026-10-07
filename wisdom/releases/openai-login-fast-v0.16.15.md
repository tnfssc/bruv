# OpenAI login fast-mode delivery — v0.16.15

## Plan

Prepare only release notes and this delivery checkpoint for the OpenAI ChatGPT subscription-login fast-mode fix. Latest published release was confirmed as v0.16.14 at 2026-10-07T15:47Z; next expected release is v0.16.15. The human-facing notes are in `support/release-v0.16.15.md`.

Parent source commits `fb5dda07` and `5aeec220` are the implementation base. The fix routes the new subscription login through regular Responses while retaining API-key support, keeps consent auth/billing-surface-specific, and preserves legacy Codex behavior. Existing persisted consent predates the split; users must run `/fast on` or `/fast off` again. Do not claim tier latency or infer a credit multiplier.

## Source proof

- Parent integration: 93 tests passed and typecheck passed.
- Worker validation: 151 tests passed.
- These are source-validation results, not a release or live-provider claim.

## Delivery state

No push, merge, release workflow dispatch, or publication was performed. Parent owns the PR, merge, workflow dispatch, and final publication proof. No package version, code, credentials, or values were changed; wisdom values remain unchanged.

Delivery worktree: `/home/tnfssc/.bruv/worktrees/t3-b5f14d57-5442693331ce-task_12e0ae1c`
Branch: `bruv/release-openai-login-fast-0.16.15`
