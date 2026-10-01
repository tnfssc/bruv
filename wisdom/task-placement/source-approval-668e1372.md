# Pinned source approval — 668e1372

## Scope and ownership

Full release scope remains **root + child** normal placement and thin-client session continuity. This worker implements the shared approval preparation and NORMAL child launch integration, not a substitute remote lifecycle. Root placement must reuse the same human-owned approval contract before release. Current-source untracked inclusion is rejected with explicit baseRef snapshots, matching backend source semantics; source selection does not change workspace kind or delegation role.

- Branch: `remote/task-placement-source`.
- Worktree: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c7fed9c-a86675007a5e-task_668e1372`.
- Owned: new `src/remote/source-approval.ts`, new tests, source portions of `src/tasks/job-service.ts` and `src/remote/jobs.ts`.
- No edits to concurrently owned repository/client/protocol/question/root modules. Rebased onto lead f6768a8. Its explicit model/thinking forwarding, native/local override rejection, jobQuestionOwner allowlist, backend placement/current-source and trusted question bridge are preserved. The source task retains its original jobQuestionOwner even after the parent advances to a followup branch leaf. Title must be added to pinned SourceIntent when introduced.

## Contract

`source: {includeUntracked: string[], retryTaskId?: string}` requests inclusion; it grants nothing. Cross-placement uses the human-pinned target and owner/epoch only. Default request without source continues snapshot-only tracked edits, with omitted paths in provenance.

Before asking, capture include and omit **orphan** snapshots outside the repository; reject credential/config paths, nonregular/missing/duplicate selections and unsupported repository states. Both snapshots retain the same tracked fingerprint. The generated ordinary /questions permission names exact paths, parent owner, original source root, target/owner/epoch, prompt digest/summary, role/workspace intent and included bundle SHA-256. No machine-wide copying, credentials or reachable local history.

Only a persisted CLI answer with matching question identity/owner and valid replyId/replyVersion can select inclusion. Agent questions.ask/resolve do not fabricate those fields. Delivery/resolution of a genuine human answer preserves its provenance. Resolving or cancelling an unanswered permission defaults to **omit all untracked**, with an explicit omission report. Human choices are Include pinned files / Omit untracked files / Cancel task. Ordinary jobs.stop also cancels before dispatch.

Pending permissions have normal session-owned ssh job IDs, visible through list/inspect/stop/stopWork, but outcome **not-dispatched**, sourceApproval.state=waiting and normal cached status unknown; no fictitious remote accepted task. Parent followup uses the returned raw task ID in source.retryTaskId and unchanged intent. Unknown IDs and parent/target/epoch/prompt/path/placement drift reject; initial batches get one approval per task and retry one task at a time. An approval's original ordering anchor survives acceptance, avoiding jobs cursor movement. No universal scheduler, no routine /remote launch-repo-json.

## Required backend integration (release blocker until combined)

Export trusted internal `launchPreparedRepository(client,args)` from repository-wire.ts (a wrapper/alias of an updated launchRepository is fine). Args include original localRoot plus approvedUntracked, preparedSnapshot:RepositorySnapshot and preparedSnapshotSha256. Validate selected paths against approvedUntracked, manifest against snapshot and bundle bytes against the pinned digest immediately before upload. Use that immutable bundle for the normal repository descriptor; retain **original localRoot** for safe return. Do not re-capture or require current source fingerprint equality: post-question local edits must not silently replace approved bytes and safe return already reviews drift.

The old launchRepository silently ignores unknown args. Therefore the source integration **fails closed before upload** if the named prepared hook is absent. This branch alone is NOT end-to-end release evidence. The parent/backend worker owns that tiny hook; other files were intentionally untouched. Shared QuestionService ordinary CLI provenance currently needs no hook, but inject the runtime service into SourceApprovalService if UI onAsked notifications need immediate refresh; persisted /questions ledger is already used.

## Proof and next gate

New isolated-repo tests cover generated human question/digest, current tracked edits, changed approved file, post-question tracked drift, fake/stale resolution/answers, CLI delivery/resolution, denial versus explicit cancel, exact owner/target/epoch/prompt/paths, credential path rejection, pending inspect/cancel/stopWork without transport, same-ID offline restart/uncertain launch and stable job ordering, strict agent-facing source schema and normal JobService followup.

Fixture inference/transport only; no paid API or actual SSH owner. Direct Bun 1.4.2, TMPDIR=/home/tnfssc/.die/tmp-pi-removal, no auto-install/full repeated suite. New fixtures fence global/system Git config. Final targeted run on the combined lead baseline: **65 pass, 0 fail, six files, 365 expectations**. Targeted adjacent source/placement/jobs/repository/wire tests passed (44 before final stable-order test; final result recorded by worker handoff). Typecheck found only four existing absent generated runtime-assets package/theme JSON imports in CLI, not source changes.

Parent must integrate the trusted snapshot hook and human worker provenance, reuse approval for root where required, prove BOTH actual compiled root and child CLI paths, detach/reopen/reconnect same IDs, server child/worktree policy, safe conflict return and cancellation uncertainty. Then one frozen role-separated fixture demo and full hosted release gates; only parent pushes/PRs/releases.
