# Remote task placement — implementation contract

Base: develop 7304688da483207dba1cf04c9d61023a188d7e00. Tree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c7fed9c; branch remote/task-placement. PR12 remains parked; no wholesale carryover.

## Scope and contract
- Normal subagent launch gains orthogonal target choice; omitted means current runtime (LOCAL at local root). One human-authorized pinned SSH target initially, identified by its configured name. No agent connect/host selection/credentials.
- Role/depth checks happen before placement; destination uses installed Die/profile default with supported explicit overrides, never silent normal substitution. Server descendants run there by default.
- Source and workspace are distinct: local worktree retains commit/history semantics. SSH handoff transfers a pinned working-state snapshot (tracked edits, explicitly human-approved untracked only), no Git history or credentials. Remote isolated checkout honestly reports snapshot provenance. Requested explicit base selects that source, not silently HEAD/current state. Protect return against parent drift.
- Parent owns job identity, progress, human decisions, cancellation and result. Existing SSH owner/epoch/ledger/transport/transfer stay backend details. Durable launch identity prevents duplicate uncertain runs. Disconnect detaches; reconnect resumes observation of same task.
- Real human questions use normal questions flow, retaining remote owner/version provenance; agents cannot answer them. Child clarification reaches parent via ordinary completion/context (no invented auto-answer authority).
- Main-agent remote attach UI remains later; contract must not assume parent runs on laptop. No fleet scheduler or environment copier.

## Seams / ownership
- Integration lead: this tree. Combine/review, cross-file correctness, focused validation, terminal compile, frozen source receipt; parent owns final review/PR/video.
- Worker backend: src/remote/{protocol,owner,client,repository-wire,repository}.ts and backend tests. Placement launch policy and pinned source/workspace transfer.
- Worker task path: src/tasks/job-service.ts, src/remote/jobs.ts, agent/execute launch schemas/prompts and normal launch tests. Add adapter launch contract and durable normal delegation identity.
- Worker human flow: src/questions/*, remote question bridge module, src/remote/extension.ts as needed; normal human answer bridge and recovery tests. Coordinate agent extension wiring with lead.

## Blockers / limits to check
- Existing SSH protocol pins normal profile and depth; must change without weakening owner identity.
- Existing repository snapshot is orphan history; cannot advertise full-history worktree. Explicit source base and current-state semantics need validation.
- Existing SSH jobs are merged projection and remote questions use separate inbox. Normal delegation must own lifecycle, not merely call remote.launch.
- Dependencies/assets and Docker availability unverified. Use Bun 1.4.2 directly, TMPDIR=/home/tnfssc/.die/tmp-pi-removal. No real host/config/cache/credentials or paid APIs; isolated fake-inference proof only. No recording until parent review/freeze.

## Verification plan
Focused common path and profile/ownership/unknown/cancel/untracked tests, typecheck, then compiled native-terminal CLI against isolated Docker SSH/fake inference. No repeated full suite and no placeholder packaged-product claim. Record honest gaps and source+binary SHA only after source freeze.
