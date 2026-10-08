# Remote placement over SSH

## Choose the journey

| Intent | Entry point | Who owns the run |
| --- | --- | --- |
| Delegate a task to a server | `subagent({ target, ... })`, then ordinary `jobs` and `/questions` | The durable parent session owns the task; the destination owner runs it. |
| Put the main agent on a server | `bruv --place <authorized-name>` | The server owns the root session; the local CLI is its thin presentation client. |
| Authorize a target or recover a saved task | Human `/remote` controls | Setup is human-owned. Diagnostics read/reconcile saved owner and task identities. |

These are not interchangeable launch APIs. Agent `remote.launch` and `remote.launchRepository` reject; they cannot bypass normal delegation policy. Main-agent placement is a startup choice, not a way for a delegated/scoped agent to reset its role or depth.

## Delegate a task

### Authorize once, launch through normal delegation

A human first uses `/remote connect <user@host-or-configured-alias> [absolute-remote-bruv-path]`. This pins the SSH connection and owner identity in OS-user-wide state; it is not per-task permission to change hosts. `jobs.targets()` exposes the saved authorized name. That cached authorization and the owner's reported auth configuration are **not verified connectivity or provider API access**.

`target` must exactly match the pinned `connection.host`. The reserved name `local` means current-runtime execution; an SSH host actually named `local` is addressed as `ssh:local`.

```ts
await subagent({
  target: "fixture-owner", // exact human-authorized SSH connection name
  type: "orchestrator",
  prompt: "Implement and test this change on the server",
  workspace: { kind: "worktree" },
});
```

Target, role and workspace are separate choices:

- Omit target (or use `local`) to stay in the current runtime. A deliberately server-placed agent's descendants stay on that server by default. Scoped native tasks reject explicit cross-placement.
- Placement preserves delegation depth and role restrictions; workers do not become orchestrators by moving. The destination uses its installed Bruv and configured profile/model, not the parent's local model. Explicit SSH `model`/`thinking` overrides are pinned launch intent.
- SSH launches are async-only: omit `waitSeconds` or use `0`. `timeoutSeconds` is unsupported; request cancellation with `jobs.stop(id)`.

### Pin the source before dispatch

Both SSH workspace kinds use an isolated snapshot-backed checkout, not a full-history local Git worktree. Default source includes current **tracked** edits; explicit `workspace.baseRef` selects that revision instead. Git history and parent runtime credentials are not transferred. Known credential/config paths are rejected, but snapshot checks are not content secret scanning.

Untracked inclusion is a separate human decision. Optional `source: { includeUntracked: ["path"] }` requests exact paths; it does not grant transfer. Launch returns a tracked pending job and a source-approval retry task ID. After a saved human answer, retry the unchanged intent with that `source.retryTaskId`. Approved bytes stay pinned; retry does not silently recapture changed files. Default omission is reported. Explicit historical base plus current untracked inclusion is rejected.

### Observe and act in the owning parent session

The parent is recorded before SSH dispatch. Normal `jobs.list/inspect/stop/stopWork` project that session's tasks under `ssh:<base64url-taskId>` IDs. Use the exact jobs ID there; low-level remote diagnostics use raw `taskId`. Old unowned tasks remain human `/remote` cache entries, not another session's jobs.

- Inspection reads bounded cached journal output, with staleness and gaps. It is not live status or proof of exit. SSH jobs do not support stdin, closeInput, watch or snooze.
- Remote human questions project into the owning parent's `/questions` ledger. Human reply dispatch preserves the pinned native owner/version and immutable reply ID. Saved, uncertain and delivered are different states; transcript text is not an answer or permission.
- `jobs.stop` and `jobs.stopWork` request cancellation. Only confirmed native settlement plus owner exit is cancelled. Offline, partial or pending reports do not mean stopped; an unreachable run is unknown, not failed or permission to launch a duplicate elsewhere.
- Refresh attempts reconciliation and safe repository return automatically. Closing the client detaches, not cancels; resuming the owning session discovers the saved run.

Terminal observations and actionable human waits feed the existing agent completion batch and print/JSON parent boundary. Refresh is discovery, not a second completion inbox; artifact refreshes do not resend terminal output. The per-session outbox deduplicates and leases dispatch attempts, **not guaranteed end-to-end delivery**: host dispatch acceptance is not an atomic parent-response ACK. A crash can replay an uncertain envelope, and the host's volatile accepted queue remains an unproven loss window. See [jobs integration and recovery limits](../../wisdom/remote-workspaces/jobs-integration.md). Live remains execute-only.

## Place the main-agent session

After the same human target authorization, start the thin client:

```sh
bruv --place fixture-owner
```

This branches before normal local agent startup: the destination runs the root agent, provider and tools. The client presents its conversation, questions and jobs. Ownership is relative to that parent session/runtime, not a presumed laptop.

The default source is a tracked snapshot from the current repository. `--remote-source <local-path>` selects another source; repeated `--remote-include <path>` explicitly approves untracked paths. Alternatively, `--remote-repo <absolute-server-path>` uses an existing destination repository, with no snapshot return to the local repo. The existing-server repository choice cannot be combined with local source or untracked-inclusion flags. `--model`/`--thinking` pin root overrides; project trust is an explicit `--approve`/`--no-approve` choice.

Reopening the same authorized target/local-source-root pointer reuses its saved root. Target/owner epoch, source and supplied model/trust intent are checked rather than silently retargeted. `--remote-fresh` explicitly starts a new root; it is not recovery permission after an unknown outcome.

The attached controls have different effects:

| Control | Effect |
| --- | --- |
| `/questions` | Select a pending server question and answer its actual owner/version. |
| `/ps` | Inspect server jobs; cancellation is an explicit confirmed choice. |
| `/abort` (Ctrl-C outside a modal) | Request abort, keeping the presentation attached. Request receipt alone is not proof all work stopped. |
| `/close` | Request root close; source return waits for confirmed closed, successful root state. |
| `/detach` (Ctrl-D) | Leave the presentation without aborting or answering pending dialogs. |

Commands retain durable identities and reconcile their receipts; unknown outcomes are not automatically replaced. Reconnect can present saved observations while offline. This describes the shipped root path, not release or live-provider acceptance.

## Human setup and expert recovery

Only human `/remote connect` changes the pinned SSH alias. Strict host-key checking stays enabled; SSH agent, X11 and credential delegation are disabled. Setup grants never come from worker text or an inferred task answer.

For local read-only access from an owned remote task:

- `/remote grant [taskId] repo.read tool:git-status tool:git-diff skill:review` explicitly authorizes named capabilities in the current local repository. No home, arbitrary shell or credential grant. Skills read `.agents/skills/<name>/SKILL.md`, not arbitrary skill execution.
- `/remote revoke <taskId> <grantId>` revokes locally before contacting the owner.
- Remote execute uses `remote.requestCapability({ kind, input, requestId? })`. Try destination tools first. Missing grants are recorded and genuinely wait while blocked/offline; an agent cannot create the human grant. See [capability integration](CAPABILITY-INTEGRATION.md) for request/reply ownership.

The remaining `/remote` controls are expert task diagnostics, not the normal delegation journey:

| Command | Purpose and boundary |
| --- | --- |
| `/remote` or `/remote status` | Inbox/recovery UI or cached summary. A menu is a snapshot; explicit refresh reloads it. |
| `/remote sync [taskId]` | Reconcile a saved task with its pinned owner. Failure leaves uncertainty visible. |
| `/remote transcript [taskId] [offset] [raw]` | Page cached events; `raw` is an explicit expert view. |
| `/remote retry [taskId]` | Reuse the saved task ID/intent, or sync an accepted launch. Conflicting replay may refuse; unknown runs are not relaunched elsewhere. |
| `/remote cancel [taskId]` | Request scoped native cancellation and foreground abort, subject to the same settlement/exit boundary. |
| `/remote answer <text>` | Legacy human reply to the sole pending question; otherwise specify `<taskId> <questionId> <text>`. Owner/version and reply ID remain pinned; uncertain is not delivered. Ordinary owned tasks use `/questions`. |

A sole active task can be selected automatically. Human expert launch controls also remain: `/remote launch <absolute-server-repo-path> <prompt>`, `/remote launch-repo <prompt>`, and `/remote launch-repo-json {"prompt":"...","include":["path"]}`. The repository form defaults to tracked files and requires explicit human approval for untracked inclusion. These expert commands do not give the agent a direct launch bypass. Agent remote operations provide `status`, `sync`, `transcript`, `cancel` and `requestCapability`, not connect, grant, untracked approval or human answers.

## Repository return and offline records

Task completion, repository return and text availability are separate outcomes:

1. A successful snapshot task fetches a digest-verified patch; a placed root requires confirmed closed successful state. Existing-server-repository runs have no local snapshot return. Patch generation alone never establishes task completion.
2. Automatic apply requires unchanged local HEAD/index/tracked fingerprint, regular tracked-file content edits and a clean apply check. Existing staged index stays staged. Local drift, creations/deletions/mode changes and untracked additions retain a **review patch**, not a success claim. Ordinary regular remote untracked bytes are included in that review patch.
3. Durable receipts prevent blind reapply after interruption. Do not discard receipts to force retry. This is conservative apply, not an atomic transaction with an editor or hostile-writer sandbox. [Repository handoff details](repository.md) describe capture and return separately from transport ownership.

RPC conversation/tool events are cached with a cursor. Execute stdout/stderr spill files, task-owned journals and scoped native job text are separately cached with hashes and local paths. Native job buffers are copied before owner exit. Retention gaps, changed files, limits and failed copies remain explicit: never call an incomplete cache complete. Repository return and text sync report failures independently.

## Follow the implementation

Read the caller first, then the operation owner; do not treat a cached projection as its authority.

| Journey / effect | Reading path |
| --- | --- |
| Normal delegation policy and durable launch identity | [job-service.ts](../tasks/job-service.ts) → [jobs.ts](jobs.ts) → [source-approval.ts](source-approval.ts) / [repository-wire.ts](repository-wire.ts) → [client.ts](client.ts) / [owner.ts](owner.ts). [placement.ts](placement.ts) checks role/depth at both ends. |
| Parent questions and completion delivery | [extension.ts](extension.ts) refresh → [question-bridge.ts](question-bridge.ts) / [job-observations.ts](job-observations.ts) → [agent extension](../agent/extension.ts) and [job-delivery.ts](job-delivery.ts). |
| Main-agent startup, presentation and server authority | [cli.ts](../cli.ts) → [root-options.ts](root-options.ts) / [root-cli.ts](root-cli.ts) → [root-client.ts](root-client.ts) / [root-presenter.ts](root-presenter.ts); server [root-entry.ts](root-entry.ts) → [root-owner.ts](root-owner.ts) / [root-runtime.ts](root-runtime.ts). |
| Human recovery vs agent operations | [extension.ts](extension.ts) owns human commands; [operations.ts](operations.ts) rejects legacy agent launches; [services.ts](services.ts) coordinates capability grants/replies. |
| Safe return vs cached text | [repository-wire.ts](repository-wire.ts) / [root-client.ts](root-client.ts) call [repository.ts](repository.ts); [artifacts.ts](artifacts.ts) and [job-artifacts.ts](job-artifacts.ts) verify/cache text independently. |

## Bounds and evidence limits

Task-owner bounds (the root session has a separate store): eight active, 100 retained owner/client task slots. Snapshot/checkouts and client cache: 128 MiB. Event journal: 32 MiB, 512 KiB rows. Repository/text transfer pages: 256 KiB. Text artifacts: 10 MiB/file, 128 MiB/catalog, 256 files. Capabilities: 16 KiB reply, 32 pending, 1024 retained requests/task, 64 grant records. Ordinary runtime/capability waits have explicit deadlines; pending human questions retain their owner. Refusals and retention gaps are explicit, not guessed success or complete-output claims.

Sparse checkout, skip-worktree/assume-unchanged, unmerged index, tracked symlinks/gitlinks and configured clean/smudge filters are not automatically handed off. Trusted repository roots and SSH owner are assumed. State/cache are OS-user-wide, stated on connect.

Existing validation evidence is Linux Docker/SSH with an explicitly deterministic fake provider and native CLI/unit tests. **No Mac, real-provider deployment, publication, installation or release claim.** This overview is not live verification; parent owns release gates.
