# Selective CI: outside evidence and what transfers here

Research date: 2026-09-30. Used the installed Tavily CLI, /home/tnfssc/.local/bin/tvly, for internet search and extraction. This is research, not implementation or a measured promise of sub-minute CI. Read the nearby CI handoff and timing audit. The parent is doing the repo-specific design.

## Main finding

**Bun already has reverse-dependency test selection. Try it before writing our own import graph.** The installed Bun is 1.4.2; its help advertises --changed=<val>. Bun's 1.4 release notes document 'bun test --changed' for working-tree changes and 'bun test --changed=<ref>' for changes against a branch or commit. The merged implementation PR describes scanning test module graphs, building reverse-import adjacency, and walking backwards to affected tests. Its temporary-Git-repository regression cases cover direct/transitive/shared dependencies, staged and untracked files, subdirectory invocation, and reference comparisons. [1, 2]

This is stronger than matching test filenames to changed source filenames. But a module graph is not a model of everything a process does. A test spawning dist/die, reading prompts through the filesystem, copying fixtures, or discovering files at runtime has dependencies outside ordinary imports. Package dependencies are treated as external in the PR's scan. Do not assume lockfile changes select tests. PTY/process and compiled CLI lanes need explicit ownership rules and conservative fallbacks. These limits are deductions from the graph and this repo's execution model, not a claim that Bun promises to discover those edges.

Vitest provides a useful cross-check: 'related' follows static imports, including literal dynamic imports, but cannot follow computed import(filepath). Changing runners is unnecessary to gain the basic mechanism. [3]

## What the mature tools do

### Nx: affected projects plus task caching

'nx affected -t test --base=<base> --head=<head>' combines changed files with the project graph, including dependent projects. Nx recommends the last successful main-branch commit as the CI base, so failed/cancelled commits are not forgotten. It defaults to marking all projects affected on lockfile changes; narrower dependency analysis is opt-in. [4]

Nx separately documents inputs (files/environment in the task hash) and outputs (restored generated folders). [18]

Affected and cached are different decisions. A shared library can affect most projects; caching can still avoid repeating tasks with identical inputs. Cache declared results and outputs, only for operations whose outputs depend on known inputs and whose skipped execution does not omit necessary side effects. Nx's 22.7 announcement explicitly warns that a missing cache input can produce a false restore; its cache-security guide lists input hashes, output files and terminal output as cached data and warns against untrusted cache writes. [16, 17]

**Here:** one package gives Nx little project-level selectivity. A source edit may mark the entire package affected. Artificial package splits or adopting Nx are not prerequisites for Bun's test-file graph. Transfer reverse dependencies, explicit generated/file inputs, known-good base, and dependency-change fallback. Revisit Nx if real package boundaries emerge.

### Turborepo: package selection and content-addressed tasks

'turbo run test --affected' selects changed packages and dependents. Its default comparison is equivalent to --filter=...[main...HEAD]; TURBO_SCM_BASE/HEAD can override it. An insufficiently deep checkout makes all packages affected. By default selection is package-level. Current docs expose an opt-in futureFlags.affectedUsingTaskInputs for task-input selection. [5]

CI guidance encourages running quality tasks and letting unchanged tasks hit cache instead of immediately constructing complex skip logic. Declared outputs matter: replaying a successful log does not restore needed files unless outputs are configured. Undeclared build-time environment variables can yield the wrong cached build. [6, 7, 8]

**Here:** the separately pinned embedded web app is not automatically a workspace dependency. Turbo cannot infer a downloaded revision, wrapper patches, archive inputs, or runtime assets without a model. The useful boundary is likely the expensive web artifact, not a cache around the opaque root 'test' script, which currently builds first.

A web-artifact key must cover the upstream pin, wrapper/build/patch inputs, dependency locks, build configuration/environment that affect outputs, and toolchain; include platform/architecture when relevant. Cache verified outputs and provenance, not just logs. Unchanged complete web inputs mean a root TypeScript edit need not rebuild upstream web. Changed inputs require rebuilding. Exact key composition belongs to the parent's design.

### Bazel: explicit actions and a trustworthy graph

Bazel actions declare inputs, outputs, command line and environment. Remote caching stores action results and content-addressed outputs. Its docs warn about undeclared external tools, environment leakage, concurrent source edits, and cold CI losing in-memory analysis state. Cache does not eliminate setup, analysis, transfer, or missing dependencies. [9]

'bazel query rdeps(...)' expresses reverse dependencies; tests(...) filters to tests. Tinder's bazel-diff instead hashes graphs at two revisions and derives changed/transitively impacted targets. That is stronger than raw changed paths when rule definitions or graph edges change. It also offers explanations of why a target was selected and graph-distance metrics. [10, 11]

**Here:** copy explicit inputs, reverse closure and explainable selection, not Bazel itself. Maintained targets and edges for prompts, generated assets, pins, spawned binaries and fixtures would be required before Bazel selection became sound. Native Bun selection plus explicit non-import rules is a smaller first step.

## Required checks: keep the workflow alive

GitHub documents three distinct outcomes. [12]

- Whole workflow skipped by paths, branch filters or a skip message: required checks remain Pending and block merging.
- Job skipped by an if condition: reports Success.
- Job depending on a failed job: may skip and fail to block merging. A required aggregator needs always() and explicit needed-job result checks.

Keep a stable required entrypoint for every PR; classify changes inside it and conditionally execute heavy work. With multiple jobs, distinguish intentionally unselected skips from planner failure, selected-job skips, failure and cancellation. Empty test selection should explain why it is safe, not mask a broken planner. One job with conditional steps can avoid extra runner startup for routine changes; split jobs when isolation/parallelism actually helps.

Merge queue needs merge_group: PR events do not cover it. Use that event's correct base/head rather than PR payload assumptions. [12]

Native path filters are not a dependency engine. GitHub examines at most 300 changed files; matches outside that slice may not trigger. More than 1,000 pushed commits or a diff timeout makes the workflow run. PR filtering uses three-dot diffs; ordinary pushes use two-dot diffs. A selector should obtain the complete changed-file set, fetch sufficient history, handle renames/deletions, and fail broad when its base is unavailable. [13]

## Risk tiers and full reconciliation

Proposed transfer, not externally established ownership for this repo:

| Change | Routine work | Broader work |
| --- | --- | --- |
| Known inert docs | classify and applicable cheap checks | no binary build needed |
| Narrow source/test edit | cheap format/lint/type checks; Bun related tests; declared process owners | no upstream web rebuild if complete inputs match |
| Prompts/assets/fixtures, nonliteral loading, PTY/process/shared lifecycle | related tests plus behavioral owners; compile if tests consume CLI | full group/fallback when uncertain |
| Locks/package/toolchain config, build or selector/workflow rules, core/shared infrastructure | conservative full lane | relevant OS/native and artifact lanes |
| Web pin/wrapper/patch/build inputs | rebuild/verify web and integration owners | browser and compiled embedding checks |
| Release | clean full checks and real target artifacts | nightly is not a substitute |

Microsoft's Test Impact Analysis states useful safety mechanisms: impacted, new and previously failing tests; full fallback for changes it cannot understand; configurable periodic full runs. It supports managed code/single-machine topology, **not Bun**, but those guardrails transfer. [14]

Use nightly or another explicit periodic full run to reconcile selection: all deterministic tests, actual CLI build/embedding, relevant PTY/native OS lanes, and web checks even if unselected. Periodically rebuild without artifact-cache reuse to catch stale/incomplete keys. Log selected/omitted groups and reasons. A failure missed by selection is evidence to widen ownership, not merely an unrelated nightly failure. Track infrastructure flakes separately. Run new tests immediately. Keep known failing tests selected until a confirmed pass if that state is affordable; do not build a database merely to imitate Azure.

Nightly catches drift but cannot make an unsafe skip safe before merge. Keep high-risk/unknown edits broad. Shadow-check the selector against representative historical changes before tightening the required gate.

## Real repos versus marketing

- **oven-sh/bun:** merged PR #29262 supplies implementation and real Git integration tests. Evidence for reverse-import selection, not evidence that die's process tests are covered or its CI takes under a minute. [2]
- **pantsbuild/pants:** maintainers document branch-protection traps and link an actual historical workflow and generator. The extracted workflow has 'Merge OK' with always(), checking actual success outputs from prerequisite jobs. Two identically named conditional success jobs were insufficient. This is operational evidence, not a speed benchmark; copy the invariant rather than all layers. [15]
- **nrwl/nx:** the 22.7 release account reports a real validate-links task reading undeclared generated index.html files. The task passed but its cache entry could be stale. File-I/O sandboxing exposed and fixed the bug. This is maintainer-reported concrete evidence for hidden-input risk, not an independent speed study. [16]
- **Tinder/bazel-diff:** real open-source graph-hashing/impact implementation. Its README's '100% accuracy' is the project's claim, conditional on the graph, not independent proof for dynamic Bun processes. [11]

No inspected source establishes cold complete die PR CI under 60 seconds. Nx/Turbo 'fast CI' advice and commercial '10x' stories describe mechanisms or sell products, not controlled measurements for this package. The credible path is omitting provably unrelated expensive work, accurately keyed web artifacts, and cheap checks. Measure warm/cold routine PRs separately from full/release lanes. Count end-to-end queue/startup/setup, not only test runtime; record cache hits, transfer/selector overhead, P50/P95 and missed failures.

## Sources

1. Bun 1.4 release notes: https://bun.sh/blog/bun-v1.4
2. Bun implementation and regression cases: https://github.com/oven-sh/bun/pull/29262
3. Vitest related/static import restriction: https://vitest.dev/guide/cli.html
4. Nx affected, base and lockfile policy: https://nx.dev/docs/features/ci-features/affected
5. Turbo affected reference: https://turborepo.dev/docs/reference/run
6. Turbo CI: https://turborepo.dev/docs/crafting-your-repository/constructing-ci
7. Turbo caching: https://turborepo.dev/docs/crafting-your-repository/caching
8. Turbo environment hashing: https://turborepo.dev/docs/crafting-your-repository/using-environment-variables
9. Bazel remote cache/known issues: https://bazel.build/remote/caching
10. Bazel reverse dependency query: https://bazel.build/query/guide
11. Tinder implementation: https://github.com/Tinder/bazel-diff
12. GitHub required checks: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks
13. GitHub diff/path limits: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
14. Azure TIA: https://learn.microsoft.com/en-us/azure/devops/pipelines/test/test-impact-analysis?view=azure-devops
15. Pants maintainer account: https://www.pantsbuild.org/blog/2022/10/10/skipping-github-actions-jobs-without-breaking-branch-protection ; actual workflow: https://github.com/pantsbuild/pants/blob/cbaf090219/.github/workflows/test.yaml

16. Nx cache input correctness: https://nx.dev/blog/nx-22-7-release
17. Nx cached data and cache security: https://nx.dev/docs/kb/cache-security
18. Nx cache inputs and outputs: https://nx.dev/docs/features/cache-task-results

Cache trust: a digest proves identity only within the trusted production of that artifact. Do not let untrusted PR runs publish outputs later consumed by protected release lanes. Nx recommends skipping cache for deployed artifacts to avoid poisoning; trusted provenance plus fresh release validation must be a deliberate policy, not an accidental shared cache. [17]

Extraction limits: an old GitHub required-checks URL returned 404; used the current URL above. Bun's current raw ChangedFilesFilter.zig URL returned 404, so implementation details rely on the merged PR/release notes, not claimed inspection of today's source. The initially attempted Nx cache-task-results URL returned 404; the working /docs/features/cache-task-results path was then extracted.
