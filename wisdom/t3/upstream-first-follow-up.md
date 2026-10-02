# Further upstream reduction and Bruv-in-T3 proof

User asked whether Bruv really works inside adopted T3 and whether the patch can
be smaller. Prior migration is integrated locally through d195d78; no push/release.
Read upstream-first-migration.md for existing code decisions and proof.

## Ownership

Implementation: task_09a4f35b (orchestrator).
Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_09a4f35b
Branch: bruv/shrink-remaining-t3-patch-without-losing-09a4f35b
Base: d195d78b8d708dc6ff53e11b009895c3ca289ebf.
Read-only validation audit: task_3b380627, main workspace.
Parent integrates and checks combined result; no publish/install requested.

Keep old source checkout t3-upstream-first-4eb8a4a8 untouched as prior proof.
New code work needs a separate durable source checkout. Reduce actual ownership,
not just bytes by moving code elsewhere or deleting useful tests. Keep essential
authority, native tools/tasks/questions/remote, delivery and history safety.

## Baseline and gaps

Pin 66a91077f9abf6e171aad0ceab2519d7272f3ff3. Patch 365318 bytes, 74 files,
6096 added lines (5981 excluding lockfile). Prior compiled native acceptance
used real Bruv/Pi processes with deterministic loopback model; browser proof
covered cold boot/reload without provider credentials. That is not proof of
a complete browser prompt -> response/tool/task path. Audit should identify
and run the smallest decisive missing check, not another broad test matrix.
Live paid providers, real SSH owners and non-Linux execution remain untested.

Values unchanged: existing real-path proof and fewer-owned-parts guidance covers
this follow-up. Do not claim everything works from narrower evidence.

## Browser audit result

Read-only task_3b380627 used compiled binary 4ff0f163 with private loopback model
and browser. Verified Bruv model picker, model Audit Beta (audit-b) selection,
normal mode persistence, real shell tool execution, visible response, and settled
turn. Evidence/probe: /var/tmp/bruv-audit-dv8srI (fix worker will preserve it).

Two reproduced failures block an everything-good claim: (1) reload redirects
settled conversation route to empty bootstrap thread despite original thread and
settings still in SQLite; (2) ProviderRegistry displays Bruv 0.15.24 unsupported
>=1.0.0 by applying Pi compatibility policy to Bruv identity. Warning does not
block submission. The audit corrected an obsolete Send message selector to the
current Submit message; that selector issue is not a product defect.

Prior native proof restart means replayed parent execution/launch-key reuse, not
an actual compiled web-server process restart. Browser native child/Stop, expanded
tool output and actual web restart restoration need focused acceptance. Bruv saved
questions have no web projection; upstream Pi interactive requests are separate.
Named SSH placement from scoped native tasks is explicitly rejected. These known
scope limits must not be described as tested full parity.

Fix worker task_5e045d3c owns focused route/advisory fixes and browser proof.
Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_5e045d3c
Branch: bruv/fix-observed-bruv-in-t3-browser-acceptan-5e045d3c
Base: a99daabadc04ef8dd59a8eefdf3b46d11df9cc2f. Separate upstream checkout.
Reduction task_09a4f35b runs concurrently; parent must compose their actual source
diffs (especially provider identity) and regenerate/verify canonical patch.

## Further reduction integrated; browser fixes split

Reduction b8d80b9 integrated as b08d229. Patch 365318 -> 356496 bytes (2.4%),
74 -> 73 files. Production additions 2398 -> 2335; actual production source
shrinks only 29 lines. Tests unchanged at 3578 added lines. Removed unused state,
duplicate enabled computation and unused UI marker; retained authority/delivery.
See further-patch-reduction.md for focused/native/browser build proof and limits.

Task_5e045d3c was stopped after >25min without new tool output, and exit143 was
confirmed. It produced no committed fix. New narrow workers start from b08d229:
- Route/restart fix task_0dea6e78: worktree
  /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_0dea6e78, branch
  bruv/fix-exact-conversation-reload-and-restar-0dea6e78.
- Provider warning task_127f41c6: worktree
  /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_127f41c6, branch
  bruv/fix-embedded-bruv-provider-compatibility-127f41c6.
Both own separate upstream checkouts and must return focused source deltas. Parent
composes them and runs final compiled browser flow, including child/Stop if not
covered already. No success claim for browser reload until those checks pass.

## Provider advisory source fix awaiting composition

Task_127f41c6 returned two-file source change in durable checkout
/home/tnfssc/.bruv/worktrees/t3-provider-advisory-fix-127f41c6 (HEAD commit).
It exempts existing trusted embedded Bruv identity in applyProviderCompatibility
and adds a regular-Pi vs embedded-Bruv regression. No root commit/canonical
change was returned. Its test setup failed loading effect/Deferred; no red/green
claim. Parent must apply its exact two-file commit diff to the final route source,
run provider tests with that installed graph, regenerate canonical patch and
validate combined compiled browser prompt/reload/restart and no warning.

## Focused route reload fix (task_0dea6e78)

Supersedes stopped task_5e045d3c for route reload only; provider advisory is owned
separately. Root worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_0dea6e78.
Durable upstream source: /home/tnfssc/.bruv/worktrees/t3-route-0dea6e78, detached at
66a91077f9abf6e171aad0ceab2519d7272f3ff3. Started with b08d229's reduced patch;
t3-reduction-09a4f35b was not edited. Baseline source tree object (including added
files): f62207d2e97b6ac97a8f755e15fb10049f04da82. Source stays uncommitted at the
pin so maintained regenerate-patch.ts can verify/export it.

Reduced compiled baseline reproduced in /var/tmp/bruv-route-baseline-ms8H6Y.
Instrumented compiled browser reproduction: /var/tmp/bruv-route-diagnostic-jdMFDO.
The missing-thread redirect ran with shell status `synchronizing`: snapshot sequence 3 held only the old empty bootstrap thread,
not the settled conversation in SQLite. ThreadRouteView treated any Some
snapshot as bootstrapComplete, redirected to `/`, then EventRouter selected the
bootstrap thread. This is not server history loss.

Fix: route render-state resolver consumes the existing shell status. Only `live`
can resolve a missing/deleted server thread and trigger navigation. Existing
cached threads still render during loading. No timers, cache persistence changes,
backend changes, or provider policy changes. Regression adds the observed cached
and synchronizing states (plus empty/uninitialized) to existing route tests.

Upstream source-only delta against b08d229 reduced baseline:
`wisdom/t3/route-reload-source.delta.patch` (three web source/test files). Apply
this to a checkout with the reduced patch, combine the provider worker delta,
then regenerate the canonical patch from that actual combined source. Do not
apply our whole canonical patch on top of the separate provider fix.

Harness worker: task_3da5f93e, branch
`bruv/browser-reload-and-real-restart-probe-3da5f93e`, worktree
`/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_0dea6e78-5442693331ce-task_3da5f93e`.

Validation: all 14 threadRoutes tests passed; web tsc --noEmit passed; production
web build and chunk-startup verification passed. Canonical patch regenerated
with integrations/t3/build/regenerate-patch.ts (which verifies the actual tree).
Initial fast acceptance reused the unchanged reduced-baseline server payload.
Then built the complete runtime from the verified fixed source with maintained
`buildWeb({prepared:true})` (both server/web typechecks, web and server production
bundles, deploy and portable dependency verification), and compiled with
`scripts/build.ts --reuse-packed-web`. Full build log:
/var/tmp/bruv-route-full-build.log. Embedded SOURCE.txt records the exact pin and
canonical patch hash; no stale baseline metadata is shipped in the final binary.

Compiled browser acceptance passed: /tmp/bruv-route-probe-J92FlX/proof.json;
concise retained evidence and binary/patch hashes: route-reload-proof.json.
Actual web process 2415530 exited, TCP listener closed, then new process 2417265
served the same userdata on the same port. All three checkpoints (settled,
page-reload, process-restart-reload) retained exact conversation URL, one prompt,
one AUDIT_BROWSER_RESPONSE_TOOL_OK response, loopback/audit-b and normal mode.
Real shell PID 2416886 returned AUDIT_TOOL_OUTCOME and wrote the private fixture
file. Probe shutdown verified both processes/listeners gone; no paid/user data.
Provider advisory still exists intentionally. Native-child/Stop combined browser
acceptance belongs to parent; this probe makes no claim about it.

Recipe (Bun 1.4.2, Linux; only private fixture directories):

```sh
BRUV_ROUTE_PROBE_BINARY="$PWD/dist/bruv" \
BRUV_ROUTE_PROBE_PLAYWRIGHT=/absolute/path/to/playwright-core/index.mjs \
BRUV_ROUTE_PROBE_CHROMIUM=/absolute/path/to/chrome \
bun integrations/t3/upstream/browser-route-reload.probe.ts
```

Probe creates an isolated HOME, loopback model endpoint, browser session, Git
workspace and SQLite userdata; keeps artifacts at its printed temporary path.
Root branch: `bruv/fix-exact-conversation-reload-and-restar-0dea6e78`.
No release, push, global install or version change.

Source delta was applied to a temporary index of the reduced baseline and
reconstructed fixed source tree c3a76c727c98af51e95543832b82c068616e9f6e exactly.
Values unchanged: real compiled-path evidence and existing authoritative-history
principles cover this fix; no new general rule is needed.

Final fully rebuilt binary passed the committed probe again (all three
checkpoints): /var/tmp/bruv-route-full-acceptance.log. Restart screenshot reviewed:
conversation response, changed fixture file, Audit Beta and normal remain visible.
The unrelated unsupported-Bruv advisory remains visible as expected.
