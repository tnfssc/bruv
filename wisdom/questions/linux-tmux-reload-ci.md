# Linux question TUI reload: own the tmux server (2026-10-05)

Read values.md and question implementation, extension lifecycle, rendered CLI,
interactive CLI, and picker wisdom. Existing values 1, 2, 3 and 10 cover this;
no general values change is needed.

## Failure and investigation

CI run https://github.com/tnfssc/bruv/actions/runs/37297354419, source
df6471ccce72e84807f12fb2fbbd9f74de666bce, failed only the Linux question TUI
reload. Downloaded the complete run log and the ci-failure-logs artifact
(including tests.log), rather than relying on the final summary. At
10:35:40.668 the assertion at tests/questions-tui.test.ts:93 expected 0 but
received 1 from the **second tmux new-session**. Progress, compact question
detail, and cancellation assertions had already passed. This was not a CLI
subprocess exit: the failed subprocess was the tmux client creating its PTY.
CI used Bun 1.4.2, tmux 3.4, four CPU slots, and three test workers.

The test killed the only session and immediately created another on the same
socket. tmux's default exit-empty=on asynchronously shuts down that server;
the next client can meet the dying server instead of a fresh one. Linux
reproduction of that exact lifecycle produced exit 1 with stderr
"server exited unexpectedly". Keeping the server alive removes the transition,
not merely its timing. tmux 3.4 server.c:279 also explicitly returns without
exiting when exit-empty is off.

Minimal reproduction (repeat with a unique socket per iteration):

```sh
sock=bruv-question-reload-$$
tmux -L "$sock" -f /dev/null new-session -d -s questions 'sleep 60'
# Fix: tmux -L "$sock" set-option -g exit-empty off
tmux -L "$sock" kill-session -t questions
tmux -L "$sock" new-session -d -s questions 'sleep 60'
tmux -L "$sock" kill-server
```

On local Linux tmux 3.6a, a 100-iteration comparison reproduced three failures
with the default lifecycle, all "server exited unexpectedly"; zero with
exit-empty=off. A separate first probe failed on iteration 1. Direct baseline
real-TUI runs passed 20/20 on 3.6a and 20/20 on a temporary source-built 3.4;
a single-core baseline also passed. These passing samples do not disprove the
observed lifecycle race. The same 100-iteration lifecycle probe on local 3.4
(both unrestricted and four pinned CPUs) passed with either setting; ten
baseline real-TUI runs with 3.6a verbose tmux logs also passed. The old test
discarded tmux stderr, so the historical
CI error text cannot be recovered from its logs; do not claim it was captured.

## Small fix and scope

Only tests/questions-tui.test.ts changes. Use /dev/null as the private tmux
configuration; after first launch set exit-empty=off. Kill and restart the CLI
session exactly as before, then finally kill the test-owned server. Assert the
kill result and retain stderr for launch/option/kill assertions. All original
progress, footer, pending/cancelled persistence, reload and compact-ID assertions
remain; the 20-second test budget and polling budgets are unchanged. No retries,
extra sleeps, product workaround, or Pi dependency/adaptation changes.

## Checks and handoff

- Current source paired CLI build and bun run check: passed.
- bun test tests/questions*.test.ts tests/tui-helpers.test.ts tests/footer.test.ts:
  70 passed, zero failed, 693 assertions, including both real PTY question tests.
- First shared Linux gate: 1,949 passed, 30 skipped, ten unrelated shell-test
  failures caused by local fish startup emitting mise untrusted-config warnings
  into command output. The question TUI test passed (1,806.81ms). Rerun uses
  SHELL=/bin/bash like CI, rather than changing product code or trust settings.
- Fixed real-TUI test repeated 20/20 successfully with tmux 3.4 and Bash,
  with all 24 assertions each run.
- Final shared Linux CI gate: passed install, format, lint, typecheck, paired
  build, offline transport, complete root suite, and standalone paired smoke.
  1,959 passed, 30 skipped, zero failed, 35,550 assertions across 272 files
  (72.45s test phase). Command: SHELL=/bin/bash with tmux 3.4 first on PATH,
  taskset -c 0-3 bun run ci. Paid/provider/device skips remain intentional.
- Raw logs in this runtime: /tmp/bruv-ci-37297354419.log,
  /tmp/bruv-ci-artifacts-37297354419/tests.log,
  /tmp/bruv-tmux-3.6a-lifecycle-compare.log,
  /tmp/bruv-questions-fixed-focused.log, /tmp/bruv-questions-fixed-repeat.log,
  and /tmp/bruv-questions-fixed-ci-bash.log. Final CI step logs also live under
  artifacts/ci/ (ignored; not part of the commit).

Worktree: /home/tnfssc/.bruv/worktrees/t3code-fcaffdf2-5442693331ce-task_571cd247
Branch: bruv/fix-linux-real-tui-questions-test-failur-571cd247
Parent source: df6471ccce72e84807f12fb2fbbd9f74de666bce.
No push/release/install. The independent Pi 1.0.3 dependency job is outside this
change. No macOS, paid-provider, audio-device, or production-web acceptance is
claimed by these Linux offline checks.
