# Web numeric schema boundaries (b488c57 canonical patch)

> Integrated into canonical `integrations/t3/upstream/die.patch`; the incremental patch below is historical. See [final installer handoff](../packaging/install-local-warning-fixes-2026-09-27.md).

Incremental source patch: `integrations/t3/upstream/web-effect.patch`; apply **after** the canonical `die.patch`. The canonical file itself was not edited.

- Persisted image/file attachment sizes, draft terminal line positions, draft version, stash pending-image count, and review indices/selection positions use `Schema.Finite`: serialized domain values cannot be NaN or infinity. This also avoids accepting non-finite line positions that can poison review rendering.
- Integration review rejected the initial generic exemptions on all error fields. These producers carry measured values, not invalid user-supplied numbers: browser/auth timeouts are finite constants, elapsed time is a Date.now() difference, credential lengths are string.length, desktop attempts are the constant 3, and status is an HTTP response status or the fallback 500. All use `Schema.Finite`; regression tests check each exported error schema with real valid fields and reject nonfinite measurements. Unlike the server logger invalid-config diagnostic, none needs a nonfinite sentinel.
- Five `Effect.succeed(Option.none())` expressions use the equivalent `Effect.succeedNone` without changing the service contract.
- `numberSchemaBoundaries.test.ts` checks valid persisted numbers, rejection of NaN and both infinities on persisted attachment/review fields, and finite measured error fields.

Verification in a private b488c57 checkout with the canonical patch applied: web `tsc --noEmit --pretty false` produced no errors; `effect-tsgo diagnostics --project tsconfig.json --format text` checked 1280 files with 0 errors, 0 warnings, 0 messages; focused boundary test passed (3/3). The local Bun install produced a damaged Pierre declaration and missing zod files; these were repaired **only under ignored node_modules** from the published package before verifying, with no dependency/build/plugin changes included in the incremental patch.
