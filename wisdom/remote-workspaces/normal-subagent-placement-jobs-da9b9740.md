# Normal subagent placement job path — da9b9740 (2026-10-01)

## Tree / reason

- Tree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c7fed9c-a86675007a5e-task_da9b9740
- Branch: remote/task-placement-jobs
- Parent feature: remote/task-placement at /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c7fed9c
- Reason: implement target selection in ordinary subagent delegation without a second agent launch/lifecycle, retaining backend policy, parent ownership and uncertain-launch identity.

## Contract implemented

- Agent schema and execute helper type expose orthogonal target?: string. Omit or use local for the current runtime; native/server descendants do not relocate to the laptop.
- Nonlocal names must exactly match the existing human-pinned connection.host. No connect/host selection/credential operation is invoked. A host actually named local has the one alias ssh:local, because local itself means current runtime. No general host alias parser exists.
- Local policy checks precede SSH selection: maximum depth two, only orchestrators delegate, child orchestrators cannot create another orchestrator. Scoped native policy stays backend-owned; explicit cross-placement is rejected without calling local policy or escaping to SSH.
- SSH is async-only. Positive waitSeconds and timeoutSeconds are rejected, rather than ignored. Existing jobs list/inspect/stop/stopWork handle its ssh: identity and cached observations.
- The existing T3LaunchIdentityLedger reserves the request before launch I/O. Parent session file + durable executeInvocationId + callIndex + batch index determine a stable filesystem-safe task ID. Target/prompt/workspace are deliberately not part of identity; backend retry-intent validation prevents changed requests becoming duplicates. Response ACK retires bookkeeping, not deterministic identity.
- RemoteJobsAdapter.launch calls launchRepository, never the legacy remote.launch agent helper. It forwards requested profile/depth/workspace, resolves no laptop model, and allowlists inputs so an untyped caller cannot smuggle approvedUntracked. Adapter-level supported explicit model/thinking overrides forward without substitution; the normal helper uses destination defaults.
- Launch results include normal id/status/output/background plus target, requested workspace and honest snapshot-only provenance. Workspace path is the remote checkout; explicit base/branch are reported as requests, not invented history or effective commits.
- A backend unknown launch exception with a durable task record returns that same record as an async unknown result. An unconfirmed repository-preparation exception before a task record includes the reserved ssh: ID in its error; a retry reuses that exact ID and any backend handoff descriptor. Deterministic retry conflicts are not disguised as successful launches.

## Integration seams

- Backend worker must land the agreed launchRepository(client, {jobSessionFile,localRoot,prompt,taskId,model?,thinking?,placement:{profile,parentDepth,parentType?,workspace}}) implementation alongside this change. Current baseline types structurally accept the forwarded object, but old repository transfer ignores placement: do not ship this task commit without backend policy/source/workspace changes.
- src/agent/extension.ts requires no task-path edit: it already constructs the shared RemoteClient/createRemoteJobsAdapter and passes that adapter into getService() for each session-owned manager. Human worker owns remote/extension.ts and questions bridging.
- Backend state remains authoritative for retry intent, pinned owner/epoch, source base, safe return and preparation artifacts. New tests fake only repository transfer/SSH; no claim of real SSH transfer, server profile execution or compiled terminal proof here.

## Verification

- Bun 1.4.2 direct, TMPDIR=/home/tnfssc/.die/tmp-pi-removal; no real host, credentials, config edits, paid API or push.
- Final focused run: 57 pass, 0 fail, 420 assertions across tests/subagent-placement.test.ts, tests/remote-jobs.test.ts, tests/t3/native-routing.test.ts, tests/prompts.test.ts, tests/prompt-preview.test.ts. Ten placement tests cover profiles, policy, target authorization, durable/session/batch retry, unknown preparation identity, cancellation, untracked allowlisting/explicit overrides, local regression and native authority.
- TypeScript --noEmit passed using the parent's prepared dependency/assets trees via temporary symlinks (not committed). Focused Biome format passed; lint exits zero with existing warnings/informational diagnostics.
- Shell test runs use SHELL=/bin/sh: inherited fish initialization otherwise emits mise-untrusted warnings into tested shell output. No mise trust/config change was made.
- Initial focused failures were fixture shape/cancellation-state/context issues and fish startup noise; corrected fixtures and isolated shell, not production assertion weakening. No full suite was run.
