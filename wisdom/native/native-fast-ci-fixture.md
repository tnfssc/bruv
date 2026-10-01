# Native fast alias fixture CI fix (2026-10-01)

PR #18 / [run 36899822725](https://github.com/tnfssc/die/actions/runs/36899822725) failed Linux typechecking at tests/native-fast-mode.test.ts:147 (TS2345). The CI policy failure only cascaded from Linux; macOS and feedback succeeded.

Cause: getModel's provider-indexed generic cannot correlate a union provider with a separately conditional model ID. The combined call made the Codex catalog reject the OpenAI-only gpt-5.3-codex ID. Select between two literal-provider lookups instead; no casts, production changes, or restored alias allowlists. The alias loop still checks unknown future aliases and untouched/on/off wire tiers on both official surfaces.

Proof: frozen dependency install, bun run check, bun run format:check, and bun run lint all passed; focused native-fast-mode, sol-model-catalog, and native-compaction tests: 64 pass, 0 fail, 308 assertions. Lint retains existing warnings/info (724/1092). Used installed Bun 1.4.2 directly because mise rejects this untrusted worktree configuration. Full Linux build/root/web/smoke and hosted rerun were not run; this is focused proof of the reported typecheck defect, not whole-CI acceptance or a billable provider call.

Handoff: branch `die/fix-pr-18-ci-4cada413`, worktree `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_4cada413`, based on PR head d316bd5 (origin/die/remove-native-fast-model-alias-gate-df2e76e7). Fix committed locally, not pushed; inspect git log -1 for commit. Next: integrate and rerun hosted CI.

Values unchanged: values 2 (state proof scope), 7 (remove speculative gates), and 10 (focused checks and useful handoff) already cover this feature-local fixture correction. See [native fast intent](native-fast-mode.md) and [CI coverage](../ci/full-path-simplification.md).
