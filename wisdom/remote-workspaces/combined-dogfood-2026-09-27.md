# Combined remote daily-use follow-up

Base e047d97; full branch die/dogfood-remote-workflow-as-actual-termin-5d85da46 merged as bb602b7. Both sides of additive test conflicts preserved; 39 focused merge tests pass. Parent worktree untouched. Read values and daily-dogfood note; config discovery stays parked.

## Work locations

Coordinator: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_f0abdd8e, branch die/finish-dogfood-gaps-and-combine-remote-f-f0abdd8e.

- Human menu implementation: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_f0abdd8e-a86675007a5e-task_9a52e473, branch die/human-capability-menus-and-fresh-remote--9a52e473.
- Lost acceptance / in-app switching fixture: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_f0abdd8e-a86675007a5e-task_b8b23775, branch die/bounded-lost-acceptance-and-session-swit-b8b23775.
- Lifecycle race audit: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_f0abdd8e-a86675007a5e-task_97030ccc, branch die/session-lifecycle-race-audit-97030ccc.

## Environment

Absolute Bun /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun. Existing parent node_modules symlinked (read-only use) and real dist/die-web copied for permitted reuse. Mise trust warning bypassed without changing host trust. Final evidence is retained below; local working logs remain in .cache/combined-dogfood.

- Capability human-flow harness: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_f0abdd8e-a86675007a5e-task_a8f2cef8, branch die/capability-menu-compiled-dogfood-harness-a8f2cef8.

## Concrete follow-up found

Lifecycle audit reproduced an old refresh awaiting cache/sync entering a new session after shutdown/start. 539c05e fences every post-await side effect with originating generation and immediately services the new session after stale refresh exits. Deterministic stale baseline/success/error tests: 0 pass/3 fail before fix, 3 pass after. Startup sync-produced completions retain existing semantics. Regression baseline uses an immutable old running snapshot while current cache is terminal; this distinguishes forbidden stale adoption from legitimate discovery of still-running unowned work.

Initial full suite: 1322 pass/20 skip/12 fail. Ten failures involved host fish/mise startup text in exact-output assertions; binary copying also exhausted host /tmp (16 GiB tmpfs at 99%). Retry uses SHELL=/bin/sh and worktree-owned TMPDIR, no assertion changes and no deletion of unrelated data.

## Hands-on corrections (not just test green)

Actual compiled menu frames exposed a stale footer after closing a modal: snapshot text remained because lastStatus still equaled the pre-menu status. 1f8d7f4 clears the modal-only banner and invalidates normal status cache. Grant/revoke results were still protocol JSON despite readable confirmations; e0b13da renders scoped human receipts. Actual transcript review then found turn_end/agent_end nested message envelopes dumped raw role/usage JSON after readable message_end; these known envelopes now use the same readable message rendering, retaining extra/unknown event fields and explicit raw mode. No unknown events/data removed.

Capability fixture initially had input-readiness races, used y/n on a selector that requires arrows/Enter, and checked local grant creation before the owner control reply completed. Fixed the driver to wait for rendered filter and next menu, use real selector keys, and wait for the completed receipt. All failing logs retained. PTY equality now excludes only the declared freshness footer and separately requires it to say updated; all picker/search/selection rows remain byte-for-byte assertions.

Second full-suite retry: 1333 pass/20 skip/1 fail. Native helper safety test forbids the substring cache/ anywhere in output path; our TMPDIR was inside .cache. Changed TMPDIR to worktree-owned .dogfood-tmp without changing the assertion. Subsequent combined full suites passed.

The /resume experiment initially used a parent fake provider returning HTTP 500: job attention triggered retries and the old assistant-less journal was not published in Resume. Acknowledging fixture-only coordinator notifications with local SSE produced published journals and allowed the actual /resume flow. This is explicit fixture-model behavior, not real provider quality evidence. The command-only/no-successful-assistant session listing limitation is not changed here.

## Final product tree and reproduction

Product tree: af2bc52705932710893ffa85e0937691ffcecab2. Full source branch 34ee07e is an ancestor, not a partial cherry-pick. Final local CLI 0.15.9 SHA256 **9feeacbd34912953ddd08a4e1f6cf85904628c329d072f256bcb523c1c471dec**. Real reused web archive SHA256 **7686d28f46c1731ace8eab80dee6fdea0e9e2c0201337f72e461a40107bcfcbd**. No fresh web build claim.

Run with Bun 1.4.2 on PATH, SHELL=/bin/sh, worktree-owned TMPDIR outside any directory named cache (for the existing helper-path assertion). Build: bun scripts/prepare-assets.ts; bun scripts/build.ts --reuse-web. Full suite: bun test ./tests. Gates: BUN_BIN=/absolute/path/to/bun REMOTE_E2E_SCRIPT=scripts/<name>.ts bash scripts/remote-e2e.sh, where name is remote-e2e, remote-jobs-e2e, remote-pty-e2e. Added supplement names remote-capability-pty-e2e and remote-recovery-e2e. Set DIE_REMOTE_PTY_ARTIFACTS to retain rendered frames.

Additional launch-recovery worker retained at /home/tnfssc/.die/worktrees/die-a86675007a5e-task_f0abdd8e-a86675007a5e-task_6ddb4951, branch die/actual-lost-launch-acceptance-reply-fixt-6ddb4951. Integrated 7332cea; final recovery driver also exercises /resume and checks full new-session scrollback plus message journal, not only bottom viewport.

## What the final frames prove

- Real compiled human capability picker shows repo.read/on-demand.txt and an unsupported shell.execute request. The latter is deliberate disposable owner-ledger fixture data, not real provider authority. Selecting it reports denial and creates no grant. Scoped human confirmation names task, pinned owner, local repository, kind, request, and explains whole-kind read-only authority. Escape/No create no grant; a disappearing request is rejected at confirmation time. Yes creates only selected kind. Revoke Escape preserves authority; confirmed revoke removes it and displays owner acknowledgement.
- Timer updates only the freshness footer while search, selected row and picker contents stay unchanged. Explicit refresh reveals newly requested capability. Completed remote work under an open filtered inbox remains a clearly labelled cached snapshot plus updated banner, rather than replacing focus. Explicit refresh reopens the inbox; it does not preserve the old filter.
- Lost launch response is discarded by the disposable SSH wrapper only after a real successful owner launch response exists. Client saves unknown outcome; same taskId retry retains owner task count and native process identity. Lost answer response likewise preserves and reconciles the same replyId after owner acceptance. Neither failure is DNS/pre-connect failure.
- Actual /new switches owning session file; old task keeps old owner, new task gets new owner. Answering old work from a separate client adds neither old task ID nor answer text to the new session viewport, scrollback, or message journal. Actual /resume picker then reopens the named original journal and /session proves its exact file. Fresh/reopened clients and offline cached views are also covered by the extended PTY gate.
- Parent-readable transcript mode remains readable for user/assistant/tool content, including known lifecycle envelopes; unknown fields/events and explicit raw metadata remain available. Narrow 50-column question choices retain their tail; cancel requires confirmation and Escape does not cancel.

## Limits and ownership

This is bounded Linux compiled CLI + loopback Docker/native-owner/fixture-provider evidence, not arbitrary network/crash exactly-once proof or model-quality validation. The accepted-response tests prove same-ID behavior for these fixtures, not that arbitrary external tool side effects can always execute exactly once. No real SSH target, provider, user data, credential transfer, web launch, Mac, host install, release or push. Configuration discovery remains parked. UI exposes existing human grants only; execute has no self-grant API. Capability picker grant/revoke currently requires a live task and reachable pinned owner; offline local revocation remains an explicit-command path, not a menu claim. Existing untracked-file approval/omission notice from the full merged branch is retained.

Values unchanged: actual product, bounded truthful evidence, ownership, no quiet loss, and human controls already cover this work. Updated feature report, reproducible drivers, and retained frames instead of adding another general value.

## Final checks

All three required Docker gates and both additional capability/recovery PTY gates exited 0 on final CLI SHA 9feeacbd...; each reviewed log prints the full SHA. Docker reported no running containers after owned fixture cleanup. Full frames retained at evidence/combined-dogfood-2026-09-27/reviewed; reviewed request/scope/revoke results, stale question rejection, completion-under-menu, offline fresh client, resume picker/exact resumed journal, and readable transcript directly. Before-fix frames retained separately.

TypeScript check and build passed. Final full suite run concurrently with five Docker fixtures reported 1342 pass/20 skip/1 fail: unchanged goals-sdk print-completion bound expected <=4 calls, observed 5. Earlier combined full runs passed, including 1341 pass/20 skip before the extra renderer regressions. No assertion changed; focused goals and an uncongested full rerun are recorded separately. Concurrency as cause is a hypothesis, not proven diagnosis.

Final uncongested full rerun: **1343 pass, 20 skip, 0 fail**, 30,719 assertions, 1363 tests/191 files, 125.47s. Focused goals rerun: 6 pass/0 fail. Retained both the one-failure concurrent run and clean full rerun; this does not prove the timing flake impossible. Build, tsc, git diff --check, all three required Docker gates, capability supplement and lost-launch/answer/session-resume supplement passed. No remaining fixture resources were running. Removed only this task's own node_modules symlink and .dogfood-tmp test directory after completion; unrelated /tmp contents and untracked user files were untouched.
