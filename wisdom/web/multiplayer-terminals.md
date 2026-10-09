# Multiplayer web terminals

Parent integration worktree: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_3e4e94f0
Branch: bruv/web-multiplayer. Base 36baa518 (draft PR #64).

User wants all browsers on the same server to share workspaces, tabs, and real terminal input/output. Creating a workspace from another device must appear live. Browsers keep their own selection. No federation between separate servers. No native chat UI or Herdr.

Original orchestrator task_3e4e94f0 made no file changes and stopped making visible progress after initial reads. Parent stopped it after 25 minutes. Parent now owns integration here; prior completed worktrees stay untouched.

## Workers

- Server task_956f10dd: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_956f10dd, branch bruv/implement-shared-terminal-server-session-956f10dd. Owns server, PTY, relay, backend tests.
- Browser task_a60f0c59: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_a60f0c59, branch bruv/synchronize-multiplayer-workspace-browse-a60f0c59. Owns browser rendering/state/voice controls.

## Shared contract

State snapshots add revision and voice null or {tabId,ownerId}. /api/events uses bruv-state + bruv-token protocols and sends {type:state,state:snapshot}. Browser ignores stale revisions. Each terminal has many clients; one root PTY. resize marks a view active; visibility false hides it from shared geometry. Server uses minimum active view dimensions and broadcasts size events. Client never answers a size event with a resize.

One explicit microphone owner remains global, visible to all clients. Observer connections never steal or stop voice. Each attachment has its own capability; only the owner attachment loss releases voice. This is shared terminals and coordinated voice, not a conference call.

## Acceptance to finish

Two independent browser contexts against compiled app. Shared PID/input/output; live workspace/tab create/rename/delete; no focus theft; replay/reconnect; unequal viewports; owner/observer disconnect and explicit voice handoff. Check browser and server auth. Keep root relay credentials out of tool/worker environments. No paid-provider or physical speech claim. Add independent review before delivery. Existing values cover session ownership, honest proof and whole-path validation; no new value yet.

## Integration checkpoint

Integrated browser bfa35af9 as 5ae0ef4a and server 183279b6 as 3b721540. Typecheck/build and 41 focused tests passed before integration review fixes. Backend intentionally uses a public hash ownerId separate from the private audio capability: parent fixed the browser to keep both instead of comparing the hash to the secret. Review also caught ignored ready dimensions; parent now applies them before replay, including hidden/larger joining views, and strengthened mocked protocol fixtures. Five frontend tests pass after both fixes.

The first two-context compiled probe got through shared input/output and remote workspace creation, then hit a test selector mismatch: accessible tab names are Select tab NAME. Fixed the selector, not product behavior. Whole browser probe is rerunning. Original broad worker was stopped without code; bounded server/browser workers completed in fresh worktrees.

## Integrated proof

Compiled two-context Chromium probe passed on 2026-10-09. Fixture /tmp/bruv-multiplayer-JWDLWQ; shared CLI PID2749373. Browser A and B both sent shell commands and saw each other's actual output. A workspace created in B appeared in A without refresh or focus theft. Concurrent tab creation converged; rename and confirmed close propagated. Reload preserved a running shell job and PID. State-socket reconnect caught up. Unequal viewports reached the same terminal size without a feedback loop.

A's enabled voice survived B's terminal disconnect and full reload. B saw the remote owner and could not disable it. A explicitly released, B enabled and ran real CLI /live mic-check, and both saw its output. Owner disconnect released voice while B continued typing into the same PID. Remote workspace deletion removed its processes but kept the folder and other CLI alive. All media was Chromium fake devices, zero provider calls, not physical speech proof. Screenshots in ignored artifacts show owner and observer views.

After integration fixes, bun run check/build and 47 focused tests passed across 10 files, 386 assertions. Error-level lint and diff whitespace checks passed. The prior single-viewer browser harness was updated to require observer-safe voice and owner-only disconnect release, not eviction. Final rerun and scoped review results are pending at this checkpoint.

Scoped follow-up reviewer task_1375eab5 approved both integration fixes after five browser contract tests. No remaining blocker found. Parent inspected real owner/observer screenshots; both show the same terminal output, while the observer sees Voice in another browser and no disable control.

The old workspace browser proof needed two timing updates for authoritative push: media tracks ending is earlier than the shared voice-release snapshot, and tab removal is broadcast before awaited process cleanup finishes. It now waits for Voice off and actual PID disappearance, retaining all assertions. These are probe ordering fixes, not relaxed ownership or cleanup checks. Final rerun pending.

## Final handoff

Final focused suite: 47 passed, 0 failed across 10 files, 386 assertions. Typecheck/build pass. Compiled two-context multiplayer probe passed as recorded above. Updated four-CLI workspace probe passed with fixture /tmp/bruv-web-workspaces-1kWup2: all PID/cwd, running work, pending mic, explicit owner, mic-check, observer join, owner disconnect, input, resize and cleanup checks passed. Standalone Chromium audio probe then passed with 10 frames / 6,400 PCM bytes, stop/reconnect/disconnect checks and zero provider calls. Error-level lint, formatting and diff checks pass. Follow-up review approved.

Deliver bruv/web-multiplayer as a stacked draft PR on bruv/web-workspaces-tabs (PR #64). No merge, release, or installed binary replacement. Previous completed worktrees stay untouched. State survives browser reconnect, not server restart. All clients must reach the same server; separate servers are not federated. Everyone with the token shares shell authority. One microphone/playback owner is coordinated across clients, not conference audio. Physical speech and paid providers remain unverified.

Wisdom added for multiplayer server, browser and integration. Values unchanged: existing session ownership, whole-path proof, and honest evidence already cover these lessons. Delivery facts belong on the PR after publication; no post-shipping edits in this task worktree.
