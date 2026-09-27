# Session-owned SSH jobs integration

Implemented from the copied [audit](remote-jobs-integration-audit.md), not by merging the standalone wake in 33f4fe5. SSH transport/owner journals remain authoritative; TaskManager still owns only real local processes.

## Ownership and surfaces

- Local cache persists jobSessionFile before SSH launch. Pinned server ownerId/epoch and immutable retry intent remain in the same task. Retry cannot reassign ownership; historically unowned tasks stay human-only. Human launches with a durable active session use the same attribution. Repository preparations persist it before upload and retain it on retry. Human commands with no session file are unowned.
- JobService receives the adapter and returns session-owned SSH jobs under ssh:<base64url(raw taskId)>. Raw remote methods still use raw taskId and the shared host cache; unprefixed SSH IDs are not migrated into jobs or silently sent to T3. Native IDs retain their existing namespace and are checked before native dispatch.
- Mixed cursor v2 orders local/native/SSH, pins counts over stable durable launch order, validates bounded cursor data, and returns only the current session’s jobs. Inspect pages are byte-bounded UTF-8 cached journal output, expose transcript gaps/staleness, and invent neither process exits nor stdin. stop/stopWork record cancellation intent and distinguish confirmed terminal, pending, and partial/error. Offline discovery is not live server discovery. Input, closeInput, snooze, setWatch reject SSH IDs.
- Periodic SSH refresh is discovery only. job-observations.ts filters by durable session ownership before publishing into job-events.ts; all owned tasks (not merely the last 20 UI entries) are projected. Remote extension does not separately announce owned completion/artifacts. Explicit human status/sync/transcript output remains available.

## One completion owner and acknowledgment limits

The agent extension extends its existing CompletionBatcher union, shared main-owner/Pi dispatch and print/json agent_end boundary. It does not register another wake extension or fabricate local TaskInspection. Subscribe then recheck closes finish-before-subscription. Human-action waits use the same batch as attention; they neither answer questions nor grant capabilities. Print can yield at a human wait. No SSH periodic quiet/snooze scheduler is implemented: unsupported controls reject rather than pretend local scheduler semantics.

A per-session SQLite adapter outbox deduplicates terminal by pinned owner/epoch/task, independent of transcript/artifact changes. Actionable waits deduplicate their stable payload; terminal supersedes pending attention. Atomic 30-second dispatch leases fence concurrent processes. Failed synchronous dispatch releases its lease and retries with exponential backoff, up to eight attempts; restart reopens exhausted failures without stealing a live lease. Batches claim at most five rows; shared formatted content remains bounded. Envelope IDs remain unchanged during retries. T3-owned sessions forward through the existing durable T3 local-notification mailbox, never an unowned Pi turn. Teardown releases subscriptions/timers without cancelling SSH work.

**Not an exactly-once parent-turn guarantee.** The adapter's delivered bit means existing host dispatch accepted the message (or the T3 mailbox persisted it), not that a provider answered or human saw it. A crash after host dispatch but before marking acceptance may replay the same envelope after lease expiry; the host has no proven atomic idempotent acknowledgment, so a duplicate turn in this uncertainty window remains possible. Conversely a Pi host returning from sendMessage before durably retaining its queue could lose a turn on subsequent crash: durable end-to-end at-least-once acknowledgment is **unproven**. Ordinary reconnect/refresh/artifact changes deduplicate; dispatch throws retry, not mark accepted. Live sendContext likewise supplies dispatch acceptance, not provider-response acknowledgment. We do not treat transport/UI rendering as coordinator acknowledgment.

## Concurrent human UI integration

Parent merges task_dca0ef2b separately; its worktree was not edited. Preserve these remote/extension.ts seams during merge: import publishRemoteJobObservations; sessionFile binding on session_start; publish all cached owned observations after sync; suppress autonomous die-remote notices for any task.jobSessionFile; pass jobSessionFile in direct/repository human launch sites; restart/clear refresh timer on session switch/shutdown. Keep the UI worker's concise rendering/menu behavior. No new Live tools: execute remains the single tool boundary.

## Work and proof

Primary worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_e24554da; branch die/integrate-ssh-remote-tasks-into-existing-e24554da; base 90f047f. Worker worktrees are sibling directories ending task_14349fbc (adapter), task_0951fc2b (shared completion), task_1e8b7c66 (CLI proof), task_9182d6a0 (adapter hardening), task_3dcce4bb (Docker-only provider proof); changes reviewed/integrated here. Earlier standalone wake branch inspected, not merged.

Tests cover durable ownership, session isolation, mixed pagination, malformed namespaces, bounded UTF-8 inspect/gaps, offline partial cancellation, unsupported operations, terminal/action dedup, concurrent leases, crash-uncertain replay/retry bounds, shared print completion and human waits. See [normal CLI proof](remote-jobs-cli-proof.md). Typecheck/regression tests use explicit Bun 1.4.2 PATH and SHELL=/bin/bash to avoid unrelated interactive fish startup output. Built with scripts/build.ts --reuse-web using a copied existing web runtime; no web source changes, install, push or release. Parent still runs full suite/reviews before shipping.

Values unchanged: existing values already require one owner, durable uncertainty, bounded output, honest proof and preserving human authority. This is a feature implementation, not a new general rule.

Validation recorded: Bun check passed; 527 passed / 10 opt-in skips / 0 failures across 81 jobs, task, Live, T3, remote and subagent-extension files. Docker-only compiled CLI integration passed separately. A final targeted pagination test also covers a newly launched random ID sorting before the previous page. Paid/real-provider and PTY tests were not run for this change.

Final review fixed an additional inspect truthfulness edge: SSH journal sequence starts at one, so a first event with seq=1 is not output loss. A focused regression and final typecheck cover it; this is independent of the compiled parent-wake proof.
