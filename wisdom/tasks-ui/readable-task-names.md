# Readable task names through completion and resume

Completed-run captures/logs mentioned below are now historical Git evidence;
[recovery and retained inputs](../quality/completed-run-retirement.md). Conclusions remain here.

## Request and scope

The user saw ✓ task_26de42bf and ✓ task_c9fcc1c8 and asked for readable task names, not hidden rows. This follows [canonical rows](canonical-task-rows-interface.md), [agreed compact actions](agreed-compact-actions.md), and [action labels](action-labels-and-quieter-notices.md). Their missing-title ID fallback was honest but not useful when typed launch metadata existed. This request replaces that fallback with readable metadata where available. No status, grouping, notification, permission, backend ownership, or release change.

Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_21cab556
Branch: bruv/fix-readable-task-names-21cab556

## Cause and choices

- formatTaskRow used clean(row.title) || clean(row.id). Local JobService only set title when explicitly supplied. TaskManager retained titles correctly through preparation, activation, completion and inspection; absent titles stayed absent.
- Native v1 task replies have no title field. The execute bridge could attach an explicit title to its UI row, but native jobs.list/inspect/stop returned ID-only metadata. Neither layer supplied a name for unnamed launches. Replay read only die-task-row entries, so a surviving typed command in a tool result could not recover an old unnamed row.
- JobService now chooses an explicit cleaned title or a literal, one-line prompt preview, capped at 120 characters. Empty display metadata uses “Agent task”. It passes the name through inherited/worktree local launches, native launch/projection and SSH requests. Prompt text remains unchanged for execution. Worktree branch naming is unchanged.
- task-rows can display a bounded typed command/prompt preview as fallbackTitle. This is separate from title: a later title-less owner snapshot must not replace “Run focused tests” with its raw command. Whitespace-only metadata cannot erase a name. IDs and terminal outcomes still merge by typed identity, not label text.
- Replay merges persisted canonical rows with typed tool-result details. It does not parse execute code, stdout, assistant prose, hidden custom messages, or task IDs to guess meaning. SDK session_start and root facets use that same projection. Native job observations borrow names from the existing parent branch metadata; no second ledger or backend contract was added.

## Proof

- 175 tests passed, 0 failed, 939 assertions across task-title, task-rows, job-service, t3/native-routing, remote-root-presenter, subagent-extension, root-runtime, worktree-workspace, task-manager and execution-previews. Includes actual local subprocess completion, omitted/blank/explicit titles, native title-less replies and fresh JobService resume, legacy command recovery, explicit-name precedence, truthful adverse outcomes, and real Pi/root render assertions.
- bun run check passed. Focused Biome format check and git diff --check passed. Worktree checks rerun after retaining original branch naming.
- [Rendered fixture output (historical)](../quality/completed-run-retirement.md#recovery) was inspected from real Pi ToolExecutionComponent/Container and RootTranscript render calls, width 100. Both show “✓ Inspect renderer” and “✗ bun run check — exit 1”. The two reported IDs are fixture identities, not a claim that the user's existing process or saved history was edited. This is component rendering proof, not compiled interactive PTY, screenshot, provider or release proof.
- Initial runs found missing worktree dependencies/assets; bun install --frozen-lockfile and prepare:assets supplied them. The default fish startup printed untrusted mise config errors into child stdout; focused subprocess checks used SHELL=/bin/sh, without changing trust or product shell behavior. Final checks passed on that setup.

## Remaining gaps

A historical row with no surviving typed title, owning execute label, command or prompt still uses its ID. Native v1 tasks observed outside the current parent branch cannot recover a name from the backend reply alone. Literal previews are not model-written semantic summaries; explicit titles remain the best names. Expanded source/output and real task IDs stay available. No live install, release, backend rewrite or migration of user sessions was done.

Feature wisdom and rendered evidence added here. values.md unchanged: existing honest UI, one-owner, durable work and bounded proof values cover this fix. Wisdom/config wiring belongs to the other worker, not this change.

## Follow-up: owning execute labels for background shells

Parent's real-SDK replay of the original session exposed a missed path: unnamed shell rows recovered huge bash/environment command previews instead of execute labels. Fixed on branch `bruv/preserve-execute-labels-on-shell-task-ro-5429be2c` in worktree `/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_5429be2c` (follow-up to e531b62).

- New background shell launches pass the execute label into typed launch row metadata. Real extension persistence keeps it through owner completion even when outer execute fails. JobService shell records leave title unset; commands remain fallbackTitle, not generated explicit titles.
- Session projection correlates sourceCallId to assistant execute arguments.label. SDK and root transcript renderers do the same for resumed typed details without preprojected rows. Explicit subagent titles win. Repeated execute labels are fine: source + job ID still owns each row; terminal failures and expanded evidence are unchanged.
- Read-only replay used original session `2026-10-02T18-30-12-598Z_01a0fde1-8d76-75d3-bdac-ebc0396e1b84.jsonl` under `/home/tnfssc/.bruv/agent/sessions/--home-tnfssc-Code-bruv--/`. Equivalent parent replay script at worktree `artifacts/task-names-followup/replay.ts` imports this worktree's source. [Actual SDK/root row output (historical)](../quality/completed-run-retirement.md#recovery): task_26de42bf → “✓ Run final repaired root suite”; task_c9fcc1c8 → “✓ Check next release version and remote branch”. Original history was not edited; this is real component replay, not interactive PTY or release proof.
- Focused regression suite (165 tests passed): task-rows, typescript-execution, remote-root-presenter, job-service, subagent-extension, root-runtime, t3/native-routing, task-title and execution-previews. New cases cover both original labels, resumed failed unnamed shells, repeated labels with distinct IDs, explicit helper names, new launch events and durable rows, real shell owner updates, outer failure and expanded source/output. Typecheck passed. Tests use existing parent node_modules and compiled isolated worker; source under test is this worktree. Full build attempted but packed-web reuse rejected the different source/workspace provenance; no new full build, install or release is claimed.
