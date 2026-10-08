# Paired Bruv update — packaging follow-up, 2026-10-03

This follows production packaging base 2abc96c3. It is not publication or native
T3 acceptance. Parent integrates both only after its native acceptance gate.

## Contract

Normal `bruv update` owns resolved sibling `bruv` and `bruv-claude-compat`.
All four official raw binary/checksum assets for the existing supported platform
map must be advertised with exact canonical URLs. Both downloads are staged in
the install directory and SHA256-checked before replacement. Staged normal
`--version` returns bare semver; connector `--version` returns
`bruv-claude-compat <semver>`. Both must equal the release tag version. macOS arm64
reuses normal `--live-self-test`, just like the local installer; it does not open
audio or call a provider.

Compatible means the resolved normal file is named bruv, is regular and has one
hard link. A normal invocation symlink remains intact. The connector must be a
regular sibling (not a directory, symlink or hard link). Unsupported/split/custom
layouts need manual paired reinstall; the updater never follows a connector link
into another installation. A normal-only installation gains a connector, including
at the same latest version. A broken/mismatched same-version connector is repaired
from that release. A newer-than-stable normal binary is never downgraded; a missing
or mismatched connector then requires a manual matching pair.

`bruv update --check` checks metadata, compatible layout and, when normal is
already current/newer, the installed connector version. It does not download,
stage or replace anything. It reports an available pair update/repair, current
pair, newer matched pair, or an actionable error. No updater daemon or config
ledger was introduced. No Claude/T3 install/update, settings/auth migration,
profile rewrite or session deletion is performed. External T3 updates separately.

## Replacement and recovery

Stop other Bruv/T3 sessions before updating; restart afterward. Two sequential
renames are not atomic together. After verification, copies of existing files
are kept as `bruv.previous` and `bruv-claude-compat.previous` inside the private
`.bruv-update-*` directory; modes are retained. Both installed file identities
are rechecked for concurrent changes. Connector is replaced first, then normal.
A reported replacement failure restores replaced files (or removes a newly added
connector). The updater reports failure, never success after a partial replacement.
Successful update/rollback cleans staging.

If rollback itself fails, the error lists failed restoration/removal actions and
retains the recovery directory. Stop sessions and restore the named previous file
to its sibling installed name, or reinstall a matching pair. For a newly added
connector there is no previous connector: remove it if returning to the old
normal-only install. An abrupt process/machine stop cannot be made transactional
by two renames: retained stage/backups can support the same manual recovery.
This follow-up does not redesign the local installer replacement sequence.

## Evidence

Focused updater tests use temporary installation paths and fake official fetch.
Raw platform fixtures inject the version/helper runner, so they are not native
platform execution evidence. A private compiled updater runner additionally
executes actual staged shell version probes, verifies a matching pair and leaves
its own executable unchanged. No running installed executable is replaced in any
test. Failure cases cover missing/bad connector assets, checksums/versions,
helper failure, unsafe layouts, concurrent changes, rollback and failed rollback.
Normal compiled CLI and existing local-install checks run with temporary HOME and
install directories. No real global updates, upstream mutation or release occurs.

Local tools use Bun 1.4.2, parent-prepared dependencies through an uncommitted local
symlink and a local copy of prepared runtime assets. Native T3, provider, actual
macOS helper and non-x64 platform execution remain parent acceptance work.

Executed checks:

~~~sh
bun scripts/build.ts
bun scripts/build-claude-compat.ts
node_modules/.bin/tsc --noEmit
node_modules/.bin/biome format src/update.ts src/cli.ts tests/update.test.ts \
  tests/update-self-fixture.ts tests/update-release-shape.test.ts tests/cli.test.ts
node_modules/.bin/biome lint src/update.ts src/cli.ts tests/update.test.ts \
  tests/update-self-fixture.ts tests/update-release-shape.test.ts tests/cli.test.ts
bun test tests/update.test.ts tests/update-release-shape.test.ts \
  tests/install-local.test.ts tests/cli.test.ts tests/product-identity.test.ts \
  tests/production-packaging.test.ts
~~~

85 tests / 380 assertions pass. Typecheck and focused formatting pass; lint has
existing/style advisory warnings and infos, no errors. Initial CLI installer probe
failed when only normal was built; building the connector fixed the actual missing
artifact. No test was skipped to hide that dependency.

Values are unchanged: paired ownership, truthful recovery/proof boundaries and
preserving user data already follow wisdom/values.md. No new general rule needed.

## Connector update entry

The connector `update` command now enters this same normal updater through root
CLI dispatch; it does not run a Claude updater. See [connector update](connector-update.md)
for the branch, offline command-path proof and the important limit: T3 may still
say unchanged/outdated because it compares protocol against latest Claude.

## Download timeout and failure phases

The updater now separates binary download deadlines from metadata/checksum
requests and reports the failed phase instead of blanket permissions advice.
See [timeout investigation](../releases/updater-timeout-diagnostics.md) for
artifact-size evidence, tests, scope and remaining network limits.
