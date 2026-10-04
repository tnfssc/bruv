# Native app-owned normal workers

## Ownership and configuration

The connector reads the **same** ~/.bruv/subagents.json as ordinary CLI delegation (HOME is deliberately disposable in acceptance). An agentDir-local subagents.json is not another profile source. native-app-worker.json contains operator-owned T3 routing/role policy, not independent model defaults. MCP annotations and model inputs never supply worker authority.

Example ordinary CLI profile:

```json
{"normal":{"model":"provider/exact-worker-id","thinking":"high"}}
```

Root connector agentDir/native-app-worker.json:

```json
{"role":"orchestrator","depth":0,"worker":{"type":"normal","thinking":"high","target":{"providerInstanceId":"distinct-normal-instance","model":"provider/exact-worker-id","options":[{"id":"effort","value":"high"}]},"runtimeMode":"approval-required","interactionMode":"default"}}
```

The distinct normal T3 provider instance uses a different connector agentDir containing:

```json
{"role":"normal","depth":1}
```

The root requires exact normal model/thinking agreement with the CLI profile, and replaces delegate_task target/options before human authorization. Human-updated inputs cannot change that policy. Only the configured root orchestrator can delegate; create_threads/t3_thread_launch are not an escape into root conversations. Native normal launches reject explicit conflicting model/thinking and bind their actual Pi reasoning level from the CLI profile. A model-less local initialize probe selects that same normal model. Role/depth floor applies to ordinary execute/subagent too. This is application/API ownership isolation, **not** a new OS-user/filesystem sandbox.

## Concrete integration fixes

* Removed connector-local profile duplication without reverting actual TaskBinding or Live wiring.
* The original reasoning worker fixture used OpenAI Completions, which correctly failed native summarized-thinking admission. The dedicated normal provider now uses a genuine loopback Responses API fixture; every worker request verifies exact model, reasoning.effort=high and reasoning.summary=auto. Runtime support checks were not weakened.
* The unchanged official T3 Effect MCP server returns OrchestratorMcpFailure in structuredContent with isError:false. MCP SDK1.27.1 then validates it as success and loses the actual scope-denial message. The narrow adapter marks this known **app-owned** failure as an error, preserves its original contents and bypasses only error-versus-success validation. Genuine successes retain SDK schema validation; ambiguous transport outcomes remain unknown, never retried. binding.ts now exposes actual MCP error content. Dedicated SDK fixture regressions cover both ordinary isError and the captured official returned-failure envelope.

## Acceptance seam and limits

The dedicated driver uses unchanged pinned official T3, actual compiled connector/normal binaries, real supplied T3 MCP and real Pi execute calls. Only provider inference is deterministic loopback; it does not generate native packets or implement a T3 endpoint. Browser submits orchestrator_capabilities→delegate_task, observes actual running native tasks, opens the completed native child via its rendered link, reads its result, returns with the rendered parent button's Enter action, then drives real task_cancel and task_status. Read-only native SQLite projections prove exact instance/model/effort, subagent lineage, app_owned origin, completion result ACK and cancellation state. Markers alone are not the proof.

Observed semantics: completed child result delivery is acknowledged by task_status; task_cancel yields a terminal **interrupted** child and **disposed** delivery, not a second cancellation continuation. A late local-model reply is intentionally released after cancellation and must not appear in native child output. Actual root/child jobs.list returns no Bruv clone; app delegation produces no connector task_started/task_notification. Child native/local delegation is denied; its native credential cannot inspect its parent's app task; execute receives zero root-control variables.

The honest connector version warning remains. It masks the header's parent navigation button for pointer clicks; the proof uses its real keyboard action instead, not force-click or T3 edits. At this reported connector version the SDK omits an effort launch flag: native stored selection is high and connector binds the ordinary CLI high profile, verified at the actual provider request. Do not claim that an --effort flag was delivered.

An earlier real run released a child while T3 still rendered the root as Working, despite an emitted connector result; child completion appeared but no automatic status/ACK continuation arrived. The focused late-completion proof deliberately waits for T3’s rendered Waiting-on-subagent state before releasing it. The current final replay also reached late completion/ACK/child UI but then T3 kept the parent active, preventing the next rendered Submit message. Overall full app-worker acceptance remains failed. Early native-app completion and repeated native root settlement safety are not established here; no synthetic continuation was injected.

Normal native children currently report no parent saved-question runtime binding; this proof does not claim child-human dialog support, paid inference, provider account/device access, arbitrary nesting, SSH, or full process-restart/resume. Cleanup can emit conservative MCP teardown diagnostics when T3 closes its server before connector session deletion; runtime cancellation/terminal state is checked separately, not inferred from cleanup. Parent owns the complete default/human/history acceptance and packaging decision.

Values unchanged: one real lifecycle owner, exact profiles, truthful observed state and rendered-control evidence already cover this work.

Final broad check repeated later:133 pass/6 skips/1 failure in unchanged task-binding test "actual SDK execute bridge binds two shells and a real Pi worker without label inference": expected final worker answer but terminal summary was only agent_start/turn_start stdout. Earlier identical broad run passed134; cause not established here and task-binding implementation was not changed. This is an observed regression-check limitation, not a claimed all-green final run.

Final independently scoped checks (Bun1.4.2, actual compiled connector+normal pair; test budget20s):18 pass/0 fail/110 assertions for app-worker policy, MCP and compiled suites. Local model checks10 pass. Typecheck passed. Full native UI acceptance remains failed as documented.
