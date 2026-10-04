# Actual local normal subagent acceptance — 2026-10-04

Focused companion to parent 156e2450; the default native harness is unchanged.
No SSH, nested orchestrators, permission/dialog wiring, or app-owned delegation coverage.

## Recipe

Use supported Bun **1.4.2**, existing dependencies/assets and the pinned external T3 fixture:

    /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun scripts/build-claude-compat.ts --outfile=.cache/subagent-connector
    BRUV_CONNECTOR_EXECUTABLE=$PWD/.cache/subagent-connector \
      BRUV_RUNTIME_BINARY=/home/tnfssc/Code/bruv/dist/bruv \
      PROOF_OUTPUT=$PWD/.cache/local-subagent-NEW \
      /usr/bin/node scripts/claude-native-acceptance/run-subagent.mjs

Output must be new. T3 gets a fresh scoped runtime and automatically chosen loopback port
(or an explicit unique FIXTURE_PORT). The model endpoint also chooses a loopback port.
The entrypoint copies the existing native replay into its private runtime, replacing only
fixture module imports with the focused driver. No shared default harness, T3 source,
installed binary, global configuration, real credentials, or devices are modified.

Exact custom identity: **bruv-acceptance/local-deterministic-v1**, never a Claude alias.
The real rendered model picker selects it for each root. Explicit fast/normal/orchestrator
profiles all select that identity with thinking off; only normal launches are exercised.
Root and actual normal worker both call the same deterministic provider endpoint.
Worker executable: **/home/tnfssc/Code/bruv/dist/bruv**, not a mocked worker.
Both binary hashes are recorded. Profile/model/runtime state is isolated and removed afterwards.

## Three bounded native root scenarios

1. Model emits real execute → subagent({type:'normal',title:...,prompt:...,waitSeconds:0}).
   Worker starts a real execute tool and waits on a scoped file. Root returns an actual background
   launch result. Expand T3's Worked-for group: real Agent title and **Running**, not Completed.
   A second real root user followup finishes while the child still waits. Release produces its
   actual tool result/answer, one native terminal event, and exactly one automatic root model
   completion. Agent becomes **Completed**. Open its actual child transcript and tool inspector;
   no runnable child control is inferred from that card.
2. In a separate native root, launch another normal worker, wait for its actual execute PID,
   then use actual jobs.stop/inspect. Require confirmed killed state, native stopped notification,
   one automatic killed-job model completion, and exit of both worker and execute-tool PIDs.
3. In another native root, hold foreground execute while its normal child runs. Default native
   Stop closes the query owner and subtree. Require exit of the normal worker, child execute
   process, and outer execute process. Continue the stopped root through a new query owner.

Separate roots bound cancel/Stop ownership instead of assigning another thread's jobs to the
reopened connector. The completion/followup test itself remains on one root.

## Observed runtime callback defect

Original binder returned a JSON text Agent launch ACK with background:true/status:running.
Pinned T3 treated plain text as a terminal Agent result and displayed **Completed** while the
actual child tool still waited. Adding an isAsync JSON property did not fix this text path.
The pinned adapter explicitly recognizes **Async agent launched successfully.** as a text prefix.
Task callback now emits that truthful prefix only for a still-running background launch.
Confirmed terminal launches still emit their actual result. No second Bruv launch, model
invocation, root wake owner, or usage charge. Binder regression asserts the real async ACK.

## Evidence and limits

Final rendered/wire/source proof: **proof/local-subagent/observed**.
Real native SDK **0.3.276** reads actual child journals. Every native sourceMessageId resolves
back to its committed Bruv child entry; native UUID order and actual Agent parent tool IDs are
checked through SDK readback. Completed history contains real child prompt/tool/result/answer;
cancelled children retain actual committed partial history, not reconstructed stdout.

T3 child transcript access and terminal status are supported. Its execute inspector displays
**input**, not a visible tool-result output section in this pinned UI. Actual result readback is
proved by SDK/source journals, not by finding a result marker inside input code.
Child independent steering/wait/close/fork controls are **not** claimed.

Further direct root submission after child-view navigation raced T3's busy/Thinking UI even
though the connector emitted its successful completion result. This is an observed remaining
same-root navigation/admission gap, not hidden by a claimed full UI pass. Cancel/Stop are
therefore separate focused roots. Fresh native onboarding also produced an intermittent hydration
click race and one browser target crash; failed attempts were not called passes. No upstream patch.

Values unchanged: real causal identity, one task owner, honest rendered proof, bounded work,
and confirmed-exit rules already cover this slice. Full-product/release acceptance is parent-owned.

## Final verdict

**Focused actual local subagent checks PASS**, not full native UI/release acceptance.
Final run: T3 v0.0.46-nightly.20261003.2623, unchanged SHA-256
2cc42990ee8ad2ff30bbd43cdcf67686c9ca5aaff5e3ed36b5be40962cc53795.
Three real local_agent starts, two terminal native notifications (complete/explicit stop);
default Stop closes its query owner and confirms all three relevant process exits.
Completion wake **1**, actual killed-job wake **1**. Three actual root execute launches;
nine provider root responses, **162** root tokens; completed child **36** tokens / one tool.
Native per-generation result usage also totals 162: no child token recharging.
The native zero-token interrupt notice is not counted as another provider response.
Eight SDK child messages resolve to eight real committed source entries across three workers.
Rendered child transcript/input is accessible; rendered tool-result output and runnable child
controls remain unclaimed. Cancellation's inline answer can be replaced onscreen by its late
completion in one native turn; actual inline answer/inspection is verified once in real wire,
and actual killed completion is required in the rendered transcript.

Regressions: **12** model-fixture tests pass (including unchanged default's seven), **8** binder
tests pass / **71** assertions on Bun1.4.2 with required real pinned SDK, strict typecheck passes.
Logs and exact invocation hashes accompany the rendered proof. No release, installation, credential,
T3 patch, or shared default harness mutation. Parent must retain the noted root busy/navigation gap
as a separate full-product acceptance item.
