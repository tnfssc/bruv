# USER FULL-SCOPE UPDATE — applies before old slice notes below

Read PARENT_FULL_RELEASE_SCOPE.md now. User requires whole end-to-end delivery and new release; root/main-agent placement is required before publication, not a later follow-up. Parent owns push/PR/video/full Release. First child slice remains first increment, not final scope. Update this status/worker contracts to full scope.

# Remote task placement — implementation contract

Pinned base: origin/develop a349a8ad4f698a43024589581845adafcb2fb1f2 (parent-fetched PR13 merge; tree identical to launch base 7304688). Lead docs rebased before implementation; worker commits will be cherry-picked individually, never their old ancestry. Tree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c7fed9c; branch remote/task-placement. PR12 remains parked; no wholesale carryover.

## Scope and contract
- Normal subagent launch gains orthogonal target choice; omitted means current runtime (LOCAL at local root). One human-authorized pinned SSH target initially, identified by its configured name. No agent connect/host selection/credentials.
- Role/depth checks happen before placement; destination uses installed Die/profile default with supported explicit overrides, never silent normal substitution. Server descendants run there by default.
- Source and workspace are distinct: local worktree retains commit/history semantics. SSH handoff transfers a pinned working-state snapshot (tracked edits, explicitly human-approved untracked only), no Git history or credentials. Remote isolated checkout honestly reports snapshot provenance. Requested explicit base selects that source, not silently HEAD/current state. Protect return against parent drift.
- Parent owns job identity, progress, human decisions, cancellation and result. Existing SSH owner/epoch/ledger/transport/transfer stay backend details. Durable launch identity prevents duplicate uncertain runs. Disconnect detaches; reconnect resumes observation of same task.
- Real human questions use normal questions flow, retaining remote owner/version provenance; agents cannot answer them. Child clarification reaches parent via ordinary completion/context (no invented auto-answer authority).
- FULL SCOPE (parent update): child placement is stage one, not final scope. Complete main-agent remote session/thin-client attach, same durable server work after detach/reopen, normal descendant policy and workspace/source return. No laptop coordinator, fleet scheduler, or environment copier.

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

## Active delegate ownership
- task_9973edae backend: remote/task-placement-backend; tree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c7fed9c-a86675007a5e-task_9973edae
- task_da9b9740 task path: remote/task-placement-jobs; tree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c7fed9c-a86675007a5e-task_da9b9740
- task_607d8168 human questions: remote/task-placement-questions; tree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c7fed9c-a86675007a5e-task_607d8168
- task_09184036 acceptance fixture: remote/task-placement-proof; tree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c7fed9c-a86675007a5e-task_09184036

Shared launch interface agreed before edits: target is an optional string naming the authorized connection host (local/current runtime default); RepositoryLaunch.placement carries profile, parentDepth, parentType, and workspace. Remote worktree is an isolated snapshot-backed checkout, not transferred full history. Dependencies linked read-only to existing installation and local assets prepared.

- task_9d77ad7e ordinary /ps monitor: remote/task-placement-monitor; tree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c7fed9c-a86675007a5e-task_9d77ad7e. Owns src/tasks/task-monitor.ts, src/ui/task-monitor.ts and cache adapter/tests. Inspection found /ps only showed local TaskManager; this would otherwise leave a second human progress surface. Scope is truthful merged active/unknown display and cancellation, not a remote-root/fleet UI. Lead wires agent extension.

## Integration review checklist (before freeze)
- Confirm normal schema carries supported explicit destination model/thinking overrides, not only backend protocol fields.
- Confirm task title/provenance surfaces do not imply full history or live cached output.
- Confirm ordinary /ps includes active and unknown SSH jobs and pending cancellation honestly.
- Confirm normal questions bridge handles restart/stale-owner/uncertain reply and does not duplicate remote inbox attention.
- Distinguish default omission of untracked files from any supported explicit human-approved inclusion path; do not claim an unimplemented normal inclusion flow.

## Full product roadmap (parent scope update)
1. Combine child backend/tasks/questions/monitor contracts and focused gates.
2. task_659e1c05 server-root durable session/thin terminal client: remote/task-placement-root; tree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c7fed9c-a86675007a5e-task_659e1c05. Owns new root modules and CLI entry integration. Must retain server execution independent of client.
3. task_668e1372 normal human-approved pinned untracked source flow: remote/task-placement-source; tree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c7fed9c-a86675007a5e-task_668e1372. Owns source approval module and child launch integration. Permission must be ordinary human question, exact pinned bytes/target/parent, no agent asserted approval.
4. Combined root + child compiled terminal acceptance: allowed server-side descendants/worktrees, question vs clarification, detach/reconnect exact IDs, safe return/conflict artifacts, cancellation/unknown, unsupported configuration, and unchanged targetless local. Disposable Docker SSH/fake inference only.
5. Parent review/freeze, ONE final role-separated demo, full hosted release gates, then parent-owned push/PR/new release. Lead does not publish. No root deferral in final deliverable.

Integrated worker commits: task path f897a049 -> 8889a90; backend f003770f -> bc50210. Backend shared launch contract includes RemoteClient.launch sixth placement argument, hello.taskPlacement=1, matching response placement/profile enforcement, and model-neutral connection.

## Root correction and current ownership
Parent root seam research explicitly rules out raw SSH TTY/tmux as the sole presentation integration. task_659e1c05 and task_cf62e5c1 both stopped with exit143; their lasting trees remain references only, no rejected root code integrated. ROOT_TYPED_CONTRACT.md and src/remote/root-contract.ts define typed root commands/observations before edits.
- task_ebba316b server-root owner/runtime/facets: remote/task-placement-root-owner, tree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c7fed9c-a86675007a5e-task_ebba316b.
- task_8f4236df thin root client/normal terminal presenter/source return: remote/task-placement-root-client, tree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c7fed9c-a86675007a5e-task_8f4236df.
Lead owns hidden root CLI/runtime wiring and combined root proof. Empty local provider settings must work; server is sole actual agent.

Child integration: questions 6267adb and monitor 787c508 integrated; server child checkpoints no longer overwrite parent runtime, top placed child real questions enabled, launch branch owner persisted before SSH. Native-terminal candidate compiled (real existing archive, no packaged receipt claim), NOT frozen/final. Candidate proof caught stale fixture state/descriptor receipt paths plus missing strict wire placement/workspace fields and snapshot origin remote; fixes retain all semantic assertions. Normal jobs.targets now provides authorized target discovery (local/current default), avoiding routine remote.status. Prepared-source trusted hook validates source root, manifest and bundle SHA before transfer; original approved bytes never recaptured.

## Current evidence (not final freeze)
Child native-terminal acceptance PASSED against compiled candidate SHA256 e580d8647762257ecd96b5e02b7dcfc4aefb0527b07c7e136b8ca8d3f36b4198. Artifacts: /home/tnfssc/.die/tmp-pi-removal/placement-child-candidate-proof-5. Disposable Docker network:none + fake inference, actual subagent/jobs/questions/SSH/runtime code, server orchestrator plus child worktree, human picker answer, client kill/reopen same task, protected apply and conflict review, no duplicate completion on automatic observation/reopen. Earlier failed runs remain artifacts; fixes were real missing wire fields/origin stripping/result summary and strict receipt-reader corrections, not weakened assertions. No video and not paid/WAN/package proof.

Source approval 74d8ba4 -> 5ecb23a integrated with trusted prepared-snapshot hook; 28 combined source tests and typecheck passed. Normal title/result controls + root CLI option tests: 83 focused tests passed. Root frontend 70b1878 -> 7d9db7f integrated; 15 root client/options/policy focused checks passed. Root backend task_ebba316b remains active; no root end-to-end claim.
- task_33783e38 corrected typed-root compiled acceptance: remote/task-placement-typed-root-proof; tree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c7fed9c-a86675007a5e-task_33783e38. Replaces canceled raw-TTY fixture design, real two-turn root proof still required.

- task_ee64aa7e: narrow root acceptance gap coverage (uncertain reply recovery, running cancellation, unsupported modes), branch remote/task-placement-root-proof-gaps, lasting tree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c7fed9c-a86675007a5e-task_ee64aa7e. Owns root fixture only; production untouched. Lead owns combined run/freeze.

- task_0b056018: preserve remaining existing remote ownership/capability/permission regression gates while migrating prohibited agent legacy launches. Branch remote/task-placement-legacy-safety-fixtures, lasting tree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c7fed9c-a86675007a5e-task_0b056018. Fixture-only scope, no weakening/skipping safety tests, no PR12 product edits. The migrated normal owned jobs gate 27cd803 -> 0e5eab3 already passed isolated Docker and 19 focused tests on child candidate.

- Legacy safety fixture c656242 -> 754ebbc integrated: 62 focused checks and both actual compiled question/capability PTY paths pass. RPC gate uncovered a real source-approval current-branch-tip regression; its downstream safety assertions stay intact, no full-green claim. task_01d670a2 owns narrow diagnosis/fix, branch remote/task-placement-source-tip-fix, lasting tree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c7fed9c-a86675007a5e-task_01d670a2. No pushes allowed.
