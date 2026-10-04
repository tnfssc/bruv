# Focused integrated connector review — 2026-10-04

Read-only review of 156e2450. Read values, composition, task-binding and implementation checkpoint. No provider calls, T3 changes, product edits or release. Do not treat the known app-worker profile path issue as a new finding.

## P1: autonomous completion can settle a pending human turn

Locations: src/claude-compat/runtime.ts:695–710 admits only text/images and drops the inbound user UUID; src/claude-compat/frontend.ts:50,69–89 emits results without consumed user_message_uuid(s) or origin. The settled event at frontend.ts:109–110 publishes the same shape for human and autonomous work.

Bounded reproduction uses the actual Pi session, execute bridge and TaskManager, with an offline stream function (no provider):
1. Initial prompt starts a real shell (sleep 0.1; echo REVIEW_WAKE) with waitSeconds:0 and settles.
2. Its real completion starts an autonomous Pi continuation; gate that stream.
3. Submit HUMAN_NEW with a distinct native UUID; gate emitInput for that text before admission.
4. Release the autonomous stream while HUMAN_NEW is still in preflight, then release input.

Observed results: initial done → autonomous done → human done. The autonomous model context does NOT contain HUMAN_NEW. All three results omit user_message_uuid, user_message_uuids and origin. The pending user therefore cannot be distinguished from the earlier wake by the native consumer.

The reproduction also extracts/transpiles the unmodified native ClaudeAdapterV2 claudeEchoedPromptUuids/isClaudeResultForOtherTurn functions from source-nightly. Feeding the actual autonomous frame with the pending human UUID and promptEchoMode:unknown returns false (foreign result not detected). Adapter handleSdkMessage then routes that result to the active pending turn, which finalizes it at 6276–6282 (routing lines 6372–6492; predicate 2387–2399). This proves emissions plus the real adapter predicate, not a new rendered browser acceptance run.

Action: retain native prompt identity through actual Pi consumption and project its supported early/result echo; identify autonomous results with the supported non-human origin. Do not label a queued user consumed at onUser entry or add a second scheduler. Add this race to focused acceptance.

Reproduction fixture retained outside Git: /tmp/native-connector-review-d2ca7c26.test.ts. Copy it temporarily into tests/claude-compat-review.tmp.test.ts (relative imports), then run Bun 1.4.2 test on that file; remove it afterwards. Uses the existing runtime-test fixture helpers and a spy on the real emitInput seam. Two successful runs; last has 4 assertions including the extracted adapter predicate. Source/check output in session job task_3a61f0b9.

## Other focused checks: no fresh findings

- Stop/EOF ownership and permission/credential scope: existing focused runtime/launch/composition/credential suites passed, 43 tests / 228 assertions. Real background PID exits on close; foreground-only interrupt preserves it; preflight interruption prevents late provider start.
- Native task/history/permission checks with required pinned SDK path: 21 tests / 139 assertions passed, including actual worker journal, SDK child-history mapping, terminal lifecycle, reattachment and permission cancellation.
- No duplicate human-dialog/fork/local-subagent UI work undertaken. Committed child messages only, missing/pruned-journal diagnostics, independent child controls and foreground→background adapter transition limits remain documented limitations, not new bugs.

Values unchanged: existing one-owner, truthful evidence and no-second-scheduler values already cover this finding.
