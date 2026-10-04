# No T3 fork, with real steering: decision point

2026-10-03. User accepts changing pi-acp, prefers no T3 changes, and requires the proper CLI steering experience in T3 UI. The last condition changes the adapter-only recommendation. This note joins actual proof, not just advertised features.

## Confirmed outcomes

| Route | Unmodified T3 | Background answer retention | Actual CLI-style steering |
| --- | --- | --- | --- |
| Published pi-acp generic ACP | Yes | Failed after root settles; concurrent input could disappear | No; generic UI Steer cancels/replaces |
| Experimental changed pi-acp hold-open | Yes | Passed bounded real local shell + completion reply + reload | Still cancel/replacement, not current-tool-safe native steering |
| Native Pi provider with direct Bruv path | Yes | Not tested successfully | Blocked before launch by product-version/engine-version gate |
| Native Pi provider with explicit research-only version shim | Yes | Native job contract remains incompatible/unproved | Actual UI pass: streamingBehavior:steer, tool completed, correction applied, no abort or extra agent_start |

No row is full product/migration acceptance. Research models were local deterministic endpoints; actual engine/tools/client/provider behavior was exercised as described.

## Why pi-acp alone cannot fix generic ACP steering

Actual browser commands differ: queued-message.promote-to-steer versus run.interrupt. But generic ACP sends the exact same session/cancel object with only sessionId in both cases. No intent or metadata reaches the adapter. Steer then sends an ordinary replacement prompt. It retains the T3 run/native session but supersedes the provider attempt; this is not native in-place steering.

The real Pi probe establishes the difference: native steering does not abort active tools, applies correction before the next model request at a safe boundary, and preserves follow-up input. An adapter cannot infer a non-cancelling steer from a cancel that is identical to Stop. Do not use a timeout, ignore Stop, or secretly keep foreground work running to pretend otherwise. Merely preserving detached jobs across an abort does not preserve the current tool loop.

Sources and wire: [steering-wire-contract](steering-wire-contract.md), [source contract review](pi-acp-only-options.md).

## What the adapter-only prototype did solve

An isolated pi-acp patch uses typed background launch disposition, real job lifecycle, and completion-message acknowledgement to keep one ACP turn open until the resulting root reply drains. It does not use idle grace timers or model polling. Same real unmodified T3/Bruv binaries now retain both the corrected follow-up and automatic completion reply after a local shell job. UI Steer works as interrupt/restart; browser reload retains the result. 173 adapter tests, typecheck/build and a clean repeated browser run passed.

The adapter also filters injected T3 controls before engine launch; names-only checks on real engine/shell processes found none. Stop is explicitly foreground-only; the managed shell survived. Post-Stop automatic output has no active T3 run and is not guaranteed visible. MCP tool use, saved questions, remote/native jobs, backend recovery and full child graph are not solved. Early text can be withheld until drain; answer fragments merge. This is a prototype, not finished CLI-like UI.

Patch/proof: [pi-acp-only-lifecycle](pi-acp-only-lifecycle.md). Parent preserved commit 55f65b9a as 6cbe1378; it adds only research patch/scripts/evidence. Worker worktree /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_0c77b9c0 and branch bruv/prove-pi-acp-only-lifecycle-change-with--0c77b9c0 remain. No production module was changed by that commit.

## Existing no-T3-change alternative

T3's native Pi provider already supports atomic prompt streamingBehavior:steer. Real UI/compiled-Bruv proof passed through that path: correction arrived while a 14-second execute was active; execute wrote its completion file; corrected answer appeared; no abort/restart and only one agent_start. Subsequent normal user input also worked.

But literal binaryPath=bruv fails version health: Bruv reports its product version 0.15.28, and T3 treats it as Pi's engine version, rejecting below 0.80.5. The research shim falsified --version to 1.0.0 solely to test the runtime path. Do not ship that shim or call direct configuration supported. A real compatibility entrypoint must report its contract/version honestly, keep product identity clear, and avoid T3's Pi maintenance action updating the wrong product.

Native T3 injection also selects existing Bruv-native behavior which expects patched bruv_task_* / bruv_local_job_notify APIs absent in official T3. Saved questions are disabled in that native mode. Steering success does not fix this. A deliberate Bruv-owned external-Pi mode/connector needs correct lifecycle, MCP and question ownership, not just a version workaround.

Details: [native-pi-steering-alternative](native-pi-steering-alternative.md). Parent inspected sanitized UI text and wire summary. No child-shell credential or background-task acceptance is claimed for this native trial.

## Options to discuss, not silently implement

1. **No T3 changes + exact steering:** use its existing native Pi interface for T3 through an intentionally designed connector on our side; keep ACP for other clients. The steering mechanism is proved, but background/permission/question/identity integration still needs work. This is not ACP-only architecture.
2. **ACP-only + exact steering:** requires T3 to expose a real supported steering contract/capability instead of ambiguous cancellation. Prefer an upstream contribution to another long-lived bundled patch. Changing only our adapter cannot create the missing signal.
3. **No T3 changes + ACP-only:** accept interrupt/restart rather than full CLI steering. The bounded prototype proves a useful path, but the user's latest requirement cannot be weakened without discussion.

Recommendation: do not remove the bundle or claim the requirements met yet. If avoiding any T3 fork is more important than using ACP for that specific frontend, investigate option 1 next. If the connection must remain ACP, discuss a narrow upstream steering capability or explicitly accept option 3. No migration/release is approved by these probes.

## Work complete / limits

All three tasks completed, owned processes cleaned, and no product/T3 source or release changed. Notes distinguish source review, fixture transport, real compiled engine, rendered UI and failed direct setup. Format/syntax/link checks apply only to retained research files; they do not promote the prototype to product acceptance.

Wisdom updated with these findings and reproducible proof. Values unchanged: existing one-owner, actual-path proof, honest UI and safe-recovery guidance applies. The new information belongs to this connector decision, not another general value.
