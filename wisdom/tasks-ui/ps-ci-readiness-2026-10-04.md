# /ps CI readiness must identify the active view (2026-10-04)

CI run 37184257701 at a9c38d283a4ec7e138afccbb15f342b963a4ff95 had
1,978 passing tests and one failure at task-monitor-tui.test.ts:158:
`Missing Inspect task_, ALPHA-live`; the captured pane was the Running jobs roster.
Parent's full log: /home/tnfssc/Code/bruv/artifacts/develop-37184257701-failed.log.

## Root cause and fix

The test waited for ALPHA and BETA anywhere in the pane after submitting /ps.
Both are already present in settled tool rows. All ten locally traced baseline
runs accepted an editor/autocomplete frame, not the monitor. They passed by
scheduler luck; the unchanged baseline also passed once before tracing.

The SDK's showExtensionCustom installs the component in a Promise continuation:
replace the editor, setFocus(component), then requestRender. A command being sent
or transcript job names being visible does not prove that transition finished.
An inspect Enter received before that transition goes to the editor; /ps then
appears in roster mode. The panel's own handleInput correctly toggles inspection.
No product defect or need to change confirmation ownership was demonstrated.

Require Running jobs, Live preview, and Enter/i inspect together with the job
names before sending the inspect key. These view/control markers are absent
from the settled transcript. Also assert the inspected ID equals the selected
ALPHA roster row. All existing stop/confirmation/identity assertions remain.
Polling attempts, interval, startup fixture delay and test timeout are unchanged;
no sleep, retrying action key, or timeout inflation was added. The helper unit
regression rejects a stale transcript frame and accepts the subsequent roster.

## Controlled reproduction (not shipping code)

The deterministic input-event gate in
[evidence/ps-ci-readiness/gated-repro.patch](evidence/ps-ci-readiness/gated-repro.patch)
yields the real /ps handler until the next stdin event. The test waits for the
gate's file handshake, then sends its premature inspect Enter. That input is
consumed with the editor still focused; the gate releases and the roster appears.
This reproduces the CI error and real pane shape without a timing sleep:
[evidence/ps-ci-readiness/gated-repro.txt](evidence/ps-ci-readiness/gated-repro.txt).
This forces the relevant scheduling window, not a claim to have recorded CI's
exact event ordering. None of the gate/debug/env modifications remain in code.

To rerun, use a separate disposable checkout at the failing base, not this fix:

~~~sh
FIX=/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_25c7f69c
REPRO=$(mktemp -d /tmp/bruv-ps-repro-XXXXXX)
git worktree add --detach "$REPRO" a9c38d283a4ec7e138afccbb15f342b963a4ff95
cd "$REPRO"
git apply "$FIX/wisdom/tasks-ui/evidence/ps-ci-readiness/gated-repro.patch"
export PATH=/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin:$PATH
bun --version # 1.4.2 (744846f84)
bun install --frozen-lockfile
bun run build
bun test tests/task-monitor-tui.test.ts -t 'real TUI /ps'
# Expected: exit 1, Missing Inspect task_, ALPHA-live; captured Running jobs.
~~~

## Fix validation

Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_25c7f69c.
Bun above was invoked directly/placed first in PATH; the worktree mise config was
untrusted. Normal maintained bun run build prepared assets and compiled BOTH
dist/bruv and dist/bruv-claude-compat after removing the probe.

Completed checks:

~~~sh
# 10 invocations, each exercises compiled /ps and /resume: 20 pass, 0 fail.
for i in $(seq 1 10); do bun test tests/task-monitor-tui.test.ts || exit $?; done
# 38 pass, 0 fail, 269 assertions (including ownership/confirmation safety).
bun test tests/task-monitor.test.ts tests/task-monitor-source.test.ts tests/remote-jobs.test.ts tests/tui-helpers.test.ts
bun run check # pass
bunx biome check tests/task-monitor-tui.test.ts tests/tui-helpers.test.ts # pass
~~~

Full local logs and traced baseline frames remain in artifacts/ps-ci-race/.
fixed-repeats.log records all ten runs; final-unit.log, typecheck.log and
final-build.log record the other gates. A separate instrumented COPY of the
fixed real /ps test records roster, ALPHA inspection, BETA confirmation with
both jobs present, and only BETA cancelled in fixed-frames.log; the copy is
removed afterward. The shipped binary contains no probe environment hook.

Limits: Linux/private tmux/local fixture provider only. No Mac/Ghostty, hosted CI,
real remote host or live provider proof; no full-suite gate, install, push or
release. Parent owns integration and hosted CI. A deterministic forced failure
plus real fixed-run repetition is not a guarantee against all terminal races.

Values unchanged: existing real-path proof, honest limits, safety and simplest
working fix guidance already covers this feature-local readiness lesson.
