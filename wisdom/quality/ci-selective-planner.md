# Selective CI planner / source feedback runner

Implemented 2026-09-30. Branch: die/implement-selective-sub-minute-ci-planne-55cde1b4.
Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_55cde1b4.
No workflow changes, dependency installation, push, dispatch, release or publication.

## Integration interface

Always create the fast-feedback job: **no workflow-level path filters**. Checkout the candidate, fetch comparison commits and provision pinned Bun 1.4.2 before planning. Planning/docs checks need no dependency installation.

~~~sh
# Run from repository root. Use event/trusted validation SHAs, not guessed refs.
bun scripts/ci-selective.ts --base "$BASE_SHA" --head "$CANDIDATE_SHA"
# Writes artifacts/ci/selection.json and selection-summary.md.
# Appends mode/full to GITHUB_OUTPUT and explanation to GITHUB_STEP_SUMMARY.
# Planner exit 0 means decision exists, NOT validation succeeded.

# mode=docs or selected, clean tracked checkout at the planned head:
bun scripts/ci-selective.ts --base "$BASE_SHA" --head "$CANDIDATE_SHA" --run
# Recomputes plan, never trusts saved JSON. Fails on full plan (exit 3).
# selected: frozen install -> prepare assets -> affected TS format/lint -> whole
# repository typecheck -> selector regressions -> selected source tests.
# docs: selector regression/consumer-contract tests; no install/build/typecheck.

# mode=full: existing fully provisioned producer, not a successful skip:
bash scripts/ci.sh linux
# Keep independent applicable macOS/native/platform validation:
bash scripts/ci.sh macos
~~~

Commands are argv arrays, never shell-expanded filenames. Biome comes from locked local node_modules, not a downloading bunx invocation. Affected TS uses the repository config. Markdown is excluded by the current formatter; docs mode does not pretend it was formatted. Whole repository check prepares assets and runs tsc --noEmit including integrations/scripts/tests; not a weakened custom typecheck. DIE_RUN_LLM_TESTS=0 is explicit. Runner has an isolated TMPDIR. DIE_PROBE_EXECUTABLE is forced to tests/fixtures/live-execute-cli.sh even if dist exists: the real wrapper execs Bun on current src/cli.ts, never a mock or stale compiled binary.

PR: BASE_SHA = current pull_request.base.sha; CANDIDATE_SHA = github.sha for the usual **checked-out merge candidate**. This tests the integrated tree and uses both trees' inputs. Alternatively explicitly use fetched merge-base and PR head, understanding that this checks a head tree, not the eventual merged artifact. No silent origin/develop or HEAD^ substitute. Missing/zero/unavailable history/base/head falls back full; a fetch failure cannot become a green skip. Comparison is base..head, not a lossy head-only list.

Develop: use the last trusted successful validation SHA for this lane (or last full producer SHA for strongest cumulative policy) and github.sha. Do not blindly use event.before across failed/cancelled runs: it can forget still-unvalidated inputs. No trustworthy base means full. Selected feedback does **not** mint full-validation/release proof.

Final policy gate must require classifier success AND either selected runner success (docs/selected) OR provisioned full producer success (full). Unknown mode, missing job, unexpected skip, failure/cancellation must fail. A planner-only step cannot satisfy a required check. Keep distinct fast-feedback and full/release check names, exact-SHA provenance and explanations. Selected execution is sequential in one job, avoiding skipped-subjob bookkeeping. Full execution belongs to the existing full producer; runner refuses to silently call it on an unprovisioned fast runner.

Schedule trusted full Linux plus applicable macOS/native/platform sweeps nightly and preserve a manual full entry point. Upload plan/summary/timings even on failure. Compare selected/full results during rollout. Preserve the **union** of CI and Release backend/model/contracts/projection/terminal checks. Keep complete release validation separate: fresh compiled CLI/offline transport/standalone smoke, final web/browser boot+reload, native/platform tests, old-updater compatibility, checksums/notices/provenance and exact prepared-SHA publication guards. Nightly is a detection backstop, not proof of a release artifact. Requiring a separate full premerge gate is an explicit parent policy choice; doing so for every executable edit does not promise all required checks under 60s.

## Explicit audited boundaries

Only A/M regular 100644 inputs qualify. Rename/copy/delete/type/mode/status changes fall back, even between fast classes. NUL name-status diff with no rename inference records source moved into docs as an old deletion. Both base/head modes and leaf runtime imports are inspected. Git failures, malformed/empty diffs go full. Unknown inputs always override the union.

Docs: root README.md, or one lower-case Markdown filename directly under wisdom/{ci,quality,live,remote-workspaces,dependencies,configuration}/. These are human references. Audit searched runtime/build/generator inputs: runtime wisdom is src/prompts/wisdom.md imported as text by src/wisdom/extension.ts, not these reference directories. Release notes are support/release-vVERSION.md (scripts/select-release-notes.ts), not these directories. Dependency/configuration references were explicitly added after that audit. No blanket *.md or wisdom/** rule. Values, changelog/release notes, embedded prompts, nested dependency/workflow fixtures, integrations docs and unknown docs remain full. Future build/runtime reads of reference docs require re-audit.

Sources: exactly src/remote/human-rendering.ts and src/live/waveform.ts. Test-change allowlist: exactly tests/remote-human-rendering.test.ts and tests/live-waveform.test.ts. Integration-test edits themselves remain full because their contracts/IO reach more systems. Either leaf or its direct unit-test edit selects its entire class. Modified direct unit tests are inspected at base and head for runtime imports beyond bun:test and the leaf; new IO/global APIs fall back. Leaf runtime imports use Bun.Transpiler. Computed/opaque dynamic import (including comment-separated syntax) is rejected at both revisions. Known global IO tokens also fall back; this conservative guard is not a security sandbox against malicious JavaScript. No general transitive-graph infrastructure.

Remote dependency/source-contract audit:
- Leaf has no runtime imports. RemoteTask/RemoteState from client are type-only and covered by whole typecheck.
- Runtime importer: src/remote/extension.ts. Direct test importers: remote-human-rendering and remote-extension (including a dynamic import).
- Class runs remote-human-rendering, remote-extension, remote-session-switch and live-spoken-tui: control-character escaping, task/attention rendering, actual registered extension behavior and late-refresh/session ownership races.

Waveform dependency/source-contract audit:
- Leaf has no imports; local Buffer PCM operations and scheduler state.
- Source importer: src/live/extension.ts. Direct test importers: live-waveform and footer.
- Class runs live-waveform, footer, live-extension, live-host-access, live-notice, live-main-integration, live-picker-tui, live-gpt-tui and live-spoken-tui. The latter two execute current-source fixtures in real PTYs with prepared theme assets; main integration is forced through the real source CLI wrapper. Extension tests exercise offline capture/queued/playback/footer behavior; source-contract/host/owner boundaries are included.
- gpt-live-waveform tests resampler/playback, not the waveform leaf; live-speaker-check uses the English word waveform but is correlation logic, not a leaf consumer. No keyword-based false mapping.

Broader CLI/session/task/web/native tests are **not** exhaustively equivalent to these classes. This is affected source feedback/direct-consumer contracts, not complete acceptance/artifact validation. Selector regressions snapshot exact leaf runtime importers and pure imports. New source consumers require audit; adding a source consumer is unknown and goes full. Shared extension/host/client/footer edits, assets, locks, package/tool/compiler/formatter configs, selectors, build scripts, workflows, fixtures and every unknown path go full.

## Proof and measurement

Selector tests cover mixed unions/unknown override; missing base/head/zero/empty diff; base+head import/contract drift; status/mode/rename-to-doc/delete/symlinks; actual Git filenames with spaces/tabs/newlines/Unicode/leading dash; malformed NUL records; Markdown fixtures/prompts; escaped summary; missing selected tests; dirty/wrong checkout; failed-command short circuit; forbidden CI install bypass; and no selective success on full. Mutation trials run real leaf unit tests on deliberately broken current source in temporary Git repositories, demonstrating regression failures without dist or installed dependencies.

Fresh no-dist local Linux measurements regenerate runtime-assets per class, run Bun 1.4.2, use preexisting root dependencies via a parent-checkout symlink, and execute affected format/lint, whole typecheck, selector tests and selected source tests. **No install authorized/performed**: frozen install, download/cold-cache and hosted bootstrap/queue costs excluded. CI runner does install frozen dependencies. --prepared-deps exists only for local measurement and is forbidden when CI is set. Hosted p95 is unknown: no under-60s hosted guarantee. Final measured table follows after validation.

Sources: parent wisdom/quality/ci-selective-design-research.md, ci-speed-timing-audit.md and ci-selective-external-research.md (Bun/Nx/Turbo/Bazel/cache/required-check research). Values unchanged: existing runtime-proof, keep-checks, simplicity, honest-scope and reproducible-evidence values already cover this work.

## Review follow-up and remaining scope

Independent early review found a computed-import hole; literal import scanning alone was insufficient. It is now rejected and tested at base/head, including comments separating import and its argument. Real merge-candidate and unresolved-conflict regressions were added; runner head/dirty/failure/install-bypass contracts are covered. The original “all class consumers” wording was corrected: these are enumerated direct-consumer/source-contract checks, not all affected CLI/end-to-end tests.

Both classes additionally run **only the source CLI variants** of pi-host via:
~~~sh
bun test ./tests/pi-host.test.ts --test-name-pattern '^source CLI'
~~~
Compiled variants remain full-producer-owned, not run against stale dist. live-spoken-tui runs the actual source CLI; both classes select it. The broader pi-host suite and other complete CLI/session/web/native acceptance remain omitted and explained. The planner does not enforce parent premerge policy itself; if using selective-only routine validation, accept this remaining coverage risk explicitly and retain scheduled/full release gates.

Early historical review found only 5 eligible changes among the last 100 non-merge commits before docs expansion. That is **not routine CI <60s coverage**. Expanded docs improve eligibility, but no new hit-rate or hosted p95 promise is claimed. Parent owns broader test-only/source/artifact expansion after integration. Bun --changed discovery can support future audits but does not replace subprocess/fixture/embedded-input ownership.

## Local measured results (final expanded classes)

| Class | All class commands, excluding install |
| --- | ---: |
| remote | 8.318s |
| waveform | 21.994s |
| union | 23.039s |

25 final selector tests pass, including two real mutation trials (timing capture used 24; the final added non-full/wrong-checkout regression does not change class commands). Format/lint and whole typecheck pass. Each source class also passes its listed tests and the two source-only pi-host CLI contracts (compiled variants intentionally excluded). Per-command argv, elapsed times and statuses are preserved in [ci-selective-local-timings.json](ci-selective-local-timings.json). The latest local class times include the review-added spoken-source CLI and source-only pi-host boundaries, superseding the initial 3s/17s figures. No hosted p95 or complete release proof exists.

Stale-dist adversarial source probe: temporarily created an owned dist/die sentinel executable that writes a marker then exits 91. With DIE_PROBE_EXECUTABLE forced to the real source wrapper, all 20 live-main-integration tests (199 assertions) passed in 4.22s; sentinel marker was never created. Sentinel directory was removed afterward. This demonstrates the selected source-wrapper contract even when a stale binary exists, not compiled artifact validation.

Reproduce class-command measurements locally (preinstalled dependencies only, no CI): ensure dist is absent and remove only generated runtime-assets before each class. The measurement invoked exported select() for synthetic M changes to either/both leaf paths, skipped only the frozen-install argv, then ran the emitted command arrays sequentially using node:child_process spawnSync with DIE_RUN_LLM_TESTS=0 and absolute DIE_PROBE_EXECUTABLE pointing to tests/fixtures/live-execute-cli.sh. Use the preserved JSON argv/timings as the exact recipe; these are class-command execution timings, excluding planner/ref checkout overhead. To reproduce the actual runner rather than synthetic measurement, use a clean temporary Git worktree with a committed comment-only change to the leaf and:
~~~sh
bun scripts/ci-selective.ts --base <parent-commit> --head HEAD --run --prepared-deps
~~~
That flag intentionally refuses CI; hosted use must execute the frozen install. Existing local mise configuration was untrusted and bun absent from PATH, so measurements used the already-installed absolute Bun 1.4.2 executable and prepended its directory to PATH; no trust or installation changes were made.
