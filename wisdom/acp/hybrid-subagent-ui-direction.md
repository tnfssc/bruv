# External T3, steering and mixed subagent ownership

2026-10-03. User clarified that deep UI integration matters: ordinary Bruv subagents and monitoring should appear in T3, like Claude activity. They may want T3 orchestrator v2 to replace Bruv orchestrator spawning while retaining normal Bruv workers. This is a design question, not migration approval.

## Clarify the claim

No bundle/fork does not mean no T3 application. T3 would run separately as the frontend. Genuine native Pi steering was proved only under an explicit research version shim; direct setup and full task integration are not complete. Do not describe that narrow proof as complete parity.

## Existing upstream display hook, source-verified

Official nightly fed41fa PiAdapterV2.ts1016–1110 already observes the real Pi example subagent tool and emits shared UI records. It checks toolName === subagent, then details.results[]. Required result fields include agent/task; model, step, finished, stopReason, exitCode and messages provide identity/state/progress/output.

It emits both subagent.updated and turn_item.updated(type=subagent), with origin=provider_native. Status distinguishes running/completed/failed/interrupted. ChildThreadId is null. Native Pi capabilities182–192 explicitly support subagent lifecycle but not exposed child thread IDs, wait/close/fork controls. Thus existing T3 supports provider-owned child display without claiming it owns/resumes those children. This is source evidence, not a new real Bruv child-count browser test.

Important async edge: finished = outer tool completed OR result.finished. Bruv's execute/subagent helper can return a background job early. Naively renaming a completed execute result to subagent would falsely finish its children. Need a truthful child-lifetime projection with stable identities, actual updates and replay, separate from the launch receipt. Do not spoof Claude events or count a monitor as a subagent merely to get a badge.

Bruv currently emits execute plus its own typed task metadata, not that exact Pi example shape. Connector changes are required. Verify actual running counts/progress/error/interrupted/reload UI before promising the desired experience. Monitoring/background process presentation is a separate mapping; the source inspection here establishes the subagent hook, not full Claude monitor parity.

## Proposed explicit split

- T3-owned orchestration: deliberate delegate_task path with T3 owning child thread/run, completion delivery and cancellation. Its MCP task_status acknowledges terminal delivery. Bruv profile/model/permission/depth/placement mapping must be explicit.
- Bruv-owned normal/fast workers: Bruv owns process/job state and cancellation; connector reports real provider-native lifecycle to T3. Display is not transfer of authority. Shared UI may show them without a native navigable T3 child thread.
- Background commands/monitors: Bruv owns unless intentionally delegated. Render their actual state distinctly; keep the root delivery lifetime valid so later updates do not vanish.

Bruv's orchestrator profile (an agent allowed to delegate) and T3's orchestrator v2 (the scheduler/ownership system) are different concepts. Routing that category through T3 is a possible redesign, not a rename. Do not expose competing interchangeable default task owners or inherit a root credential into local children.

## Next bounded acceptance slice

If this split is chosen, demonstrate external unmodified T3 with proper native steering, two real Bruv normal workers (parallel running count, one failure), one background monitor, and one explicit T3-owned delegated task. Confirm actual output, ownership, Stop versus child cancellation, stable IDs and reload. No T3 source edit is assumed; if the supported projection cannot represent the required UI, report the exact gap before adding a patch.

No new production code/runtime trial in this addendum. Parent read exact official native-Pi projection and upstream delegate_task contracts. Values unchanged: the existing one-owner and honest UI rules directly cover this design.
