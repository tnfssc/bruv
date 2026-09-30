# T3 integration resources

This is the maintained resource/tooling boundary for the embedded T3 runtime.
Runtime code lives in `src/t3/`; direct tests live in `tests/t3/`.

- **One upstream input set:** `upstream/source.json` pins the repository and revision,
  `upstream/die.patch` is the canonical patch, and `upstream/bootstrap.mjs` is
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

The canonical `upstream/die.patch` includes the reviewed installer modernization.
It scopes pnpm to the shipped server, browser, shared packages and typecheck scripts;
it is not an upstream desktop/mobile build checkout. Modern injected-workspace
deploy preserves native optional assets and the local package self-reference.

Browser codecs and syntax data remain lazy: HEIC uses an external WASM worker;
Shiki uses native Oniguruma WASM and JSON grammar assets instead of large JS
wrappers. The original 500 kB JavaScript warning threshold is unchanged. Artificial vendor/size
chunk groups are deliberately absent: they broke production initialization. A large
shared chunk warning is preferable to a client that cannot boot. Both fresh and
reused builds reject cyclic static emitted chunk graphs; the manual packaged browser
startup regression is documented in `gates/README.md`. Run
`T3_WEB_DIST=<source>/apps/web/dist node --test upstream/chunks*.test.mjs` from
this directory after a production build. `upstream/heic.browser.test.mjs` also
requires `T3_HEIC_SAMPLE`, `PLAYWRIGHT_MODULE`, and optionally
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` for real browser conversion checks.

Compiler idioms preserve cancellation/error contracts. Finite schemas express
wire/domain constraints, not a blanket numeric rewrite: the invalid numeric
configuration error intentionally retains `Schema.Number` with the compiler’s
documented single-site exemption. See the numeric-contract wisdom and the final
installer validation handoff for evidence and compatibility decisions.
