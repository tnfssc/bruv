# Live maintenance-reduction audit

## Overview

Read **all 7,754 lines in all 47 assigned files**, in bounded numbered chunks; re-read portions of oversized outputs rather than treating truncated previews as review. Scope: live-manifest.json. Research only: no production, test, configuration, wisdom, build output or commit changes. Read values.md and relevant Live promotion/architecture/audio-cap context. No documentation/wisdom deletion is counted.

Best opportunities are a retired companion architecture retained by tests/diagnostic scripts, an orphan transcript grouper, and model-switch memories that no longer drive the UI. Native audio, cancellation, history and provider protocols mostly earn their complexity. Gross means old lines removed; net subtracts replacement lines. Estimates are planning ranges, not generated diffs. Findings are disjoint unless explicitly described otherwise; external test savings are counted only where the exact relevant lines were read.

## Ranked actionable findings

### live-01 — Retire companion orchestration, not its security boundaries
**Class:** behavior-preserving for the shipped CLI, with explicit diagnostic/test migration; **confidence:** high about CLI reachability, medium about final patch size. **Gross:** ~300–360 owned lines; **net:** ~260–310 owned lines, ~225–290 after an estimated 20–45 lines of caller/fixture replacement. No outside test-file deletion savings included.

- Old six-tool schema/factory: src/live/orchestration.ts:1–125. createOrchestration and boundedHostContext have no production callers; tests/live-orchestration.test.ts:2,31,75 exercise them. The CLI instead loads src/live/extension.ts at src/cli.ts:218; defaults reject missing directMainAgent/instructions at extension.ts:70–78. MainOwner exposes the ordinary execute-only declaration at main-owner.ts:613–621, not agent_send/agent_steer/job_cancel.
- Companion context buffering survives in session.ts:24–25,44–46,237–264,270–272 and openai-session.ts:19,180–183,418–429,440–457,465–467. Current callers always take the direct context path (session.ts:219–235; openai-session.ts:400–416). Remove the alternate coalescer/state, not direct context limits and data labeling.
- Retired handoff authority/transport timer branches: session.ts:369,377,387–389,411 and openai-session.ts:581,590–591,607,624–634,685–689. Narrow types.ts:53–65 and generic failure mapping in tool-failure.ts:1–11 accordingly. Remove only authority plumbing that cannot occur with execute; retain response revisions/cancelled states used for audio and continuation, identified call ledgers, bounded calls, and ordinary host admission.
- **Counterevidence:** orchestrationTools is used by scripts/probe-openai-realtime-setup.ts:6,59; tests/live-provider.acceptance.test.ts:4,14–18; tests/live-openai-provider.acceptance.test.ts:4,15–18; tests/openai-session-schema.test.ts:104–108,125–138; tests/live-prompt.test.ts:2,16–19. These are real script/paid-test entrypoints, not proof the module can simply disappear. Migrate setup probes/schema assertions to the actual execute-only declaration and supplied root instructions. Keep provider setup coverage, denial stubs and explicit paid gates. Do not leave an old schema in a new test fixture just to preserve outdated expectations.
- **Behavior lost:** internal companion API and diagnostics of that obsolete six-tool setup. No current /live task behavior should be lost. If someone intentionally relies on the developer probe's old schema, this is a deliberate supported-probe contract change, not a safe blind deletion.
- **Checks:** fake-socket full/mini schema tests; Gemini setup config; current-main integration and tool denial/hook/result pairing; context observations; interruption before/after admission; async completion after voice stop; compiled loopback/default transport. Re-run paid setup only with later human approval.

### live-02 — Delete the orphan timestamp transcript grouper
**Class:** safe removal; **confidence:** high. **Gross/net:** 51 owned lines, or **101 total** including the one import and tests/live-transcript.test.ts:73–121 (49 lines).

src/live/transcript.ts:1–51 is referenced only by tests/live-transcript.test.ts:2,76,101,116, including a hidden-file repository reference search excluding generated/dependency trees. There is no CLI/dynamic-loader/build use. Live actually imports TranscriptLog from src/session/transcript at extension.ts:23, constructs it at :143 and receives GPT deltas directly at :491,:506. Their passive canonical history is written separately at :482–505. The timing grouper's timer, suppressed status and timestamp rules never affect this path.

**Counterevidence:** its three tests cover genuine grouping behaviors, but only an uninstalled class. Delete those tests, **not** the entire mixed transcript test file: retain its shared TranscriptLog tests at :5–71 and :123–131. No equivalent grouping coverage needs to be invented for an absent feature. **Behavior lost:** unused internal utility only; current rendered transcript/history unchanged. **Checks:** focused transcript and fake GPT extension tests; compare visible interleaved and provisional transcript behavior. External private imports cannot be ruled out, but package.json is private and exposes the CLI bin, not a supported module export.

### live-03 — Remove remembered provider models that nobody reads
**Class:** dead state/internal API removal; **confidence:** high for current product. **Gross:** ~35–37 owned lines; **net:** ~32–35.

providers.ts:23–37 modelForProvider is called only in tests/live-config.test.ts:6,15,24–27,37–38,50–52. /live provider now configures credentials without changing the selected model (extension.ts:723–759); /live model lists all providers together and derives the provider from the chosen model (:766–817). The googleModel/openaiModel values are merely stored/validated at config.ts:10–11,18,21–22,26–27 and rewritten at extension.ts:821–832. Neither affects a production read/selection decision. Keep only provider/model; remove the switch helper and twelve-line memory update.

**Counterevidence:** tests deliberately assert remembered fields (live-extension.test.ts:1124–1155; live-config.test.ts:9–66). Rewrite only those assertions; retain cross-provider selection, reload, invalid active model and failed atomic-save coverage. Existing JSON files contain extra fields. Accepting/ignoring obsolete memories on load is simple, but is a deliberate validation change for invalid unused extras; never default an invalid active provider/model. **Behavior lost:** serialized unused memories/internal test API, no selectable model or credential flow. **Checks:** selection/reload, credentials-only provider command, cancelled picker, bad active model, unsuccessful save retaining old selection. No outside test savings claimed.

### live-04 — One implementation of paired coding-turn execution
**Class:** behavior-preserving refactor; **confidence:** medium-high. **Gross:** ~85–100 replaced lines; **net:** ~25–40.

main-owner.ts:441–478 and :507–544 separately serialize onto delegatedTail, fence backendEpoch/branch, set backendRunning, clear _runSystemPromptOptions, runDelegatedMainTurn, capture new assistant text, report it, and decrement inFlight/checkRelease. Assistant reply extraction alone is identical at :464–470 and :529–535. Use a private common queued-turn runner with an operation closure; keep the user prompt/provenance and custom-message payload in their existing callers.

**Counterevidence:** different semantics matter: delegated ID/signature ledger and synchronous onAdmitted (:429–440,:479–482), notification dedup (:494–505), errors (delegation rejects; notification catches), and revoked admission (throw versus return). Do not replace both with a generic fire-and-forget request API or merge their ledgers. Preserve inFlight reservation **before** queueing and voice-stop preserving admitted work. **Behavior lost:** none intended. **Checks:** paired typed/delegated request ordering, duplicate ID/different payload, notification dedup, explicit stop-work of queued continuations, completion/error after voice close, branch navigation, last operation releasing ownership.

### live-05 — Remove write-only audio/presentation bookkeeping
**Class:** safe removal; **confidence:** high. **Gross:** ~9–11 old lines; **net:** ~6–8.

- audio.ts:50,125,129–131 maintains a capped stderrBytes count that is never read, exposed or logged. Replace the data handler with a discard callback; **keep draining stderr** (:150,:469), otherwise the native pipe can block. No need for a counter or MAX_STDERR when no bytes are retained.
- audio.ts:82 and :502: safeMessage ignores its parameter and is only called with undefined. Inline the same controlled literal; do not start forwarding native text.
- extension.ts:153,:216,:295: lines is created empty, read and cleared, never appended anywhere. Render TranscriptLog.view(clean) directly and delete the empty array. Keep the viewport cap and sanitization.
- audio.ts:359–365: after asserting gen equals currentGeneration, the :364 assignment reassigns that same value; flush already owns generation changes at :373.

**Counterevidence:** stderr draining and generation *validation* are useful, only accounting/redundant assignment is dead. **Behavior lost:** none. **Checks:** fake worker stderr flood/closure, stale-generation rejection and flush, unchanged transcript widget.

### live-06 — Remove native no-op aliases/callback registrations
**Class:** safe internal removal; **confidence:** high. **Gross/net:** **9 owned lines**.

AudioCore.c:22–24 ll_play_push simply calls ll_play_push_batch; header AudioCore.h:11 declares the alias. Swift uses batch directly (main.swift:306); remaining alias callers are core self-test (:114–117) and test-core.c:44–45. Rename those calls to batch; delete the wrapper/declaration (4 lines). Build script scripts/build-live-helper.sh:10–11 links a C object into the helper, not a supported shared-library API.

Linux main.cpp:83–84 callbacks do nothing; registrations at :138,:149–150 cannot affect the polling state machine at :253–295. Delete both functions and the three registrations (5 lines). **Counterevidence:** callbacks are registered, so this is not import-based deadness; their bodies are visibly empty, and readiness/failure are polled. **Behavior lost:** internal alias and empty notifications only. **Checks:** device-free C core/self-test compile, Swift helper compile, Linux compile and isolated protocol/source-removal checks. No current hardware/provider execution performed for this audit.

### live-07 — Fold the standalone waveform regression into the native CI executable
**Class:** coverage-preserving test refactor, optional; **confidence:** medium. **Gross:** 21 owned lines; **net:** ~0–7 after transplant and build-link changes. Do not count 21 as a free deletion.

native/live/test-waveform.c:7–20 verifies one second of 437 Hz PCM split into 20 ms packets equals contiguous output. test-core.c:4–35,74–94 checks short ramps, several render rates, packet/fractional seams and flush. These overlap but are **not** identical stimuli. Move the long sine assertion into a test-core function rather than deleting it as redundant. Core already runs in .github/workflows/live.yml:25–28 and release.yml:65; add math linkage where needed.

**Counterevidence:** the standalone file is intentionally manually runnable; wisdom/live/gpt-live-crackling-investigation.md:37–41 supplies its build command and recorded mismatch baseline. No automated import does not make it unused. Preserve the assertion and, if useful, mismatch metrics; this saves little but brings a currently manual regression into CI. **Behavior lost:** standalone executable/old manual invocation if merged, not coverage. **Checks:** baseline packet-seam failure still reproduced, current implementation passes, sanitizer C test at all existing rates.

## Feature cuts requiring human choice

### live-08 — Drop only the opt-in speaker-correlation diagnostic
**Confidence:** high about scope, medium about patch size. **Gross:** ~416–435 owned lines; **net:** ~400–425. Not part of safe-removal totals.

Delete speaker-check.ts:1–299, speaker-summary.ts:1–61 and the command/dependency machinery in extension.ts:36–37,58–62,909–951; remove speakerProbe state, busy/status/stop/navigation mentions (:102,:674,:714–715,:914,:933,:953–954,:1042,:1051) and command labels/completion. Retain mic-check (:846–908), static errors, native self-tests and platform controls.

**Behavior lost:** local low-amplitude probe, correlation/polarity/lag/RMS summaries, opt-in route comparison. **Counterevidence:** real dynamic imports exist at :59–60; this is not dead code. It is useful acoustic triage and explicitly does not certify AEC/barge-in (speaker-check.ts:1,11–14; summary.ts:59). Cuts remove tests specific to this feature only after separate ownership review; no external test deletion savings counted. **Checks:** command help/completion/unknown command, start/stop/navigation and mic-check remain functional; no latent abort/busy flag.

### live-09 — Replace animated PCM footer with plain lifecycle text
**Confidence:** high about scope, medium about estimate. **Gross:** ~80–100 owned lines; **net:** ~75–95, disjoint from speaker-check and live-05.

waveform.ts:1–65 plus extension.ts:22,141–142,159,211,261,291–293,390,410,625–626 and stop's waveform reset. Remove only meter calculation/tick timer/calls; keep status updates, throttled render, transcript widget, speaking/thinking/listening and bounded playback. **Behavior lost:** PCM-driven braille activity visualization and periodic animation refresh. **Counterevidence:** this is active user feedback; without the tick timer provider/queue callbacks must still redraw every meaningful lifecycle transition. GPT uses its own playback recovery and already differs from the direct provider's meter. **Checks:** real narrow/wide TUI idle/speaking/thinking/interrupt/stop, no stalled status after last packet; no audio pacing or capture changes.

No combined feature-cut total is presented; implementation could change which extension cleanup lines survive. Dropping a provider dialect/GPT delegation would save more, but loses a substantial supported workflow, not a small optional feature.

## Keep rationale and essential boundaries

- **Permissions/privacy:** credentials.ts:29–50 refuses links/nonregular or incorrectly owned/permitted import files; :126–151 guards against replacing existing OAuth/key under the storage lock. status.ts:1–11 and audio.ts:165–177 keep device capture local/interactive and helper environment allowlisted (:63–78), not a credential-bearing child environment. setup.ts is an actively offered explicit import, not an automatic fallback. Keep these even if future onboarding changes.
- **No quiet data loss:** audio.ts framing/base64/int32/queue bounds and helper reap/abort ownership; AudioCore.c atomic all-or-nothing admission, generation epochs and capture overflow accounting; Swift realtime callbacks cannot allocate/emit JSON; Linux :31–50 terminates after partial/backpressured output. Keep source-removal and saturation tests. Linux render flush (:176–193) is not duplicate dead code of pump flush (:296–307): a command thread can set flushPending between them.
- **History/tool authority:** main-owner.ts tool validation/hooks/paired history, branch fences, ordinary-turn exclusion and released ownership are essential. lifecycle-access.ts is used by agent integration; voice stop preserves jobs while explicit stop-work remains separate. passive-history.ts:5–38 is genuinely historical compatibility, but deleting it would feed old synthetic delegation context back as user prose or lose uncertainty/omission handling. Retain it unless historical sessions are explicitly retired/migrated. tool-result.ts preserves full oversized/image results, not only a misleading preview.
- **Protocol differences:** Gemini SDK setup/lifetime, GA Realtime completed ASR/response IDs/truncate, and GPT-Live continuous fragments/client delegation/observed session.closed are different contracts. GPT playback's heuristic is not a second authoritative VAD; resampler state is required at chunk boundaries. Do not create a common mega-transport just to hide those distinctions.
- **Real non-import entrypoints:** embedded.ts is replaced by scripts/live-helper-bundle.ts:23–30; Info.plist is linked by build-live-helper.sh:11; self-test.ts runs via cli.ts:32–36, install-local.sh:35 and release.yml:341; offline-transport-probe.ts via cli.ts:23–30. Keep the packaged/default transport probes; factory-only mocks do not cover them. virtual.sh and standalone native tests have explicit/manual invocation even without CI references.
- **Billing:** cost.ts is not a safe deletion candidate. A wiring discrepancy deserves a focused follow-up: comment :86–87 and tests/live-cost.test.ts:5–19 describe cumulative GPT duration; production extension.ts:520 calls usage rather than cumulative (:132–140), and onClosed at :522 ignores final usage forwarded by gpt-live-session.ts:115,231–232. Resolve provider semantics and test the real extension event path before deleting the apparently test-only cumulative method or trusting a cost total. This audit makes no claim of verified upstream billing semantics.

## Per-file verdicts

Every range below was read completely; verdicts also appear in live-coverage.json.

| File (reviewed lines) | Verdict |
|---|---|
| native/live-linux/tests/backpressure.py:1–28 | Keep: unique fail-closed pipe saturation coverage |
| native/live-linux/tests/protocol.py:1–70 | Keep: device-free hello and optional isolated full protocol coverage |
| native/live-linux/tests/source-removal.py:1–42 | Keep: bounded shutdown after source removal is not normal-stop coverage |
| native/live-linux/tests/virtual.sh:1–15 | Keep: explicit virtual device ownership and cleanup |
| native/live/AudioCore.c:1–122 | Keep DSP/rings; remove identical push alias (live-06) |
| native/live/AudioCore.h:1–21 | Keep boundary declarations; remove alias declaration (live-06) |
| native/live/main.swift:1–330 | Keep native graph, realtime isolation, permission and teardown ownership |
| native/live/test-core.c:1–116 | Keep assertions; rename alias calls; possible waveform consolidation (live-06, live-07) |
| native/live/test-waveform.c:1–21 | Keep standalone regression or fold assertion into CI core test (live-07) |
| src/live/audio.ts:1–513 | Keep bounded process boundary; remove unobserved stderr bookkeeping (live-05) |
| src/live/config.ts:1–48 | Keep atomic validated selection; remove unconsumed per-provider memories (live-03) |
| src/live/cost.ts:1–147 | Keep accounting/unknown markers; investigate usage wiring before deleting cumulative method |
| src/live/credentials.ts:1–173 | Keep canonical key and conditional import ownership/security |
| src/live/diagnostics.ts:1–66 | Keep static allowlisted diagnostic translation |
| src/live/embedded.ts:1–2 | Keep build-plugin replacement seam, not an unused null constant |
| src/live/extension.ts:1–1085 | Keep lifecycle and routing; remove dead state; optional diagnostic/meter cuts (live-03, live-05, live-08, live-09) |
| src/live/gpt-live-context.ts:1–19 | Keep bounded Unicode observations distinct from instructions |
| src/live/gpt-live-delegation.ts:1–233 | Keep replay, omission, pending-admission and stale-result fences |
| src/live/gpt-live-playback.ts:1–135 | Keep GPT-only provisional acoustic recovery; not a duplicate provider VAD |
| src/live/gpt-live-request.ts:1–20 | Keep omission rejection and overlap-preserving speech assembly |
| src/live/gpt-live-session.ts:1–372 | Keep separate continuous protocol and observed close handling |
| src/live/helper.ts:1–49 | Keep private integrity-checked executable extraction |
| src/live/lifecycle-access.ts:1–28 | Keep session-scoped stop API, consumed outside Live |
| src/live/main-owner.ts:1–845 | Keep root/tool/history admission; deduplicate paired turn execution (live-04) |
| src/live/offline-transport-probe.ts:1–115 | Keep hidden compiled CLI loopback probe |
| src/live/openai-connect-error.ts:1–38 | Keep safe upgrade classification without fabricated HTTP status |
| src/live/openai-errors.ts:1–18 | Keep shared safe provider-code translation |
| src/live/openai-resample.ts:1–45 | Keep stateful rational-phase streaming conversion |
| src/live/openai-session.ts:1–848 | Keep GA transport and response correlation; retire companion-only branches with caller migration (live-01) |
| src/live/openai-upgrade-socket.ts:1–81 | Keep ws upgrade adapter and bounded rejection handling |
| src/live/orchestration.ts:1–125 | Retire old companion factory/schema after migrating explicit diagnostic callers (live-01) |
| src/live/passive-history.ts:1–110 | Keep replay safety, including explicitly historical normalization |
| src/live/playback.ts:1–260 | Keep one bounded scheduler with estimated played time and tail/flush semantics |
| src/live/providers.ts:1–37 | Keep model catalogue; remove test-only switch helper (live-03) |
| src/live/self-test.ts:1–24 | Keep packaged embedded-helper release diagnostic |
| src/live/session.ts:1–482 | Keep Gemini SDK adapter; retire companion-only context/authority branches (live-01) |
| src/live/setup.ts:1–55 | Keep explicit import/recheck/cancel; not dead compatibility |
| src/live/speaker-check.ts:1–299 | Keep unless human drops opt-in local correlation diagnostic (live-08) |
| src/live/speaker-summary.ts:1–61 | Keep unless speaker-check feature is cut (live-08) |
| src/live/status.ts:1–11 | Keep local TUI/privacy eligibility policy |
| src/live/tool-failure.ts:1–11 | Simplify legacy InputHandoffError translation only with companion retirement (live-01) |
| src/live/tool-result.ts:1–41 | Keep complete result artifacts and truthful image/preview limits |
| src/live/transcript.ts:1–51 | Remove orphaned timestamp grouping implementation and only its tests (live-02) |
| src/live/types.ts:1–78 | Keep provider contract; narrow retired companion flags/callbacks (live-01) |
| src/live/waveform.ts:1–65 | Keep unless human drops animated PCM meter (live-09) |
| native/live-linux/main.cpp:1–392 | Keep Pulse/APM worker and both flush opportunities; remove no-op state callbacks (live-06) |
| native/live/Info.plist:1–7 | Keep linker asset and microphone usage permission text |

## Gaps / next verification

No assigned unread lines. Outside-set files were traced/read only as needed, not audited line-by-line in full. Repository rg included hidden source/script/workflow references while excluding dependencies/generated artifacts; arbitrary private external callers cannot be disproved. Estimates exclude wholesale deletion of unreviewed external tests and all docs/wisdom. No full build/suite, paid connection, credential access, microphone/speaker or Pulse service invocation was run. Checks above are proposed change gates, not passing results. This audit used bounded filesystem/reference reads and a line-count reconciliation (all manifest counts matched). Real device/acoustic behavior, packaged Mac acceptance and upstream usage semantics remain unverified here. Values/wisdom were left unchanged because this was explicitly report-only research.
