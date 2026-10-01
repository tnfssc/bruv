# bruv packaging rename — 2026-10-01

## Ownership and provenance

Worktree: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_74b29f92-a86675007a5e-task_4d865d74`.
Branch: `die/rename-packaging-releases-to-bruv-4d865d74`.
Read `wisdom/values.md`, single-binary packaging, native Live promotion,
packaged-probe final-fix, Linux release browser gate wisdom, and integration README.
Only scripts, workflows, native identity, root packaging configuration,
package/lock metadata, current support explainer, and this note changed.
No source/tests/integrations edits, dependency upgrades, release, push, installed
application change, or user configuration edit. Installer tests use private fixtures.

## Contract

- Package/bin: `bruv` / `dist/bruv`; web payload: `dist/bruv-web`,
  `bruv-web.archive.gz`, and its matching manifest.
- Release assets: `bruv-{linux-x64,linux-arm64,darwin-arm64,android-arm64}`
  and matching SHA256 filenames. Legal/source bundles retain their generic names.
- App/tooling environment is `BRUV_*`, including `T3_V2_BRUV_BINARY`;
  agent/private fixture storage uses `.bruv`. Native identity is
  `dev.bruv.live-audio` / PulseAudio client `bruv-live`.
- Installer still stages, probes, and atomically replaces only the executable.
  Generic native helper names, upstream/provider identifiers, legal text, and
  actual GitHub slugs remain unchanged. `tnfssc/die` still hosts releases.
- `scripts/verify-update.ts` replaces the exact-v0.7.1 release gate.
  It compiles current bruv updater source with fixture version 0.0.0, serves
  staged bruv assets from an injected fake fetch, proves corrupt-checksum
  preservation, verifies replacement bytes, then executes replacement --version.
  An unmodified v0.7.1 updater expects die asset names and is deliberately not
  a bruv-only release compatibility contract. Linux/Mac release jobs retain gates.
- Pi host adaptations emit bruv metadata/markers. Recomputed adapted hashes:
  main.js `bb1f03e5be8a21f5cd28450325628562e37e9f8c596486c2ee7a6c32b2392dde`;
  cli/args.js `0ce67721550898f24242282d13728c1a1f0db78926929d05425c2312addc7a08`.
  Original package hashes and version pins remain untouched.

## Checks and their limits

- Unmodified repository tests: publish-release + release-browser-setup,
  **9 pass, 0 fail, 29 assertions**.
- Private new-contract mirror of installer, smoke, packed-web, publish-release,
  release-workflows, manual-release, and release-browser-setup tests:
  **72 pass, 0 fail, 557 assertions**. Only copied fixtures were renamed;
  repo tests remained untouched. Includes private installer rollback/Mac-helper
  cases and archive embedding into a real minimal compiled executable.
  Log during this task: `/tmp/bruv-packaging-fixture-0zXa3a/checks-complete.log`.
- Current updater gate passed against a private compiled --version fixture,
  using a renamed copy of the pending source updater. Proves gate mechanics,
  not boot of the final combined application. Log: same fixture directory,
  `updater-check.log`.
- Two changed Pi adaptations: pristine source hash, exact adapted hash,
  idempotence, and drift rejection passed using read-only existing dependencies.
- Dependency declarations unchanged; bun.lock differs only in root package name.
- Bash syntax: 10 scripts; Python AST syntax: 6 scripts; TypeScript transpilation:
  45 scripts; native C++ `clang++ -std=c++17 -fsyntax-only` with pkg-config
  headers; native plist identity; workflow YAML parse: all passed.
- Focused Biome format: 34 files passed after formatting three length changes.
  `git diff --check` passed. actionlint was not available; YAML parse is not
  a hosted-workflow execution proof.
- Initial unchanged manual-release test failed on the intentional old gate/name
  expectation (13 pass / 1 fail across that initial three-file run).
  The new-contract mirror subsequently passed. Parent must integrate test edits.
- No complete app build/typecheck, browser boot, cross-platform application
  startup, Docker/SSH acceptance, paid provider, or real audio/device test ran.

## Integration follow-up

Parent's source/T3/test owners must supply `updateBruv`, renamed runtime env
and storage contracts, `integrations/t3/upstream/bruv.patch`, bruv output/cache
paths, `BruvTaskService.test.ts`, and `NativeBruvIntegration.production.test.ts`.
The root .gitattributes follows the renamed canonical patch. Remote Docker
fixtures must install `/usr/local/bin/bruv` and the matching runtime tree.
Rerun the actual updater gate against the final Linux/Mac raw assets and run
packaged CLI/browser smoke after integration. Builds need clean pinned Pi
package inputs: an already die-adapted node_modules tree intentionally fails
new adaptation guards; no legacy adapted-file acceptance was added.

## Intentional residuals

Historical support release notes (38 files), historical archive references in
scripts/leak-audit/README.md, preserved `tnfssc/die` URLs, and the real
`tnfssc/die-dependency-pr-fixture-20260930` repository slug remain.
The verifier comment explains legacy die assets. BODIES/English bodies and
opaque upstream integrity strings are not product references. CI's v0.7.1 tag
fetch remains for the existing historical compatibility regression tests;
those tests are test-owner scope, not the current release gate.
Shell `die()` error helpers/calls are not product names and must stay unchanged
where they occur (none were present in these owned active shell files).

Values unchanged: existing built-thing proof, truthful limits, clear ownership,
and coherent handoff lessons cover this rename; no new general rule needed.
