# Workspace sidebar and terminal tabs

Task worktree: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_7ed8b8f5
Branch: bruv/web-workspaces-tabs
Base: 9efff4a1 (completed browser terminal Live). Parent worktree must stay untouched.

Goal: existing xterm + vanilla UI, server-owned workspace/tab PTYs, explicit single voice owner. No chat/editor framework, release, or PR. Ownership survives browser reload, not server restart. Never delete workspace folders.

## Contract
GET /api/workspaces returns {workspaces:[{id,name,cwd,tabs:[{id,name,pid?,exited?}]}], defaultCwd}. POST /api/workspaces {cwd,name?}; POST /api/workspaces/:id/tabs {name?}; PATCH /api/tabs/:id {name}; DELETE /api/tabs/:id and DELETE /api/workspaces/:id require {confirm:true}. Mutations return full state. Browser fetch uses Bearer token and explicit Origin when browser sends it; GET may have no Origin. Server rejects wrong Origin and Host; mutations require exact Origin. Terminal socket /api/terminal?tab=ID&after=N uses existing protocols, emits audio-owner attachment capability. Browser audio session is tab ID. Keep initial tab ID terminal for old checks. Every tab has distinct relay secret/env. Server allows only one browser audio owner across all tabs; close/replacement/detach releases it.

## Work
Both implementation children are integrated. This task owns the built-browser acceptance, docs, review and final handoff.

## Child worktrees
- task_2932ae37: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_7ed8b8f5-5442693331ce-task_2932ae37; branch bruv/agent-1-2932ae37. Server, PTY lifecycle, relay admission and tests.
- task_e597548d: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_7ed8b8f5-5442693331ce-task_e597548d; branch bruv/agent-2-e597548d. Browser sidebar, tabs, visible resize and voice UI.

## Acceptance plan
Run focused web/Live relay tests, environment scrubbing, launcher and asset-fixture tests, typecheck and compiled build. Then Chromium fake media against dist/bruv: two folders/two tabs each; actual PID/cwd and isolated input/output; visible-only resize; tab/workspace switching, reconnect and reload; rename and explicit close cancellation/cleanup; labeled voice owner through selection changes and /live mic-check; paced keys, paste and narrow layout. Reuse standalone audio probe. Independent reader checks the integrated lifecycle and voice ownership. No paid-provider or audible-speech claim.

## Integration checkpoint
- Browser child 3fde72ca integrated as f072ba79.
- Server child b5a61f06 integrated as 87850c4a. No contract changes.
- Independent read-only review: task_ff13b283, current task worktree.
- Integrated typecheck and compiled build passed. Focused web, browser Live, remote credential scrub, launcher and packaging-input suite: 42 passed, 0 failed (9 files, 320 assertions). Full huge suite not repeated; prior 722/4 gate is historical, not this task’s result.

## Final proof (2026-10-09)

- `bun run check` and `bun run build` passed in this worktree. Assets stay compiled into the binary. No dependency, license, release or version changes. Asset-input fixture and launcher `--setup` checks passed in the 42-test gate.
- Independent reviewer task_ff13b283: no blockers. Its focused lifecycle/auth/voice checks passed (26 tests, 179 assertions); it did not claim independent Chromium or physical-audio proof.
- `scripts/web/browser-workspaces-smoke.mjs` passed against this worktree’s actual `dist/bruv web` in Chromium fake media. Final fixture: `/tmp/bruv-web-workspaces-OLUIPg`. Four CLI PIDs: 2700662, 2700664 in `one`; 2700669, 2700680 in `two`. `/proc` confirmed cwd and distinct root relay secrets/IDs. Real `!printf ...; pwd` output and separate drafts proved input/output isolation.
- A real CLI shell job completed after switching and reload. All four PIDs stayed unchanged across switch, reconnect, refresh and controlling-browser replacement. Rename, close cancellation, completed tab close, workspace removal and whole-server shutdown passed. Removed folders still existed.
- Voice stayed labeled and bound to its original workspace/tab across selection changes. Explicit release was required before another owner. Pending microphone resolution after release closed without transfer. The built server independently rejected an unrelated voice admission with 409; a replaced attachment’s capability got 403. Hidden owner `/live mic-check` completed through the real root CLI relay. Workspace disposal released browser tracks/contexts, with other CLIs untouched.
- Paced keyboard input, bracketed paste, tab arrow navigation, a 390px viewport and visible-only terminal resize passed. No browser exceptions. Screenshots: `artifacts/web-workspaces-wide.png`, `artifacts/web-workspaces-narrow.png`, `artifacts/web-workspaces-voice-owner.png`.
- Original `scripts/web/browser-smoke.mjs` passed. Standalone `browser-audio-probe.ts` passed: 9 capture frames / 5,760 bytes; playback/stop/reconnect/browser-loss checks; zero provider calls.
- First multiplexer browser run caught a fixture timing error: GET state removes the tab before its awaited PTY cleanup completes. The harness now waits for the UI to apply the completed DELETE response before asserting PID death. The assertion was kept; reruns passed.
- Final polish directs expired replay recovery to closing only the affected tab, not restarting all CLIs. After that text change, typecheck/build, 9 terminal tests (44 assertions), and the whole compiled multiplexer Chromium check passed again.
- Changed code format, error-level lint and whitespace checks passed. Parent `/home/tnfssc/.t3/worktrees/bruv/t3-6f8b2e16`, branch `t3/web-terminal-live-mode`, remains clean at exactly 9efff4a1.

## Boundaries and handoff

Run `dist/bruv web` from the desired launch folder. Use the sidebar and each workspace’s tab strip. Remote access remains the documented same-host/same-port loopback SSH tunnel. A token controls all workspace CLIs; do not share it. Closing asks before terminating terminals and never removes folders.

Workspace and tab ownership is in memory. No server-restart restore. Refresh replay remains bounded raw output (2 MiB per tab), best effort after past resizes; expired replay reports a gap. Linux/Bun 1.4.2 and fake Chromium media are tested. Physical microphone quality, audible speech and paid-provider voice remain unverified. No push, release or PR.

Wisdom added here and the usage guide updated. Values unchanged: whole-path proof, one clear owner, async lifecycle checks and honest evidence already cover this work.
