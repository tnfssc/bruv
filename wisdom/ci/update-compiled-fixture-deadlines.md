# Scoped deadlines for compiled updater fixtures

On HEAD 409086c9 during the Pi 1.1.0 Linux gate, two failures were confined to the compiled fixtures in tests/update.test.ts: the private compiled Bun identity fixture exceeded the default test budget, and the compiled updater case timed out while its compiler child was still running. Bun then killed the compiler, obscuring the original timeout as exit 143/uncaught child errors. These fixtures compile local updater sources; this was not evidence of a Pi/catalog regression.

Give only those two compiler-owning tests explicit 30-second budgets, matching the bounded compiled tests in tests/verify-update.test.ts. Keep the compiler exit-code assertions and compiled executable/output checks unchanged: a genuine compiler failure still fails, while parallel CI gets reasonable compilation headroom. Do not raise the suite-wide timeout or relax product assertions.

Change: tests/update.test.ts adds `30_000` test budgets to the real private compiled-fixture test and compiled updater test.

Proof: `bun test tests/update.test.ts tests/verify-update.test.ts` — 55 pass, 0 fail, 202 assertions; both fixtures compiled and ran. `bunx biome format tests/update.test.ts` and `git diff --check` passed. The full Linux gate was not rerun; parent owns it.
