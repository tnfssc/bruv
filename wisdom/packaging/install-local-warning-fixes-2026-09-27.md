# Installer source fixes and residual diagnostics (2026-09-27)

Implemented, not audit-only. **Not an entirely diagnostic-free transcript:** two
Rolldown plugin-timing advisories remain visible. No push, tag, publish, version
bump, or change to v0.15.5 run 36302402467.

## Pick up here

- Branch: `die/fix-audited-installer-warnings-at-source-a478759f`.
- Worktree: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_a478759f`.
- Authoritative tested upstream checkout: `.cache/t3-final-installer-v3` in that worktree.
- Source pin unchanged: `b488c57f3f9f1688e31c53daee99e29dd1d0baa2`.
- Canonical source input: `integrations/t3/upstream/die.patch`; SHA256
  `b7b28c1c67ffdb64dbfa1c707509681883130a10a30e77e35f3ac2efebffcdb8`.
- Archive: `dist/die-web.archive.gz`, SHA256
  `5af75225d3c652c9e589f64c433297f926f0faae0bff4bcabc7c19c4d6d2a226`.

Independent review patches were folded into the canonical patch and removed.
Reproduce with a fresh pinned checkout and the canonical patch, not the historical
incremental-patch instructions in worker notes. Build's exact-source verifier is
unchanged. Regenerating the patch requires `git diff HEAD --binary` after recording
new paths: `git add -N` can stage deletions, so plain `git diff` loses them. A
source-verification regression now covers resurrected deleted files. Existing
old/modified cached checkouts are deliberately rejected; use a fresh DIE_T3_SOURCE
rather than resetting user edits.

## Changes and compatibility decisions

- Modern injected-workspace pnpm deploy, with the original portable native-asset
  checks and local package self-reference. Scope install to shipped server/web,
  shared packages and typecheck scripts. Desktop/mobile/infra-only dependencies
  and Electron Clerk auth are excluded; browser auth is preserved. This source
  patch intentionally does **not** build upstream desktop/mobile. No broad upgrade.
- All 387 audited server suggestions and 23 additionally found web suggestions
  resolved. Build now typechecks **both** apps before bundling. Reviewed finite
  wire/domain schemas; the invalid logger configuration error alone retains the
  complete Number domain through the compiler's documented line-local exemption.
  SQLite infinity query results are explicit JSON strings, not silently null.
  Web error fields were checked at producers: constants, string lengths, clock
  differences and HTTP status are finite; generic error-field exemptions were
  rejected. See numeric-contract notes and real exported-schema tests.
- Preserve Effect cancellation/error ownership. Per-turn imperative admission
  cancellation remains distinct from scoped subscription cancellation.
- Lazy sidebar/composer/timeline boundaries and bounded vendor chunks. Replace
  inline HEIC JavaScript codec with libheif-js 1.23.2 + separate WASM worker;
  release image handles/context on completion/error. Shiki grammar JSON and native
  Oniguruma WASM remain lazy data assets, including in the ES-module Pierre worker.
  A single build-only filesystem import has a local Effect diagnostic annotation:
  Vite reads compiler inputs before an application Effect runtime exists.
- Original 500 kB JS threshold unchanged. Final main **197372 B**, chat
  **306973 B**, largest JS **464661 B**;
  **zero JS assets over 500000 B**. Non-JS payloads remain real measured assets:
  HEIC WASM 1422377 B, Oniguruma WASM 466610 B, cpp JSON 381729 B,
  emacs-lisp JSON 778700 B. No stderr filtering or blanket diagnostic suppression.

## Acceptance evidence

Full `scripts/install-local.sh` exited 0 from the pristine v3 checkout, real frozen
install, backend + web typechecks, web production build, backend bundle, native
modern deploy, archive and executable compilation. No skip/reuse flag. Disposable
`DIE_INSTALL_DIR=artifacts/staged-install-bin-v3`, `HOME=artifacts/staged-install-home-v3`,
`TMPDIR=artifacts/test-tmp`; no user executable/storage overwritten. Both streams:
`artifacts/install-local-final-v3.log`. Tools: Bun 1.4.2, Node 24.15.0, pinned pnpm 11.10.0.

Passed:
- Root check, format check, standalone smoke; full die suite **1216 passed, 17 opt-in skipped, 0 failed**.
- Combined affected backend: **2801 passed, 1 skipped / 134 files**.
- Final shipped-native/backend CI selection: **260 passed / 16 files**.
- Affected web: **609 passed / 18 files**, plus focused highlighting/chat/codec **317 passed / 7 files**.
- Contracts **26 passed**, client projection **9 passed**. Final pnpm peers check: no issues.
- **7 production asset/browser checks**, including transitive startup/lazy graph,
  every JS chunk under threshold, real concurrent 1440x960 HEIC -> JPEG,
  corrupt-input rejection/recovery, and actual WASM-worker C++/Elisp token coloring.
- Staged executable ran HTTP backend with no Node/Bun on PATH, initialized SQLite,
  extracted embedded archive, and served HTML plus WASM/JSON assets with correct MIME.
  See `artifacts/probe-packaged-runtime.ts` and `final-native-runtime-v3.log`.

Evidence files in `artifacts/`: `final-die-tests-v3.log`, `combined-server-tests.log`,
`final-native-backend-tests.log`, `final-all-affected-web-tests.log`,
`final-browser-assets-v3.log`, `final-contract-tests.log`, `final-projection-tests.log`,
`final-peers-v3.log`, `final-diagnostics-inventory.json`.
Browser test uses optional Playwright at `artifacts/browser-probe/node_modules/playwright/index.mjs`
and cached Chromium; sample `artifacts/sample.heic` SHA256
`c02a2d70040fa05840231c29f183ce51d045bea027839e3d2ca4a6e968371541`.
The sample is a local probe, not redistributed source. Any known HEIC fixture can
be supplied through T3_HEIC_SAMPLE to the checked-in browser harness.

## Every remaining diagnostic / limits

Final installer inventory contains exactly **two PLUGIN_TIMINGS advisories**:
35% of 10.9s in hooks (3.8s), and 94% of 38.6s (36.3s). Rolldown explicitly counts
awaited callback work, including nested worker build; Babel React Compiler is the
main cost. This reports real build cost, not invalid output. Removing React Compiler
or moving work outside the measured hooks just to silence it changes optimization
or hides cost. A native equivalent/measured compiler optimization is the alternative;
we kept both compiler and timing diagnostics. **Do not claim zero build diagnostics.**
The pinned-pnpm newer-version notice and Vite+ command-routing notes are informational;
no major toolchain bump solely to remove a notice.

No remaining installer Effect, deprecated-package, peer-conflict, legacy-deploy or
large-JS-chunk warning. Separate repository lint exits 0 with **397 warnings and
537 infos** (not installer diagnostics); complete inventory `final-lint-all.log`.
Test-only Node v8.queryObjects experimental notice is in the backend log. The
no-TTY/native runtime probe emits shell job-control notices, not startup failure.

Host fish startup emits mise's untrusted-worktree-config error outside captured
installer subprocesses. We did not alter global trust, shell config or SSH keys.
The audit's host Git HTTPS->SSH rewrite/unreadable-key issue is likewise not a
source fix; source was fetched using command-local HTTPS configuration, then clean
cloned locally. Full tests use SHELL=/bin/sh to avoid host startup text corrupting
expected shell output, not output filtering. One earlier suite failed solely from
/tmp tmpfs exhaustion; the owned 5.8 GB worker checkout was moved into its lasting
worktree and final tests use disk-backed TMPDIR. Earlier failed logs are retained.

Linux x64 + Chromium only. macOS helper/native execution and real provider/paid
live tests are unverified here; parent owns platform CI and the next release.
Values unchanged: existing semantic-preservation, honest-evidence, safe-user-data,
and finish-the-whole-path principles cover the work.
