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

## Same-root child return follow-up — 2026-10-04

Concrete gate added, **not marked fixed**. Three bounded actual pinned-T3 attempts:

1. Child transcript → Open parent → normal Submit → **ROOT_AFTER_CHILD_REAL** in the
   original root URL/native session passed. Prior cancellation/Stop checks also passed.
2. Fresh fixture failed before model work while selecting Local folder. Captured page:
   Settings/Connections. Bootstrap failure, not busy-root evidence.
3. Child return, next real reply and idle composer passed again, as did cancellation and
   default Stop/continue. The **new wire ownership gate fails**:
   `Consumed prompt UUID missing/wrong: ACCEPT_LOCAL_SUBAGENT`.

We did **not** reproduce the intermittent post-return busy/Thinking UI in these attempts.
Two successful navigations are not a fix. Actual root wire in attempt 3 still has zero
prompt-consumption echoes and no origin on initial human, follow-up, task completion or
after-child results. Canonical journal contains the task-complete custom message followed
by ROOT_COMPLETION_ONCE_REAL, then the distinct next user/assistant exchange. Native root
runs 1–4, provider turns and child projection are completed, not orphan-running, at capture.
Attempt 1's persisted binder cursor is terminal, Agent result emitted, five child entries,
36 tokens and one child tool. No separate production binder defect was proven. This matches
the missing fields in the [focused prompt-correlation finding](focused-integrated-review.md),
but these successful UI timings do not prove it caused the earlier hang.
**task_0720fd7d owns runtime.ts/frontend.ts consumption/origin**; neither file nor T3 changed.

The harness unconditionally requires the same persisted root URL, one actual distinct next
model reply and success result in the same native session, and an idle composer before it
may create the independent cancellation/Stop roots. No root replacement, reload, Stop,
Queue or Steer gets past return admission. It also requires consumed human UUIDs on results
and supported `task-notification` origin on actual completion, with no reused human UUID.
Failure evidence is captured before state removal: marker-only correlation, committed source
messages, relevant T3 SQLite statuses; no auth/payload rows or prompt text exported.
Full expectations increase only for the extra reply: 10 root responses / 180 root tokens,
still three actual root execute launches, child 36 tokens, one successful completion wake
and one killed-job wake. A pre-patch no-echo run must not turn green.

[Evidence](proof/local-subagent-return/observed/) includes attempt 3's deliberate FAIL,
return/next-reply frames, real wire/source/status projections, model sequence, artifact hashes
and cleanup. Attempt 1's earlier PASS predates the strict ownership gate; not current acceptance.
Unchanged T3: `2cc42990ee8ad2ff30bbd43cdcf67686c9ca5aaff5e3ed36b5be40962cc53795`.
Real compiled Bruv + loopback-only model; no real credentials/paid calls, T3 patch, release,
bundle removal or push. Every owned runtime/browser state directory was removed.

### Parent checkpoint after task_0720fd7d

Apply that patch; rebuild from the integrated checkout, then run there:

```sh
BUN=/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun
"$BUN" scripts/build-claude-compat.ts --outfile=.cache/local-return-connector
TMPDIR=/var/tmp BRUV_CONNECTOR_EXECUTABLE="$PWD/.cache/local-return-connector" BRUV_RUNTIME_BINARY=/home/tnfssc/Code/bruv/dist/bruv PROOF_OUTPUT="$PWD/.cache/local-return-proof-$(date +%s)" /usr/bin/node scripts/claude-native-acceptance/run-subagent.mjs
/usr/bin/node --test tests/claude-native-acceptance-model.test.mjs tests/claude-native-subagent-model.test.mjs tests/claude-native-subagent-return.test.mjs
```

Node 25.9.0 was used (read-only node:sqlite evidence). The launcher reserves a private port
when FIXTURE_PORT is unset. Use a new proof directory, not an earlier PASS. Do not skip the
UUID/origin gate or replace the root if blocked. Require same-root browser reply **and** wire
ownership to pass. Inspect same-root-return-evidence.json for completion origin, next prompt
echo, committed source exchange and no lingering root run. Classify bootstrap failures
separately; a fresh retry is not a fix. After-patch race acceptance remains the parent's next
step. Earlier rendered child-tool-result and runnable-child-control limits are unchanged.

### Separate proven fixture correction

The binder SDK test used waitSeconds:1 then immediately shut the session down. Under load,
the budget returned during real worker startup; shutdown cancelled it and expected answer
became only agent_start/turn_start output. Test now awaits actual TaskManager exits before
shutdown. No larger waitSeconds, weaker result/source assertions or production binder edit.
Before: 7/8 pass (67 assertions). After: **8/8, 71 assertions**, required pinned SDK 0.3.276,
Bun 1.4.2. Model/harness regressions **16/16**, including default's unchanged seven; new four
also pass in Bun. Strict typecheck and whitespace checks pass.

Values unchanged: whole-product proof, honest gaps and one owner already cover this work.

## Post-integration root-return P1 remains open

[Final rebuilt connector proof and exact native/SDK/persisted-event boundary](proof/same-root-lifecycle/README.md). Supported task origin and turn lifecycle were corrected; actual-consumption UUID ownership, true steering and the TaskManager owner are intact. 177 focused tests and typecheck pass. Final real UI still fails Stop-hidden after the next actual same-root reply; no cancellation/Stop roots follow that failed checkpoint. Do not count reply visibility or the earlier intermittent origin-only full pass as final idle acceptance.
