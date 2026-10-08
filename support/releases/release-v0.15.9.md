# v0.15.9

## Remote jobs belong to the coordinator

- Session-owned SSH tasks now appear in jobs.list/inspect and support jobs.stop/stopWork. Stable SSH IDs keep local, native and remote jobs distinct; unsupported controls reject explicitly.
- Remote completion and actionable waits use the existing job batch and parent-turn boundary. The launching coordinator receives a follow-up instead of leaving raw worker output unanswered. Other sessions do not adopt its work.
- Durable delivery claims and dedup handle ordinary polling/reconnect/restart. End-to-end exactly-once delivery across a crash is not guaranteed: the final dispatch boundary can replay or lose a queued turn. Offline cancellation remains pending/unknown until confirmed.

## Human progress, not polling JSON

- Routine event-count changes update a compact named footer instead of appending JSON messages.
- Human remote commands and completion text are readable; explicit transcript inspection retains full events. Machine APIs remain structured.
- Status preserves uncertain replies/cancellations and unfinished repo preparations with recovery hints.
- SSH connection labels show user@host support; exact-command autocomplete no longer needlessly consumes Enter.

## Validation

Parent full suite: 1,326 passed, 17 skipped, zero failures. All three compiled Docker/SSH gates passed, including terminal menus/quiet polling and coordinator responses through print/JSON job delivery. Typecheck, formatting and lint passed. A compaction test fixture now gives the SDK summary request capacity headroom; no compaction product behavior changed.

Remote evidence remains Linux Docker with a deterministic fake provider, not real Mac/provider deployment or fleet scale. Existing scope/resource limits remain. Configuration discovery stays parked.
