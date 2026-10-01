# Action labels and quieter task notices

## Choice

The user approved short execute action labels, human task names in completion rows, and neutral routine task checks. They will use the existing Ctrl+T toggle themselves. No thinking toggle, settings, grouping, live task-status design, scheduler timing, execution, or capture policy changed.

Read the conversation noise discovery note in /home/tnfssc/Code/die/wisdom/tasks-ui/conversation-noise-discovery.md, plus values and nearby task UI notes. This change builds on [the prior cleanup](ui-cleanup-2026-09-14.md) and [neutral attention color](attention-notice-color.md).

Owner worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_0caeac44.
Branch: die/action-labels-and-quieter-task-notices-0caeac44.
Base: 9a6ec0100b0bd961333bada479935d11b06ae143.

## Paths and behavior

- src/typescript/extension.ts adds an optional string label to the real execute parameter schema. renderCall reads it from incoming args; renderResult reads it from context.args. Only code reaches executeIsolated. A missing, blank, or unusable display label keeps the old code preview. src/ui/execution-previews.ts strips terminal/control sequences and folds labels to one line. Expanded rows still show full source and result, not a replacement summary.
- src/prompts/execute-description.md and execute.md tell models to use short action labels, such as “Read task UI code” and “Run focused tests.” A label describes an attempt, not an unverified success finding. The schema keeps it optional.
- src/tasks/job-service.ts carries the existing subagent title explicitly on inherited launches, worktree preparation, and activation. TaskLaunch, AgentPreparationLaunch, and TaskSummary in task-manager.ts carry that optional field. Summary snapshots and terminal inspections retain it. completionDiagnosticDetails in src/agent/extension.ts already copies summary metadata, so no new delivery channel is needed. No source, command, or prompt parsing supplies a title.
- Completion rows use that title where present, otherwise the ID. “Finished” means the worker/process ended; it does not mean the feature is ready. Failed, cancelled, timed-out, running, and unknown states stay distinct. The small-batch expanded notification also includes a bounded Title line in completion-notification.ts. Batch caps, omitted-failure counts, and delivery/wakeup ownership are unchanged.
- Routine collapsed attention rows use the existing notice reasons, quietForMs, and elapsedMs: “Task check · task_fixture · quiet 5m.” Durations are whole minutes rounded down. Reviews show “review 10m”; combined reasons show both. They use normal color and no warning glyph. Old/missing metadata gets a neutral expand-for-details hint. Expanded checkpoint text is unchanged. job-attention.ts and its five-/ten-minute schedule are untouched.
- The same custom message type can carry SSH human-action notices. Those must not become routine neutral checks. The renderer uses existing remote metadata to keep human action, cancellation, and unknown states visible, with the existing encoded SSH ID. A remote “done” is shown neutrally as “finished,” never as verified feature success. Invalid IDs fall back safely. No SSH or native task protocol was extended. Native launch already accepts title; its returned task schema does not carry one. Where title metadata is absent, keep the ID fallback rather than invent a name.
- Truncation and output-save errors still come before the action label. Handoff copy stays visible; if a handoff also has truncated/unsaved output, its diagnostic row now stays visible too. Full captured-source/result expansion and existing image/background summaries remain intact.

## Proof

Final focused run: 180 tests passed, 0 failed, 1,056 assertions across 14 files (task_4cbed23f). The final label/capture assertion was then made type-safe and rerun: 1 passed, 6 assertions (task_51b79a07). Final bun run check passed (task_42fe9a2c); focused Biome formatting and git diff --check passed. Local fixture CLI compilation passed (task_9325fbc7). No live provider was used. Tests include the registered tool schema and guidance, real native Pi ToolExecutionComponent and CustomMessageComponent rendering, and a local JobService launch through a real short-lived fixture process to its background completion. Worktree launch tests check title at preparation/activation/inspection. Tests cover fallback, plain-text sanitizing, narrow rows, failed/cancelled/timed-out/unknown state, omitted failures, truncation, output-save errors, expansion, batching, attention scheduling, native routing, SSH delivery, and compiled execution.

Native component fixture rows checked:

- … executing · Read task UI
- ✓ executed · Read task UI
- ✗ execute failed · Read task UI
- ✓ Inspect renderer finished
- Task check · task_fixture · quiet 5m

Expansion assertions recover source/output/worker/checkpoint sentinels. These are native component fixtures, not an interactive PTY or live-model acceptance run. The local launch fixture substitutes a tiny process for a model worker; it proves metadata delivery, not worker quality.

Focused files: action-label-wiring, execution-previews, job-service, task-manager, conversation-density, job-attention, completion-notification, completion-batcher, t3/native-routing, typescript-execution, worktree-workspace, prompts, t3/local-notifications, and remote-job-delivery (all under tests, with .test.ts suffix). Run with existing Bun, SHELL=/bin/sh, and the existing tool binaries on PATH. prepare-assets.ts is needed first in a fresh worktree.

## Build and limits

The worktree had no dependencies linked. Used a temporary link to existing /home/tnfssc/Code/die/node_modules, existing Bun 1.4.2 and Node 24.21.0, and prepare-assets.ts. No install ran. The shell startup reported untrusted mise config; absolute tool paths and SHELL=/bin/sh avoided that noise in child-process checks without changing trust/settings.

The normal fresh build stopped because pnpm was missing. Did not install it or rebuild web. For compiled CLI execution tests only, copied the existing parent dist/die-web.archive.gz into this worktree and compiled src/cli.ts with bun build --compile --minify --outfile dist/die. This is a local fixture binary with reused web bytes, not proof of a fresh web build or a release candidate. Nothing was installed, pushed, or versioned.

## Values

Reviewed wisdom/values.md again. It stays unchanged. Values 1, 2, 8, and 10 already cover real wiring, honest UI state, bounded proof, and a code-backed handoff. This is a feature-local recipe, not a new general rule.
