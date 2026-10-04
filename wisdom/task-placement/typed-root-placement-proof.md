# Typed root proof ownership and integration notes

## Lasting worker work

- Branch: remote/task-placement-typed-root-proof
- Tree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c7fed9c-a86675007a5e-task_33783e38
- Owns only NEW scripts/remote-root-placement-e2e.ts,
  tests/remote-typed-root-placement-fixture.test.ts,
  tests/fixtures/remote-typed-root-placement/* and this wisdom file.
- No production files or existing child runners changed. Do not reuse canceled
  raw SSH/tmux-root design or call finite-child proof root acceptance.
- Contract read: lead [historical typed-root contract](../remote-workspaces/task-placement-implementation.md#retired-root-handoffs-2026-10-04), src/remote/root-contract.ts,
  ROOT_CLIENT_INTEGRATION.md, PARENT_ROOT_ACCEPTANCE_NOTES.md.

## What has actually run

Direct Bun 1.4.2 focused fixture/assertion tests: 16 pass. Infrastructure probe
completed using cached die-remote-e2e-2434886-5027:latest, real SSH through docker
exec proxy, network:none and server-only fake inference. Probe artifact receipt:
/home/tnfssc/.die/tmp-pi-removal/remote-root-placement-artifacts-7tOMRD/receipt.json

That is NOT combined root acceptance. No full actual binary run is claimed in
this commit. Lead's former candidate lacked root backend. Run the new runner only
with DIE_BIN pointing to the actual combined compiled CLI after integration.

## Integration assumptions that must stay visible

Backend remote/task-placement-root-owner owns one persistent server RPC root,
intent root/depth0, typed command receipts/status/events, durable question and job
facets, successful close exitCode0 and repository-result retention. Frontend
remote/task-placement-root-client owns pointers at ~/.die/remote/roots and exact
command ledgers, root presenter and source return. Lead owns early --place wiring
and root runtime registration. Runner itself does not instantiate a parent/local
inference session or implement backend behavior.

Setup human authorization is explicitly seeded using pinned RemoteClient.connect
against ONLY the temporary alias/server. No provider files in temporary client
HOME. Server settings chooses root fixture model; server normal profile chooses
child model. Plain typed prompt starts work, not a positional launch prompt.
Host tmux drives selectable /questions and /ps, detach/reattach and explicit human
choice. Server SSH PermitTTY=no. SSH key material is temporary and never copied
to artifacts. No server tmux process, package fetch, provider/WAN call or video.

Current runner consumes frontend root.json and RootRecord.sessionFile plus typed
receipt results. Schema path adaptation is allowed, semantic weakening is not.
Source capture remains honest orphan-baseline history. Both root sessions have
first prompt, human answer and explicit second prompt in one journal. A fresh
second scenario begins from the prior successfully returned source, uses explicit
human include, then introduces real local drift for review-only return. Closed
reattach must not cumulatively replay either patch.

Remaining actual acceptance gaps are reported in receipts: unknown reply recovery,
running cancellation, unsupported source/isolation modes. Idle /abort isn't a
running cancellation proof; assertion-unit unknown rejection isn't backend crash
recovery proof. See fixture README for exact commands and expected artifacts.

## Follow-up gap scenarios (2026-10-01)

Branch remote/task-placement-root-proof-gaps extends only the existing fixture,
runner, focused tests and wisdom. Read lead ROOT_OWNER_INTEGRATION.md and
[historical typed-root contract](../remote-workspaces/task-placement-implementation.md#retired-root-handoffs-2026-10-04) from the parent tree (owner still integrating). No production
changes or full acceptance run. Direct Bun 1.4.2 focused fixture tests now pass 22/22,
including a real subprocess exercise of the discard/status-gate relay mechanics.

Combined runner now demands a genuine unknown local receipt after an actual
successful server SSH command reply is discarded; captures it before reconnect;
then requires exact saved identity, command-status reconciliation, one send and
one server tool execution. The gate is fixture-only, no durable ledger edits or
fake backend response. The third root launches an actual long-lived shell process;
human /ps cancellation must have a running pre-inspect, successful typed stop,
terminal non-success post-inspect and dead PID, not just stop acknowledgment.
CLI full-history/worktree and conflicting source requests must reject before any
startup/inference/source mutation. Source roots still have real second-turn edits,
with new explicit local-diff/absent-outcome checks after both turns, followed by
successful-close-only protected return. Fault root detaches without close/return.

Honest gaps remain in receipt: backend dispatching crash becoming unknown,
streaming-root abort, unsupported mode rejection at the server-protocol boundary.
These are NOT proved by reply loss, shell-job cancellation or CLI rejection.
Full acceptance must wait for the combined binary. If layout/terminal details need
adaptation, preserve these semantics and fail-closed assertions.
