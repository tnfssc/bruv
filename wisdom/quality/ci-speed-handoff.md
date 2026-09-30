# CI speed handoff

## User goal and decisions

User asked for routine CI under one minute, requested Tavily research, and repeatedly asked the parent to parallelize and cut the right corners. Do not turn selected feedback into a claim of full validation. Keep actual failures visible. Use focused proof for small changes and hosted full gates; stop repeating whole local suites or review rounds without cause. See [fast delivery](fast-delivery.md). Values10 updated from this repeated feedback.

## Done

- Pi MCP/codemode removal released as v0.15.14; release recorded in dependencies wisdom.
- Change-aware CI on develop: audited docs/narrow source and broad remote source feedback; full fallback for unknown/shared/dependency/build changes. Cumulative push baseline from last successful trusted ancestor, PR tested merge tree, fail-closed CI policy, nightly/manual full reconciliation. Actual releases retain complete artifact/native/browser/updater gates. No branch protection changed.
- Remote-only final three test processes overlap with separate temp/tmux state, failure and cancellation checks. Same commands preserved. Mixed classes serial. Runner commit55af0a7, proof commitb08f5c4 pushed.
- Hosted source PR10 was60s, docs20s. Parallel PR11 source46s end-to-end. Both probes closed unmerged; branches/worktrees retained. See ci-hosted-fast-path-proof.md. One sample each, not p95.
- Parent full local suite1432pass/20skip/0fail before runner-only change. Runner focused typecheck+32tests pass. Earlier full hosted CI36761523580 and36762688912 pass.

## Separate browser failure and current next step

Release dry-runs36761523355 and36762688740 failed unchanged real browser gate with Tiptap view.dom before available. Not waived. Worker fixed real upstream controlled-selection lifecycle guard and reproduced4regression failures before/172focused passes after; actual never-mounted/destroyed Editor cases, both modes. Root/upstream typecheck and patched-source verification pass; packaged candidate passes unchanged browser gate. Exact hosted timing trigger remains unproven.

Fix worker f01c77b integrated locally as c32a42b, not pushed yet. Worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_cacd84d1, branch die/investigate-hosted-editor-mount-failure-cacd84d1. See ../t3/composer-editor-startup-lifecycle.md. Parent should commit proof/values notes, push the browser fix, and monitor fresh hosted full CI+release dry-run. No new release dispatch needed or authorized for this follow-up. Browser work does not negate measured CI speed.

A gh query for full workflow runs at b08f5c4 is shell job task_3a0748f0 (may still run); inspect result. Current probe run36770502052 succeeded and PR11 is closed. No local installed die replacement.

## Pickup references

- ci-selective-planner.md and ci-selective-workflow-rollout.md: boundaries and command contract.
- ci-remote-source-group.md and ci-remote-process-overlap.md: test ownership and preserved commands.
- ci-selective-external-research.md: Tavily sources; Bun --changed, affected graphs, status-check traps.
- ci-speed-timing-audit.md and ci-broad-fast-path.md: baseline and candidate coverage.
- ci-hosted-fast-path-proof.md: actual hosted results.

Avoid more architectural expansion before closing this verified slice. Broader source classes and reliable p95 are future measured work, not already solved.
