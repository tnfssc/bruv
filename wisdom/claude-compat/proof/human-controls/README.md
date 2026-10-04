# Native human controls acceptance

This proof uses actual compiled Bruv/connector, the unchanged official pinned
T3 v0.0.46-nightly.20261003.2623, and only the loopback deterministic test model
bruv-acceptance/local-deterministic-v1 (not Claude). No provider, device or real
credential is used. The harness owns unique temporary roots and loopback ports,
pins connector bytes before launch, removes raw wire/scoped state, and records
cleanup. Rendered frames are original official T3 UI; fixture IDs/paths on images
are local fixture state, not credentials. Exported protocol identities and ledger
owners are hashes. Text snapshots redact temporary fixture paths.

The focused human branch checks actual Supervised execute consent before side
effects; allow, deny, Stop while waiting; explicit native question deferral without
an answer; Stop/reload/reopen with unchanged question owner/ID/version; saving a
real answer after recovery as resume-needed; explicit human resume; real execute
permission for questions.resolve; and exactly one answer continuation after
another reopen. Commands never reach the local model.

Official live native AskUserQuestion has no dismiss affordance (only asynchronous
message-mode questions are dismissible). The connector therefore presents the
honest human choice **Keep pending (do not answer)**. Selecting it uses official T3 single-choice auto-advance/submit behavior and
leaves the existing ledger record unchanged; it is not a saved answer.

Observed upstream gap: Stop cancels execute consent but official T3 retains the
cancelled approval card, even on reload. The driver records that frame and
explicitly uses real Decline to recover. The side effect remains absent. This
is not proof of automatic card clearance or a polished all-green T3 experience.
A zero-model native human command can also stay Working after its genuine
success result; actual Stop/reopen is used when needed without inventing model
workload counts. The shared harness uses the real Start without a project
empty-state control if source-control auto-bootstrap has left no project, and
then preserves that ready native composer. No upstream files are edited.
Browser tab disconnect, narrow viewport, and full
menu/picker discovery are not separate acceptance claims here. Task/Live/app
policy/history integration belongs to the parent's composed gate.

The only runtime fixes are native terminal-result ordering behind real pending
question callbacks, projection interrupt without modifying the saved ledger,
and correlated source UUID metadata for received human commands. Native command
resume may start a genuine Pi follow-up; the Pi settle event owns its terminal
result, not the command handler returning. No fabricated task/lifecycle events,
second question service, scheduler, or question continuation loop is added.

Final gate/results are recorded in observed/result.json and gates.md.

## Strict command-idle follow-up

[command-idle/README.md](command-idle/README.md) retains the failed no-recovery
follow-up. Truthful native started/completed command metadata alone does not
settle zero-model commands in unchanged T3. The current driver refuses the old
Stop/reopen completion workaround; shared result settlement remains blocked.
