# Owned remote jobs regression gate: normal placement

2026-10-01. Test-only migration; production launch policy and parked PR12 UI flows are not preserved/bypassed.

## Lasting tree

- Branch: remote/task-placement-regression-fixtures
- Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c7fed9c-a86675007a5e-task_a4cc0106
- Owned files: tests/remote-jobs-e2e.test.ts, scripts/remote-jobs-e2e.ts, tests/fixtures/remote-e2e/fake-provider.ts; focused new tests/remote-jobs-placement-fixture.test.ts.
- scripts/remote-e2e.sh already accepts DIE_BIN/BUN_BIN; no setup-script edits needed. No edits to production or remote-{placement,root-placement}-e2e.ts.

## Contract

A human fixture command connects fixture-owner once. Real parent CLI execute calls discover that exact authorized SSH alias with jobs.targets and launch normal async subagent({target, waitSeconds:0}). Returned ssh: IDs are persisted outside source and reused for jobs operations. The two parent CLIs use a fixture Git repo at isolated HOME/repo, never HOME; sessions, configs and source caches remain outside Git. A dirty tracked README edit must reach destination and finish its real shell job and owner continuation. Destination server normal profile/depth1 is asserted in execute; further delegation must fail with normal-worker role policy (no lowering/bypass).

Original two-session yields, existing task-complete coordinator parent wakes, repeat-sync deduplication and reconnect no-redelivery remain. The gate also checks own/foreign ID envelopes, journal session ownership, completed jobs.inspect with the exact launch ID, foreign/unknown jobs.inspect and jobs.stop rejection, and jobs.list isolation. Existing uncertain/offline semantics tests remain untouched.

## Focused verification

Direct Bun: /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun. TMPDIR=/home/tnfssc/.die/tmp-pi-removal.

Supplied compiled candidate (no package rebuild): /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c7fed9c/dist/die-placement-candidate; SHA256 e580d8647762257ecd96b5e02b7dcfc4aefb0527b07c7e136b8ca8d3f36b4198.

- DIE_REMOTE_JOBS_E2E=1 DIE_BIN=<candidate> bun test tests/remote-jobs-e2e.test.ts: isolated Docker/SSH actual compiled CLI and actual fake streaming provider PASS. Final source-finish marker + encoded-ID nonleak assertions: 1 pass, 0 fail, 2 expectations, 27.93s. Earlier focused gate iterations passed 36.60s and 32.14s.
- bun test tests/remote-jobs.test.ts tests/remote-jobs-placement-fixture.test.ts: 19 pass, 0 fail, 121 expectations (1.67s). Includes unknown launch/session isolation/offline cancellation and unchanged pagination tests. Worktree has no dependencies installed: a temporary symlink to parent worktree node_modules was used and removed. NODE_PATH alone failed to resolve zod/mini; not a regression.
- Focused fake-provider tests: 2 pass; execute generated placement/probe code against mocks, negative missing/invalid target/async ID and accepted foreign-stop cases. Test provider binds ephemeral loopback, no owner markers written on host.
- Biome format on owned files; git diff --check clean. Shell startup prints an unrelated untrusted mise config warning; direct Bun runs succeed without changing trust/config.
- No real credentials/host/config/cache modifications, paid APIs, WAN provider proof, placeholder web/video, or full suite.

## Exact unconverted legacy paths (intentionally parked)

- scripts/remote-e2e.ts:26: agent remote.launch; also old human /remote launch and launch-repo RPC flows for questions/source return/conflict/capability/cancel. Separate PR12 integration, not this owned gate.
- scripts/remote-pty-e2e.ts:23: agent remote.launch; /remote launch menu flow at :232. Separate PTY/question UI proof.
- scripts/remote-capability-pty-e2e.ts:23: agent remote.launch; /remote launch at :289. Separate capability UI proof.
- scripts/remote-recovery-e2e.ts:134,147: old human /remote launch UI commands (not an agent helper), including intentional lost-response fixture recovery. Separate parked UI workflow.

Those three agent-helper call sites reject with current policy and are not claimed passing. Their fixture-model branches remain unchanged; only the owned fixture-parent/jobs-proof branches migrated. Do not blindly preserve these workflows or infer root-backend coverage from this normal child gate.
