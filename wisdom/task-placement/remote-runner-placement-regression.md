# Remaining remote runners: normal agent placement

Scope: scripts/remote-e2e.ts, remote-pty-e2e.ts, remote-capability-pty-e2e.ts; their deterministic provider paths and focused tests. No production, root fixture script, recovery runner, or PR12 UI changes.

## Contract and preserved assertions

The shared pure fake-parent response discovers the exact human-pinned authorized SSH alias with jobs.targets and calls normal asynchronous subagent({target,type:"normal",waitSeconds:0}). It persists the exact returned ssh: ID outside source Git. Every source is a committed disposable Git repo, never HOME; Git global/system configuration is fenced. Destination fixture branches check normal/depth1 and reject further delegation before real shell work. Question branches check normal/depth1 but avoid a rejected bridge operation before questions.ask: that operation moves the current branch tip within execute. The existing owned jobs gate retains its normal-worker delegation rejection assertion too.

RPC source/capability/cancel launches now use normal placement. Untracked permission is an explicit source.includeUntracked request, not authorization: a saved human question must exist and the owner must not yet accept a task. The runner sends the human /questions omission answer and retries unchanged intent with the reserved source retryTaskId; exact job identity is asserted. Physical untracked omission, tracked dirty input, index preservation, safe apply, drift review patch bytes, explicit file/tool/skill grants, owner continuation while disconnected, native question owner/version/answer continuation, cancellation shell death, complete cached artifacts and offline readable paged transcript assertions remain. jobs.stop uses the launch's exact ID.

PTY human /remote launch commands remain solely to create **unowned diagnostic tasks** for the existing legacy owner/transport/security UI assertions. Their diagnostic RPC has --no-session, because owned normal jobs deliberately do not appear in the legacy inbox. Each PTY runner also executes a separate persisted normal-subagent placement and verifies discovery, destination policy, real shell text and terminal result. The question runner performs that proof after online diagnostic autocomplete/menu assertions, avoiding an owned job becoming the first legacy completion. All Escape/No/Yes, stale owner/version/request, unsupported authority, narrow-terminal tail, stable modal frames, no JSON leak, cancellation, repeat polling, reconnect, offline and no local-question-ledger assertions remain unchanged. No test is skipped or weakened to obtain a green gate.

## Commands and proof

All commands run in this child worktree, not an assumed root tree:

Direct Bun: /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun
candidate: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c7fed9c/dist/die-placement-candidate
TMPDIR: /home/tnfssc/.die/tmp-pi-removal
candidate SHA256: e580d8647762257ecd96b5e02b7dcfc4aefb0527b07c7e136b8ca8d3f36b4198

Exact commands (BUN/CANDIDATE below stand for the full paths above):

tmp env for every command: TMPDIR=/home/tnfssc/.die/tmp-pi-removal

```sh
BUN=/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun
CANDIDATE=/home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c7fed9c/dist/die-placement-candidate
export TMPDIR=/home/tnfssc/.die/tmp-pi-removal
"$BUN" test tests/remote-runner-placement-fixture.test.ts tests/remote-jobs-placement-fixture.test.ts
DIE_BIN="$CANDIDATE" DIE_REMOTE_E2E=1 DIE_REMOTE_PTY_E2E=1 "$BUN" test tests/remote-e2e.test.ts
DIE_BIN="$CANDIDATE" BUN_BIN="$BUN" REMOTE_E2E_SCRIPT=scripts/remote-capability-pty-e2e.ts bash scripts/remote-e2e.sh
# Dependencies absent in child worktree; temporary symlink was removed by EXIT trap.
(test ! -e node_modules && ln -s /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c7fed9c/node_modules node_modules && trap "rm node_modules" EXIT && "$BUN" test tests/remote-source-approval.test.ts tests/remote-repository.test.ts tests/remote-capability-runtime.test.ts tests/remote-jobs.test.ts tests/remote-question-bridge.test.ts)
```

- Focused generated execute tests: 5 pass, 0 fail, 59 expectations. Includes missing/unauthorized/non-SSH target rejection, invalid/non-async ID rejection, full long prompt retention, exact source retry intent and jobs.stop ID.
- Source/repository/capability/jobs/question unit regressions: 57 pass, 0 fail, 312 expectations, 6.00s. This is source-level proof, not a compiled approval success claim.
- Capability PTY: PASS, including normal/depth1/delegation-denied shell proof and all existing human permission assertions. Earlier iteration also passed; an earlier stale request selection run failed (not hidden or disabled).
- Compiled RPC reaches saved source preflight after real owner continuation, reconnect, native human question/answer completion, then fails: Questions need a current branch tip. Start a new turn before asking on this branch. Splitting target discovery into a previous execute did not fix this candidate integration failure; that needless split was removed. Source inclusion, safe return/conflict/capability/cancel/artifact checks remain in the runner and are NOT claimed passing end-to-end.

- Question PTY: PASS, 119.38s, including normal-agent proof plus all legacy autocomplete, human question ownership, stale submission, cancellation, modal stability, transcript, narrow terminal, reconnect, offline, and no-local-question-ledger assertions. Moving the owned proof after online diagnostic completion tests preserves their original unowned first-task completion semantics; no UI code changed.
- Final combined CLI test: 1 pass (question PTY), 1 fail (RPC source preflight), 3 expectations, 173.25s. Capability PTY command separately exited 0. These are **not** a full-green three-runner gate.
- Biome format on scoped TS files and git diff --check clean. Untrusted mise warning is unrelated; no trust/config edit was made. No real SSH host, credentials, paid inference, WAN proof, push, root-runtime claim or full-suite claim. All integration owner work uses the disposable Docker/fake-provider fixture.
