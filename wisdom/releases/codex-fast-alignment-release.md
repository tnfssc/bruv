# Codex fast alignment — PR and release

## Ownership and isolation

User explicitly requested “make prmerge. release”. Repository: tnfssc/bruv, default develop. Release worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_aaa0030d. Branch: bruv/pr-merge-and-release-codex-fast-alignmen-aaa0030d. Started at origin/develop 8e687ef00bda8e58cb60f7b6ddd100698ce7f185 (prepared but unpublished v0.16.1). Cherry-picked only parent implementation e93d0953c0f95daaa9ab08c984b239b00d9b51f7 as 0f2538d2 and integration wisdom 7404ee328ce401b2724ae69568f5a141cce43166 as 580841c2. Human notes added in c33e55ed to the already prepared support/release-v0.16.1.md; no guessed version bump. Parent worktree and unrelated work untouched.

PR: https://github.com/tnfssc/bruv/pull/27. Parent proof: 117 tests / 781 assertions and typecheck passed. Read values, native-fast-mode wisdom, recent release records, Release workflow and prepare-manual-release.ts. No active Release when starting. No local binary installation or credential changes. Existing SSH key warning did not prevent fetch/push. Local test tools: installed Bun 1.4.2, SHELL=/bin/bash; reused parent locked dependencies via untracked node_modules symlink (never staged) and generated normal runtime assets, no dependency installation.

## Actual CI blocker and correction

Previous Release https://github.com/tnfssc/bruv/actions/runs/37188844249 failed deterministic tests (1967 pass, 28 skip, 28 fail) before assets/publication. Initial PR CI https://github.com/tnfssc/bruv/actions/runs/37189627215 failed Linux validation separately: OpenAI GA oversized tool output was not ready within a fixed 10 ms fixture sleep (JSON.parse(undefined)). Sharded PR CI did not encounter the adapter-order failure that the unsharded Release suite did. The long-thread optimization called a captured AgentSession.getContextUsage from its projection-only estimator facade. If shake accounting installed first, that capture was the accounting wrapper, which needs a complete session manager and threw at manager.getSessionId(). This is an adapter installation-order bug in the default-branch optimization, not fast-mode wire behavior.

Reproduced locally with the real SDK suites (47 pass / 4 fail) and a new isolated-process regression that installs shake accounting before disk history. The fix captures the pristine SDK estimator at module evaluation and uses it only for the existing narrow projection view; ordinary-session fallback retains the current wrapper. No interface weakening, latency-target change, model fallback or gate bypass. Regression failed before the patch; projection parity plus real shake/native runtime suites now pass: 53 tests / 265 assertions. Typecheck and diff whitespace passed. Full deterministic suite and new hosted checks pending.

The PR timing failure is a test synchronization assumption: oversized tool results write a filesystem artifact before emitting their reply. Changed only that fixture to wait boundedly for the actual reply, assert it exists, and retain truncation/path assertions; no product behavior or gate removed.

## Publication checkpoint

Do not merge with failing checks. After green normal merge, recheck active Release runs, dispatch existing Release on develop, and hold develop steady until publication gates finish. Workflow owns version and notes preparation. Verify stable metadata, tag SHA and every expected nonempty asset; no redundant binary download. Commit final evidence only after the fixed-SHA release window ends.

## Values

Existing values on real-path proof, safe recovery, honest states, preserving unrelated work and useful handoffs cover this work. No new reusable value warranted.
