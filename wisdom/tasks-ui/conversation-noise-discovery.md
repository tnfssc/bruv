# Conversation noise discovery

The user said the CLI was too verbal. They asked for code-backed suggestions, then approved action labels, named task completions and shorter neutral attention rows. They will use Ctrl+T themselves. Grouping and live status redesign are out of scope.

## Why the earlier examples were wrong

- src/ui/execution-previews.ts already gives each settled execute call one row. It flattens JS source, not the meaning of shell commands. Human action labels need explicit tool metadata.
- Green execute status means the outer JS call succeeded. Nested shell failure is a returned job result unless code throws. Neither a call label nor a finished worker proves feature success.
- Agent launch title was folded into displayCommand, not carried as a separate local task field. Source/prompt parsing is not a sound way to recover it.
- Attention is a scheduled observation: five minutes quiet, or ten-minute review intervals. It is not evidence of failure, stuckness or a human question. Normal delivery wakes the parent; quieter human rows must not suppress that wakeup.
- Pi 0.99.1 already has app.thinking.toggle (Ctrl+T by default) and persisted hideThinkingBlock. Hidden reasoning becomes Thinking... without lowering model reasoning quality. Ordinary assistant commentary is separate. The pasted paragraph alone did not identify its content type.
- /ps is the existing task monitor. Grouped check rows are not existing behavior or a text-only change.

## Outcome and handoff

Implemented in [action labels and quieter notices](action-labels-and-quieter-notices.md). That note has code paths, worker/PR worktrees, proof, limitations and scope. Optional execute label and explicit local task title now supply human names. Missing metadata keeps the legacy source/ID fallback. Native and SSH paths keep truthful fallback rather than expand their protocols.

Read-only traces: task_3c8b2c83 (notices), task_75959b21 (narration/execute), task_62143032 (integration). Main corrected the narration trace's missed Pi thinking toggle with dependency source and a native render probe. Review task_58fd4378 found cancellation wording and narrow-row outcome risks; follow-up fixed both. No thinking settings, scheduler intervals or grouping changed.

Final proof: 184 focused tests, typecheck, and 16 actual compiled-terminal assertions passed. No live provider or install. See the feature note for build limits and evidence. User asked for a PR on develop when done. Other remote-workspace notes and values.md edits in the parent tree are not part of this work.

Values stayed unchanged for this feature. Existing values cover honest UI state, real wiring and proof that says what was checked. No new general rule was needed.
