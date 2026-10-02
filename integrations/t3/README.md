# T3 integration resources

This is the maintained resource/tooling boundary for the embedded T3 runtime.
Runtime code lives in `src/t3/`; direct tests live in `tests/t3/`.

- **One upstream input set:** `upstream/source.json` pins the repository and revision,
  `upstream/bruv.patch` is the canonical patch, and `upstream/bootstrap.mjs` is
  the packaged bootstrap. Builds, CI, and release attestation share these inputs.
- **One build:** `bun run build:web` runs `build/build.ts`;
  `build/verify-source.ts` rejects anything other than pinned HEAD plus that patch.
  `scripts/build.ts` remains the overall CLI/package orchestrator, including bootstrap
  refresh for `--reuse-web`. Generated output stays in `dist/` and revision-keyed `.cache/`.
- **Maintained gates:** `gates/` contains acceptance harnesses and migration templates.
  See [gate instructions](gates/README.md) for prerequisites and explicit opt-ins.
- **Shared contracts:** `fixtures/native-task-contract.json` serves root routing tests
  and upstream contract conformance, without separate fixture copies.

## What runs when

Routine offline verification is `bun run check`, `bun test ./tests` (after building),
plus CI pinned-source checks. Contract conformance and migration checks need prepared
checkouts but never install dependencies. Packaging checks need a reviewed built binary.
Browser, model/provider, and native acceptance are manual: they may need browser tools,
credentials, or devices. Do not add those to automatic discovery or bypass their guards.

[Experiments](../../experiments/t3/README.md) preserve preview, production-candidate,
and old-pin investigation history. They are not current gates or alternate build pipelines
and are not automatically executed. Archived files retain historical paths and provenance;
those paths are not compatibility aliases. Generic CLI scripts, native helpers, and
release notes retain their role roots (`scripts/`, `native/`, `support/`).

## Pinned browser/server build

The source is official `t3code/codex-turn-mapping`, pinned at the immutable
revision in `upstream/source.json` (not a stable-release assumption). Official Pi
support (#7211), Pi 1.0 (#14688), provider adapters, orchestration, usage, history
and browser codecs/syntax assets remain upstream-owned.

Bruv keeps its executable/environment boundary, least-privilege native tasks and
profile/depth policy, durable cancellation/replay, local-shell cards/completion
notifications, and Bun PTY/lazy native-search packaging. Broad compiler rewrites,
bespoke Pi usage aggregation and browser codec/syntax adapters are no longer
maintained here. Five optional per-turn cost fields remain solely to preserve
already-stored history; async task launches never acknowledge unread results. See [migration evidence](../../wisdom/t3/upstream-first-migration.md).

The official workspace/catalog remain intact. Installation selects only the
shipped server/browser dependency closures and root build tools. Modern pnpm
injected-workspace deploy requires a small generated lockfile delta; upstream
package versions, catalogs and patch declarations are not copied into a second
Bruv dependency definition. Legacy deploy was rejected because it re-resolved
the dependency graph and failed on unrelated upstream mobile patches.
The local package self-reference and portable native optional-asset checks remain
mandatory. Prepared builds honor `BRUV_T3_SOURCE` too. The compiled launcher
uses Bun preload to clear interpreter mode before executing upstream’s ordinary
CLI entry; argv and shutdown remain upstream-owned.

The original JavaScript warning threshold is unchanged. No artificial vendor/size
chunk groups are added. Both fresh and reused builds still reject cyclic static
emitted chunk graphs, and packaged browser startup remains a mandatory gate. Run
`T3_WEB_DIST=<source>/apps/web/dist node --test upstream/chunks*.test.mjs` from
this directory after a production build. Historical HEIC-specific adapter fixtures
remain research evidence; current codec behavior is the official implementation.

## Updating the canonical patch

Edit a disposable checkout at the revision in `upstream/source.json` after applying
`upstream/bruv.patch`, then export the actual Git source:

```bash
bun integrations/t3/build/regenerate-patch.ts /absolute/path/to/patched-checkout
```

The exporter checks the pin, uses a disposable index, includes file renames and
regenerates Git blob IDs, and verifies the result against the actual checkout.
Do not perform text replacement on a patch or hand-edit hashes. The upstream
repository/revision pin stays unchanged for product-only edits. The web builder
regenerates `SOURCE.txt`, the archive digest, and the verified payload receipt.
Bruv is a fresh identity: its `BRUV_*` environment, `.bruv` state, MCP tool names,
services and cache/artifact names do not fall back to Die identities.
