# Label-only connector CLI identity — 2026-10-07

## Contract and reason

The user approved `bruv-claude-compat --version` returning exactly
`Bruv connector` plus newline, with no dotted semver in stdout **or stderr**.
Normal `bruv --version` stays real product. Connector `--bruv-version` stays
exact `bruv-claude-compat <product>`. SDK init stays protocol `2.1.280` in
`claude_code_version` and real product in `bruv.version`.

`CONNECTOR_DISPLAY_IDENTITY` replaces the ambiguous `CONNECTOR_VERSION` name.
It is not a protocol version or a fake high Claude version. Keep
`COMPAT_PROTOCOL_VERSION` separate. No T3 changes or settings edits are needed.

Research is from a separate completed worktree:
`/home/tnfssc/.bruv/worktrees/t3-1c4479b8-5442693331ce-task_63490595`,
commits `b03989a6` (`wisdom/claude-compat/t3-unknown-version-backend.md`) and
`cc5230e7` (`wisdom/claude-compat/t3-non-semver-version-update-prompt.md`).
Those notes and historical proof captures were not rewritten as new evidence.

The exact unmodified T3 tag is `v0.0.46-nightly.20261005.2702`, SHA
`cfa4f765ec05950a032b6c1cf9cdfff0c2391545`. Its parser finds **any** dotted
semver across stdout plus stderr. Label-only output yields null. Latest-Claude
lookup skips it; popup and settings predicates exclude unknown. Unknown is not
unsupported. Version-gated built-in Claude models are filtered and a separate
“installed version is too old” model advisory can remain. Custom Bruv models
stay available (apart from built-in ID collisions). Other providers can still
cause their own global update notification. These are pinned-source findings,
not a new live desktop run, full parity, or a promise about future T3 versions.

## What stays intact

- The thin launcher still resolves/execs its normal sibling. No second runtime.
- The old 0.16.3 updater’s narrow staged canonical `--version` bridge inside
  `.bruv-update-*` still returns `bruv-claude-compat <product>`. After rename
  the same wrapper returns `Bruv connector`. New packaging uses `--bruv-version`.
- Paired update root routing from `db67f86b`/`89b381e7` is unchanged.
- Release, smoke, updater fixtures, help, and current setup docs now expect the
  label-only display identity. Historical captures retain their old output.

## Implementation workspace

New worktree: `/home/tnfssc/.bruv/worktrees/t3-1c4479b8-5442693331ce-task_ef0b72b0`.
Branch: `bruv/stop-bruv-connector-triggering-claude-up-ef0b72b0`.
Base: `89b381e7`. The completed prior task and research worktree were read only.
Bun: `/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun`.
Test setup uses a local untracked node_modules symlink to the prepared Pi 1.0.3
modules in `/home/tnfssc/.t3/worktrees/bruv/t3-1c4479b8`, with a local copy of
its prepared runtime assets. No dependency or lockfile version changed.
The temporary modules symlink and disposable baseline checkout were removed
after the gates; ignored local build/assets remain for inspection.

## Proof and limits

Gate captures are in [proof/label-only-cli-identity](proof/label-only-cli-identity/).
`compiled-identities.json` records the real root and wrapper output.
`focused-tests.txt` includes protocol-init and updater assertions. Tests run against the
actual compiled root and wrapper with isolated HOME. Display tests require exact
stdout, empty stderr, and no dotted semver. Compiled root protocol init checks
`claude_code_version: 2.1.280` and real product `bruv.version` using a loopback
provider fixture, not real provider authentication. Updater checks only replace
isolated temporary fixture pairs; no real installation/update, release, or push.

Values unchanged: existing truthful identity, exact-source proof, shipped-path
checks, and separate task ownership cover the lesson. This is feature-local.

### Reproduce the gates

Use Bun 1.4.2 with `PATH=/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin:/usr/bin:/bin`.
After dependencies/assets are prepared:

```sh
bun run build
bun run check
BRUV_CLAUDE_COMPAT_TEST_BINARY="$PWD/dist/bruv-claude-compat" \
BRUV_CLAUDE_COMPAT_TEST_BRUV="$PWD/dist/bruv" bun test ./tests
sh scripts/smoke.sh --reuse-build
```

The final focused run selects `product-identity`, `claude-compat-launch`,
`claude-compat-compiled`, `claude-compat-launcher`, `connector-update`,
`install-download`, `manual-release`, `release-workflows`, `smoke-script`,
`t3/web-launcher`, `update`, `verify-update`, and `site/scripts/install` tests.
It uses the same compiled-binary environment variables.

Offline updater proof used copies of the built pair named as raw Linux assets
plus generated SHA256 manifests in ignored `dist/release/` (not publication):

```sh
bun scripts/verify-update.ts dist/release/bruv-linux-x64 0.16.13
bun scripts/verify-update.ts dist/release/bruv-linux-x64 0.16.13 --legacy-updater
```

The first attempt used canonical `dist/bruv` rather than the required raw asset
name; the second lacked SHA256 manifests. Both stopped during input validation.
After preparing the complete local raw pair/manifests, both offline gates passed.

### Results

- Final build, TypeScript check, and isolated paired smoke: pass.
- Final focused identity/launch/compiled/updater/release/site tests: **136 pass,
  0 fail**, 1,203 assertions across 13 files. Both compiled tests ran (not skipped).
- Actual Linux compiled pair with current and frozen 0.16.3 offline updaters:
  checksum rejection, second-rename rollback, matched product versions, and
  installed label-only CLI probe all pass.
- Full suite: **2,224 pass, 27 skip, 6 fail**, 112,723 assertions across 302 files.
  All six failures are in `terminal-perf-send.test.ts`: the globally installed
  accounting adapter calls missing `manager.getSessionId` on the disk projection’s
  skeletal usage manager. That file alone passes **7/7** (173 assertions).
- A separate disposable baseline checkout at `89b381e7` also reproduces the same
  adapter TypeError in unchanged `manual-shake.ts`/history code. Its full counts
  are **2,159 pass, 27 skip, 70 fail**: not a clean count comparison, because Bun
  discovers files in reversed order there and source PTY tests also encounter
  the temporary path’s untrusted `mise.toml`. No trust was granted. The baseline
  confirms the adapter symptom predates this feature, not that all failures are
  equivalent. No unrelated adapter/fixture fix is bundled with this task.

See `gates.txt`, `full-suite-failures.txt`, `baseline-adapter-error.txt`, and
`terminal-perf-isolated.txt` in the proof directory. Full-suite green is **not**
claimed. There was no new T3 desktop run, real provider auth, real install/update,
push, or release.

## Parent UI acceptance

The parent now has bounded unchanged-2702 UI proof on the integrated pair.
See connector-version-probe-integration.md. Its control observes the old update
popup; the label-only build removes it and preserves genuine native loopback
custom-model chat. The separate model warning remains. This does not change
the source/UI, full-suite, auth or full-parity limits of the worker gates above.
