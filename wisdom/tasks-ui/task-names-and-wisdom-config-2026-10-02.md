# Readable task rows and thin wisdom config

Completed-run captures/logs mentioned below are now historical Git evidence;
[recovery and retained inputs](../quality/completed-run-retirement.md). Conclusions remain here.

User asked to fix checked raw task IDs, keep project wisdom config thin, and release when done.

## Actual failure and fix

Both reported tasks were background shell commands. Their saved row records had sourceCallId but no title. The original execute calls did have labels:
- task_26de42bf: Run final repaired root suite
- task_c9fcc1c8: Check next release version and remote branch

The first task fix recovered typed command previews. Parent replay of the user's actual saved metadata showed those were still long shell commands. The follow-up keeps the original execute labels on new launches and recovers them by call identity on resume. Explicit task titles still win. IDs still own identity. No source parsing or guessed task outcomes.

See [task naming](readable-task-names.md) and [wisdom setting](../wisdom-system/project-wisdom.md). The setting is one field, wisdomDir, in .bruv/settings.json. Default: wisdom. Relative paths start at the project root. No new UI, migration or automatic file move.

## Durable work

Parent: /home/tnfssc/Code/bruv, develop. Base: 9f78878.
- Names: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_21cab556, branch bruv/fix-readable-task-names-21cab556. Worker 4c9b018 integrated as e531b62.
- Wisdom: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_72ded808, branch bruv/add-thin-project-wisdom-setting-72ded808. Worker 08466ca integrated as 236c604.
- Shell labels: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_5429be2c, branch bruv/preserve-execute-labels-on-shell-task-ro-5429be2c. Worker 6122873 integrated as cb292310.
- Parent fixture fixes: 488cd3a.

## Final local proof

At cb292310, fresh build, typecheck, repository formatting/lint and standalone smoke passed. Full root suite: 1,741 passed, 20 intentional skips, zero failures, 33,020 assertions across 239 files.

Parent inspected real Pi rendering from the original saved task metadata. Then the compiled CLI replayed the selected original messages in a private copied session, offline, with no provider request or mutation of the user's session. Both rows showed their exact labels once on cold reopen and after /reload. [Compiled reload frame (historical)](../quality/completed-run-retirement.md#recovery). This is a copied-session replay, not a new natural provider task. Existing usage metadata in the capture is copied, not a claim of new paid use.

Local ignored probes and captures: artifacts/task-names-wisdom/. Logs: /tmp/bruv-task-wisdom-final-{build,tests,smoke}.log and /tmp/bruv-task-wisdom-pty.log.

Two assertions in the first full suite needed updates. The SDK fixture now has an explicit empty project settings file so repository-local TMPDIR does not make it inherit the parent repo root. The TUI monitor expects the readable cancelled command, while still checking exact task IDs in confirmation and the remaining running list. No cancellation or identity assertion was removed. Focused reruns passed both normal and repository-local temporary directories.

Packed-web reuse rejected changed inputs. The normal fresh producer ran instead, with pinned pnpm on PATH. No cache guard was bypassed.

## Release

Published stable v0.15.28 at 2026-10-02T23:25:57Z: https://github.com/tnfssc/bruv/releases/tag/v0.15.28 . Release notes: support/release-v0.15.28.md.

Wisdom changed for task names, exact failure evidence, config and release handoff. Values unchanged after reviewing both features: the existing simple-config, honest-UI, real-path proof and durable-handoff values cover the lessons. This is feature detail, not a new general rule.

Pushed dd340ec1. Hosted release run https://github.com/tnfssc/bruv/actions/runs/37076563552 passed every gate, including actual Mac binary/updater and final Linux browser boot/reload. All 12 expected assets are present. Downloaded small SOURCE.txt matches tag commit 462970b21e4225b9e66fc4fd2700921e6450b6ce. Parent fast-forwarded to the prepared package version commit. No large binaries were downloaded only to repeat CI hashes. SOURCE.txt is in artifacts/task-names-wisdom/release-v0.15.28/.

Work and release are done. User must update/restart their running binary to use the new code; no user install was changed by this session. Historical rows with no surviving name metadata still use IDs. Real SSH acceptance and Android execution were not claimed. Values stayed unchanged after release review; existing guidance already covers the lessons.
