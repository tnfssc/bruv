# v0.15.12: packaged browser startup failure (2026-09-30)

## Ownership / pickup

- Branch: die/fix-released-t3-startup-failure-5adb044a.
- Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_5adb044a.
- Candidate source: .cache/t3-startup, pinned HEAD b488c57f3f9f1688e31c53daee99e29dd1d0baa2 plus canonical patch, checked with verifyWebSource and reverse-apply check.
- Evidence: /var/tmp/die-v01512-investigation (download, private HOME/cache, build/browser logs). No live user state used.
- No version change, tag, push, or publication. v0.15.12 remains unchanged.

## Actual release and cause

Downloaded GitHub v0.15.12 Linux x64 asset and verified its published checksum:
6a26c1a789d6fdf37f49e78486cbd2988673575cb7f5ecd8cd9b3e23f9a2f2b5.
Release SOURCE.txt identifies commit f9428de7f69e4420adf6222ade5d46b9fd48cffc.
Extracted archive content ID: 9d69aecba74c04a4b28f10b057f1a605943f51961434f6b7e45e9c1455f7a167.
The backend starts, initializes SQLite, and serves HTML. Real Chromium says
**T3 Code could not load.**, with console **TypeError: c is not a function** at:

    effect~main~_chat.pull-requests~settings.appearance~settings.archived~settings.connections~~lzspwg26-D_tXFpnz.js:1:1089

The emitted Array chunk calls imported Function.dual during top-level evaluation.
That dependency exports a var-bound implementation but statically imports back
into the consumer graph. Artificial Rolldown vendor/size groups split cyclic
initialization dependencies; the binding is still undefined. This is not missing
assets, archive extraction, provider/auth, or backend startup failure.

A single-Effect-chunk experiment passed an Effect import probe but the browser
then failed on undefined schema .ast in contracts. Removing byte splits while
keeping vendor groups then failed on an undefined base class in number-field.
Both experiments were discarded: fixing only the first error leaves the product
broken. The fix removes the whole artificial codeSplitting override and lets
the bundler preserve initialization order. Lazy sidebar/composer/timeline imports
and native WASM/JSON codec assets stay.

## Fix and regression proof

- Production client build from the exact patched checkout and upstream browser
  tsc --noEmit pass. Existing prepared installer dependencies were reused; this
  was not a fresh dependency-install acceptance run.
- chunks-startup.test.mjs parses emitted static imports using the existing
  es-module-lexer 3 API and rejects cyclic/incomplete chunk graphs. Dynamic back
  references remain allowed. It fails on the downloaded release's actual Effect
  cycle and passes on fixed output. Three root fixtures exercise cycles, a valid
  static DAG plus lazy back references, empty output, and missing dependencies.
- Both normal web builds and scripts/build.ts --reuse-web run the gate before
  packaging. The real reused candidate build exercised this hook successfully.
- All **six** production chunk/codec/lazy-boundary checks pass. Removed the old
  blanket all-JS-under-500-kB assertion, not the warning threshold: it drove the
  unsafe grouping. A genuine 856,140-byte shared utils chunk now triggers the
  unchanged warning; plugin timing advisories remain. No warning-free claim.
- Focused root web suites: **27 passed, 0 failed** (five files). Root bun run check
  and exact canonical-source verification pass. Full repository and macOS/Android
  suites were not run.
- Candidate dist/die-startup-final SHA256:
  7291a939ca4db0335123a3b48a0d6864ed93a389d0ca9f95a96d6381f87fb78c.
  Embedded archive: 7192d21b509b7551559b1a79474d0f0ef90b05feb2f4166ca97d6b011b21af97.
  This candidate recomposes the **unchanged downloaded release backend** with the
  newly built fixed client, then packs/compiles through maintained --reuse-web.
  It is not a fresh full deploy/native-helper release build: it isolates the
  client packaging fix without claiming those gates.
- Candidate launches with private HOME/cache and PATH=/nonexistent using its own
  interpreter. Maintained browser regression loads that actual embedded package:
  two cold contexts, each followed by reload, render the workspace prompt with
  zero page/console errors. The same test fails on v0.15.12 with captured dual
  error. No model call/credential needed. Chromium loopback local-network policy
  is explicitly disabled for this isolated fixture.

Reproduce graph check:

    T3_WEB_DIST=<dist/client> node --test integrations/t3/upstream/chunks-startup.test.mjs

Browser command / explicit isolated-loopback opt-in: integrations/t3/gates/README.md.
Evidence logs: release-graph.log, release-browser-final.log, fixed-browser-final.log,
final-root-web-tests.log, fixed-build3.log, web-typecheck.log, reuse-gate.log.

Initial extraction hit a full /tmp tmpfs; moved owned evidence/runtime to /var/tmp
and repeated successfully. A first launcher-suite attempt lacked dist/die; a
second used a symlink and failed the executable-path assertion. Passing run uses
DIE_WEB_BINARY at the actual candidate. First browser harness selector wrongly
required a hidden sidebar toggle; corrected it to the rendered workspace prompt.
These were test setup failures, not the diagnosed release error.

## Lesson / prior wisdom

[Installer warning fixes](../packaging/install-local-warning-fixes-2026-09-27.md)
and [syntax asset checks](../web/t3-large-chunk-assets.md) proved data codecs and
server/HTTP packaging, not mounting the whole browser entry. Asset inventories,
schema typechecks, and a working backend can pass while production initialization
fails. Prefer honest size diagnostics to semantic damage. Value 1 now explicitly
states that build-size/file checks do not prove startup, with this note linked;
no new value added.

## Parent full-build follow-up

After frozen pnpm install, the canonical full build caught TS2769 in Vite config:
worker.format widened to string after removing the chunk override. The parent
pinned that existing value with `"es" as const` in the canonical patch.
Earlier isolated browser typecheck proof does not cover this installed full-build
state. The full build then passed both upstream typechecks and entered bundling.
Final integrated build/release proof belongs in the v0.15.13 release note.
