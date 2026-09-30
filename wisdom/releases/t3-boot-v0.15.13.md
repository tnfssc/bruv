# T3 browser startup fix: v0.15.13

Published https://github.com/tnfssc/die/releases/tag/v0.15.13 on 2026-09-30.
Stable, non-draft, all 12 expected assets present. SOURCE.txt matches tag commit
`92efde9f0cdc1d1fdf34382dabe803f7257fa66f`.
Dry run 36703153676 passed. Publication run 36704291531 reused those exact
assets and passed browser and Mac updater gates again. No local install.
No redundant published binary download; only SOURCE.txt was read after release.

## Cause and fix

Artificial vendor/size chunk splitting made a cyclic initialization graph.
The real v0.15.12 Linux release served HTML but Chromium showed
`T3 Code could not load.` and an Effect initialization TypeError.
Removed unsafe chunk overrides; kept lazy imports and codec/data assets.
A real large-chunk warning remains. Startup matters more than hiding warnings.
See [root cause and proof](../t3/v01512-browser-startup.md).

Fresh and reused builds now reject cyclic or incomplete emitted static graphs.
Publication requires Chromium cold boot and reload of the final Linux binary.
See [browser gate](linux-release-browser-boot-gate.md). Canceled trace exports
are logged but not treated as missing assets; all other request errors fail.

## Proof

- Full local build from new canonical source checkout passed frozen install,
  upstream typechecks, web/backend bundle, deploy, archive and compile.
- Local suite: **1367 pass, 20 skip, 0 fail** across 196 files.
- Root typecheck and format pass. Lint has warnings/info, no errors.
- Fresh root binary 0.15.13 passed real browser cold load and reload with no
  page/console errors. Proof: `artifacts/release/browser-boot-root-v01513.json`.
- Root binary SHA256: 90a5a50a7291b1c55cf3a1f1434209f742046ba041ceeedfc1dfc3d480f55a10.
  This is local proof, not the hosted release hash.
- Hosted gates cover final Linux browser boot/reload, Mac helper/updater,
  portable binaries, licenses, deterministic tests and package checks.

## Pickup and limits

Fix worker: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_5adb044a`,
branch `die/fix-released-t3-startup-failure-5adb044a`, commit 25688b3.
Gate worker: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_6a1d394b`,
branch `die/gate-release-on-browser-boot-6a1d394b`, commit 86f59ce.
Parent integrated both and fixed worker.format literal typing, gate formatting,
and workflow test assertions. No unfinished product work remains for this fix.

Root clean source: `.cache/die-t3-v01513-clean`. The default source cache
still has the old patch; use the clean source via DIE_T3_SOURCE rather than
resetting someone else's cache. A repo-local corepack shim in
`.cache/release-tool-bin` supplies pnpm. Reused worker dependency symlinks
had missing license files; fresh install fixed that local build setup issue.
Local logs: `/var/tmp/die-t3-clean-build.log` and
`/var/tmp/die-t3-full-tests2.log`. Earlier failed dry runs were superseded;
only the successful exact-commit runs above are release proof.

Wisdom records the root cause, gate and release. Value 1 was strengthened:
build-size/file checks do not prove startup; run the shipped entry point.
No new value. No paid provider calls or real Mac device tests were claimed.
