# Pi 1.0 dependency upgrade (2026-10-02)

## Ownership and inputs

Worktree: `/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_275c67be`.
Branch: `bruv/update-dependencies-for-pi-1.0-release-275c67be`.
Base: `843ab2f`, including first-paint fix `c4af41c`.
The worker owns dependency/code changes and this commit. Parent owns integration,
push, version selection, tag and release. bruv stays at 0.15.23. No push, publish,
release-version bump or replacement of the user's installed executable was done.

Root updates used the maintained `scripts/update-dependencies.ts`, not hand-edited
pins. It excludes `@types/bun` (still 1.4.2), checks Pi alignment and records the
whole lockfile delta. Root node_modules started absent; these are new Pi 1.0 files,
not another checkout's mutated 0.99.1 host. Upstream review used freshly downloaded
npm 0.99.1 and 1.0.0 coding-agent tarballs plus previous AI/TUI/server/agent-core
packages in `/tmp/bruv-pi-review-275c67be`. Local dependencies may be installed;
no product install script was run. Bun 1.4.2, Node 24.21.0 and cached pnpm 11.10.0
were selected using absolute executable directories, without global mise trust.

## Exact dependency delta

| Section | Package | Before | After |
| --- | --- | --- | --- |
| dependencies | @earendil-works/pi-ai | 0.99.1 | 1.0.0 |
| dependencies | @earendil-works/pi-coding-agent | 0.99.1 | 1.0.0 |
| dependencies | @earendil-works/pi-server | 0.99.1 | 1.0.0 |
| dependencies | @earendil-works/pi-tui | 0.99.1 | 1.0.0 |
| dependencies | @google/genai | 2.24.0 | 2.26.0 |
| devDependencies | @biomejs/biome | 2.5.14 | 2.5.15 |

## Lockfile packages (including transitives)

| Package key | Before | After |
| --- | --- | --- |
| @biomejs/biome | @biomejs/biome@2.5.14 | @biomejs/biome@2.5.15 |
| @biomejs/cli-darwin-arm64 | @biomejs/cli-darwin-arm64@2.5.14 | @biomejs/cli-darwin-arm64@2.5.15 |
| @biomejs/cli-darwin-x64 | @biomejs/cli-darwin-x64@2.5.14 | @biomejs/cli-darwin-x64@2.5.15 |
| @biomejs/cli-linux-arm64 | @biomejs/cli-linux-arm64@2.5.14 | @biomejs/cli-linux-arm64@2.5.15 |
| @biomejs/cli-linux-arm64-musl | @biomejs/cli-linux-arm64-musl@2.5.14 | @biomejs/cli-linux-arm64-musl@2.5.15 |
| @biomejs/cli-linux-x64 | @biomejs/cli-linux-x64@2.5.14 | @biomejs/cli-linux-x64@2.5.15 |
| @biomejs/cli-linux-x64-musl | @biomejs/cli-linux-x64-musl@2.5.14 | @biomejs/cli-linux-x64-musl@2.5.15 |
| @biomejs/cli-win32-arm64 | @biomejs/cli-win32-arm64@2.5.14 | @biomejs/cli-win32-arm64@2.5.15 |
| @biomejs/cli-win32-x64 | @biomejs/cli-win32-x64@2.5.14 | @biomejs/cli-win32-x64@2.5.15 |
| @earendil-works/chord | @earendil-works/chord@0.99.1 | @earendil-works/chord@1.0.0 |
| @earendil-works/pi-agent-core | @earendil-works/pi-agent-core@0.99.1 | @earendil-works/pi-agent-core@1.0.0 |
| @earendil-works/pi-ai | @earendil-works/pi-ai@0.99.1 | @earendil-works/pi-ai@1.0.0 |
| @earendil-works/pi-codemode | @earendil-works/pi-codemode@0.99.1 | @earendil-works/pi-codemode@1.0.0 |
| @earendil-works/pi-coding-agent | @earendil-works/pi-coding-agent@0.99.1 | @earendil-works/pi-coding-agent@1.0.0 |
| @earendil-works/pi-mcp | @earendil-works/pi-mcp@0.99.1 | @earendil-works/pi-mcp@1.0.0 |
| @earendil-works/pi-protocol | @earendil-works/pi-protocol@0.99.1 | @earendil-works/pi-protocol@1.0.0 |
| @earendil-works/pi-server | @earendil-works/pi-server@0.99.1 | @earendil-works/pi-server@1.0.0 |
| @earendil-works/pi-telemetry | @earendil-works/pi-telemetry@0.99.1 | @earendil-works/pi-telemetry@1.0.0 |
| @earendil-works/pi-tui | @earendil-works/pi-tui@0.99.1 | @earendil-works/pi-tui@1.0.0 |
| @google/genai | @google/genai@2.24.0 | @google/genai@2.26.0 |
| @types/node | @types/node@26.6.3 | @types/node@26.6.4 |


All ten resolved Earendil package keys move together to 1.0.0. No T3 source pin,
upstream patch, browser lockfile, provider credential or user setting changed.

## Reviewed changes and product preservation

Read Pi's 0.99.2 and 1.0.0 release notes and compared published runtime sources.
Pi 1.0 adds header-only quiet startup, fullscreen by default, stricter provider-only
CLI validation, Radius login/config suggestions, Anthropic headless sign-in and
workload identity, MCP OAuth hardening, codemode image generation and smaller
prompts. It also fixes transcript retention, theme chroma, whitespace slash
completion, custom/function tool ID replay, deferred tool restore and defaultTools
reload behavior. Built-in MCP/codemode/tool-search remain removed from bruv; llama,
bruv execute and user-authored extensions remain available. No inherited built-in
was restored, and no paid provider calls were needed for this review.

SessionManager's pristine file is byte-identical to 0.99.1. Its existing guarded
scan cleanup and bruv lazy-journal/publication/metadata adapter stay intact; native
SDK parity tests cover them. The built-in registry is also byte-identical. main.js
changes only to reject --provider without --model; args.js changes provider and TUI
help. Existing MCP-removal/host-marker anchors still match exactly. Their hashes
were revised only after review. The exact version, original/adapted SHA-256,
single-occurrence anchors, result hash, validate-all-before-write behavior and
runtime host gate still fail closed. The session hash is unchanged:
`046b6a1109ac3f0ed893bb85bf0648709362fa926a5da75761216cf2fcf9d926`.

Pi's new fullscreen default would change bruv's normal scrollback. A fifth exact
host patch keeps regular mode when unset and honors explicit saved/CLI fullscreen
selection, without writing settings. CLI help matches this default. Tests cover
unset, explicit regular/fullscreen, overrides, source/compiled help and the new
provider-only error. No fullscreen implementation or guard is bypassed.

InteractiveMode still starts rendering before its 100ms terminal-color wait and
session_start. Its editor/init wiring used by c4af41c did not change. The owned
startup adapter still replaces both default/active editors before native init,
retaining submit, exit, shortcuts and extension replacement. New quietStartup
header policy still honors bruv's true getter and explicit verbose diagnostics.
The real built CLI's plain-PTY whole-output regression passes: compact chevron from
first paint, no native horizontal border. See
[evidence](evidence/pi-1.0/startup-stream.txt), captured without a provider turn (ANSI and trailing whitespace normalized).
The native footer can still appear briefly; this fix concerns the editor only.

The full root suite found a concrete presentation incompatibility: Pi 1.0's
user-message memory fix removes its outer Box. bruv's density guard correctly
rejected the changed shape, breaking user-turn rendering. The adapter now requires
one direct Markdown child with its vertical padding, rather than accepting an
arbitrary box/child or disabling the guard. It sets/restores Markdown padding and
invalidates its cache, preserving the dense plain boundary rows, inner Markdown,
mouse coordinates and teardown ownership. Existing density assertions are kept,
and a new test explicitly rejects the old nested Box. Rendered conversation/task
and delegated spoken-user regressions are included in the final root gate.

Pi server context helpers moved from agent-core to chord/context, and SessionMetadata
is now local to pi-server. Wire/server routing behavior is otherwise unchanged in
the reviewed files. bruv does not import the removed agent-core node/harness/search
exports. Its current CLI drives the real native/task-server production integration
in the fresh patched T3 checkout; typechecks and behavioral tests validate the
client projection and terminal recovery too. OpenAI replay now drops IDs with the
wrong item prefix or different-model pairing; native checkpoint/fast/SDK coverage
retains its existing assertions.

Pi's npm LICENSE matches `third_party/pi/LICENSE` byte-for-byte. Curated fallback
notices require the explicit package allowlist at exact 1.0.0, with unknown/unpinned
rejection tests preserved. Notice generation finds 128 production packages.

## Validation

- Root prepare-assets and TypeScript checks pass against exact 1.0.0.
- Fresh full web build passes server/web typechecks, emitted chunk startup checks,
  portable optional-dependency verification and archive packing. After the density
  fix the maintained --reuse-web mode repacks this same newly built web graph and
  compiles the changed CLI; no old external archive is used. Packed-only reuse
  correctly rejects changed invocation inputs / absent manifest after repacking.
  No verification was disabled to get a build.
- Maintained ci-web-validation.sh passes: terminal-client typecheck; backend
  281/18 files (including current-CLI native production integration, task services,
  PTYs, continuation and usage); model 158; contracts 26; projection 9; web cache
  138; terminal recovery 38.
- Startup/editor/footer/history/host focused gate before density discovery:
  46 pass / 0 fail / 480 assertions, including source/compiled provider validation,
  host guards and whole-output Linux first-paint regression.
- Frozen lockfile install in a removed/rebuilt root node_modules passes; published
  1.0.0 coding-agent tarball is copied locally before prepare to ensure host input
  is truly pristine, not a mutated cache file. No shared host tree is reused.
- Notices: 128 production packages / 552380 bytes; license cmp passes. Bun blocks
  genai no-op preinstall and protobufjs postinstall by its normal policy; no script
  trust was added and runtime/typecheck tests run with that policy intact.
- Initial complete run: 1667 pass / 20 skip / 27 fail. These identified the real
  Markdown seam above plus missing pnpm in test PATH and mise diagnostic pollution
  in shell output. The subsequent run uses all three tool directories and a
  process-only MISE_TRUSTED_CONFIG_PATHS for this worktree, not global trust.

- Final clean deterministic root suite: **1695 pass, 20 skip, 0 fail**, 1715 tests
  across 230 files, 32889 assertions. Command: BRUV_RUN_LLM_TESTS=0 bun test
  --parallel=3 ./tests. Density/task-row/delegated-user rendered regressions,
  Linux plain-PTY first paint, guard/version/notices and native SDK tests pass.
- Final standalone smoke and loopback-only OpenAI default transport pass for both
  source and compiled CLI (full/mini session.updated and HTTP 401). No external
  provider API call. The final rebuilt CLI also passes the one-test native
  production integration again (1 file, current binary).
- Root typecheck, format and lint pass; lint retains 739 warnings and 1090 infos
  (exit 0). git diff --check passes. No assertions or guards were disabled.
- Clean final compiled CLI SHA-256:
  `9c737252c01c9e6b727d83ebe137b276a2c285f293605e8039817f677ed97d16`.
  Freshly built/repacked web archive SHA-256:
  `c964372e8886d6f59fa3332a71593004a4349b8400230418546ea8c891fca2ee`.
- Detailed uncommitted logs are in `/tmp/bruv-pi-review-275c67be`; web validation
  step logs are in this worktree's `artifacts/ci`. Committed first-paint evidence
  is under `wisdom/dependencies/evidence/pi-1.0`.

## Release handoff

No known release blocker from these Linux/offline gates. Parent integrates this
commit, chooses/bump-tests the release version, then performs push and release
CI/signing/publishing. The browser payload source/pin is unchanged and was built
fresh; --reuse-web is a repack path, not a verified packed-only cache receipt.
A future --reuse-packed-web invocation needs a fresh producer receipt and must
not bypass its manifest/input checks. No user executable was installed/replaced.

## Values and limits

Values unchanged: values 1/2 (built-path evidence and honest limits), 6 (guards and
user-work safety), 9 (behavioral upgrade review) and 10 (durable handoff) already
cover this work. No macOS packaging/hardware or paid/live provider entitlement was
tested. Parent's release CI/signing/publishing remains separate from this worker.
