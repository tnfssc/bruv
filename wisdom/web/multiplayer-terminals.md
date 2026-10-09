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
