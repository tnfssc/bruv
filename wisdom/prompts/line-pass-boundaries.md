# Prompt line pass: boundary gaps

## Scope and counts

Worktree: `/home/tnfssc/.bruv/worktrees/t3-6c093fbb-5442693331ce-task_cb01845b`.
Branch: `bruv/prompt-lines-boundary-gaps-cb01845b`.

Checked 14 files in `src/ui/**`, 22 in `native/**`, and auto-loaded repo-owned instruction sources outside the other six slices. Found 0 authored prose lines with a proved model sink. 0 line-review jobs. 0 lines kept or rewritten. No prompt or code edits. No made-up reviews for display text.

Read `wisdom/values.md`, `wisdom/prompts/writing-without-clutter.md` (Value-based prompting), and `src/prompts/system.md`. Left values alone.

## Traces and decisions

- `src/tasks/job-service.ts:289` reads `taskRowsFromSessionEntries()` for native job titles. Titles and fallbacks come from caller titles, execute labels, commands or prompts. No authored UI prose is added. Status keys are typed facts. `formatTaskRow()` and status summaries add display words, but this path never calls them. The invalid remote ID label “SSH task” is not selected by the native-title path.
- `src/remote/root/runtime.ts:66` sends task rows in a root snapshot. `root/owner.ts` stores root facets; `root/presenter.ts` draws them. This is UI data, not a model prompt. Preview and density hooks build display views. Slash-command descriptions feed UI command lists. Activity journal entries hold call IDs, not instructions. No authored UI prose sink was found.
- Native helpers emit error messages. `src/live/audio.ts:81` discards helper text. Lines 400–417 keep bounded code/domain/number facts and replace prose with “Audio helper reported an error,” authored outside this slice. Lines 222–223 drain stderr without forwarding it. Line 556 uses the fixed message. `src/live/extension.ts:555` sends a diagnostic to `fail`; lines 350–355 stop Live and show a UI warning. Native permission, device and protocol prose does not survive this boundary. `Info.plist` text is OS permission UI. Native docs and tests are not prompt sources.
- Pi loads ancestor context files named `AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md` or `CLAUDE.MD`. It also discovers trusted project `.pi/SYSTEM.md` and `.pi/APPEND_SYSTEM.md`. None is tracked here. Skill roots are `.pi/skills`, ancestor `.agents/skills`, user roots and explicit configured paths. No tracked repo skill is in those roots or configured for loading. Proof: installed Pi `core/resource-loader.js`, `core/skills.js`, `core/package-manager.js`, and tracked-file/config searches.
- `wisdom/landing-page/writing-sources/SKILL.md` exists. No shipped import, build inclusion or auto-load config points to it. Wisdom is user project data in product use. Left it and other docs alone. User/ancestor files and dependency-owned text are outside this repo-owned slice.

Read-only native sink trace: `task_979276e6` (fast, inherited workspace). It found 0 proved lines too. This is research, not a line review. Launch, result, inventory, decisions and test logs live in ignored `.tmp/prompt-line-review/boundaries/`.

## Checks

- 150 pass, 0 fail: `tests/tasks/task-rows.test.ts`, `tests/tasks/job-service.test.ts`, `tests/remote/root-runtime.test.ts`, `tests/ui/execution-previews.test.ts`, `tests/ui/conversation-density.test.ts`, `tests/ui/rolling-activity.test.ts`, `tests/ui/rolling-activity-disk.test.ts`.
- 40 pass, 0 fail: `tests/live/live-audio.test.ts`, `tests/live/live-audio-lifecycle.test.ts`. Includes proof that helper message and stderr text are not forwarded.
- First run: 144 pass, 6 fail. `/tmp` tmpfs was full; failures show `ENOSPC`. Shell tail hid Bun’s exit code. Reran with `TMPDIR=$PWD/.tmp/prompt-line-review/boundaries/test-work`; all 150 pass. Audio tests used that scratch path too.
- `git diff --check` passed. Only this note changed.

## Gaps

No provider call, device test, native build or release test. No runtime text changed. Explicit user reads, user skill config and generic error forwarding can expose repo data; that does not make it a shipped instruction source. The other six owners cover their own prompt and tool text. No edits there. Commit stays local. No push or PR.
