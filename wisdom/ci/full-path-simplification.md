# Faster CI, same confidence

## User intent

Make normal work fast. Keep the relevant confidence. Keep the pipeline simple. The user rejected our 46-second selected-source probe as reward hacking. It ran fewer checks; it did not solve full CI speed. Do not call it completion.

## Shipped correction

- All executable, build, test and unknown changes need full CI. Only safe reference-doc edits get a cheap path.
- Keep cumulative trusted-baseline planning and the fail-closed CI policy gate.
- Remove the selected-source allowlists, guard and scheduler. Product remote CLI/PTy tests stay.
- Release runs only for stable tags or explicit dispatch, not every develop push. Move its unique source/web checks into ordinary full CI. Actual releases still run final browser, native-helper, macOS binary/updater and publication gates.
- Same-workspace packed-web receipts landed c935911. They are not cross-run cache authorization.
- Latest pushed 8ce5eaf fixes the CI command-inventory fixture. Typecheck and 32 focused planner/workflow tests passed; fixture 3 tests/24 assertions passed; packed reuse/workflow 38 tests/416 assertions passed.

## Parallel root tests

Use Bun 1.4.2 native `bun test --parallel=4 ./tests`, with existing DIE_RUN_LLM_TESTS=0.
Worker custom runner 5a5a2cf was integrated c730abd, then reverted 46cb147 before pushing. Native Bun avoids 247 lines of scheduler and a narrower .test.ts discovery glob.
Native full current suite: 1420 pass/20 skip/0 fail, 203 files, 51.77s locally. This includes 5 obsolete custom-runner tests since removed with that helper. No product tests or timeout policy were removed. This is not whole-CI or hosted time.
See [root-test parallelism](root-test-parallelism.md) for resource audit, controlled worker comparison, evidence and durable worker branch.

## Earlier hosted failures

- Correction run 36774743001 failed only an obsolete CI-runner fixture; fixed 8ce5eaf.
- Run 36775922476 failed fresh packing: receipt tree() calls Bun.file.bytes() on upstream .claude/skills, a symlink to a directory. Fixed in worker 64a909b, integrated 10e9364, with real fresh/warm build proof and a regression. Log /home/tnfssc/.die/ci-pack-hosted-failure.log.
- Receipt GITHUB_ACTION input also varies between fresh and target shell steps. Exclude invocation metadata, not actual build settings; fixed with a step-metadata regression.
- Do not claim the latest hosted gate is green or publish another release.

## Integrated cache work

Task task_23c5c02a. Worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_23c5c02a. Branch die/reuse-unchanged-web-build-in-full-confid-23c5c02a, base c935911.
It owns CI YAML/ci.sh, real exact-input web cache, reproducible producer environment, source/dependency preparation on cache hits, native root parallel invocation, full web/root overlap where safe, helper fixes and focused tests. All current behavioral checks stay. Cache miss/corruption must rebuild. Save only from trusted default branch; PR restore is read-only. No credential, node_modules or unchecked dist cache.
Parent Release --reuse-packed-web edits are committed fd84441. Worker CI-only test edits merged alongside them. Parent sent native runner result and hosted symlink failure through PARENT_NATIVE_AND_HOSTED_BLOCKER.md in worker tree. Do not commit PARENT notes.

## Finish

Worker 64a909b integrated 10e9364. One expected CI fixture conflict used the worker version: it includes the preserved union and failure tests for the new parallel groups. Parent typecheck and 58 focused tests/665 assertions pass. Run actual cold/warm hosted full-confidence CI. Include setup/queue/aggregate time. Do not run repetitive full local suites merely to look careful. Native local full proof already passed. Under-minute full hosted CI is not proved.

Use TMPDIR=/home/tnfssc/.die/tmp-pi-removal for Git signing and commands; /tmp is full. Local pnpm 11.27.1 is at $TMPDIR/bunx-1000-pnpm@11.27.1/node_modules/.bin. GitHub CI installs it normally.

Values 2 and 10 now state the confidence contract and parallel/focused verification lesson. No new value is needed for choosing native Bun over a custom scheduler.

Read-only cache review task_628ca308 found no concrete unsafe stale-hit or lost behavioral check in the in-progress flow. It checked exact key coverage, controlled environment, source/deps on hits, digest/size fallback, trusted save/read-only restore and both test-group exits. Known symlink and GitHub-action metadata bugs remained the implementer fix/proof duty. No need another review round without a new reason.

Local cache proof: warm full gate129.990s,1426root+650web passes,20existing opt-in skips,zero failures. It removed source/dist/root node_modules first, kept only download stores and exact web payload, and made an isolated CLI source edit. Cold208.252s reached the producer and web suite but failed stale fixture assertions, since corrected; not a clean matched all-green baseline. See packed-web-reuse.md for commands/logs. Native parallel uses Bun discovery; no custom runner ships. Net against e561bda before correction: about681 fewer lines, not a speed metric. Hosted proof is next.

Hosted run36780027410 failed (not a cache-hit proof): macOS passed51s; cold Linux root1446cases reached6failures and backend web281cases reached1failure. Root issues are repeated pnpm startup inside fake receipt fixtures, combined multi-scenario5s tests, and coalescing fixtures that assume child exit beats a real timer. Native web assertion parentContinuations.length expected1 got2 under load is under investigation, not accepted as harmless. Log /home/tnfssc/.die/ci-full-cache-cold-failure.log.

Follow-up owners: task_58c6e2d7 normal in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_58c6e2d7, branch die/make-timing-fixtures-deterministic-witho-58c6e2d7 owns job-bridge/remote-jobs/subagent-extension tests (preserve all assertions and time bounds). task_b3cc2c03 fast completed7c8ca34, integratede022426: fixture-owned pnpm version shim+real version-drift assertion, no production version check removed. Receipt tests25pass in1.84s instead20s, native compiled smoke retained. task_1b9334b7 read-only diagnoses native web continuation count.

Parent resource fix pending: three native root workers plus one web Vitest worker share public hosted4CPUs; previous4+2 oversubscribed. No test filtering or timeout changes. Focused integrated runner/key/release/receipt53tests/519assertions pass2.01s. Need new full hosted cold pass, then warm full proof. All prior under-minute caveats remain.

Root timing worker45bf4f8 integrated:63tests/306assertions and14changed scenarios under4CPU affinity+2competitors pass. No production code, deadline relaxation, or assertion removal. Web diagnosis found marker-history request counting conflates intended replay with later terminal continuation; task_3a9ad30d owns exact-phase fixture fix in canonical die.patch, worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_3a9ad30d, branch die/fix-native-web-replay-fixture-accounting-3a9ad30d.

Setup corner cuts: use installed tmux rather than unconditional apt/brew work; Linux fetches shallowHEAD plus exactv0.7.1 tag, while baseline-planning job retains full history. An actual shallow clone with onlyHEAD/tag passed all15updater compatibility tests/85assertions. Workflow24focusedtests pass. Hosted prior setup took62s (including28s to restore998MBcompressed pnpm store); producer35s preparation+146s bundle, root90s under4+2contention. Warm hosted end-to-end cannot honestly be called under1min. No new dependency-cache architecture yet.

Native web fixture worker e1c313b integrated426d57c. It now forces exact initial/replay/terminal phases, delays terminal response with a barrier, waits for both completed parent runs and terminal assistant output, and preserves one projected execute output/child/cancellation/authorization checks. Both execute responses remain identical; replay skips a second handoff only when its idempotently recovered child is already completed. Negative control restores old history filter and deterministically gets2instead1. Real focused test1/1 passes; wholecanonicalpatch applied and extractedfixture matched tested source. See wisdom/t3/t3-native-hosted-fixture-phases.md. Parent final typecheck+60focusedtests/671assertions pass2.29s. Ready to push reliability/setup fixes and repeat hosted full cold, then full warm. No timeout increase.
