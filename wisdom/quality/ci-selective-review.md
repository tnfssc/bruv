# Early selective CI review

Read-only review task_19706d03, 2026-09-30. Review of in-progress worker, not final integrated code.

## Early verdict

Good conservative foundation, but **not yet evidence of complete affected-test selection or routine CI <60s**. No worker files edited. Current selector tests: **13 passed, 126 assertions, ~329ms**.

### Must-fix before enabling executable fast paths

1. **Opaque dynamic imports bypass the pure-leaf guard.**  
   `scripts/ci-selective.ts:153–158` relies on `scanImports()` plus selected forbidden identifiers.

   I reproduced this in an isolated temporary Git repository:
   ```ts
   const fs = await import(["node", "fs"].join(":"));
   export const x = fs.readFileSync("README.md", "utf8");
   ```
   Result: `mode: "selected", full: false, selected: ["remote"]`.

   Bun reports no scanned imports here; none of the regex’s forbidden identifiers appears. This can introduce filesystem dependencies while retaining fast selection—and subsequently make docs skips unsafe. Reject opaque dynamic loading conservatively and add regression coverage. No custom dependency graph is necessary.

2. **The dependency audit does not establish actual affected-test completeness.**  
   `tests/ci-selective.test.ts:185–216` asserts direct imports of the two leaves, then checks a few manually listed transitive boundaries. It does not audit transitive consumers or spawned CLI ownership.

   Concrete omitted consumers:
   - `src/cli.ts:180–181` dynamically imports both extensions.
   - `tests/live-spoken-tui.test.ts:35` launches that source CLI, but neither class selects it.
   - `tests/pi-host.test.ts:144` includes source-CLI execution, but neither class selects it.

   Consequently, “all class consumers” at selector line 61 overstates what is proven. Either explicitly cover relevant source/process boundaries, or document these omissions and retain enforced full premerge validation. The mixed source/compiled `pi-host` suite needs deliberate separation or full-lane ownership, not execution against stale `dist`.

3. **Missing merge and runner-contract regression coverage.**  
   Existing tests cover ordinary commits, missing revisions, hostile filenames and mode changes. They do not cover:
   - A real merge candidate containing target-branch changes/conflicts.
   - Explicit head differing from checkout HEAD.
   - Runner failure propagation.
   - CI rejection of `--prepared-deps`.
   - Source-wrapper use when an old compiled binary exists.

   These are important contract tests before the parent wires YAML.

### What looks sound

- **Diff handling:** two resolved commit trees; NUL-delimited output; external diff/textconv disabled.
- **Rename/delete safety:** `--no-renames` exposes rename endpoints as deletion/addition; deletion forces full fallback. Conservative rather than optimized.
- **Both revisions:** leaf imports/runtime markers inspected at base and head; changed file modes checked on both sides.
- **Union:** unknown inputs override docs/selected classes. Empty/unavailable diffs fail broad.
- **Docs:** narrowly scoped human-reference Markdown; prompts, fixtures, embedded source docs and release inputs are not blanket-exempted. I found no current runtime consumer of the allowlisted documentation.
- **Source execution:** selected commands bypass the build-first root test script, prepare assets, and force `DIE_PROBE_EXECUTABLE` to the source wrapper. Selected PTY tests launch `src/cli.ts` directly.
- **Fail-closed runner:** `--run` refuses full plans with exit 3; command errors/nonzero exits propagate; tracked checkout must match planned head.

**Parent contract:** `plan()` does not choose an event baseline or compute merge-base. YAML must supply the correct baseline and actual tested merge head. Classification returning exit 0 with `full=true` is intentional—not validation success. Missing/failed classification must never become a skip.

### User-intent gap and expansion

I classified the worktree’s latest **100 non-merge commits** using the current path/status rules:

| Result | Commits |
|---|---:|
| Docs | 3 |
| Selected | 2 |
| Full | 95 |

This is a historical candidate count, not a correctness or timing benchmark. Nevertheless, **5% fast-path eligibility is too narrow to describe as routine CI <60s** without explicitly qualifying the promise.

Next evidence-backed expansion priorities:

1. **Additional audited human-reference docs.** Historical excluded candidates include `wisdom/dependencies/*.md` and `wisdom/configuration/*.md`. Audit exact files first; keep release-consumed material and `wisdom/values.md` excluded.
2. **Short, self-contained test-only classes.** Explicit ownership and helper/process-input checks can safely broaden coverage without building a graph engine.
3. **Additional pure source/model classes**, after consumer audits and mutation trials.
4. **Avoid rebuilding unchanged web inputs** through the parent’s separately validated artifact boundary; this offers broader value than adding many tiny leaf classes.

Keep explicit ownership if it remains simpler and tested; Bun `--changed` is optional and cannot discover filesystem/process ownership by itself. Measure cold/warm runner-start-to-result p95 before advertising any class as <60s. Keeping full validation required for every executable merge is safe, but means the fast lane is **feedback**, not complete under-one-minute merge validation.
