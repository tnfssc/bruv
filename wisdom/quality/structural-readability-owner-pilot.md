# Structural readability: remote owner

## Direction and result

User rejected the repo-wide naming sweep and asked for an independent judge. That correction changed the bar: fewer things to reconstruct, not more renamed variables or green test counts.

This is a focused pilot on upstream 886c4c84. The old rename branch was not imported. First judge rejected its owner changes as useful names with unchanged structure. A fresh judge accepted structural candidate 390651f0. A third judge accepted final code 25fe1082 after framing and note fixes. This acceptance covers owner.ts and its inspected contracts, not the whole repository.

## What is easier to follow

- **Answer round trip:** NativeAnswerDelivery groups acceptance/recovery, durable dispatch marking, and ledger-backed acknowledgement. Receipt, slot, reply and native ledger remain separate authorities. The caller visibly invokes these operations instead of burying them in parsing and timer blocks.
- **Native settlement:** framing only yields events. nativeSettlement distinguishes active work, pending questions and completion; settleNativeTurn exposes their consequences. Successful process exit or agent_settled alone still cannot prove task completion.
- **Cancellation through exit:** OwnerCancellation owns request/report evidence. OwnerChild owns shutdown, escalation and actual close. One finally releases timers/child, drains persistence and closes the journal before locked terminal publication. Concurrent reply/cancellation fields and terminal immutability remain protected.

These boundaries own coherent operations. They are not a generic context bag, handler registry or state-machine framework. The reader can follow the three journeys without reconstructing the entire stdout callback and control timer together.

## Explicit behavior fix

A synthetic child-error event against a real SIGTERM-ignoring process exposed the teardown path. Independent judge rerun: baseline returned after 25 ms with child alive; candidate returned after 2028 ms with child dead and result unknown. This is an exercised error path, not a naturally observed OS failure. Shutdown ownership persists through escalation and close.

The first candidate also began ignoring blank/whitespace RPC frames. Judge caught that extra change. Final code restores baseline rejection; a regression failed before that fix and passes afterward. Corrupt Markdown fences and six NUL bytes were repaired.

## Proof

- Final focused suite: 103 pass, 0 fail, 1,493 assertions across 11 files. Existing authority/replay/configuration/race/journal tests retained; new lifecycle/framing/error/spawn cases added.
- Independent final judge: framing checks 2 pass, 8 assertions; accepted owner.ts/owner-child.ts blob identity, narrow delta, clean tree, diff checks, note bytes and fences verified.
- Parent Linux gate at 25fe1082: locked install, format, lint, typecheck, paired build, offline OpenAI transport, complete root tests, paired standalone smoke all passed. Root: 2,235 pass, 30 opt-in skips, 0 fail; 112,743 assertions across 303 files. Smoke is not native parity acceptance.
- CI job: task_452152ec. Transient log: /tmp/bruv-owner-reviewed-ci.log. Readability verdict is separate from these checks.

Run the full gate with Bun 1.4.2 on PATH and SHELL=/bin/sh: `bun run ci`. Automatic fish setup could not find Bun; explicit binary directory is /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin. No checks or assertions were weakened.

## Limits

Outstanding async persistence can still accumulate under contention. Completed promises are removed; that is not backpressure. No live-provider, authenticated SSH, macOS, physical-device or remote-owner compiled-CLI parity claim. Root build and generic paired smoke do not erase those limits. Pending work/questions and uncertain cancellation remain intentional safety complexity.

## Pickup and delivery

Branch: bruv/structural-readability-owner-reviewed. Worktree: /home/tnfssc/.bruv/worktrees/t3-6b8c09c6-5442693331ce-task_eacecb49. First candidate is retained at /home/tnfssc/.bruv/worktrees/t3-6b8c09c6-5442693331ce-task_7b98d051, branch bruv/structural-readability-owner-pilot.

Implementation task_7b98d051; follow-up task_eacecb49. Judge rounds: task_e67bcc5b (reject prior naming pass), task_9174b83a (accept structural pilot), task_0d485f50 (accept final narrow follow-ups). All code is committed; PR delivery is next. No broad fan-out or whole-repo quality claim from this one pilot.

[Guidance](structural-readability-guidance.md) records the structural and judge lessons. Value 2 was clarified, not expanded into a new rule set: broad readability work needs actual-code judgment separate from safety proof. It helps large agent-led passes; not extra rounds for every tiny rename. Wider structural work still remains.
