# Rolling activity: independent disclosures and grouped task notices

Completed-run captures/logs mentioned below are now historical Git evidence;
[recovery and retained inputs](../quality/completed-run-retirement.md). Conclusions remain here.

## Scope / durable workspaces

Integration: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_993dc486 (base bb0dba7403cde61ff9483f95f1223765f2a091e2).
Implementation: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_993dc486-5442693331ce-task_54afb092, branch bruv/implement-rolling-activity-ux-54afb092.
Independent terminal acceptance: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_993dc486-5442693331ce-task_56424178, branch bruv/independent-compiled-activity-acceptance-56424178.

CLI display projection only. Do not change task delivery ACKs, model context, journal content, ownership, compact-connector packaging, versions, README or wrapper defaults. Earlier stopped draft worktrees remain untouched.

## Actual T3 precedent inspected

Read-only source comparison by task_9cb8ad8d, independently inspected source excerpt and both PNGs by integration owner. Cached source is /home/tnfssc/Code/bruv/.cache/acp-t3-upstream-experience/source-stable at 54cda02cdeea979df2d979a4103b9b7ed770a389. Paths below are under apps/web/src/.

- components/chat/MessagesTimeline.tsx:2646–2701 builds child sections only when the activity group is open. Its button has aria-expanded but no chevron. LiveActivityRow uses secondary-label/icon-muted styling and padding at 3222–3247; tool groups likewise omit a chevron at 3339–3365.
- Individual tool detail has its own remembered/default-false expansion state at 4733–4746. This is the relevant two-level disclosure precedent, not the broader settled turn fold.
- MessagesTimeline.logic.ts:340–347 and 1159–1174 group reasoning/work, not arbitrary assistant prose, and stop at different turns/nonactivity. Agent-spawn/question/compaction/error rows are excluded. session-logic.ts:723–775 updates spawn rows by identity. CLI requirements deliberately put typed background notices in activity, rather than copying T3 spawn placement.
- The separate “Worked for…” fold does have a chevron (2358–2366) and can fold earlier assistant prose (logic:704–765). We do not copy that behavior: lasting prose/questions remain visible boundaries.
- Viewed fixture-streaming.png under the experience cache: actual spaced/subdued “Working for 8s” and “Thinking”, no chevron. Viewed ../acp-t3-bruv-filtered/10-screenshot.png: expanded “Worked for 1.1s” exposes one compact Tool row with final EXECUTE_FINISHED_FILTERED answer separate; that turn fold has a chevron. Static frames are rendered precedent, not proof of two-stage clicks.

## Validation baseline

Bun 1.4.2, frozen-lockfile install. Existing focused tests before change: 72 pass / 0 fail / 407 assertions across rolling-activity, rolling-activity-disk, task-rows and conversation-density. Raw local baseline log: /var/tmp/bruv-activity-baseline-993dc486.log. The shell wrapper is fish; use /bin/bash -c for PATH exports (a fish export left tail unavailable after the passing tests).

Final implementation and compiled proof below supersede the baseline expectations.

## Integration checks / observed fixes

Implementation 0ef6e14a29cb28808e0d550ab2783b04e48f1d4d cherry-picked as 29a481d4. Runtime preparation 852b8acb integrated before it. Normal build uses bun run prepare:assets && bun scripts/build.ts (no T3 or connector bundle build). Typecheck passed. First focused gate: 123 pass, one long-thread failure because the unchanged test expected the deliberately removed ▾ header. The captured frame showed real saved-93 stdout, not lost data. Commit 861e6f85 removes only stale chevron expectations, asserts left padding/no chevron, and retains exact original output/preservation assertions. Rerun: 1 pass, 1,049 assertions (3.43s), including regular mode, 2,101 messages / 1,000 unchanged toolResults, resize, editor draft, first/last native stdout and reopen. Compiled /ps and /resume passed in the first focused gate. Logs: artifacts/activity-ux-integration/{build,check,focused,long-thread}.log.

Review identified protected task/error detail could leak through a closed group after independent native expansion; bounded follow-up worker task_3f17c6d8 owns correction and regressions, at /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_993dc486-5442693331ce-task_3f17c6d8, branch bruv/fix-protected-detail-collapse-regression-3f17c6d8. Fresh-binary independent runtime worker task_17c92ea4 uses /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_993dc486-5442693331ce-task_17c92ea4, branch bruv/run-fresh-cli-activity-acceptance-17c92ea4.

## Final behavior and concrete review corrections

- Headers use the native output inset and semantic muted theme (no hardcoded ANSI), without a group chevron. Groups reveal compact native rows only; item detail state survives group collapse/reopen. Ctrl+O remains the native global detail control. /activity exposes both group and individual-item choices.
- Typed task-complete/task-attention messages are activity members. Adjacent callbacks join their source tool group only when every typed sourceCallId belongs to that uninterrupted segment. Otherwise a truthful “job notification(s)” activity segment preserves their location. Assistant prose, users, permissions/questions and handoff controls remain boundaries. No English-string task detection, journal rewriting, ACK/delivery or model-context changes.
- Canonical task rows still have one owner. Their status facts feed collapsed source summaries; failed/cancelled/running counts stay visible. Collapsed groups hide all child native bodies, including previously expanded task/error/notice output. Reopening restores exactly that native state. Actual handoff text and output-save warnings remain visible without leaking expanded source.
- Protected-detail fix 872bcbc3: review found old always-visible task/error protection leaked expanded detail after group collapse. Focused regressions now cover task/error/notice hide/restore and capped adverse outcomes.
- Picker fix f5f649d2: actual tmux Enter dismissed /activity but changed nothing. Each transcript paint recreates group objects, so the picker held a stale group. Resolve the stable native member against current groups on selection. Tests paint the transcript while the picker awaits; real picker now reveals rows after reopen.
- Test contract corrections preserve original evidence: long-thread uses arrowless headers, still checks original first/last stdout and all 1,000 saved toolResults. /ps checks the cancelled summary while closed, then uses real /activity to assert the exact original BETA cancelled row and still-running ALPHA identity. No timeout increase or weakened cancellation ownership assertions.

### Notification placement decision

Independent worker task_17c92ea4 reported the real picker bug and called late notification-only headers redundant. Its harness/evidence commits are 9b464609 and bd665bfe (the latter remains in its durable worktree, not cherry-picked wholesale). The picker bug is fixed. The header objection was resolved against the requested contract: the fixture emits a **lasting assistant answer after each callback**, so these are separate notification-only activity segments, not standalone raw notification prose or duplicate task cards. Removing their headers would hide accessible callback evidence; folding across answers would violate the requested prose boundaries. Adjacent, proven-source callbacks now share the tool group (1d6b1641). The final runtime assertion opens the source group and verifies exactly three canonical cards, while allowing distinct notification segments across lasting answers. This is a deliberate placement tradeoff, not a claim that callback evidence vanished.

## Final compiled acceptance

Final normal binary: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_993dc486/dist/bruv.
SHA256: 6f34075b453687fbd674c85d45dc9d58bed0c3d869f56cec25caddc96fa153dd.
Production code at f5f649d2; subsequent changes are tests/evidence only. The alternate output dist/bruv-activity-final was used while the independent worker still held the first binary; the default final binary was then separately built **and rerun**, not accepted based on a hash comparison.

Exact commands (from integration worktree, inside /bin/bash -c, Bun 1.4.2):

~~~sh
export PATH=/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin:$PATH
bun install --frozen-lockfile
bun run prepare:assets
bun scripts/build.ts
bun run check
bun test tests/rolling-activity.test.ts tests/rolling-activity-disk.test.ts tests/task-rows.test.ts tests/conversation-density.test.ts tests/execution-previews.test.ts tests/job-attention.test.ts tests/completion-notification.test.ts tests/task-monitor-tui.test.ts tests/long-thread-tui.test.ts
python3 tests/activity-runtime-acceptance-test.py
python3 tests/activity-terminal-acceptance-test.py
python3 scripts/activity-runtime-acceptance.py "$PWD/dist/bruv" /var/tmp/bruv-activity-final-default-993dc486
git diff --check
~~~

Results: typecheck passed; focused final gate **146 pass, 0 fail, 2,175 assertions** across nine files (12.93s). Python helper tests **21 pass**. Compiled runner: **rows, lifecycle, question, long_thread all passed**. Local full logs: artifacts/activity-ux-integration/final-gate-green.log, final-check.log, final-default-runtime.log. Raw command records, complete plain/ANSI frames, original fixture journals and provider requests remain in /var/tmp/bruv-activity-final-default-993dc486; private providers/tmux servers were stopped by the harness. Earlier concrete collapse probe at /var/tmp/bruv-activity-final-probe-993dc486 was also stopped.

### Direct frame review (not just hashes)

[Final samples and reviewed report (historical)](../quality/completed-run-retirement.md#recovery) were read as actual plain and ANSI frames by the integration owner:

- rows-settled: one leading column aligns both 3/2-tools headers with assistant prose, no chevron. ANSI header uses the semantic muted theme, rendered as ESC[2m dim in this clean default fixture; normal assistant prose does not. This is subdued theme differentiation, not a claim of an RGB color screenshot.
- group-open-rows: three compact check-mark rows, no source/full output. first-closed-second-open and group-reopened-independent: only RECORD-B detail is open; A/C stay compact. activity-selected proves real keyboard group disclosure after reopen.
- lifecycle-summary: one source header says 1 job failed / 1 cancelled, with no child cards while closed. lifecycle-child-rows shows one succeeded, one exit-7 failed, one cancelled card exactly once. task-detail-hidden/restored preserves native source/result expansion; lifecycle-details includes real terminal SIGTERM delivery output. Real success/failure/cancel and review wake use the normal shell manager/notification journal, not injected task text.
- question pending-reopened: actual question text and “1 /questions · waiting on you” remain visible. Saved keyboard choice survives reopened ownership; explicit /questions resume delivers it; lasting answer survives another reopen without a provider call.
- long_thread: 100 turns / 1,000 tools / 2,101 original messages. Oldest marker survives group opening, original first/last stdout is reachable, unsubmitted draft/48-column resize/reopen work, and replay makes no provider requests. Observed long startup 0.809s and reopened readiness 0.718s; these include harness timing and are **not a latency benchmark**. Existing native compiled long-thread test additionally checks regular mode and every original toolResult.

## Limits / pickup

Linux/private tmux/loopback only. No paid calls, device, Mac/Ghostty, real remote, clipboard/selection or web proof. No full-suite/hosted-CI claim (parent owns combined CI). Task running/progress projection is tested with typed running snapshots and quiet/review metadata; the compiled lifecycle case generates a real review wake, not an agent-specific live progress event. Notification headers remain separate across real lasting assistant answers by design. Regular mode remains native rather than rolling. Disk-journal clear/branch selection/reopen, /reload recreation and real ScrollView anchoring have focused regression coverage; this does not claim a new full terminal fork/clear matrix.

No global install, push, release, version, compact connector or wrapper-default edits. All stopped old drafts and user data remain untouched. Values reviewed and unchanged: existing real-path proof, stable ownership, honest limits and minimal scoped fixes cover these lessons.
