# v0.15.7

## Remote work in the normal session

- Connect to a preinstalled, authenticated die over pinned SSH with /remote. Remote agents own their tasks and keep working when the client disconnects.
- Automatic bounded progress sync, reconnect, offline conversation/tool text and text-artifact caches. Gaps and uncertain outcomes stay explicit.
- Answer native remote questions with pinned owner/version and durable reply identity. Cancel tasks without treating an unconfirmed cancellation as success.
- Send the current repo with tracked edits on demand. Untracked inclusion needs human approval. Safe regular-file changes return automatically without changing the local index; conflicts and other changes retain review artifacts.
- Explicit local repo grants support file reads, git-status/git-diff and named skill text. Requests wait while the client is offline. No arbitrary local shell, whole-machine access or credential transfer.
- Agent access uses execute helpers, preserving Live's execute-only setup. Use the remote default profile or explicit model/thinking overrides.

## Build tooling

- Cache Bun downloads and the pinned T3 pnpm store in CI/release. Hosted warm verification reused 848 packages with zero downloads; no meaningful total CI speedup was established.
- Align mise with CI's Bun, Node and pnpm versions.

## Validation and limits

Parent validation: 1,261 tests passed, 17 skipped, zero failures, including the actual CLI Docker/SSH fake-provider lifecycle and Live regression. Typecheck passed. Hosted release platform gates follow.

Remote acceptance is Linux Docker with a deterministic fake provider, not real Mac sleep, real-provider authentication or fleet-scale proof. Trusted repo/SSH user assumptions apply. Transfers, concurrency and caches have explicit limits. Repo return is conservative, not crash-atomic with external writers. Unknown tasks are never silently rerun elsewhere. See src/remote/README.md for commands and boundaries.
