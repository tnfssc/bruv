# Web numeric schema boundaries (b488c57 canonical patch)

Incremental source patch: `integrations/t3/upstream/web-effect.patch`; apply **after** the canonical `die.patch`. The canonical file itself was not edited.

- Persisted image/file attachment sizes, draft terminal line positions, draft version, stash pending-image count, and review indices/selection positions use `Schema.Finite`: serialized domain values cannot be NaN or infinity. This also avoids accepting non-finite line positions that can poison review rendering.
- Browser capture timeout, primary-auth request/credential/session errors, and desktop-update read errors deliberately retain `Schema.Number` with next-line diagnostic suppression: diagnostic errors must be constructible from untrusted/invalid numeric payloads rather than hiding the original failure behind schema validation.
- Five `Effect.succeed(Option.none())` expressions use the equivalent `Effect.succeedNone` without changing the service contract.
- `numberSchemaBoundaries.test.ts` checks valid persisted numbers, rejection of NaN and both infinities on persisted attachment/review fields, and preservation of invalid diagnostic payloads.

Verification in a private b488c57 checkout with the canonical patch applied: web `tsc --noEmit --pretty false` produced no errors; `effect-tsgo diagnostics --project tsconfig.json --format text` checked 1280 files with 0 errors, 0 warnings, 0 messages; focused boundary test passed (3/3). The local Bun install produced a damaged Pierre declaration and missing zod files; these were repaired **only under ignored node_modules** from the published package before verifying, with no dependency/build/plugin changes included in the incremental patch.
