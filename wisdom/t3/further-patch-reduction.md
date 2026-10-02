# Focused reduction after upstream-first adoption

Base: Bruv d195d78b8d708dc6ff53e11b009895c3ca289ebf.
Upstream remains 66a91077f9abf6e171aad0ceab2519d7272f3ff3
on t3code/codex-turn-mapping; no repin.

## Workspace and ownership

- Bruv: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_09a4f35b
- Fresh upstream source: /home/tnfssc/.bruv/worktrees/t3-reduction-09a4f35b
  (detached exact pin, canonical patch applied; durable shared-object clone).
- Prior t3-upstream-first-4eb8a4a8 source/proof was not edited.
- Read-only provider audit: bruv-5442693331ce-task_09a4f35b-5442693331ce-task_e2452a74,
  branch bruv/find-safe-provider-seam-reductions-e2452a74.
- Read-only web/terminal audit: bruv-5442693331ce-task_09a4f35b-5442693331ce-task_5763c967,
  branch bruv/audit-web-and-terminal-duplication-5763c967.
  Both are beneath /home/tnfssc/.bruv/worktrees/.

## Actual reduction, not an architectural rewrite

Canonical patch regenerated from actual source using the maintained
integrations/t3/build/regenerate-patch.ts. No test was removed or weakened.

| Category | Before files | After files | Before + / - | After + / - |
| --- | ---: | ---: | ---: | ---: |
| Production TS/TSX/MJS | 44 | 43 | 2398 / 227 | 2335 / 193 |
| Tests (.test.) | 28 | 28 | 3578 / 33 | 3578 / 33 |
| Packaging/config | 2 | 2 | 120 / 8 | 120 / 8 |
| Total | 74 | 73 | 6096 / 268 | 6033 / 234 |

365,318 -> 356,496 bytes: 8,822 bytes (2.4%) smaller. Production patch
additions fell by 63 lines, but actual production source shrank by only 29
lines. The rest is restoring upstream code/formatting. This is a modest
cleanup, not another major reduction. Tests still account for 3,578 added lines.
The separate clean-build fix below adds two root build lines, not patch lines.

Removed:
- ProviderSessionManager: unused release tombstone Map/WeakSet and unused
  prepared-credential retention metadata. No consumers existed. Official
  releaseEntry already owns the live map, subscriber termination, scope closure,
  release persistence and credential cleanup. Removing dead declarations does
  not claim that upstream provides the stronger tombstone behavior their old
  comment implied.
- PiDriver: duplicate enabled computation; use effectiveConfig.enabled, already
  calculated by applyBruvWebPiSettings. Keep the independent adapter override:
  adapter construction uses injected HostProcessEnvironment, and has independent
  callers; driver construction uses process.env.
- session-logic: unused preserveLifecycleCard field and assignment. No renderer
  consumed it. Official projection/timeline code remains the owner. Audit probes
  found identical rows for running/completed/failed, working/settled inputs.
  **Gap:** successful settled work can be a turn-fold with or without this field;
  this is not proof of an always-visible shell-card requirement.
- ws: restore official optional-project lookup and tagged-error failure helpers,
  plus incidental formatting. Keep cancellation routing and both bounded
  terminal subscriber streams.

Retained for concrete non-equivalence at this pin:
- BruvTaskService uses official delegateTask, projections and ThreadLaunchService;
  remaining profile/depth authority, immutable base capture, same-key restart,
  non-consuming launch/list, scoped result observation and ancestor-first subtree
  cancellation are not replaced by those APIs.
- Stable task/command/message identity cannot return to credential-session keys:
  those rotate on process restart. Cancel/dispose fences and lineage checks prevent
  late events or descendants reviving cancelled work.
- Local-job ownership checks and message.dispatch delivery remain; upstream normal
  notifications alone do not authenticate Bruv shell nodes or reject late wakes
  from cancelled owners.
- Pi mode descriptors, exact embedded executable identity/version exception,
  update suppression, shell-event projection and pending-work/interrupt hooks
  remain Bruv-specific. Credential authority checks were untouched.
- Official ReusableDevAuth requires a development URL/token. It does not replace
  credential-free loopback auth with exact-origin/DNS-rebinding checks.
- Official NodePtyAdapter still uses node-pty, not Bun native terminals.
  OutputProtocol bounds transmitted unacknowledged chunks, not the callback queue
  behind a stalled subscriber; event/byte bounds remain necessary.
- Draft/model intent, destroyed-editor guard, browser-only auth import, finite
  stored-cost fields and all valuable tests remain. Schema.Number accepts
  nonfinite values; it cannot replace Schema.Finite.

## Clean checkout build defect found

The original filtered frozen install selected t3..., @t3tools/web... and the root,
but omitted @t3tools/scripts.... A truly fresh checkout failed server typecheck:
apps/server/tsconfig.json includes ../../scripts/lib, whose Effect, shared,
typescript-legacy and other imports need that workspace's declared dependencies.
The prior populated checkout could mask this. Add the existing official scripts
workspace dependency closure to the filtered install. No manifests, lockfile,
compiler settings, assertions or gates were loosened. Scripts are build inputs,
not a new shipped runtime seam. The first failure is kept in build.log.

## Evidence

Evidence is under the Bruv worktree's .cache/reduction-proof/.
- Fresh guarded build passed: frozen install, server/browser typechecks, bundles,
  emitted chunk-cycle gate, deploy, portable assets, archive receipt, compiled
  executable. build-final.log. No previous binary/archive/receipt was reused.
- Provider/session lifetime and identity: 97 pass across 4 files
  (providers-final.log), after manager/driver deletions.
- Websocket, subscriber/output protocol and actual timeline helpers: 194 pass
  across 5 files (websocket-timeline-final.log), after final source edits.
- Native task/policy/delivery/contracts: 30 pass across 5 files (tasks.log).
  This ran before the provider/UI cleanup; those task source files were unchanged.
- Source export/verification regressions: 2 pass (source-guards.log); the unrelated
  prepared-build invalidation test was not selected while retaining the build receipt.
  Migration provenance regression tests: 4 pass (migration-guards.log).
- Compiled native acceptance passed, bound to the binary hash below:
  native/proof.json. Real Bruv/Pi + scoped HTTP MCP + deterministic loopback model;
  live observe, nested child, one completion, parent handoff, subtree cancellation,
  unaffected sibling, unique credentials, same-key restart with zero duplicate
  children, zero foreground ACKs, all four provider processes reaped.
- Compiled browser cold navigation and reload passed: browser-boot.json and PNG.
  Screenshot inspected: app visible, Bruv model/mode controls and correct no-model
  hint, no Pi-update advisory. Zero browser errors. Playwright 1.60.0 was reused
  read-only from prior installed dependencies; Chromium's installed 1228 executable
  was selected explicitly after its default 1223 path was absent. This changes no
  assertion. Short private TMPDIR: /home/tnfssc/.bruv/t3-probe-09a4.
- Final source regeneration verifies exact HEAD + canonical patch. Root typecheck,
  changed root file formatting and git diff --check pass.

SHA-256:
- Patch: 1b44fb0d2a139b73c12721450c2f51d6215392a60e5bb7e68cdd6d3c1f9383a4
- dist/bruv: bc5d11ae5592e0e944103a2810df631a157410ddb6c6bec564481cc81f7a163b
- Web archive: 275e8581dcbe776812c325b34acc07dc4b4de52ac50e7ffaf25236b8bcfe9a0e

No full root suite or fresh full shipped-history migration rerun in this focused
pass. Prior migration proof is historical, not presented as this binary's proof.
No populated real-model shell-card browser replay was run; the removed marker had
no consumer, and the actual timeline-helper suites plus cold boot cover this edit.

## Limits and next options

No broader safe provider/task replacement was found at this exact pin. Further
substantial savings require upstream support for native scoped delegation and
local shell ownership, or an explicit product decision to drop features. Do not
silently remove those boundaries to meet a byte target. A future repin needs its
own comparison and proof; none is justified by this focused pass.

No push, release, install, or version bump. No paid model, real SSH owner,
hardware/audio or non-Linux runtime validation is claimed. Values unchanged:
existing ownership, honest proof, bounded state and upstream-first simplicity
values already cover these decisions.
