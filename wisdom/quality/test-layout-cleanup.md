# Feature-owned test layout

This cleanup follows [ARCHITECTURE.md](../../ARCHITECTURE.md) and the one-clear-owner value in [values](../values.md). The previous flat root hid whole families, not just Live scripts.

- Keep only `architecture.test.ts`, `session-boundaries.test.ts`, and `setup.ts` at the root: they protect or initialize the whole repository.
- Group tests by the feature they exercise. Integration variants stay beside that feature, even when they also touch SDK, Live, or terminal rendering. Claude connector/native-driver tests join `claude-compat/`; the T3 harness-action contract joins existing `t3/`.
- Keep genuinely shared process, environment, compiled-binary and TUI helpers in `helpers/`, and shared image/host fixtures in `fixtures/`. Feature-only probes, fixture scenarios and fixture helpers follow their feature.
- Preserve basenames, assertions and behavior. Depth changes affect source imports, repo roots, generated child imports, Python parent indexes, Docker fixture contexts and fixture creation paths—not only test imports.

The one-time move map is retired now that integration is complete. It remains
in Git at baf2fcd5c9976ee19a8cbc0ae8839875d714cc38 as
wisdom/quality/test-layout-moves.json. Git rename history also records the moves.
Historical wisdom is not a current checkout manifest.

The parent refined value 3 after the scope correction; this lane adds no separate value.

## Integration and proof

- The map covers 431 moves; all 453 original tracked test/support files still exist at their mapped homes. An audit found unchanged counts for all 16,214 assertion/case calls and unchanged executable modes. Basenames stay unchanged; historical fixture wisdom remains byte-identical.
- The frozen 0.16.3 updater has a byte-pinned source checksum. Its only code edit is the package import depth; the checksum test normalizes that one import back to its original spelling and keeps the original expected checksum. Do not update the checksum to accept other changes.
- `bun run build` passed (Bun 1.4.2). All five Python suites passed: 62 tests. Node 24.21.0 ran the 19 moved `.test.mjs` files: 134 passed.
- `bunx tsc --noEmit` reached only outside-consumer errors: `scripts/live/probe-startup-audio.ts`, `scripts/loopback-parent-fixture.ts`, `scripts/remote-{capability-pty-e2e,e2e,placement-e2e,pty-e2e,root-placement-e2e}.ts`. Rewrite their imports using the map; the implicit-any error in the typed-root runner follows its missing scenario import. No errors remain in `tests/`.
- Other known parent updates: script/CI test selectors and preloads, feature fixture Docker contexts, `scripts/verify-update.ts` legacy fixture path, and package/workflow references. Keep source-pattern assertions in the tests; do not relax them to accept stale consumers.
- Final focused boundary/fixture run: 39 passed across eight files. Broader focused feature coverage: 289 passed, one skipped, two process timing failures; both process cases passed on isolated rerun.
- Final recursive run (`BRUV_RUN_LLM_TESTS=0 bun test --parallel=3 ./tests`): 3,097 passed, 31 skipped, nine failures and three errors reported. Stale outside consumers account for the two CI-selector failures, two legacy-updater failures, and three module-load errors. The SDK markdown 5-second timeout passed alone (3.04 seconds). Resource capture replay still fails alone with `Saved questions unavailable: no parent question runtime binding` from `src/claude-compat/human-controls.ts`; its test assertions were preserved. Full integrated CI remains the parent responsibility.
- Detailed local logs: `/tmp/bruv-layout-all-tests-final.log`, `/tmp/bruv-layout-typecheck.log`, `/tmp/bruv-layout-smoke-final.log`, `/tmp/bruv-layout-node.log`, `/tmp/bruv-layout-python.log`, and `/tmp/bruv-layout-isolated-*.log`.

## Parent integration

The parent integrated the map and updated all outside consumers. The final layout
includes the owner corrections for measurement tools, task-owned agent helpers
and connector checkpoint restoration. Shared owned-process cwd now comes from
the helper's stable repo anchor, not the calling test's depth. Copied script
fixtures create their real nested directories. Earlier outside-consumer and
resource replay failures are resolved. See [the combined record](file-layout-cleanup.md)
for the final proof and the remaining full-suite Markdown timeout.
