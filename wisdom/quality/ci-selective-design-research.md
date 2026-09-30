# Change-aware CI design research

Research only, 2026-09-30, task_dc34f739. Proposals below are not implemented or hosted-verified yet.

## Recommendation

**Build a selective PR-feedback lane, not a faster version of the current all-inclusive CI script.** Keep a separate, explicitly named full-validation gate for merge/release. Routine, proven fast-path changes can finish execution in under one minute; arbitrary changes cannot honestly meet that target with the current build architecture.

The optimization worker’s pack-once/concurrent-validation work remains useful **for full validation and releases**, but does not solve this request: the measured **133-second build alone** exceeds the entire routine-CI budget.

No repository edits made.

## What inspection established

### Current cost and triggers

From `wisdom/quality/ci-speed-timing-audit.md`:

- Linux shared gate: **321s**.
- Build: **133s**.
- Root deterministic tests: **141s**.
- Web verification: approximately **44s**.
- Other commands inside the shared script: approximately **3s**.
- A PR took **24m33s elapsed**, but Linux execution was **6m45s**: approximately **17m47s queue/start delay**.

Therefore define separate metrics:

1. **Execution SLO:** runner/job start → final check result, target p95 <60s for identified fast classes.
2. **Feedback latency:** push → final result, including queue time.
3. **Full-validation duration:** a different, longer SLO.

Hosted queueing prevents a universal push-to-green <60s promise.

Current workflows:

- `CI`: every PR; pushes to `develop`; cancels superseded PR/ref runs.
- `Release`: every `develop` push, version-tag push, manual dispatch.
- `Live`: manual native/transport probes.
- Dependency updater: its own candidate validation/publication process.

`develop` currently duplicates substantial build/test work across CI and release dry runs.

### Required checks: observed, not assumed

GitHub API inspection returned:

- Default branch: `develop`.
- `develop.protected: false`.
- Required-status-check endpoint: **404 “Branch not protected.”**
- Repository rulesets: **`[]`**.

There is presently no observed branch-protection requirement to preserve, but release publication has real internal gate dependencies. Future protection must explicitly distinguish selective feedback from full validation.

**Do not keep the name “Bun 1.4.2 / Linux x64” while silently changing its meaning from full validation to selected tests.**

## Test taxonomy and build requirements

The root test tree contains **197 `.test.ts` files**, including **188 at its top level**. Filename prefixes are not adequate component boundaries.

| Group | Examples | Necessary preparation |
|---|---|---|
| Pure/model/source tests | waveform, rendering, buffers, parser/state tests | Root dependencies; some need prepared Pi assets |
| Source-contract tests | `live-notice`, workflow/release assertions | Explicit filesystem-input edges |
| SDK/runtime integration | agent, Live, questions, remote, session ownership | Root dependencies, Pi adaptation/assets; isolated temporary state |
| CLI/process/PTY tests | startup, TUI, execution, task monitor | Source wrapper or compiled CLI, depending on test; tmux only where actually needed |
| Compiled/packaging tests | CLI standalone behavior, web runtime, install/smoke | Fresh production build and embedded web archive |
| Upstream web tests | server, web model, contracts, client projection | Verified pinned/patched upstream source and frozen pnpm installation |
| Native/platform gates | sanitizers, helper embedding, macOS Live | Appropriate platform/toolchain |
| Release artifact gates | browser boot/reload, updater compatibility, checksums, provenance | Exact final release artifacts |
| Opt-in acceptance | LLM and real provider acceptance tests | Explicit credentials/environment; not implied by deterministic green |

The web build is not simply Bun compilation. It performs pinned-source retrieval/verification, patching, frozen pnpm installation, server/web typechecks, frontend and server bundling, deployment, chunk verification, portable dependency verification, and archive packing.

`src/t3/web/embedded.ts` imports `dist/die-web.archive.gz`; production compilation consequently cannot simply omit web packaging without changing the product being tested.

Conversely, `src/cli.ts` loads web launching dynamically. Source CLI paths that never launch web can potentially run with **prepared root assets but no upstream web build**.

## Dependency evidence: why filename-only selection fails

I constructed an exploratory relative-import/re-export dependency graph. This is useful evidence, **not a production-grade sound selector**: runtime filesystem reads, spawned executables, fixtures and dynamic behavior need additional edges.

Examples of transitive test reach:

| Changed input | Import-reachable test files |
|---|---:|
| `src/remote/human-rendering.ts` | 3 |
| `src/live/waveform.ts` | 5 |
| `src/ui/footer.ts` | 23 |
| `src/prompts/normal.md` | 34 |
| `src/tasks/task-manager.ts` | 37 |
| `src/output-buffer.ts` | 52 |
| `src/diagnostics.ts` | 61 |

Concrete consequences:

- A waveform change reaches Live extension/host integration and footer tests, not just `live-waveform.test.ts`.
- A remote-rendering change reaches remote extension and session-switch tests.
- Prompt Markdown is executable input: `src/prompts.ts` imports it with text import attributes. **Never classify all Markdown as documentation.**
- `live-notice.test.ts` reads `src/live/extension.ts` directly; an import-only graph misses that relationship.
- `update.ts` appears to reach only one test through imports, but packaging and old-updater compatibility involve different inputs and execution paths. That count does **not** justify running only `update.test.ts`.
- At least **36 test files explicitly mention CLI source or `dist/die`**. Executable-consumer edges must be represented.
- `live-main-integration.test.ts` automatically chooses existing `dist/die` unless explicitly overridden. Selection must prevent an old local binary from masquerading as current-source validation.

The upstream patch contains **300 file diffs**:

- 239 server;
- 42 web;
- 6 contracts;
- 5 client-runtime;
- package/lockfile changes as well.

Initially, **any `die.patch` change should trigger full validation**. Treating that one filename as a narrow web component would be unsafe.

## Concrete fast paths

These are execution estimates, **not hosted measurements**.

| Change class | Proposed PR work | Likely warm execution |
|---|---|---:|
| Allowlisted non-executable documentation | Classifier, diff/input validation, applicable documentation policy | **5–20s** |
| Proven test-only source-unit change | Frozen root install, applicable assets, format/lint, root typecheck, changed test plus mapped helpers/dependents | **20–45s**, subject to test duration |
| Remote human-rendering leaf | Root preparation/checks; transitive selected source tests | **20–45s** |
| Waveform leaf | Root preparation/checks; selected Live/footer/source-contract tests, explicit source CLI wrapper | **25–55s** |
| Shared runtime, CLI/bootstrap, dependencies, packaging, upstream patch/pin | Full fallback | **Minutes; not a <60s class** |

### Actual local timing probes

- Remote-rendering transitive group:
  - `remote-human-rendering`, `remote-session-switch`, `remote-extension`.
  - **51 passed; 375ms test execution.**
- Waveform import-reachable group:
  - Five files, **108 passed; 9.59s**.
  - This first run could choose existing compiled output, so it is not clean source-only proof.
- Explicit source-wrapper rerun, adding the filesystem-based `live-notice` test:
  - **109 passed across six files; 7.47s**.
  - `DIE_PROBE_EXECUTABLE` explicitly pointed to `tests/fixtures/live-execute-cli.sh`, which invokes current `src/cli.ts`.

These show plausible source-feedback budgets. They do **not** prove fresh-runner installation time, complete affected-test coverage, or compiled artifact correctness.

There is meaningful documentation opportunity: **19 of the last 100 non-merge commits changed only non-`src`/non-`integrations` Markdown**. This is an upper-bound candidate population, not a certified allowlist. Release notes need separate treatment because publication consumes them.

## Selector design

### Use two related graphs

1. **Source/test graph**
   - Parse TS/JS imports, re-exports and literal dynamic imports using actual module resolution.
   - Include text/file imports.
   - Include test helpers and fixtures.
   - Attach explicit filesystem-read and executable-consumer edges.

2. **Build/artifact graph**
   - Package/lock/tool pins → root installation and Pi adaptation.
   - Pi adaptation → runtime assets → source CLI and compiled CLI consumers.
   - Upstream source pin/patch → server/web/contracts/client-runtime validation and packaged web.
   - Bootstrap/native helper/archive/build scripts → compiled artifacts and their consumers.
   - Release metadata → appropriate publication/version/notes checks.

Take the union of changes’ affected checks. Do not let one fast-class file override another file requiring full validation.

### Conservative selection rules

- Evaluate dependencies in **both base and head**, including deleted/renamed inputs.
- For PRs, inspect the actual tested merge tree and compare it to its target baseline.
- Handle changed filenames using NUL-delimited Git output.
- Changed selector/configuration/workflows, unresolved imports, unknown inputs, missing base, opaque dynamic behavior, or unclassified tests → **full fallback**.
- Changed test helpers/preloads require their consumers, not merely the helper’s filename.
- Zero mapped tests for production code is a coverage gap, not permission to skip.
- For initial deployment, restrict fast paths to an explicit small allowlist of audited classes.

Emit an explanation manifest:

> changed input → dependency path → selected check; excluded check → documented applicability reason.

### Critical distinction

A selective source lane is **not equivalent to running every compiled CLI consumer**. If executable-consumer edges imply broad artifact testing, those checks must either:

- run in the full premerge gate, or
- force full PR fallback.

Do not pretend a static leaf-test list proves absence of packaging or integration regressions.

## Workflow architecture

### PR feedback

One compact Linux job for fast classes:

- Checkout with only history needed for reliable comparison.
- Classify first.
- Install Bun/root dependencies only when applicable.
- Prepare assets only when selected checks need them.
- Avoid Node/pnpm, upstream source setup, web-store restoration and apt/tmux on fast paths.
- Run selected checks and root typecheck.
- Publish the applicability manifest.

Avoid a planner → several workers → aggregator pipeline for tiny selections: extra runner starts and queues can consume the entire budget.

### Full premerge validation

Explicit **`Full validation`** gate:

- Required before merging executable changes.
- Run on a merge-queue candidate if a merge queue is adopted; add `merge_group` trigger.
- Otherwise run against the current PR merge candidate and enforce it before merge.
- Include Linux source/build/test gates and applicable macOS/native gates.

If “routine CI under a minute” means **every required executable-change premerge check**, this architecture does not promise that. It gives fast feedback plus longer trusted merge validation. That policy distinction requires explicit acceptance.

### Develop/release

Use **one trusted full producer per exact SHA**, whose successful outputs can feed release staging. Preserve the union of CI and release web checks, rather than choosing the smaller set.

Keep all final release gates:

- Fresh validated artifacts, compiled transport and standalone smoke.
- Native/platform validation.
- Actual final Linux browser boot/reload and SHA-linked proof.
- Linux/macOS old-updater compatibility.
- Checksums, notices/licenses, source/patch provenance.
- Publication only after successful exact-SHA gates.

Manual release preparation may create a new SHA; do not reuse the previous SHA’s proof or wait for a bot push that does not trigger another workflow.

### Nightly

Run full validation to detect selector mistakes and environment/platform drift. Preserve current opt-in acceptance semantics unless deliberately introducing separately credentialed acceptance jobs.

**Nightly is a backstop, not a replacement for premerge validation of executable changes.**

## Required-check behavior

Always create the workflow’s final policy check; do not use top-level path filtering to make required workflows disappear.

The final check must verify:

- Classifier succeeded.
- Every selected job actually succeeded.
- Missing, unexpectedly skipped, failed or cancelled selected jobs fail the gate.
- Nonapplicable checks have explicit reasons.
- Full-validation proof is never synthesized from selective results.

Use distinct names such as:

- `PR affected checks`
- `Full validation`
- Platform gates where independently required.

Avoid `[skip ci]` as the fast-path mechanism.

## Candidate implementation plan

1. **Inventory and manifest**
   - Record every existing gate, build need, platform, resource requirement, duration and artifact input.
   - Preserve CI/release check union.

2. **Introduce selector in shadow mode**
   - Continue full checks.
   - Emit proposed selection and explanation.
   - Compare selected/full failures over representative changes.

3. **Prove mappings**
   - Fixture tests for direct/transitive imports, text imports, filesystem reads, spawned CLI, helpers, renames/deletions and unknown inputs.
   - Mutation/change-injection trials demonstrating relevant regressions are selected.
   - Explicitly test failure/cancellation/skip behavior of final gates.

4. **Enable documentation fast path**
   - Small audited allowlist first; no blanket Markdown rule.
   - Historical candidate rate suggests immediate useful coverage.

5. **Enable measured source/test classes**
   - Remote rendering and waveform are good candidates for deeper proof.
   - Fresh worktree/runner tests with no preexisting `dist`.
   - Explicit source-wrapper selection and asset preparation.
   - Require p95 runner-start-to-result <60s before advertising the class.

6. **Separate full producer and release consumer**
   - Apply the optimization worker’s improvements here.
   - Remove duplicate exact-SHA validation without weakening publication gates.

7. **Expand only from evidence**
   - Track fast-path hit rate, execution p50/p95, queue delay, cold-cache fallback and missed-selection incidents.

**Bottom line:** under-one-minute routine feedback is plausible by avoiding web builds, unrelated tests and unnecessary tool provisioning. Under-one-minute validation for arbitrary changes is not supported by this repository’s measured costs or dependency structure.
