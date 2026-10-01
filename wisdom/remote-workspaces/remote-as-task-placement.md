# Remote is task placement (2026-10-01)

User corrected the direction. Remote should just be a place where a task runs. The agent already starts subagents and worktrees. Remote must fit that same flow, not sit beside it as another product.

## Decision

- One task and delegation model. Local and remote are execution places.
- Worktrees, progress, questions, cancellation and results use the existing task flow.
- The agent chooses or is told where to run work. It should not need a second family of task commands.
- Host setup can be separate configuration. Everyday work should not need a remote inbox or manual sync/reply loop.
- Existing SSH transport, pinned identity and safe repo transfer may still be useful underneath. Do not throw away safety just to unify the surface.
- This is the product direction, not approval for a particular API/schema or a new implementation today.

## Parked work

PR12 is still draft and is marked parked. The remote UI polish solved symptoms of the wrong abstraction. Do not merge or release it as the remote redesign.
Product worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_93139879, branch remote/pleasant-ux, local code HEAD5cabed4. GitHub PR currently contains417e3cd; later local work is not pushed.
Rendering reference branch remote/human-results (686d82e), collapsed attention reference remote/human-attention (1af2b01), terminal runner branch remote/ux-pty-acceptance (447dee2). Trees: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_9803d733, /home/tnfssc/.die/worktrees/die-a86675007a5e-task_877666f7, /home/tnfssc/.die/worktrees/die-a86675007a5e-task_f5a4c45a.
Video worker task_80e67b72 was cancelled; exit143 confirmed. Its tree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_80e67b72 and artifacts /home/tnfssc/.die/probes/remote-ux-video-2026-10-01 remain. No merge or release.
Baseline dogfood reports remain useful evidence, not endorsement of a separate remote workflow. Main compiled terminal journey and112focusedtests pass. Updated main PTY runner passes. Capability runner still filters an old action label; recovery runner observes an undefined owner answer after an accepted reply; that cause is not resolved. Neither failing runner is declared passed or weakened.

## Next

Map the existing subagent/workspace/job ownership model against SSH execution. Find the smallest way to make remote a target while sharing task lifecycle and human controls. Discuss that fit before coding more UI. Keep existing identity, grants and transfer boundaries visible where permission is actually needed.

Values unchanged for now. This is a user product requirement. Existing values1,3 and8 already say build the real thing, prefer simple ways and use actual human flows.
