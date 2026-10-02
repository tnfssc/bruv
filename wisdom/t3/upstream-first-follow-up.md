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
