# Bounded repeat-offender audit (2026-10-05)

Base: 9906f92e (v0.16.8 preparation), Bun 1.4.2 (744846f84), Linux/private
tmux, freshly built dist/bruv and dist/bruv-claude-compat. Owned tests:

tests/task-monitor-tui.test.ts, tests/execution-previews-tui.test.ts,
tests/goals-sdk.test.ts and their fixtures. Read values, task-monitor wisdom,
[readiness proof](ps-ci-readiness-2026-10-04.md), goals controller/extension and
[release v0.16.1](../releases/release-v0.16.1.md).

## Current-fixed, not a new rewrite

The historical eleven /ps failures had different startup/readiness/deadline/render
signatures; they are not evidence of one surviving race. Current startup uses a
harmless command handshake, jobs live until test actions, and 8b947729 waits for
the monitor's view/controls rather than names already in the transcript. Its
existing controlled red proof remains linked above. a10f033c checks the exact
cancelled child through Activity disclosure after collapsed-group rendering
changed; it did not remove the target identity or confirmation assertions.

The preview fixture waits for a saved task row. Traced the SDK startup owner:
interactive-mode.js installs key handlers and rebinds extensions before
renderInitialMessages. This marker is unlike /ps transcript names before a new
panel opens. Compact/error/detail/narrow-width assertions all pass unchanged.

Goal accounting belongs to src/goals/controller.ts and src/goals/extension.ts.
ce0f5a8d already holds print jobs until the agent_end accounting boundary, then
releases on the next event-loop turn before the native completion wait. A job
that finishes before handoff does not activate helper-wait accounting for the
first turn. Separate v0.16.1 wrapper contamination was fixed by b39d0f4e's five
connector child-process boundaries; do not merge this with the extra-call issue.

**No remaining fixture or product defect demonstrated. No maintained tests,
helpers, assertions, sleeps, deadlines or product sources changed.**

## Exact checks and controlled evidence

- `bun run build`: passed, both binaries built. Worktree mise trust warning
  did not stop the directly available Bun; no trust configuration was changed.
- `bun test tests/task-monitor-tui.test.ts tests/execution-previews-tui.test.ts tests/goals-sdk.test.ts`:
  [baseline](evidence/repeat-offender-audit/baseline.txt) 9 pass / 0 fail / 155
  assertions; [post-control green](evidence/repeat-offender-audit/fixed-tests.txt)
  9 pass / 0 fail / 155 assertions. /ps took 7.02 s and 6.92 s respectively.
  These were baseline and restored-fixture checks, not retry-on-failure.
- Controlled lifetime negative control: copied goals-sdk.test.ts to
  tests/goal-cycle-early-completion.audit.test.ts. Only in that disposable copy,
  replaced the print job's gated command with `sh -c 'exit 7'` and inserted
  `while ((await jobs.inspect(job.id)).status === "running") await new Promise(resolve => setImmediate(resolve));`
  before handoff. This forces completion before handoff without a timing sleep.
  `bun test tests/goal-cycle-early-completion.audit.test.ts -t 'print completion cycles pause'`
  [failed as expected](evidence/repeat-offender-audit/early-completion.txt):
  received 5 calls, unchanged maximum 4. This is a forced version of the already
  fixed lifetime flaw, **not** a failure of today's maintained fixture or proof
  of the exact historical scheduler order. Removed the copy before green check.
- Wrapper order: a disposable tests/goal-sdk-wrapper-order.audit.test.ts imported
  native-shake-sdk, claude-compat-composition, claude-compat-live-frontend,
  claude-compat-prompt-ownership, claude-compat-runtime, claude-compat-task-binding,
  then goals-sdk (each ./<name>.test). Ran
  `bun test tests/goal-sdk-wrapper-order.audit.test.ts`:
  [18 pass / 0 fail / 185 outer assertions](evidence/repeat-offender-audit/wrapper-order.txt).
  Native shake ran first; all five connector children and all six goal cases
  passed. Removed shim. This targets wrapper ordering, not the full release gate.

## Limits and handoff

No unresolved defect established within this bounded scope. These checks do not
rule out all hosted-load/startup deadlines, macOS terminal races, or full serial
release interactions. No full suite, CI/workflow/ci.sh-test changes, prepush,
actionlint, ffmpeg work, install, push, PR or release. Values unchanged: existing
real-path proof, distinct ownership and honest limits cover the lesson. Future
failures need their exact assertion/frame and lifetime, not a blanket retry.
