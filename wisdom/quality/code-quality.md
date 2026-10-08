# Code quality tooling

Biome `2.5.15` is pinned exactly so formatting and lint results stay stable. TypeScript checks remain a separate `bun run check` step.

## Commands

- `bun run format`: rewrites supported project files.
- `bun run format:check`: finds format drift without changing files.
- `bun run lint`: runs the recommended Biome rules, including correctness checks.
- `bun run check`: prepares generated assets and runs TypeScript 7 without emitting files.

Biome follows `.gitignore`. It also leaves out dependency, generated, runtime, distribution, harness, and artifact directories. Markdown formatting is off, so the formatter never rewrites prompts or project docs. Test-only overrides turn off rules that add noise to typed mocks and fixtures: explicit `any`, non-null assertions, banned placeholder types, and template-string preference. Correctness rules such as unused imports and variables stay on.

## Initial formatting baseline

The repo now has one formatting baseline. `bun run format` checked 116 supported files and rewrote 102 of them. `bun run format:check` then passed with no drift. CI and release both run this gate before lint.

At that initial baseline:

- `bun run lint` passes with recommended rules on. It reports 132 warnings and 101 informational diagnostics. They stay visible; no rules were hidden to make the result look clean.
- `bun run format:check` passes after checking 116 files.
- `bun run check` passes with TypeScript 7.0.2. Biome can also parse Bun import attributes (`with { type: "file" }` and `with { type: "text" }`) and the `*.md` ambient module declaration.

CI uses `bun install --frozen-lockfile`. It then runs `bun run format:check`, `bun run lint`, and `bun run check` as separate steps. The release workflow runs the same quality gates.

## PR #6 format gate (2026-09-26)

The Linux CI run 36246843468 stopped at `format:check`: two new assertions in `tests/live-main-owner.test.ts` used single quotes where Biome requires double quotes. The macOS device-free lane passed; later Linux gates did not run. For prompt-only changes with test edits, run `bun run format:check` locally before handing off; fix the test formatting rather than changing the prompt behavior.

## Behavior-preserving lint cleanup

Keep the schema URL aligned with the pinned CLI. Use its migrator for deprecated configuration fields; `recommended: true` to `preset: "recommended"` preserves the rule selection. Review automatic fixes by rule, not with a repository-wide `--unsafe` pass. In line readers, use a `for` initializer/update to find the next newline after consuming the buffer; keep `continue` paths advancing too. Separate cache assignment from its returned value without changing when lazy work starts or which promise concurrent callers share.

Do not blindly replace callback `void` unions with `undefined`: existing callbacks typed to return `void` need not satisfy the narrower contract. Terminal control-character regexes, fixture strings containing literal `${...}`, and CSS `!important` enforcing hidden state also need their owning behavior checked, not cosmetic substitutions. Keep unresolved diagnostics visible and report them separately from successful command exits.
