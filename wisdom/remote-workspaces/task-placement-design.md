# Remote as task placement: design thoughts

2026-10-01. User asked us to think deeply after rejecting the separate remote workflow. This is a proposal, not implementation approval. PR12 stays parked.

## Core idea

A task is work. A target is where it runs. A workspace is the files and isolation it gets. A backend is how die starts and observes it. Do not turn a different backend into a second task product.

Place belongs beside normal delegation. It is not another workspace kind. Normal child tasks, worktrees, progress, human requests, cancellation, result return and ownership must stay in the same flow.

## What the code actually does

- src/tasks/job-service.ts already owns local CLI and scoped-native delegation. The subagent schema has workspace, but no target. These backends already differ in waits, input and timeout support.
- src/tasks/worktree-workspace.ts pins a Git source commit and creates a task worktree.
- src/remote/operations.ts exposes a second launch family. src/remote/jobs.ts projects its records into jobs. Current jobs.list is a merged view, not a single lifecycle store.
- src/remote/owner.ts and protocol.ts provide durable remote ownership. Client records and jobSessionFile bind follow-up to the parent. job-delivery.ts and agent/extension.ts forward completion and attention. These are useful backend pieces, not reasons for a separate user workflow.
- Current remote repository transfer makes an orphan working-state snapshot, not a normal Git worktree with local history. Do not relabel it as identical.

## Keep the choices separate

Execution target: current runtime or a named authorized destination. Workspace: inherited checkout or isolated worktree. Repository source: selected revision and selected working-state changes. Role/profile: what the child may do, resolved against destination configuration. Changing target must not silently change the role, bypass depth limits, or send different code.

Illustrative API only: subagent({ target: "builder", workspace: { kind: "worktree" }, ... }). Exact name/schema not decided. Do not add workspace.kind="remote"; worktree on a remote target must be possible.

Default placement should inherit the calling agent's runtime. A child on the server creates its own children/worktrees there unless explicitly placed elsewhere. Its shell and file tools run there naturally; do not route every tool invocation back through the laptop. A fast/normal worker does not become an orchestrator by hopping to another host.

## Root placement matters too

A local parent with remote children can lose orchestration when the laptop closes even if accepted children continue. A main agent running on the server can keep coordinating. These are different products if we do not model root placement too.

The same model should support both. UI can attach to a remote root session without inventing a second local coordinator. We can start with child placement, but must not bake in a laptop-only owner. Current runtime, not the UI machine, defines the default execution place.

## One task tree, honest backend differences

The parent owns the task goal and follow-up. The destination owns actual execution. The UI observes and acts through the task contract. This does not require one physical database across machines. A durable task ID and backend reference connect those owners; a socket is not an owner.

Save intent before dispatch. Reconcile the same ID after a lost launch reply. Pin the destination once dispatched. Never automatically start a second copy elsewhere while the first outcome is unknown. Offline is not failed. Cancel requested is not stopped. An answer accepted for delivery is not necessarily used.

Work state, observation freshness and command delivery are different facts. Keep them distinct underneath. Show them together only when they matter. Catch-up and reply routing belong in the backend; routine users should not operate sync/retry mailboxes.

One normal task surface should show progress, waits and results, with a small destination marker. Human questions appear there. Child clarification can reach the parent, but an explicit human question or permission request must never be answered by the agent pretending to be human. Grants keep their scope and authority even if they share the request UI.

## Workspace is the hard part

Local worktree means a pinned commit/branch context. Current remote snapshot includes working-state bytes without local history. Before claiming target-neutral worktrees, define the source, revision, history and return contract. A remote path is not a local path.

A task result should include its workspace/change outcome. Integration is separate from execution completion. Preserve the user's earlier choice of automatic safe, conflict-free return, but make that an explicit shared integration policy, not an SSH-only side effect. Never overwrite local drift or invent applied status. Do not silently copy Git history, credentials or untracked files to create apparent parity.

## Existing user choices to keep

From user-decisions.md: current-repo handoff includes tracked edits; untracked transfer needs human approval. Destination model default applies unless explicitly overridden. Approved repo-scoped local access is not whole-machine access. Try available destination capabilities first when the laptop is offline; wait if still blocked. Keep full readable offline text with explicit gaps. Unknown execution must not be duplicated automatically.

Prepare enough authorized project context at launch that ordinary remote work does not need repeated read-back requests to the laptop. Local-only capabilities remain a real exception, not the usual working model. Do not copy the user's environment or credentials to pretend the two runtimes are identical.

## Small coherent first slice

1. Define a backend-neutral delegated-task contract around the existing job service: parent ownership, profile/role policy, workspace, start, observations, human requests, cancel and result.
2. Let normal subagent select a configured named target. Reuse existing SSH ownership/transport underneath; do not build a fleet scheduler or environment copier.
3. Agree on one honest remote workspace/source contract. Do not ship a rename of snapshot as worktree.
4. Route remote child progress, human requests and completion through normal task handling. Agent may use authorized target without asking for SSH setup per task.
5. Test one normal conversation: delegated work on Linux, remote child making its own worktree/child as permitted, human question in normal flow, laptop detaches/reopens, same task returns and integrates safely.

Do not merely call remote.launch behind a new argument while retaining the second lifecycle and inbox. Also do not rewrite every store before a vertical slice. Backend ledgers and diagnostic commands can stay private if they honor the same task contract.

Open design points: root-remote rollout timing, source/history contract, and how target policy selects among authorized places. Suggested defaults are inherit-current-runtime with explicit named override and no silent relocation. No new saved question needed yet; these are recommendations for discussion.

## Research and limits

Read-only reviews: task_419f6c7f (local/native lifecycle), task_772e8fc9 (SSH/ownership/transfer), task_b1ea6c4b (product critique). Parent synthesis used current source and the earlier user choices. No new build, SSH test, paid call, PR change or implementation in this design pass. Dogfood proof remains disposable Linux SSH with fake inference; not real-provider or WAN proof.

The parked UI work is at remote/pleasant-ux in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_93139879. Do not branch the redesign from that UI stack. Start implementation from current develop after the design is agreed, and carry only useful backend pieces and these notes.

## Confirmed in the step-by-step discussion

User confirmed: one task experience regardless of location; an agent uses the files/tools where it runs and its children inherit that place unless told otherwise; target and workspace/source isolation are separate choices. Other recommendations above remain proposals. No implementation approval yet.

User also confirmed: support main-agent placement as well as child placement; disconnect detaches without canceling accepted remote work, reopening reconnects the same task and unreachable work is not duplicated; routine child clarification goes to its parent, while real human decisions and new permission requests remain human-owned. Existing explicitly human-owned question ledgers must not be auto-answered under this proposed clarification flow.

User confirmed result handling through the delegating parent, wherever it runs, with automatic integration only when safe and conflict-free. User permits agent selection among authorized targets within preferences, but clarified LOCAL is the default. Connecting a server does not make it the default. User accepted that a deliberately server-placed agent still keeps descendants there by default. No per-task connection/approval ceremony for already authorized placement.

User confirmed destination uses its installed Die/configured models/tools, with destination model default and supported explicit overrides; role must not silently change. Current-repo handoff uses tracked current edits, untracked transfer needs approval, requested isolation stays intact and source baseline protects return against later local drift. User regards equivalent current-code behavior as obvious. The step-by-step product principles are agreed; no product implementation started during this discussion. Do not keep asking approval for basic location-neutral behavior.
