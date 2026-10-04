# Focused custom-home fork revision

Published user branch: **tnfssc/t3code:fix/claude-provider-history-env**.
Final source: **c1310b2429625e704ef20a175e8b2847f58589ba**, based on upstream **eac52f0087d9ba5dee5542f24788d1482affae43**.
Diff: **2 files, +118/-7** (was 5 files, +302/-24). Production +52/-6; tests +66/-1.
[Prefilled PR body](PR_BODY.md) and [creation URL](PR_URL.txt); no PR created or upstream writes.

## What changed

Only the reproduced UI fork failure is fixed. The existing history worker receives the provider instance's environment via Effect ChildProcessSpawner, with extendEnv:false, scoped process ownership, concurrent bounded stdout/stderr collection and the existing typed error boundary. Reused collectUint8StreamText and the worker; no generic client, worker expansion or global process.env mutation. Dropped fallback child-link lookup: independent path, unnecessary for this bug/proof.

Original remote head **e9efb362e60e82da42a23e3b9daac72eb7ae0b89** is preserved locally as **backup/claude-provider-history-env-e9efb362e**. The remote still matched it immediately before the explicit force-with-lease. [Publish log](revision-publish.log).

## Exact-head verification

- Added real-SDK test transplanted onto unchanged eac52f0087: fails with **Session … not found** ([baseline log](revision-baseline.log)). Baseline production source remains unchanged; only the regression test was transplanted.
- Final **135 tests passed** across ClaudeAdapterV2.test.ts and ClaudeHome.test.ts. Server tsc --noEmit passed; targeted vp fmt --check and vp lint --report-unused-disable-directives passed. Existing unused-layer warning reproduced unchanged on baseline, not hidden. Repository rules explicitly call for focused checks, not repo-wide checks.
- Independent read-only reviewer checked **c1310b242**, ran 2 native-fork tests and found **no actionable findings**. [Full review](independent-review.md). Before finalizing, repository lint findings were resolved: NodeURL namespace and module-scope compiled decoder. No maintainer endorsement claimed.
- Fresh **vp build** in apps/web, then **node scripts/cli.ts build --verbose** in apps/server at this same head. Physical client copies, no build/asset symlinks. Source version remains **0.0.45**. Runtime native dependency/resource-monitor support was physically copied from the existing 2644 diagnostic support, not rebuilt or relabeled as source output; generated server/worker/web assets are fresh. This is a source-built diagnostic host, not official binary or SEA acceptance.
- Bruv pair freshly built from **a800e8f1bb9e1ae85516f135fb540ff5f4014ac5**, including shutdown fix **c64a27ad**; no Bruv product edits. Local frozen-lockfile install, prepare:assets, build-pair. Earlier attempts missing PATH Bun/dependencies were build setup failures, resolved before final pair build.

## Actual browser proof

[Result](final-head/result.json): **passed:true**, **acceptanceScope:history**. Full unrelated acceptance remains **false**, not claimed.
[Invocation](final-head/invocation.json): normal startup args=[], only HOME/PATH; provider binary and custom home configured only through Settings Providers UI. No preset provider env/config, credentials, tap, synthetic connector events or version spoof.

Strict original assertions passed for fork-at-checkpoint, actual model continuation context, rollback, page reload/reopen, exactly one root execute exchange, no inherited job/question authority, unchanged root question and ordinary Claude store, and temporary-state cleanup. [Model checks](final-head/model-checks.json), [pending root question](final-head/root-question-kept-pending.json), [cleanup](final-head/cleanup.json), [reopened screenshot](final-head/reopened.png). Reopen means page reload, not server restart. The unsupported connector version advisory remains visible and is outside this fix (parent task_5c3a7422 remains separate).

[Provenance](final-head/source-provenance.json) pins every staged asset and both compiled Bruv binaries. Stage/run checked the copied tree before and after, and preserved all original behavioral/authority assertions; no shared cache mutation. [UI log](revision-ui.log).

## Durable locations / rerun

- Source: /home/tnfssc/.bruv/upstream-preparation/t3-ui-history-2644; branch fix/claude-provider-history-env.
- Baseline: /home/tnfssc/.bruv/upstream-preparation/t3-history-baseline.
- Private pair: /home/tnfssc/.bruv/upstream-preparation/history-minimal-pair.
- Strict prepared harness commit **9a975292**, branch **bruv/prepare-strict-exact-head-ui-proof-8884d842**, worktree **/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_1cbcc09f-5442693331ce-task_8884d842**. Its experiments/t3/ui-only-history-minimal/README.md has exact stage/run commands. Retained there instead of duplicating ~9,500 harness lines into this handoff.
- Private staged host: that worktree's experiments/t3/ui-only-history-minimal/build-staging/c1310b242962-1791109410527. Primary agent ran its run.mjs; subagent only prepared harness.

Original strict proof and unchanged-host UI failure are in Bruv **14add8f4**. This revision's baseline regression and final-head browser pass were newly executed; not relabeled old proof. Current upstream merge-tree is conflict-free; public compare and absent PR/check results are saved alongside. No particular maintainer approval, full CI or release compatibility claimed.
