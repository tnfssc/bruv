# Independent Fast repair rejudge — ACCEPT

## Exact target and reviewer

**ACCEPT** for repair commit **0ef23a5c525d7e13884e4793bd65e50573d3ef9b**, relative to **484dc0ef**. HEAD was exactly that repair; the working files matched these Git blobs, with no source/test/wisdom differences:

| File | Reviewed blob |
| --- | --- |
| src/agent/native-fast-mode.ts | 77af6b183259595e571cc6e2e16afcef71b174ef |
| tests/native-fast-mode.test.ts | 59f2e41e4c7e046faac430175975fc55d23e8a3d |
| wisdom/native/native-fast-mode.md | 35841b6c624b9d83929bdaa95910702b909b7b0f |

Actual reviewer model independently verified from this session's model_change event: **openai-codex/gpt-6.1-sol**, event **959e14fd**, **2026-10-08T15:24:25.316Z**, session **01a11c1d-9914-7617-b4fd-9a864ac5a8c2**.

Read the complete original quality-intent-review.md from task_ec7a9c16, wisdom/values.md, structural-readability-guidance.md, and the original owner pilot. This verdict applies their existing standard: reduce reconstructed decisions and duplicated ownership, not merely names, lines, or test counts.

## The formerly split journey is now coherent

The prior REJECT identified three programs constructing the same consent checkpoint and two publication routes. That finding is resolved in the actual source, not merely its description.

At **530–543**, persistSelection now owns the complete v2 record: current session ID, admitted model's provider/ID, OAuth surface, enabled/costAcknowledged pairing, and timestamp. It publishes through persistSetting. Host **562**, command **672**, and inherited startup **701** all use it. There is only one durable selection constructor and one NATIVE_FAST_ENTRY append site (**196**). The synthetic volatile off record in resolveSetting is a read-time safety override, not a competing publication program.

A reader can now follow “caller admits consent → persistSelection binds the checkpoint → persistSetting publishes or rolls back → caller reports outcome.” No comparison of three schema-building blocks or special startup append semantics is needed. Passing the model explicitly matters: the command supplies the model it rechecked after confirmation rather than leaving the helper to choose an unchecked model. The boolean persistence result preserves caller-owned consequences without a generic settings framework or shared context bag.

Different admission paths remain intentionally visible, not mistaken for duplicate policy: an explicit host user selection, interactive/noninteractive command consent, and a one-shot authorized child launch are different sources of permission. The shared rule is the checkpoint they publish.

## Safety and caller boundaries remain meaningful

- **Async command consent (593–675):** session ID, branch leaf, provider and model ID are captured before confirmation. After the await, the command checks them against current state and rechecks the admitted authentication surface. There is no await between those checks and publication. Stale/cancelled consent still returns before any selection write. Publication binds the rechecked currentModel and current session; extraction did not erase consentScope or move confirmation into persistence.
- **Host boundary (545–565):** explicit cost consent stays at setWithCostConsent. Compatibility, endpoint and auth admission remain local. A failed write still throws the bounded host error instead of reporting success. Unsupported host false selections still create no authorization. The compatibility runtime's initial selection closes on failure and rethrows (616–624); apply_flag_settings validates boolean-only input and idle state, then propagates failure (688–702). Transport catches rejected control handlers and emits an error response, not success (317–353).
- **Checkpoint failure (190–210):** persistSetting retains its prior-leaf capture and best-effort restore after append failure, including append-then-throw. Failed off selections suppress prior premium consent through the manager/session/provider/model-scoped volatile opt-out; only successful publication clears that scope. Both status resolution and request policy see that suppression. This mechanism and restoreLeaf are unchanged; rollback is not being represented as infallible under a separately failing restoration operation.
- **Inheritance (505–508, 687–711):** the launch bit is consumed from the environment and spent once before admission/publication. Child depth, concrete runtime compatibility, supported model/auth, and an absent setting remain required. Existing valid, corrupt, or volatile-off settings are not overwritten. Startup now uses the same rollback path; persistence failure records a bounded failure notice/diagnostic, reaches status refresh, and does not retry on a later session_start. An absent prior setting plus successful leaf restoration prevents the failed inherited opt-in from becoming active.
- **Request authority (269–503):** these bodies are untouched by the repair. Concrete streamSimple captures primitive provider/model/auth/tier policy before asynchronous preparation; the private closure does not reread mutable session selections after waits. Ambiguous ownership is rejected. Prepared provider/model/auth, premium endpoint and canonical resolved credential/header checks remain before provider dispatch. The final payload guard validates object/model/tier after the complete hook pipeline. Pi's emitter swallowing hook exceptions is therefore not the safety boundary. Installed OpenAI and Codex serializers await onPayload before HTTP creation or WebSocket/SSE body dispatch. Request-local standard compaction policy and runtime-controller detach lifetimes remain intact.

## Evidence and remaining scope

Read **all native-fast-mode.ts lines 1–724**, **all native-fast-mode.test.ts lines 1–1321**, and the complete repair diff including its feature note. The new tests exercise equal caller records, host failed-off suppression, and inherited append-then-throw rollback/error/one-shot behavior. Existing tests still express stale confirmation, request snapshots, controlled write failure, OAuth/credential/endpoint rejection, and final-hook mutation blocking. **The worker's reported 13 tests / 69 assertions are safety evidence only; I did not execute or independently reproduce them.** Source ownership and the traced journey determine ACCEPT.

Necessary neighboring reads: src/agent/extension.ts **115–137**; src/claude-compat/runtime.ts **351–384, 595–640, 661–717**; transport.ts **238–284, 311–358**; history/session-manager.ts **47–135**; session/restore-leaf.ts complete; tasks/job-service.ts **573–595**; remote/placement.ts complete. Installed Pi ModelRuntime **447–517**, extension runner **1066–1093**, OpenAI serializer **115–138**, Codex serializer **152–213** confirm the inspected request seams. The history reader selects newest matching active-branch records; this repair does not change that authority.

**No unresolved finding requiring rejection of these repair blobs.** Existing limitations remain: best-effort leaf restoration, registry auth-surface rather than specific-account identity, and no native task-backend Fast inheritance. These are retained boundaries, not new guarantees. No independent reacceptance of the other nine files, history/workload repairs, or later combined source tip is implied.

Static review only. No tests, setup retry/bypass, installation, preparation, scripts, live auth/provider/device/SSH actions, secrets inspection, sudo, deletion/recovery, source edits, push or merge. Only this report was added. Runtime/rendered-host acceptance and final-tip validation remain with the parent after integration. Values/guidance unchanged: this repair successfully applies their existing ownership/readability principle.
