# T3 PR creation link (not a submitted PR)

User-authorized fork and isolated branch publication only. Created tnfssc/t3code as a fork of pingdotgg/t3code; pushed only fix/claude-provider-history-env. No PR creation, upstream/default-branch writes, release or global install.

- Base: eac52f0087d9ba5dee5542f24788d1482affae43
- Head: e9efb362e60e82da42a23e3b9daac72eb7ae0b89
- Original tested patch: a3fb75e8e950ec02bd94eb846d4634363596949f
- Durable source: /home/tnfssc/.bruv/upstream-preparation/t3-ui-history-2644
- Original patch retained as local branch preserved/ui-history-2644.
- GitHub compare: ahead 1, behind 0, merge-base equals base, exactly five history/fork implementation/test files (302 additions, 24 deletions).
- [Exact prefilled body](pr-body.md), [creation URL](pr-url.txt) (1886 characters), [metadata](publication.json), [rebase provenance](rebase-provenance.txt).

Main's touched source files were identical to the original baseline; cherry-pick is patch-equivalent (range-diff '=') with no edits/conflicts. Upstream main nevertheless contains unrelated changes, including Effect RPC patch/lockfile changes; install was refreshed from main's frozen lockfile. Focused tests (133), server no-emit typecheck and format checks all exited 0 on the published head. Test/log artifacts are retained here.

Commands (Node 24.21.0 / pnpm 11.10.0):

~~~sh
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm exec vp test run apps/server/src/claudeHistoryClient.test.ts apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.test.ts
corepack pnpm exec tsc --noEmit -p apps/server/tsconfig.json
corepack pnpm exec vp fmt --check apps/server/src/claudeHistoryClient.ts apps/server/src/claudeHistoryClient.test.ts apps/server/src/claudeHistoryWorker.ts apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.test.ts
~~~

Original proofs/handoff live in Bruv commit 14add8f4, experiments/t3/ui-only-history-upstream/README.md. Official 2644 failure remains distinct from the modified npm/web diagnostic history success. Actual fork/rollback/reload-reopen UI proof was not rerun on current main; no full acceptance, desktop/SEA, server-replacement or production adoption claimed. Only public upstream source plus synthetic regression fixtures went to GitHub; no retained diagnostic/private state or credentials.

The user's next action is opening the saved comparison link and deciding whether to submit it. The URL itself creates nothing. No browser opened by this task. Upstream main may move after this check.
