# Curated third-party license input location

Root curated license inputs live under `licenses/third-party/`, separate from build/runtime source. This is a location-only change: preserve all curated bytes and keep notice generation and release artifact behavior unchanged.

The notice generator, packaging/release fixtures and architecture map must use the new root. Historical wisdom and release reports retain their original path wording as evidence; they are not active path consumers.

Validation: `bun test tests/packaging/generate-third-party-notices.test.ts tests/release/release-workflows.test.ts`, `bun x tsc --noEmit`, and `git diff --check`.

Worktree: branch `bruv/move-curated-third-party-licenses-241d25b2`, path `/home/tnfssc/.bruv/worktrees/t3-53f4b259-5442693331ce-task_241d25b2`.
