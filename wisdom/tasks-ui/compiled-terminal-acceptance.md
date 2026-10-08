# Proposal #23: independent compiled-terminal acceptance preparation

Completed-run captures/logs mentioned below are now historical Git evidence;
[recovery and retained inputs](../quality/completed-run-retirement.md). Conclusions remain here.

This is a prepared harness, **not acceptance of the in-progress implementation** in task_9f8bbb2c. No runtime edits or build. Read that worktree's rolling-activity-proposal.md, rolling-activity-research.md and ui-discussion-checkpoint.md, plus wisdom/values.md. Keep the latest human-approved compact action/footer choices; do not redesign native expanded details to match a hypothetical screenshot.

## What is reusable

Run scripts/activity-terminal-acceptance.py with Python 3 and tmux. It launches an **explicit already-compiled binary** into a real 120\u00D740 fullscreen PTY. It never builds, starts the source CLI, uses paid inference, or launches remote/agent workers. A loopback Responses provider emits actual commentary/final_answer phases, unknown meaningful prose, and real execute calls. Files, sessions, gates, provider requests, plain/ANSI visible frames and raw PTY output live in the chosen disposable evidence directory.

Patterns reused: scripts/remote-pty-e2e.ts (compiled binary + isolated tmux + visible pane capture), tests/fixtures/remote-e2e/fake-provider.ts and models.json (synthetic HTTP provider + real execute transport), scripts/tui-harness.ts and tmux.conf (keyboard, frame recording, extended keys). The existing TUI harness suffices for basic recording but assumes this checkout's dist/bruv and a paid default model; this driver accepts the implementation owner's eventual binary without editing or rebuilding that checkout, adds controlled late jobs, mouse bytes and same-session reopen.

The launched CLI receives a clean environment, not the invoking worker's BRUV_SUBAGENT_DEPTH/TYPE, job bridge, native placement, package directory or credentials. An initial smoke inherited child role and made /questions unavailable; isolating the test parent fixed that observed harness problem. Fixture setup failures remain visible rather than yielding a fabricated success answer. Only the tested Keep concise saved-answer choice is scripted.

## Commands once the implementation binary exists

Run from the worktree containing this script. These are Bash examples; set BIN to the owner's actual ready binary. Each start needs a **nonexistent** evidence directory. Do not run bun build in the owner's worktree to make it ready.

~~~bash
python3 tests/activity-terminal-acceptance-test.py
A=scripts/activity-terminal-acceptance.py
BIN=/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_9f8bbb2c/dist/bruv
R=/tmp/bruv-activity-acceptance-$(date +%s)
python3 "$A" start "$R" "$BIN"
# Printed tmux attach command allows human reading/selection/copy.
python3 "$A" send "$R" 'Review the guide and check the setup instructions.'
python3 "$A" record "$R" 4
python3 "$A" frame "$R" guide-settled
~~~

Wait for the final answer, not a fixed sleep. Inspect recorded **visible** frames: commentary should replace activity rather than leave a collapsed ladder. The fixture makes exactly three unique outer execute calls. Under proposal #23, the settled summary counts 3; full final answer and the unphased Important: credential note remain visible. Count must not include streaming events, provider requests, or inner helpers. If the owner intentionally changes segment boundaries around unphased notes, record that contract before changing the expected grouping; the note itself must survive.

Open/close using the actual /activity picker (do not guess a title or row coordinate):

~~~bash
python3 "$A" send "$R" /activity
python3 "$A" frame "$R" activity-picker
python3 "$A" key "$R" Escape       # no view change
python3 "$A" send "$R" /activity
# Up/Down if needed; Enter selects the observed guide group.
python3 "$A" key "$R" Enter
python3 "$A" frame "$R" group-open
python3 "$A" key "$R" C-o
python3 "$A" frame "$R" native-details
~~~

Verify original guide/setup/configuration output and source remain native, not regenerated summaries. Ctrl+O exposes contained groups and all native details, including an old group; toggle back. Use /activity again to close a chosen group. Opening details must not add a provider request or execute anything. Escape from the picker returns to the editor without changing expansion. This driver does not assert unimplemented picker labels.

For mouse, capture the frame, locate its actual summary row, then use python3 "$A" click "$R" X Y with **1-based visible terminal cells**. This sends literal SGR press/release bytes to the CLI (not tmux copy-mode and not a direct handler call). Click a settled group, then a native tool row; click body prose without collapsing. Attach tmux and drag/copy output separately: injected clicks do not prove selection, clipboard or real terminal artifact behavior.

### Parallel, late completion, new user and continuation

~~~bash
python3 "$A" send "$R" 'Run parallel checks.'
python3 "$A" frame "$R" checks-yielded
# Wait for "The checks are running" before the next request.
python3 "$A" send "$R" 'While checks run, read the release note.'
python3 "$A" frame "$R" foreground-running
python3 "$A" release "$R" fast
python3 "$A" record "$R" 2
python3 "$A" frame "$R" late-fast
python3 "$A" release "$R" foreground
python3 "$A" release "$R" slow
python3 "$A" record "$R" 3
python3 "$A" frame "$R" continued
~~~

The launch execute starts two real shell jobs, slow first and fast second. It counts **one**, not two. Fast settles out of order while the newer foreground execute waits on its own gate. Old job status must update its source group without replacing Read the release note. Releasing foreground ends the new stretch; shell completion delivery invokes the provider again through the normal continuation path, with no new tool calls. The fixture currently emits the same concise background-update prose for each completion; two such answers are deliberate fixture responses, not evidence of duplicate tool delivery. Record actual continuation grouping and no stale spinner.

### Scroll anchor and short/narrow rendering

While foreground is gated, use /activity to open the older guide, Ctrl+O to expose its native output, and PgUp (driver key PPage or attached terminal wheel) to read away from the bottom. Capture the **specific visible text and position**, release fast, capture again; reading position must not jump to the newest preview. Toggle the observed group header while not following the end and verify the same header remains reachable. Click coordinates must be re-read after every resize/expansion.

~~~bash
python3 "$A" resize "$R" 60 12
python3 "$A" frame "$R" narrow
python3 "$A" key "$R" PPage
python3 "$A" frame "$R" reading-away
# Release a not-yet-released gate here; compare visible reading text, not scrollback.
python3 "$A" resize "$R" 120 40
~~~

Do this before the release commands above, or use a fresh fixture. Existing tmux scrollback alone is not semantic-anchor proof. The documented research probe hid a group header during bottom-follow expansion; this check intentionally observes both reading-away and following-end behavior, without assuming identical anchoring.

### Meaningful saved question and reopen

Use a fresh directory, or do this last (the provider gives a saved answer precedence over other fixture requests):

~~~bash
Q=/tmp/bruv-activity-question-$(date +%s)
python3 "$A" start "$Q" "$BIN"
python3 "$A" send "$Q" 'Ask about notes.'
python3 "$A" frame "$Q" pending-question
python3 "$A" send "$Q" /questions
python3 "$A" frame "$Q" question-picker
# Select the actual question, then Keep concise using normal keyboard controls.
python3 "$A" key "$Q" Enter
python3 "$A" frame "$Q" answer-picker
python3 "$A" key "$Q" Enter
python3 "$A" record "$Q" 2
python3 "$A" frame "$Q" answer-used
wc -l "$Q/requests.jsonl"
python3 "$A" reopen "$Q"
python3 "$A" frame "$Q" reopened
wc -l "$Q/requests.jsonl"
python3 "$A" send "$Q" /activity
python3 "$A" frame "$Q" reopened-picker
~~~

A real questions.ask/block creates the human-owned record. The human picks an answer; ordinary speech/text is not substituted for /questions. Normal saved-answer delivery starts a parent continuation that resolves the record and yields lasting prose. No hidden routing JSON should leak. On reopen, compare persisted question status, original call identities/counts, note/final answers and native details; no replay inference requests or new calls. Expansion may reset. Reopen currently uses --continue and the same explicit session-dir/cwd; session selection is not inferred from global history.

If in-app /reload or /resume/branch parity is claimed, repeat these observations using their existing controls. That is follow-up integration review, not a new fixture state-machine matrix.

Cleanup (also on failure):

~~~bash
python3 "$A" stop "$R"
python3 "$A" stop "$Q"
~~~

Stop releases every fixture gate, kills only its private tmux server/provider, and retains evidence. Do not delete a root until its stop has run. Compare state.json's compiled-binary SHA256 with the owner's delivered build; hashes are provenance, not visual acceptance.

## Preparation evidence / limits

2026-10-03: six focused Python fixture tests passed. Baseline compiled CLI /home/tnfssc/.local/bin/bruv SHA256 e53ea361d57316d9a43ec12730e10379db755cbcc7069afa6afae2353edbf083 was exercised without building. Actual visible frames were inspected: three successful guide executes, native Ctrl+O source/stdout, SGR mouse expansion of a native settled tool, two gated real shell jobs settling out of order while foreground remained busy, normal completion callbacks, /questions keyboard choice \u2192 resolve \u2192 lasting answer, and --continue replay. Private providers/tmux sessions were stopped. Small captures are in evidence/terminal-preparation; the fuller local artifacts remain under /tmp/bruv-activity-final-smoke-59099cce and /tmp/bruv-activity-isolated-59099cce.

Baseline **does not implement rolling groups or /activity**. These captures prove the transport/compiled/keyboard/native-detail/question path is runnable; they prove neither collapsed group counts, /activity, group mouse behavior nor scroll anchoring. The implementation owner's dist/bruv was absent during preparation. No actual implementation acceptance, live provider, remote host, image/artifact, clipboard, regular-mode parity, branch navigation, stop/cancellation, failure recovery or web/placed-root parity is claimed. Those are deliberately outside this modest gate unless the owner promises them. A real compiled pass requires inspecting new frames, not treating these fixture tests or baseline hashes as product proof.

Wisdom/values unchanged: existing \u201Cactual visible frames, meaningful human controls, leave proof and limits together\u201D guidance already covers this preparation; no new general lesson.

## Current independent rolling gate

See [rolling runtime acceptance preparation (2026-10-04)](rolling-runtime-acceptance-2026-10-04.md) for the parent-supplied integration binary path, bounded row/detail/notice/question/long-thread runner and explicit pending real-runtime/ANSI review. Baseline preparation above remains transport evidence only.
