# Agent runtime

## Entry points and authority

[extension.ts](extension.ts) is the agent composition root. [CLI](../cli.ts),
[prompt preview](../prompt-preview.ts), and the [Claude-compatible runtime](../claude-compat/runtime.ts)
load it. It registers hooks and binds services to the attached session; it is not another task scheduler.
Task execution, job operations, attention scheduling, worktrees, child sessions, profiles, and cost
attribution are implemented in [tasks/](../tasks/). Notification routing and its attachment lifetime
are owned by `createJobNotifications` inside `extension.ts`.

## Follow an attachment and its jobs

Start in `extension.ts` and follow these operations:

1. **Attach:** `session_start` restores branch task rows and agent identity, scopes instruction continuity,
   and calls `notifications.attach`. `getManager` lazily creates the task manager and attention scheduler;
   `getService` binds a `JobService` to that manager. The manager captures its owning session for diagnostics,
   lifecycle records, and the optional native task-owner binding. Resumed child identity still restricts
   delegation; switching attachments must not reuse the old manager or service.
2. **Dispatch:** `registerExecuteTool` and `registerRootRuntime` use that job service, which also receives the
   [remote jobs adapter](../remote/jobs.ts). `registerSessionHost` lazily exposes the same manager and
   service through the provider-independent [`SessionTaskPort`](../session/host.ts), not a second scheduler.
   Resolving the host creates the manager through its event subscription, even before a job is launched.
3. **Detach:** `session_shutdown` runs for reload/new/resume/fork as well as quit. It stops/closes the current
   main owner and shared host, closes notification delivery, disposes attention, awaits manager shutdown,
   then closes the task-owner binding and clears the attachment. Durable notification rows remain replayable;
   closing delivery is not an acknowledgement. Do not treat the extension closure as one permanent session.

## Follow a job notification to delivery

Read `createJobNotifications` as one attachment-owned operation, rather than tracking delivery state
through the registration hooks:

- **Attach and replay:** `attach` resets the batch, releases the old SSH subscription/retry/outbox, and
  stops old T3 delivery. For the new session file it starts configured
  [T3 local mailbox delivery](../t3/tasks/local-notifications.ts) and replays/subscribes the
  [SSH outbox](../remote/job-delivery.ts). These stores own persistence and acknowledgement/claim rules;
  the notification owner connects them to session events and dispatch. A configured native attachment
  without its durable mailbox cannot launch local jobs or fall back to unowned Pi turns.
- **Observe and dispatch:** the manager calls `complete`; the attention scheduler calls `attend`.
  T3 local command notices are persisted directly at that edge, before asynchronous server admission.
  Other local notices and SSH delivery signals enter the shared batch. At flush, completion supersedes
  attention for the same local job, and attention for jobs no longer pending is discarded.
  [Local completion](../tasks/completion-notification.ts) and [attention](../tasks/job-attention.ts)
  formatters and the [batch timer](../tasks/completion-batcher.ts) live in `tasks/`;
  `createJobNotifications` allocates budgets, assembles mixed/SSH text, and selects the destination.
  SSH completion summaries come from [remote job observations](../remote/job-observations.ts).
  Batch dispatch prefers the current main owner; otherwise it transfers SSH rows to the T3 mailbox for
  native attachments or steers ordinary Pi messages. SSH claims are marked delivered only after dispatch
  succeeds; failures release them for bounded retry. T3 mailbox rows wait for server acknowledgement.
- **Hold the idle boundary:** `agent_end` delegates print/JSON settlement to `waitForNextResult`.
  It waits for a local completion/attention or owned SSH terminal/actionable observation, or abort,
  then flushes and holds pending SSH retries. It does not hold spawn or the TUI loop. RPC flushes the
  ordinary local batch; native delivery already used the durable mailbox, not Pi's volatile steer queue.
  `close` stops delivery and releases batch timers, SSH listeners and retries before manager teardown.

## Follow host access and transcript handoffs

[Host access](../session/host-access.ts) lets extension wrappers share the session host through their
event bus. The [native frontend](../claude-compat/frontend.ts) resolves it lazily; the
[remote child runtime](../remote/runtime.ts) uses it to inspect jobs before settlement, and
[remote cancellation](../remote/cancellation.ts) inspects closure through the same authority.
Shared `session/` code does not import task or provider implementations.

For host `send`/`steer` handoffs, follow `SessionHost`'s branch-scoped transcript selection and request
replay/scope checks, then [transcript-snapshots.ts](../session/transcript-snapshots.ts) when the inline
transcript is too large. The host selects received text from the current branch and checks that the
branch still matches before queuing; the helper retains immutable content across reconnects and failed
handoffs. Snapshot expiry is 24 hours after creation or last reuse; reclamation happens on later snapshot creation,
not on host close. Unexpired snapshots are not evicted to make room. These snapshots are quoted transcript data,
not audio, verified heard speech, or the raw session file with sibling branches.

[Live](../live/extension.ts) uses the session transcript contracts and the
[main owner](../live/main-owner.ts) for turns, not another task manager. The composition root forwards
typed input and job context to the current main owner when present.

## Follow context and model policy

- **Projection and compaction:** [manual-shake.ts](manual-shake.ts) plans and applies branch projection;
  [native-compaction.ts](native-compaction.ts) captures and compacts native Codex context;
  [cache-affine-compaction.ts](cache-affine-compaction.ts) handles cache-affine compaction.
  Registration order is policy: manual shake gets the first chance to cancel compaction, then native
  Codex, then cache-affine handling. Cache-affine handling skips events owned by native Codex;
  an explicit native fallback lets it run.
- **Request and cache observation:** [native-fast-mode.ts](native-fast-mode.ts) owns fast-tier policy;
  it must register before payload capture/observation so snapshots contain the transmitted tier.
  [cache-countdown.ts](cache-countdown.ts) tracks cache estimates using session-scoped attempt evidence
  from [provider-attempts.ts](provider-attempts.ts).
- **Instructions and user defaults:** [instruction-mode.ts](instruction-mode.ts) selects root-agent
  guidance; [instruction-continuity.ts](instruction-continuity.ts) keeps the current instruction frame
  available across turns. [last-used-cli-model.ts](last-used-cli-model.ts) persists explicit root TUI
  model/thinking selections, not worker or automation routing.

The persisted shake discriminator, version, validator, and invalid-record error belong to
[history/shake-record.ts](../history/shake-record.ts), not the command implementation. History readers
can interpret records without loading agent hooks.
