# PR64 focused CI fixes

Owner worktree: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_05663b00,
branch bruv/web-alignment-ci. Base cad214c801b78b27dd722f58b7f7fb6fdbea8b70.
Parent keeps PR64; no push, new PR or hosted rerun. No UI edits.

Run 37970824511 Linux x64 shard 3 failed the native capture and markdown
equivalence tests. Other lanes passed. Policy is downstream of Linux, not
another failure. Full log: /var/tmp/bruv-alignment2-ci-failed.log.

## Why and fix

Tmux pane_dead means its PTY fd is closed, not that SIGCHLD has been reaped.
Hosted tmux 3.4 (confirmed in the log) and upstream 3.5a format.c read
fd == -1 for dead, but require PANE_STATUSREADY
and WIFEXITED for status; signals use WIFSIGNALED and pane_dead_signal.
server.c sets status readiness after waitpid. Read upstream source at
https://raw.githubusercontent.com/tmux/tmux/{3.4,3.5a}/format.c and
https://raw.githubusercontent.com/tmux/tmux/3.5a/server.c. Native tmux 3.6a probe saw
normal 1:0:, deliberate early EOF 1:: then 1:0: after 310ms, and TERM
1::15. Hosted log lacked a signal query, so it cannot prove which empty
status it saw. It does prove the old completion predicate was insufficient.
Detach now reads dead/status/signal together, waits for a child result,
rejects signals and still requires exactly status 0. Capture/removal only
follow success. Failed panes retain evidence and server cleanup. Tests cover
pending result, nonzero exit, signal exit, original native cat, and native
EOF before child exit. Each native case keeps dimensions, reopen, timeline,
raw viewport/scrollback and isolated state assertions.

Markdown is a synchronous equivalence workload: 29^3 = 24,389 boundaries
plus 10 source cases and deep comparisons of complete tokens and links.
An instrumented isolated copy measured 372ms for boundaries, then
81/276/467/564ms for the 50k, 1MiB, 40k-line and late-heading cases.
Large original regexes dominate; they are intentionally retained as the
reference, including Bun effort-limit behavior. Actual isolated test took
1972ms. CI uses bun test --parallel=3 with native --shard=3/3. On one
logical CPU with two other real test files, the same test took 4314ms;
hosted hit 5119ms against 5000ms. Give only this equivalence test 10s.
Keep every source and assertion, with no parser/runtime or runner change.
Separate structural work tests remain at their existing budget.

## Commands and evidence

All checks use TMPDIR=/var/tmp (/tmp is full). Bun 1.4.2 (744846f84),
Linux x64, tmux 3.6a. Local CPU affinity normally 0–15; constrained
parallel measurements use CPU 0, not a claim to match hosted hardware.

- TMPDIR=/var/tmp bun test tests/tasks/task-placement-clean-capture.test.ts tests/ui/sdk-markdown-blocks.test.ts:
  before fix, 12 pass / 0 fail, 54,376 assertions, 2.39s.
  /var/tmp/pr64-focused-before.log.
- TMPDIR=/var/tmp bun /var/tmp/pr64-tmux-probe.ts:
  completion states above; /var/tmp/pr64-tmux-probe.log. Probe uses a
  unique tmux socket and finally kills its server and removes its root.
- TMPDIR=/var/tmp bun test /var/tmp/pr64-markdown-profile.test.ts -t 'line-bounded hooks':
  1 pass, 24,399 assertions, 1762ms; /var/tmp/pr64-markdown-profile.log.
  Disposable copy uses absolute SDK imports and per-loop clocks only.
- TMPDIR=/var/tmp taskset -c 0 bun test --parallel=3 tests/ui/sdk-markdown-blocks.test.ts tests/performance/terminal-perf-tool-events.test.ts tests/performance/terminal-perf-tools.test.ts:
  before budget change, 29 pass / 0 fail, 57,618 assertions, 12.04s.
  /var/tmp/pr64-three-before.log. No timeout reproduced locally.

- TMPDIR=/var/tmp bunx biome format --write scripts/tui/task-placement-clean-capture.ts tests/tasks/task-placement-clean-capture.test.ts tests/ui/sdk-markdown-blocks.test.ts:
  formatted 3 files; 2 fixed.
- TMPDIR=/var/tmp bun test tests/tasks/task-placement-clean-capture.test.ts tests/ui/sdk-markdown-blocks.test.ts:
  after fixes, 15 pass / 0 fail, 54,417 assertions, 2.87s; equivalence
  1852ms. /var/tmp/pr64-focused-after.log. An interim PTY-only run
  found the old two-query mock expectation; updated to the atomic snapshot.
- TMPDIR=/var/tmp bun run format:check; TMPDIR=/var/tmp bun run lint;
  TMPDIR=/var/tmp bun run check: all exit 0. Format: 958 files, 2 existing
  size warnings. Lint: 1290 files, 870 warnings / 1752 infos, no errors.
  Check includes prepare:assets and tsc --noEmit. Logs:
  /var/tmp/pr64-{format:check,lint,check}.log.

- TMPDIR=/var/tmp taskset -c 0 bun test --parallel=3 tests/ui/sdk-markdown-blocks.test.ts tests/performance/terminal-perf-tool-events.test.ts tests/performance/terminal-perf-tools.test.ts:
  after change, 29 pass / 0 fail, 57,618 assertions, 12.76s; equivalence
  4535ms. /var/tmp/pr64-three-after.log.
- TMPDIR=/var/tmp bun test --rerun-each=10 tests/tasks/task-placement-clean-capture.test.ts -t 'native isolated PTY':
  20 pass / 0 fail, 620 assertions, 2.97s; /var/tmp/pr64-native-repeat.log.
- git diff --check: exit 0. Only capture script, focused tests and this
  wisdom changed. Working-state review found no UI or generated edits.

Values unchanged: existing actual-path proof, measured-work and honest-gap
principles apply. No new general value is needed. Full suite, compiled
product capture, hosted CI and macOS are outside this focused local proof.
