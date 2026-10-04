# tests2 followup3 — read-only code reduction audit

## Completion and method

**Complete for this assignment: 9/9 ranges, 3,838/3,838 lines examined.** Every assigned line, including prefixes previously seen by another reviewer, was reread in numbered bounded chunks. Indentation was trimmed for display, not changed on disk. An oversized manual-shake display was reread as 695–769 and 770–790; no coverage relies on its clipped preview. Reference searches and loading bytes to calculate chunks do not count as line review. This is not a sign-off for other ranges in the original partial audit.

Read wisdom/values.md first and consulted the original tests2-report.md's findings, particularly tests2-02. That earlier finding concerns manual-shake-sdk/auto-shake-sdk, not this file's command harness: the savings below do not overlap it. No builds, tests, provider calls, audio, or paid/live experiments ran. Only this report and its ledger were written. Existing unrelated untracked wisdom was left alone. Wisdom/values stayed unchanged: this is a scoped code audit, not a new lesson or permission to edit prose.

Savings count nonblank code lines in examined assigned ranges, excluding standalone comments/documentation. New code is deducted, even if outside the assignment. Estimates are proposals, not measured patches. **Recommended gross 52, net approximately 43 code lines** (F01–F03). Optional F04 adds 170 gross/net, only after an explicit evidence-feature cut decision. No production savings are counted.

## Consumer tracing

These are executable tests, not unused modules inferred from missing imports. package.json:15 discovers ./tests after a build; scripts/ci.sh:57 runs the complete root suite with BRUV_RUN_LLM_TESTS=0; .github/workflows/release.yml:166–167 likewise disables paid cases and runs ./tests. scripts/ci.sh:33 also discovers live-*.test.ts. tsconfig.json includes tests, source, scripts, and integrations. scripts/build.ts:46 bundles src/cli.ts; cli.ts:206 dynamically installs the disk-backed session manager and :218/:278 dynamically loads/registers the Live extension. No build was executed.

Production links: src/agent/extension.ts:109/:114/:249 registers diagnostics, countdown, and manual shake; src/typescript/extension.ts:76/:89 supplies execute call/result renderers; src/tasks/job-service.ts:200 constructs T3NativeTaskAdapter/T3McpClient; src/history/session-manager.ts:21/:110/:184 adopts/opens DiskEntryStore; src/live/extension.ts:7/:478 constructs GPTLiveSession. Thus none of those suites is called dead.

The older orchestration surface has real non-runtime consumers: scripts/probe-openai-realtime-setup.ts:6 and tests/openai-session-schema.test.ts:4, live-openai-provider.acceptance.test.ts:4, live-provider.acceptance.test.ts:4, live-prompt.test.ts:2 import orchestrationTools. The assigned test imports createOrchestration/boundedHostContext at :2. Active Live owns MainOwner orchestration (src/live/extension.ts:17/:380), but that difference alone is not proof the old contract can be dropped. No unused-code claim is made for it.

## Findings

### F01 — One command harness in manual-shake.test.ts

**High confidence; behavior-preserving fixture consolidation. Gross 16, estimated net 16.**

- Evidence: tests/manual-shake.test.ts:331–353 already owns handlers, command capture, custom-entry append, notifications, context, and invalidations. :487–502 repeats that wiring as shakeHarness solely for :601/:607/:613/:630/:636/:657.
- Change: move the existing harness to file scope and replace those shakeHarness calls with it; remove :487–502. Hoisting adds no code lines. The existing harness defaults to idle=true, pending=false, matching the repeated harness.
- Counterevidence: not all similarly shaped fixtures are duplicates. :504–539 injects an append that mutates then throws; :542–595 exercises fail-closed carry-forward/session reset; :681–707 drives before-compaction rather than the command. Keep those distinct seams. The original SDK-helper finding does not replace this command fixture.
- Behavior lost: none intended. The shared harness records notices/invalidations even where a case does not assert them. Preserve all diagnostic privacy/outcome assertions at :597–667 and all atomic rollback/abort checks.
- Checks needed: offline manual-shake.test.ts; compare case/assertion counts; verify command capture is specifically the shake command and session hooks still see the same manager.

### F02 — Delete two duplicate preview cases after retaining the path fixture

**High confidence on overlap; gross 14, estimated net 14.**

- Evidence: tests/execution-previews.test.ts:64–70 only asserts one composed call/result row after shared state settles. :535–548 does the same with exact row equality for absent/present source and label plus vocabulary/source suppression. Remove :64–70 (7 code lines).
- :420–426 repeats collapsed success hiding truncation with a separate fixture. Retain stdoutPath/stderrPath in the richer result at :391–408 (add those fields to the existing details line :394), then remove :420–426 (7 code lines). The richer case checks exact action text, hidden source, image representation and background counts. Do not simply drop the distinct path inputs.
- Counterevidence: keep :22–25's no-shared-state default construction, :27–62's handoff composition, :85–118's registered-tool wiring, :277–294/:558–572's aggregate boundary cases, and :453–477's artifact-save warning. Shared-state and standalone renderer modes are not automatically interchangeable. Likewise local attention hiding and actionable SSH attention (:495–533) differ.
- Behavior lost: two test names; no asserted product behavior if fields are retained. This does not remove legacy/unknown outcome support, cancellation/timeout distinctions or control sanitization (:246–263/:382–389).
- Checks needed: offline execution-previews.test.ts; retain the existing TUI preview check when implementing. Verify exact default/composed rows and all narrow-width risk markers remain.

### F03 — Reuse the existing isolated subprocess runner for disk I/O faults

**High confidence on duplicated mechanism; gross 22, estimated net 13.**

- Evidence: tests/history-storage-io.test.ts:143–153 and :225–235 each spawn Bun, pipe both streams, and await exit concurrently. tests/helpers.ts:10–26 already does exactly this and returns stdout/stderr/code; many CLI/TUI tests import it. Replace each 11-line block with a four-line run(...) call and add one import (9 replacement lines). Keep :154/:236 failure messages, updating exitCode to code.
- Counterevidence: the generated scripts :108–141 and :199–223 are not duplicate scenarios. They mock different fs exports and must remain in **separate child processes**, not be moved into a shared-process mock. :102–155 protects short writes and rollback; :193–237 protects successful publication despite spool cleanup failure.
- Behavior lost: none intended for these filesystem-only children. The helper additionally strips HERDR socket/pane context via offlineTestEnv(:1–8); explicit fault-path environment variables and cwd must still be passed. This is deliberate isolation, not permission to strip required test configuration.
- Checks needed: offline history-storage-io.test.ts both alone and in the root suite; assert both child scripts really run, retain captured stderr on failure, and verify no node:fs mock leaks into other tests. No new subprocess framework or runner owner is needed.

### F04 — Optional cut: retire the synthetic warm-cache/cold-baseline experiment

**Explicit evidence-feature cut, not dead code. High confidence about lost behavior; medium confidence that retirement is desirable. Gross/net 170 code lines, no replacement.**

- Target: tests/cache-affine-compaction-live.test.ts:1–173 (173 physical lines less two standalone comments and one blank). The test is opt-in at :18, dynamically registers the Phase 1 fixture at :83–93, makes real requests at :123–134/:146/:150–159, and writes success/failure evidence at :162–169.
- Consumer/counterevidence: ordinary root discovery includes it but CI skips it; it can be explicitly enabled using BRUV_RUN_LLM_TESTS=1. tests/phase1-compaction-fixture.ts registers the actual execute/affine extension, not a fake function. Companion references in cache-affine-compaction-sdk.test.ts and current-pipeline-live.test.ts do not prove real warm-cache performance. The latter's :163/:182 exercise fresh and uncaptured compaction, with strategy/summary assertions :169–170/:188–189, not this warm-cache/cold comparison.
- Decision: only delete if the owner intentionally no longer wants the synthetic cache-hit/performance experiment. Do not present it as covered by offline SDK fixtures. Keep the shared Phase 1 fixture and companion suites, which have other consumers.
- Behavior lost: asserted real cacheRead>0 (:144), archive-marker retention and tail exclusion (:142–143), resumed exact answer (:146–147), and default compact baseline timing/result evidence (:148–160), including error artifacts. Production compaction behavior is unchanged, but regression evidence is reduced.
- Checks needed before accepting cut: owner confirms this evidence is no longer required; inspect CI/manual invocation references again and remove only this test. No paid run is needed merely to remove an explicitly unwanted experiment. If its evidence is required, keep all 170 code lines; zero savings.

## Whole-file dispositions and counterevidence

| Assigned range | Verdict / evidence |
|---|---|
| manual-shake.test.ts:1–790 | F01 only. Keep transformed/ambiguous protocol grouping (:114–179), malformed marker refusal (:219–251/:387–397), JSONL/branch/SDK durability (:254–327), async state/model fences (:399–467), atomic append/carry failure (:504–595), and automatic compaction ownership (:718–789). |
| t3/production-bridge.test.ts:1–705 | Keep. Authorization/no local fallback (:23–67), allowlist/request identity (:219–226), reflected error redaction (:228–255), matching SSE cancellation (:275–311/:519–561), reader settlement-before-DELETE (:313–454), shared initialization/reconnect ownership (:486–609), stable mutation replay and no retry on caller abort/auth (:626–705) are different boundaries. Similar handshake boilerplate is not enough benefit to introduce a configurable transport framework. |
| execution-previews.test.ts:1–572 | F02 only; keep security, failure, unknown, cancellation, bounded aggregate and save-warning cases described above. |
| diagnostics.test.ts:1–421 | Keep. Privacy/schema (:34–80/:407–421), finite ring/durable budgets and stale recorders (:82–164), active-leaf restoration failure (:223–289), and actual SDK runtime/reload context transparency (:291–405). Real SDK proof is not replaced by the fake manager cases. |
| gpt-live-session.test.ts:1–353 | Keep. Injected socket makes this offline. Actual transport handshake shape/resampling (:44–80), provisional correction/delegation pairing (:82–142), bounded queues and honest final usage (:144–194/:242–261/:292–303), stale callbacks (:210–240), typed acknowledgment/capacity ownership (:305–353). No live provider was contacted. |
| cache-countdown.test.ts:1–309 | Keep. Restore/shake invalidation (:44–72), separate settings file/corruption preservation (:82–128/:253–280), request-model versus selected-model and overlap correlation (:129–230), nonfatal telemetry/privacy and append rollback (:232–252/:281–308). Repeated event registration is modest fixture duplication, not grounds to remove those cases. |
| history-storage-io.test.ts:1–279 | F03 only. Keep visitor error propagation (:64–74), Unicode/CRLF/tail repair (:76–100), collision rollback/cache atomicity (:156–191), failed replacement recovery (:239–253), duplicate physical records (:255–266), bounded serialized-buffer cache (:267–278). |
| live-orchestration.test.ts:1–236 | Keep pending broader contract decision, not called unused. Prevents tool output becoming instruction authority (:81–112), latest/single-use/expiry (:114–141), ambiguous-send replay (:143–168), cross-turn/request tombstones (:170–206), and non-evicting capacity (:208–236). Do not weaken these authority/cancellation checks to simplify setup. |
| cache-affine-compaction-live.test.ts:1–173 | Keep by default; F04 is optional retirement of intentionally paid experiment evidence, not a claim of redundant provider coverage. |

## Validation status

Static reading/reference tracing only. No recommendation was implemented or executed. Suggested future focused checks are offline for F01–F03; set BRUV_RUN_LLM_TESTS=0 and do not use package.json's test command just for this refactor because it also builds. Follow the normal owner-controlled validation gate when implementing. No unread code, production code, comments or prose is included in proposed savings.
