# Agent runtime

## Entry points and authority

[extension.ts](extension.ts) is the single agent composition root. [CLI](../cli.ts),
[prompt preview](../prompt-preview.ts), and the [Claude-compatible runtime](../claude-compat/runtime.ts)
load it. It registers hooks and connects existing services; it is not another task scheduler.
Task execution, jobs, attention, worktrees, child sessions, profiles, and cost attribution belong in
[tasks/](../tasks/).

## Follow a session and its jobs

Start in `extension.ts` and follow these operations:

1. **Attach:** `session_start` restores branch task rows and agent identity, scopes instruction continuity,
   and prepares notification delivery. `getManager` lazily creates the task manager for that attachment;
   `getService` binds its `JobService` to the same manager. Resumed child identity still restricts delegation.
2. **Dispatch:** `registerExecuteTool` and `registerRootRuntime` use that job service.
   `registerSessionHost` exposes its list/inspect/stop operations through the provider-independent
   [`SessionTaskPort`](../session/host.ts). The [remote child runtime](../remote/runtime.ts) uses this
   host to inspect jobs before settlement. Shared `session/` code does not import task or provider
   implementations; [Live](../live/extension.ts) uses its transcript contracts and the
   [main owner](../live/main-owner.ts) for turns, not another task manager.
3. **Deliver:** `completions`, `attentions`, and `notificationBatch` wire task events to the current main owner,
   T3 notification outboxes, or ordinary Pi messages. `tasks/` supplies local completion/attention
   formatters and the batcher; `extension.ts` assembles SSH attention text, combines local and remote
   notices, allocates content budgets, and selects the destination. SSH completion summaries come from
   [remote job observations](../remote/job-observations.ts). For durable T3 and SSH delivery, follow
   [local notifications](../t3/tasks/local-notifications.ts) and the [remote outbox](../remote/job-delivery.ts).
4. **Detach:** `session_shutdown` runs for reload/new/resume/fork as well as quit. It closes the shared
   host, stops notification delivery and attention, awaits manager shutdown, then closes the task-owner
   binding and clears the attachment. Do not treat the extension closure as one permanent session.

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
