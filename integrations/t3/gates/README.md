# Maintained T3 acceptance harnesses

These scripts check the canonical T3 source pinned by `integrations/t3/upstream/source.json` with
`integrations/t3/upstream/bruv.patch`. Retained harnesses default to the revision-keyed checkout:

`<repository>/.cache/bruv-t3code-<integrations/t3/upstream/source.json revision>`

Set `T3_V2_CANDIDATE` only to review an equivalent checkout elsewhere. Harnesses
never install dependencies. Prepare the pinned checkout and its dependencies first.
All live harnesses use private temporary state beneath `TMPDIR`, or the platform
`os.tmpdir()` when `TMPDIR` is unset. An explicit reviewed binary and SHA-256 are
required where noted.

## Manual offline probes

- `bun integrations/t3/gates/launcher-runtime.ts`: Linux local fake-backend lifecycle
  and exact owned-PID cleanup; requires a built `dist/bruv`.
- `bun integrations/t3/gates/rpc-smoke.ts`: compiled CLI RPC with a loopback fake
  model and T3 task events, no provider API. `--serve` intentionally keeps the fixture
  server running for manual browser work.

Neither probe uses a source checkout or a hardcoded upstream pin. They are manual
resource investigations, not automatically discovered release tests.

## Packaged browser startup regression

Launch a reviewed package with private HOME/cache/base-dir and `--no-browser`. Then:

```bash
T3_STARTUP_ACCEPT=1 T3_STARTUP_URL=http://127.0.0.1:<port> \
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/absolute/path/to/chromium \
node --test integrations/t3/gates/startup.browser.test.mjs
```

This verifies two cold browser contexts and reloads against the actual embedded
client and backend without model calls. It requires an explicitly isolated loopback
server and installed browser tools; it does not install them. Production builds
(including `--reuse-web`) also automatically reject cyclic static chunk graphs via
`upstream/chunks-startup.test.mjs`. Asset-size checks alone do not prove startup.

## Canonical checkout identity

```bash
REVISION=$(bun -e 'console.log((await Bun.file("integrations/t3/upstream/source.json").json()).revision)')
CHECKOUT="$PWD/.cache/bruv-t3code-$REVISION"
HEAD=$(git -C "$CHECKOUT" rev-parse HEAD)
test "$HEAD" = "$REVISION"
```

The checkout must be exactly the pinned HEAD plus the canonical patch. The build
pipeline's source verifier decides whether it passes.

## Deterministic static contract

`contract-conformance.ts` checks the shared fixture against the root Zod schemas and
the real candidate Effect schemas:

```bash
bun integrations/t3/gates/contract-conformance.ts
```

Keep `integrations/t3/fixtures/native-task-contract.json` with this harness and its root
consumer, `tests/t3/native-routing.test.ts`.

## Browser and native acceptance

Both launchers fail closed unless checkout HEAD, binary path, binary hash, and the
explicit acceptance flag are given. They do not install, build, or release.

```bash
BIN=/absolute/path/to/reviewed/bruv
SHA=$(sha256sum "$BIN" | cut -d' ' -f1)
T3_V2_ACCEPT_CANDIDATE=1 \
T3_V2_BRUV_BINARY="$BIN" \
T3_V2_EXPECT_CHECKOUT_HEAD="$HEAD" \
T3_V2_EXPECT_BINARY_SHA256="$SHA" \
bun integrations/t3/gates/browser-acceptance.ts

T3_V2_ACCEPT_CANDIDATE=1 \
T3_V2_BRUV_BINARY="$BIN" \
T3_V2_EXPECT_CHECKOUT_HEAD="$HEAD" \
T3_V2_EXPECT_BINARY_SHA256="$SHA" \
bun integrations/t3/gates/native-acceptance.ts
```

Browser acceptance also needs Chromium and `playwright-core` already
available. Optional overrides are documented by the `T3_V2_*` constants at the top
of each script. Native acceptance needs the candidate's
`NativeBruvIntegration.production.test.ts` and prepared dependency tree.

## Migration acceptance

The migration harness tests the shipped production source
`b488c57f3f9f1688e31c53daee99e29dd1d0baa2`, with the canonical
patch from root commit `92f1f2bc543ef148a5d254c20c95e6ba8b9aa4be`, upgrading in place to the preview revision in
`integrations/t3/upstream/source.json` plus `integrations/t3/upstream/bruv.patch`. Each checkout needs its own prepared dependency tree. Its installed lockfile must retain exact pinned metadata, importer bindings,
package records and snapshots, with the complete server dependency closure.
pnpm may prune packages outside the shipped workspace from the installed lock;
that does not require forking the official source lock. The harness never clones or installs and never writes package
caches. Override checkout or patch paths with
`T3_V2_MIGRATION_PRODUCTION`, `T3_V2_MIGRATION_PREVIEW`,
`T3_V2_MIGRATION_PRODUCTION_PATCH`, and
`T3_V2_MIGRATION_PREVIEW_PATCH`.

The production runner creates a native V2 event/projection graph. It includes a run and
nodes, normalized usage and cost, provider session/thread/turn identity, a
completed native subagent job, two-message history and turn items, and encoded
server settings with a provider instance and price override. The preview runner
opens that same database and settings file, validates them through preview domain
readers/schemas, then starts a second time and compares a semantic snapshot. This
is an upgrade/restart compatibility gate. The shipped production fixture records schema migration 54. The canonical
66a91077 target must reach migration 56; restart must preserve the semantic snapshot.
Usage assertions inspect official provider-turn records directly, including token
counts, confidence/scope and provider-reported cost, rather than the retired Bruv
subtree report. The ledger also verifies the official migration renumbering at 53–56.

```bash
TMPDIR=/var/tmp \
T3_V2_MIGRATION_PRODUCTION=/absolute/path/to/patched-b488c57 \
T3_V2_MIGRATION_PREVIEW=/absolute/path/to/patched-66a91077 \
bun integrations/t3/gates/migration-acceptance.ts
```

The two tracked fixture templates are copied temporarily beneath their matching
checkout only for workspace package resolution and removed in `finally`.
When no production patch is given, the harness rebuilds and hash-checks it from repository
history. Before running, it checks that each checkout is exactly its pinned HEAD
plus the expected patch.

## Packaged, preservation, and worktree gates

- `packaged-smoke.ts` is a black-box relocation/security smoke. It uses only
  supported Node/Bun built-ins. No transitive `ws` package is needed.
- `preservation-acceptance.ts` validates same-server shell-card and completion
  preservation against an exact packaged binary.
- `worktree-acceptance.ts` validates local and native structured-worktree behavior.
  It needs `T3_WORKTREE_ACCEPT=1`, `T3_WORKTREE_BRUV_BINARY`,
  `T3_WORKTREE_EXPECT_SHA256`, and `T3_V2_EXPECT_CHECKOUT_HEAD`.

These live gates write proof only to their configured artifact paths. Proof files,
logs, screenshots, browser profiles, generated binaries, and private state are review
evidence, not source inputs.

## Historical research is not a gate

Candidate builders/exporters and their inputs have been retired from the checkout.
[Historical archive recovery](../../../experiments/t3/production-v2/README.md)
records their exact Git baseline. They are not alternate ways to build or update
the canonical inputs. Historical prose and preservation evidence remain.

## Final release browser boot (mandatory CI gate)

`release-browser-boot.ts` launches the downloaded final
`dist/release/bruv-linux-x64`, not a source/dev server. It uses fresh HOME,
XDG cache/config/data/state, agent state, web state and browser profile; no provider
credentials are inherited. Chromium errors are collected before navigation. Both
initial load and reload must show a real setup dialog with Continue, or the app's
New thread/model-picker UI, with the boot splash removed and no load failure.
The release workflow runs this for freshly built and reused assets, and publication
requires its success. Failure proof includes browser errors, server output and a
screenshot when a browser page exists.

Local rerun with an existing playwright-core install and Chromium:

```bash
RELEASE_BOOT_PLAYWRIGHT=/absolute/path/to/playwright-core/index.mjs \
RELEASE_BOOT_CHROMIUM=/absolute/path/to/chrome \
bun integrations/t3/gates/release-browser-boot.ts dist/release/bruv-linux-x64
```

`RELEASE_BOOT_PROOF` overrides `artifacts/release/browser-boot.json`.
A binary argument can select another compiled artifact for investigation; only the
final release artifact is release proof. The script never builds, publishes, or
changes the package version.
