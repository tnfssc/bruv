# Biome warnings fail CI

The shared CI runner calls `bun run lint`. That script now uses
`biome lint . --error-on-warnings`, so local lint and Linux CI agree.
No second lint command or warning baseline is needed.

Keep the recommended rules on. Narrow ignores explain deliberate terminal
control bytes, literal template text, or an exact callback contract.
Biome's file cap is 4 MiB so it can check the two large tracked review JSON
files instead of skipping them with warnings.

`--only=style/useTemplate` enables that rule even in test files where our
config turns it off. Keep unrelated autofixes out. The frozen
`tests/release/update-v0.16.3-fixture.ts` must keep its exact bytes. Do not
update its hash to bless a style edit.

`tests/ci/lint-gate.test.ts` runs the real package script in owned scratch.
Clean code passes. A warning-only file passes plain Biome but fails the
package script. Existing CI runner tests cover stopping on a failed gate.

## Proof and limits

- Lint: 1,259 files, no findings. Format, root typecheck, and build pass.
- Warning-gate and CI runner tests: 22 pass.
- Tooling and site: 324 focused tests pass, plus site typecheck, browser
  validation, and offline profiler checks.
- Compatibility and Live: 208 focused tests pass, 7 skip.
- Source worker: 569 pass, 3 time out. Two timed-out cases pass alone.
  The source-approval question-outage case still times out and then reports
  a retry-intent conflict. This remains unresolved.
- Runtime review: no concrete regression found; 176 tests pass, 7 skip.
  Template review checked all 1,616 baseline suggestions with AST comparison
  and 114 value probes. No behavior regression was found.
- Final full suite: 3,119 pass, 31 skip, 37 fail, 3 errors. It is not green.
  The system `/tmp` mount is full. Owned `TMPDIR` helps, but some scripts
  hard-code `/tmp`. A temp root inside this repo also changes project-root
  discovery. There are timeouts and other failures, not all isolated to an
  environment cause. Two SDK wrap-performance checks fail in unchanged tests.

Scratch logs are under `.tmp/lint-*` and `.tmp/src-*`. Create
`.tmp/lint-test-tmp` and set `TMPDIR="$PWD/.tmp/lint-test-tmp"` for local
reruns. Do not clear shared temp files or relax assertions to get green tests.
The cleanup is left uncommitted. No PR or push was requested.

Values stay the same. This applies the existing proof and simple-owner values;
it does not add a new project-wide lesson.
