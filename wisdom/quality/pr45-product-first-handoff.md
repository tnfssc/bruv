# PR45 product-first handoff

The user transferred PR45 to this owner after the old parent hit provider errors. At the user's explicit request we stopped the old parent, coordinator and remaining leaf. All three processes exited; the coordinator journal records killed/session-shutdown at 2026-10-08 10:43 UTC. Their worktrees and saved results remain intact. No reset or deletion was used.

Product code comes first. Tests support changed behavior. Unrelated test cleanup is deferred, not removed or called passing. The old test-only integrated objections in lanes25/55 remain recorded; no new whole-repo review cycle is needed.

## Integration

Accepted continuation a0d9ef19 is merged with develop22ad5f50 at1d8b7643. Published PR45 head118edf14 remains an ancestor. Rejected parentfc592efd was not merged. See [integration decisions and focused evidence](pr45-product-first-integration-2026-10-08.md).

Parent publication checkout: /home/tnfssc/.bruv/worktrees/pr45-product-publication-owner-20261008. Branch: bruv/pr45-product-publication-owner. The original finished worker checkout is not being edited.

Two bounded Sol tasks follow up, both on exact integration tip1d8b7643:
- task_818b4420: independent judgment of merge-changed product paths only. Checkout /home/tnfssc/.bruv/worktrees/t3-1dc1185b-5442693331ce-task_818b4420, branch bruv/pr45-targeted-product-judge.
- task_3cfa6fe3: guarded asset generation, final typecheck and product build. Checkout /home/tnfssc/.bruv/worktrees/t3-1dc1185b-5442693331ce-task_3cfa6fe3, branch bruv/pr45-product-build-verification.

The integration worker passed 13 focused tests with 663 Bun expectations. Its initial typecheck was blocked by eight missing generated runtime-assets imports. The first build worker retained a strict preparation failure: shared-cache agent-session.js had an older unsupported adapted hash. No hash guard was changed.

Parent resolved that local dependency provenance issue without code changes: install the frozen lockfile into this previously empty publication worktree using a fresh private cache and Bun's copy backend. Package lifecycle scripts were disabled during install; the inspected guarded asset preparation was then run explicitly. No shared cache/dependency bytes were edited.

Final evidence: /home/tnfssc/.bruv/agent/watchers/pr45-owned-product-build-eC19jY. Every phase has explicit argv/env, timestamps and stdout/stderr logs. All phases exited0: fresh install, unchanged guarded prepare-assets, direct TypeScript noEmit, paired build, compiled CLI --version (0.16.18), and --help. All child commands used retained owned HOME/config/SDK/cache/data/state/tmp and a cleared environment. These are product build/startup checks, not fullCI or interactive/provider/device proof. No more test-only cleanup was done. Targeted product judgment found one merge-specific pagination bug; the focused repair and its recheck are below.

## Delivery

Update existing PR45 after the targeted result and product validation. No force push, new PR, merge or release is authorized by this handoff. The user asked for a PR, not automatic merge/release. Keep CI and unrun platform/provider limits honest. No auth/device tests, raw secret access, sudo, destructive cleanup, or renewed data recovery.

Values unchanged. Existing ownership, product-first progress, and actual-code proof already cover this work.

## Focused product repair from the merge judge

The Sol judge rejected one real regression in HistoryService: keeping an auxiliary cursor leaf to prove branch membership also let that non-searchable entry consume the20,000-entry scan budget on later pages. The unchanged query/snapshot could then lose a candidate and skip a match. The other inspected merge paths had no concrete rejection.

The repair keeps auxiliary membership validation in the live active branch, but filters scan candidates before applying the scan window. Historical snapshot selection and live shake exclusions keep their prior authority. No extra state or cursor format was added.

Two regressions at20,000 and20,001 candidates reproduced missing matches before the fix. They pass after it. The complete focused history.test.ts file passes25tests/81expectations, including branch/snapshot/exclusion/permission/bounds behavior. Scoped formatting passed. All commands used the retained owned environment above; only fixture-owned temporary files were removed by the existing test hooks. No broader test cleanup or fullCI was run. Red/green evidence is in pagination-red/pagination-green/history-suite manifests and logs. Targeted independent recheck of this exact fix is pending.
