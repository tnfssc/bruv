# Tooling maintenance-reduction audit

## Overview

Read **all 11,093 lines of all 76 assigned files**, including long literal/HTML lines and complete fixture/config files. Large files were read in contiguous numbered chunks; truncated previews were revisited in smaller chunks. Coverage is recorded per file below and in tooling-coverage.json. This is read-only research: no production/test/config edits, no commits, no build, full suite, Docker fixture, device, paid provider or Live launch.

Best opportunities are **duplicated acceptance infrastructure, duplicated gate inventories, and copied research transports**, not deleting acceptance assertions. Recommended no-feature-cut portfolio: roughly **1,278–1,461 gross lines replaced/removed, 687–886 net lines saved**, including replacement helpers and small test/call-site edits. Estimates are physical source lines, not formatting compression. No documentation/wisdom savings are counted. Feature-cut alternatives below overlap this portfolio and must NOT be added to it.

References were traced with rg through scripts, package commands, workflows, tests, production sources, integration builds and relevant reproduction notes. No-import is not used as evidence of an unused executable. Context: wisdom/values.md, wisdom/ci/full-path-simplification.md, relevant packed-web/history/Live research rationale. Syntax-only checks passed for nine shell scripts, four Python scripts and four workflow YAML files; no product-behavior verification was run.

## Ranked actionable findings

### tooling-01 — Remove copied but uncalled capability-harness helpers (safe removal)

- **Where:** scripts/remote-capability-pty-e2e.ts:9,16,28,170–183,194–215; scripts/remote-pty-e2e.ts:16,28.
- **Evidence:** complete capability script has no call to ownerQuestion, noChatJson or command. historyPane is used only inside that uncalled command. container is read from the environment but never used. localCalls is only declared/incremented in both PTY scripts; unlike scripts/remote-e2e.ts:192–204,462, neither script asserts or reports it. rg of these exact identifiers agrees with the line review.
- **Counterevidence/boundary:** these FILES are real CLI fixtures, not dead files (tests/remote-e2e.test.ts:27–45 invokes PTY through remote-e2e.sh; capability script is selected by remote-e2e.sh:8,98). Keep all grant/revoke/Escape/No/stale-request assertions at capability:393–469, and all PTY chat-envelope assertions in the other script.
- **Gross/net:** **41/41 lines** (39 capability + 2 PTY); no coverage lost, no behavior lost. **Confidence: high.** Check TypeScript/lint, then the two opt-in compiled PTY scenarios on an authorized isolated fixture. Do not launch them as part of this audit.

### tooling-02 — One network-none Docker/SSH harness for root, child and presentation captures (behavior-preserving refactor)

- **Where:** scripts/remote-root-placement-e2e.ts:46–120,153–304,808–830; scripts/task-placement-clean-capture.ts:42–129,171–325,548–568; scripts/remote-placement-e2e.ts:31–91,124–269,553–573.
- **Evidence:** three copies create isolated HOME/repo/build/key directories, construct the same allowlisted process environment and sync command runner, resolve Docker context before switching HOME, generate client/host keys, inspect a cached base image, build/run with network:none and resource limits, construct pinned SSH with Docker-exec ProxyCommand, wait for SSH/provider readiness and clean up exact owned resources. Root and clean-capture code are particularly close, including path canonicalization. These are hundreds of duplicated lifecycle lines, not merely similar scenario names.
- **Action:** extract a narrow owned fixture returning env, repo, SSH/run helpers and cleanup; callers supply fixture directory/file overlays, build-arg name, binary/probe selection, alias and optional reply-loss SSH wrapper. Keep scenario-specific tmux controls, assertions and receipts in their current callers. Do not invent a general test framework.
- **Counterevidence:** child fixture has local fake parent inference; root/clean intentionally have none. Root enables real reply-loss transport and richer source-return assertions; clean is a natural presentation rather than diagnostic acceptance. Preserve these differences. Do not merge finite child ownership into persistent root ownership or route these through the loopback-published remote-e2e.sh fixture.
- **Gross/net:** **430–540 / 220–300 lines**, accounting for one shared implementation and explicit options. **Confidence: medium-high.** No intended behavior loss. Re-run root clean+drift+lost-reply+cancel, child clean+drift, and presentation capture; compare source patches, identities, receipts, cleanup and visible frames, not just exit status. Keep network:none, no pulls, secret-free environment, strict host pinning, external artifacts, exact resource ownership and conflict-review boundaries.

### tooling-03 — Share the older loopback fake-parent/RPC client plumbing (behavior-preserving refactor)

- **Where:** scripts/remote-e2e.ts:21–60,94–146; scripts/remote-pty-e2e.ts:18–57,101–155; scripts/remote-capability-pty-e2e.ts:18–57,101–155.
- **Evidence:** copies use the same imported placementReply scenario, SSE response construction, fixture-model model file and newline-buffered real compiled RPC client. The latter two client implementations differ principally in tmux diagnostic socket names. Existing scenario ownership is already shared via tests/fixtures/remote-e2e/placement-parent.
- **Action:** keep one fake-provider/model-file owner and one spawn/RPC-line/wait helper with caller-supplied diagnostic formatter and diagnostic no-session flag. Keep events available for machine assertions, and preserve rejection of malformed RPC JSON and explicit false trust confirmations.
- **Counterevidence:** remote-e2e.ts counts provider calls to establish independence/offline behavior, so that counter cannot be deleted there. Other scripts have modal/state tests unavailable in RPC-only coverage. tests/remote-e2e.test.ts:9–22,31–44 verifies both distinct entrypoints; tests/remote-jobs-e2e.test.ts:7–21 verifies a separate two-session wake path, not replaceable by this helper.
- **Gross/net:** **260–275 / 130–165 lines**, after tooling-01 removes dead copied pieces; those lines are NOT counted again. **Confidence: high on duplication, medium on exact size.** No behavior loss intended. Check original RPC, question PTY and capability PTY scenarios; retain original error diagnostics and owned-child cleanup. This does not replace tooling-02's different network-none transport.

### tooling-04 — Release should call the ordinary gate rather than maintain its inventory twice (behavior-preserving refactor)

- **Where:** .github/workflows/release.yml:145–170,211–241 versus scripts/ci.sh:27–63 and scripts/ci-web-validation.sh:15–33. integrations/t3/build/build.ts:117–118 already owns server/web tsc during a fresh producer.
- **Evidence:** release copies frozen install, format/lint/typecheck/build, offline default transport, root tests, smoke, and the web suite list. tests/release-workflows.test.ts:405–424 literally compares the duplicated web test-name unions. Release adds repeat server/web tsc after the same fresh build. This is a maintained duplicate contract, not additional behavior coverage.
- **Action:** invoke the shared Linux gate once, with a small log-directory option if release logging must retain its current location. Remove duplicate standalone producer-owned typechecks; retain client-runtime typecheck. Adapt the union test to follow the shared invocation rather than require copied names in YAML.
- **Counterevidence:** release target compiles, attribution, final packaged browser boot, Mac embedded helper/updater and publication guards are NOT ordinary CI. Keep release:175–210,242–370. Source-only CI success is not final-asset acceptance. ci.sh parallelizes independent suites; confirm changing execution order/log layout is acceptable and keep both failure outcomes propagated.
- **Gross/net:** **57–65 / 40–55 lines** including shared logging/test adjustments. **Confidence: high.** No intended assertion loss; source suites run once on the current CLI. Required check: parsed workflow policy tests, gate command-union comparison, one actual release candidate through all final-asset gates before publication. Never execute write-token publication just to test the refactor.

### tooling-05 — One intercepted Realtime study transport, three small scenario drivers (behavior-preserving refactor)

- **Where:** scripts/probe-live-capability.ts:78–215; scripts/probe-live-recorded.ts:90–221; scripts/probe-live-controlled.ts:135–258; duplicated snapshot/content projection at recorded:43–58 and controlled:67–80.
- **Evidence:** three nearly identical WebSocket/session.update/configuration/JSON parsing/tool capture/fake result/response.done/deadline/close/redaction loops. All deliberately intercept model-generated code. Scenario preparation, transcripts, variant instructions, synthetic outputs and result fields differ; transport mechanics do not.
- **Action:** one trial runner accepting instructions, pre-response conversation items, tools, mocked tool-output function, deadline and speech-output limit. Keep distinct scenario drivers; do not use production execution dispatch for this helper.
- **Counterevidence:** capability uses 20s/1,400-character output; other trials 25s/2,000. Recorded replay adds provisional speech, controlled compares languages/prior refusals and optional synthetic input. These differences are research behavior to preserve, not fallbacks to discard. Manual reproduction is documented in wisdom/live/capability-probe-integration-2026-09-25.md:5–7, so none is proven dead merely because workflows do not call it.
- **Gross/net:** **300–350 / 160–210 lines**, excluding tooling-09's duplicate guards. **Confidence: medium-high.** No intended behavior loss. Test runner offline with loopback event sequences (ready/tool/result continuation/error/timeout/close), compare trial JSON against fixtures; input gate tests remain. A paid rerun needs explicit separate human consent, not audit authorization.

### tooling-06 — Share the identical Python ANSI video renderer, not all terminal renderers (behavior-preserving refactor)

- **Where:** scripts/task-placement-clean-video.py:62–130; scripts/task-placement-final-video.py:56–120.
- **Evidence:** copied PIL font/palette/ANSI color handling, Unicode column-width walking, fixed canvas rendering and FFmpeg raw-video encoding loop. Titles/captions/footer, input provenance and auditing are the meaningful differences.
- **Action:** one rendering/encoding function parameterized by rows, titles, footer and frame-audit hook. Keep clean's full marker/privacy/decoded-frame/faststart checks at :11–60,122–146 and final's frozen-source proof at :17–55,122–124.
- **Counterevidence:** scripts/tasks-ui-proof-screenshots.ts:52–118 supports italic/dim/underline/reverse, strict unknown-control rejection and browser text equality, unlike these PIL scripts. Do NOT collapse it into this less complete renderer. Final replay is intentionally old frozen evidence, not fresh product acceptance.
- **Gross/net:** **134 / 45–60 lines**. **Confidence: high.** No intended picture/content loss. Render the same frozen captures, compare all visible frame content/pixel output, fully decode video and keep privacy/provenance checks. No synthetic or filtered product text.

### tooling-07 — Let preparePiHost own the duplicated dependency seam check (behavior-preserving refactor)

- **Where:** scripts/prepare-assets.ts:1–2,13–27 versus scripts/pi-host-adaptation.ts:84–109.
- **Evidence:** assets code independently reads Pi package version and hashes session-manager.js against the same original/adapted digests, immediately before preparePiHost checks package version and validates every patch (including that file) before any write. The first hashing pass does not provide extra runtime protection.
- **Action:** delete duplicate hash/version computation and unused crypto import; use the existing all-files gate. Retain/cover the invariant that piHostPatches contains the required history seam; do not remove host adaptations.
- **Counterevidence:** private seam drift is an essential data/history boundary; the dedicated explanatory error currently differs from generic adaptation errors. Diagnostic wording changes unless moved into the single owner. tests/pi-host.test.ts:80–98 already proves all-file fail-before-write and version rejection; :59–63 proves original/adapted/idempotent/drift hashes.
- **Gross/net:** **17 / 15–17 lines**, allowing a small invariant assertion/test. **Confidence: high.** No supported Pi-version behavior lost; possibly different error text. Check those guard tests plus assets preparation on pristine and already-adapted packages in an isolated authorized checkout, not shared dependencies during this audit.

### tooling-08 — Remove the future content-key API used only for redundant tests (safe removal)

- **Where:** scripts/packed-web.ts:90–95; tests/packed-web.test.ts:211–214,219–222,258–261,274–277 and its import.
- **Evidence:** rg finds packedWebInputKey only at its declaration and these tests. It has no CLI entrypoint; neither real producer nor cache restore calls it. Current cross-run key is ciWebInputKey (scripts/ci-web.ts:63–91,175–195). Same-workspace receipt uses private inputKey at packed-web:86–89,109,134, which remains required.
- **Action:** remove the exported future wrapper and only redundant key assertions/import; retain each test's real verifyPackedWeb acceptance/rejection assertion (pnpm change, CLI-only edits, per-step environment, GITHUB_REF change).
- **Counterevidence:** removing all identity/key code would break real producer receipts and their tests. This proposal removes only the unconsumed future restore API, not cache/source/digest/age/symlink checks.
- **Gross/net:** **15/15 lines** across assigned helper and outside-set test call sites. **Confidence: high.** No shipped behavior lost. Run focused packed-web and ci-web tests; verify content drift rejects reuse and CLI-only/command-file changes preserve reuse.

### tooling-09 — Remove second validation passes inside already validated study plans (safe removal)

- **Where:** scripts/probe-live-capability.ts:77,80; scripts/probe-live-recorded.ts:68–73; scripts/probe-live-controlled.ts:104–111.
- **Evidence:** capability:19–33 already validates count/spec before configuration/credential loading; recorded:15–24 validates every spec before readStudy; controlled:15–28 validates every condition before private reads. Plans are not mutated between validation and their execution loops. Second checks accept the same combinations and add no security boundary.
- **Counterevidence:** the EARLY checks, paid opt-in, explicit input source/study/disclosure and bounded reading are essential. Never move validation until after connecting or reading private data.
- **Gross/net:** **16/16 lines**. **Confidence: high.** No behavior loss for immutable plans. Add/exercise offline invalid-plan tests asserting failure before credential/socket work, and keep tests/live-probe-input.test.ts. Alternative to deleting entire study tooling in tooling-11; not additive to that cut.

### tooling-10 — Inline trivial aliases and remove a discarded tmux query (safe removal)

- **Where:** scripts/remote-placement-e2e.ts:277,576–578; scripts/tui-harness.ts:90–93.
- **Evidence:** jsonString only returns JSON.parse and has one call; inline JSON.parse. TUI start discards has-session's return completely and always performs list-sessions inside its then callback; existing-session behavior depends only on that list. Use that existing list check without the first subprocess/promise wrapper.
- **Counterevidence:** preserve duplicate-session rejection and session-name validation (:89); don't remove tmux configuration needed for modified Enter. Keep fake Docker/SSH scenarios themselves.
- **Gross/net:** **8 / 5–7 lines**. **Confidence: high.** Only an unobserved subprocess/error-swallowing call disappears; no intended behavior loss. Exercise duplicate TUI start and new-session start plus the placement fixture's network-mode assertion. Check tests/tui-harness.test.ts and existing fixture entrypoints.

## Feature cuts requiring human choice

### tooling-11 — Retire the completed September 25 paid instruction study

Delete scripts/probe-live-capability.ts:1–218, scripts/probe-live-recorded.ts:1–223, scripts/probe-live-controlled.ts:1–260 and scripts/live-probe-input.ts:1–85 **only if reproducible reruns of this research are no longer wanted**. Gross/net assigned code **786/786 lines**; tests/live-probe-input.test.ts adds 42 possible removed test lines outside this group's savings, not included. No shipped voice functionality changes. Loss: synthetic language/prior-refusal comparisons, fixed historical cutoff/indices, recorded snapshot/provisional replay and per-trial captured generated code. These are real documented manual CLI entrypoints, not proven unused. Historical indices make them study-specific (input:4–7), not a general acceptance harness; production runtime/audio acceptance lives elsewhere. Confidence high on size/scope, human decision required on continued research value. If cut, check no code/build/CLI caller remains and preserve production Live/transport/onboarding acceptance. Do not count or delete wisdom/docs. This replaces tooling-05 and tooling-09's savings, not adds to them.

### tooling-12 — Stop regenerating the old frozen integrated video

Delete scripts/task-placement-final-video.py:1–124 only if the already-published frozen replay no longer needs regeneration. **124/124 gross/net assigned lines**; no product behavior loss. It requires exact source 963401c… and binary a48c9… (:18–23), manually listed capture names (:25–39), and a historical personal output default (:13), rather than today's clean capture pipeline. Counterevidence: wisdom/task-placement/final-integrated-video.md and final-video-replay.md document direct invocation, so it is not dead. Loss is reproduction of that exact old child+root evidence, NOT current acceptance or new clean capture. Confidence high, human choice required. Preserve stored evidence; no docs/wisdom deletion savings. Overlaps the final-video half of tooling-06 (65 gross lines); if chosen, recompute shared-renderer economics instead of adding both estimates.

## Keep rationale and essential boundaries

- CI docs classification/baseline/cache code is live workflow machinery. Preserve complete executable validation, cumulative trusted ancestor comparison, NUL-safe diff parsing, regular/non-executable docs check, fail-full uncertainty and final policy gate. Do not cut baseline/security checks just because they are fallback code.
- Packed reuse has two distinct trust contracts: fixed-environment cross-run producer cache and same-workspace short-lived archive receipt. Keep digest/size, source pin/patch, environment/tool inputs, PR read-only/trusted-branch cache writes and symlink containment. Different identities are not automatically duplicate implementations.
- Publishing is a mutation boundary: keep exact SHA/tag matching, develop movement check, immutable published-release assets, duplicate/extra/digest rejection and draft repair. Browser/Mac/updater gates check shipped artifacts; never replace them with source-only tests.
- Installation/update must stage and verify before replacing working binaries. Keep atomic move, checksum mismatch preservation and isolated test homes. Legal notices' curated fallbacks reflect missing packaged licenses; removal is not justified by lack of imports.
- Remote source return must preserve local index/history/untracked privacy and review on drift, stable task/reply IDs, explicit human permission, scoped cancellation and real process exit. RPC, ordinary questions, persistent root and diagnostic capability UI test different contracts. Reduce copied harness code, not their assertions.
- Live hardware isolation, owned-process cleanup, paid/disclosure gates and secret-redacted diagnostics stay. Loopback compiled success/audio/header/error tests and full-CLI transport tests aren't automatically equivalent: the smaller smoke includes 403/404/429 upgrade metadata not covered by the full probe's 401 alone.
- History storage/native-vs-adapted and real SDK compaction probes test distinct retention layers. The preload is a documented SDK-suite entrypoint, not a dead four-line file. UI cleanup proof (older spacing/long-output/batched tasks) differs from newer streamed-label/native proof; do not delete either without migrating unique assertions.

## Per-file verdicts

The following table is the complete owned manifest, not a sampled inventory. Keep means no material line-reduction candidate established beyond identified cross-file findings.

| File (complete lines read) | Verdict | Findings |
| --- | --- | --- |
| .github/workflows/ci.yml (1–229) | Keep: live docs/full policy, cumulative comparison and cache authorization; no safe structural deletion. | — |
| .github/workflows/dependency-updates.yml (1–173) | Keep: candidate/read-token and publisher/write-token isolation, exact SHA/base and lease protections. | — |
| .github/workflows/live.yml (1–62) | Keep: native rings/protocol and optional full compiled transport validate different layers. | — |
| .github/workflows/release.yml (1–370) | Refactor shared CI inventory; retain every release-only final asset and publishing gate. | tooling-04 |
| biome.json (1–68) | Keep: one concise formatter/linter configuration; exclusions cover generated and fixture output. | — |
| bunfig.toml (1–2) | Keep: required test preload entrypoint. | — |
| mise.toml (1–6) | Keep: pinned local toolchain consumed by cache/build identities. | — |
| package.json (1–49) | Keep: commands/bin/dependencies are build and human entrypoints, not unused imports. | — |
| scripts/build-live-helper.sh (1–14) | Keep: platform check, sanitizer-independent self-test and owned temporary compile cleanup. | — |
| scripts/build-live-linux-helper.sh (1–7) | Keep: distinct Linux helper/native dependencies; not interchangeable with Apple helper. | — |
| scripts/build.ts (1–55) | Keep: target/helper modes and fresh/repack/verified archive dispatch are real build paths. | — |
| scripts/ci-selective.ts (1–134) | Keep: conservative docs-only planning and clean/file-mode/diff safety are workflow policy. | — |
| scripts/ci-web-validation.sh (1–33) | Keep/refactor caller: single web validation inventory should also own release selection. | tooling-04 |
| scripts/ci-web.ts (1–201) | Keep: fixed-environment cross-run cache owner and trust checks differ from local packed receipt. | — |
| scripts/ci.sh (1–63) | Keep/refactor reuse: shared local/hosted complete gate; introduce at most a log-location option. | tooling-04 |
| scripts/find-ci-baseline.ts (1–91) | Keep: bounded successful trusted ancestor discovery avoids unvalidated cumulative changes. | — |
| scripts/fixtures/task-placement-clean/fake-provider.ts (1–20) | Keep: directly copied Docker fake-provider asset, not unused because no production import. | — |
| scripts/fixtures/task-placement-clean/models.json (1–23) | Keep: copied server-only demo models configuration. | — |
| scripts/fixtures/task-placement-clean/scenario.ts (1–90) | Keep: shared presentation inference/stream fixture with actual tool/state assertions. | — |
| scripts/fixtures/task-placement-clean/settings.json (1–5) | Keep: copied deterministic demo default settings. | — |
| scripts/fixtures/task-placement-clean/subagents.json (1–6) | Keep: copied server helper profile; protects placement/default-role behavior. | — |
| scripts/generate-third-party-notices.ts (1–178) | Keep: legal notice graph, limits and curated license gaps are essential packaging behavior. | — |
| scripts/history-sdk-probe.ts (1–168) | Keep: real SDK compaction/reset/resume/context-edit retention soak; not storage probe duplicate. | — |
| scripts/history-storage-preload.ts (1–4) | Keep: documented SDK suite preload installs CLI history adapter. | — |
| scripts/history-storage-probe.ts (1–220) | Keep: native-vs-adapted disk/cache/hash comparison adds distinct retention evidence. | — |
| scripts/install-local.sh (1–44) | Keep: staged private artifact self-test before atomic install protects working executable. | — |
| scripts/leak-audit/bridge-retention.ts (1–47) | Keep: bridge listener-retention soak targets cancellation lifecycle not other memory probes. | — |
| scripts/leak-audit/cli-rpc-soak.ts (1–244) | Keep: real CLI RPC lifecycle resource probe; retained output and failed-response evidence serve measurement. | — |
| scripts/leak-audit/execution-runtime.ts (1–135) | Keep: isolated output spill/abort/descendant cleanup/bridge timeout soak. | — |
| scripts/leak-audit/session-journal.ts (1–39) | Keep: isolated in-memory SDK baseline diagnostic, not a disk retention regression replacement. | — |
| scripts/live-acceptance.ts (1–536) | Keep: virtual-route/monitor-tail/interruption proof differs from protocol-only tests; paid gating stays. | — |
| scripts/live-gpt-live-offline-smoke.ts (1–131) | Keep: compiled GPT integration handshake/PCM/delegation/local interruption/recovery smoke. | — |
| scripts/live-helper-bundle.ts (1–34) | Keep: target/Mach-O/digest/regular-file validation belongs at helper embedding boundary. | — |
| scripts/live-isolated-audio.sh (1–58) | Keep: private hardware-free audio service lifecycle and graph checks prevent desktop/hardware access. | — |
| scripts/live-onboarding-smoke.ts (1–121) | Keep: compiled real menu credential-import permissions/no audio command smoke. | — |
| scripts/live-openai-offline-smoke.ts (1–77) | Keep: manually compilable loopback PCM/header and multi-status upgrade/redaction evidence. | — |
| scripts/live-probe-input.ts (1–85) | Refactor shared study projection/transport, or human-choice retirement with its consumers. | tooling-05, tooling-11 |
| scripts/offline-openai-default-transport.ts (1–36) | Keep: source/full CLI loopback gate probes are a real CI/release entrypoint. | — |
| scripts/packed-web.ts (1–155) | Remove only future test-only key API; keep real receipt identity/digests/modes. | tooling-08 |
| scripts/pi-host-adaptation.ts (1–110) | Keep: guarded all-files host adaptation owns essential Pi seam checks. | tooling-07 |
| scripts/prepare-assets.ts (1–73) | Refactor redundant seam hashing into preparePiHost owner; retain required patch invariant. | tooling-07 |
| scripts/prepare-manual-release.ts (1–61) | Keep: manual version preparation/refusal of empty or duplicate release. | — |
| scripts/probe-live-capability.ts (1–218) | Refactor common intercepted study transport and duplicate guards, or explicit study cut. | tooling-05, tooling-09, tooling-11 |
| scripts/probe-live-controlled.ts (1–260) | Refactor common intercepted study transport and duplicate guards, or explicit study cut. | tooling-05, tooling-09, tooling-11 |
| scripts/probe-live-recorded.ts (1–223) | Refactor common intercepted study transport and duplicate guards, or explicit study cut. | tooling-05, tooling-09, tooling-11 |
| scripts/probe-openai-realtime-setup.ts (1–74) | Keep: intentionally opt-in paid setup handshake probe, private-key validation/redacted outcome. | — |
| scripts/prompt-preview.ts (1–53) | Keep: actual prompt assembly CLI command; isolated preview and explicit project selection. | — |
| scripts/publish-release.ts (1–168) | Keep: stable tag/SHA and verified asset publication/draft repair mutation boundary. | — |
| scripts/remote-capability-pty-e2e.ts (1–478) | Remove uncalled copied helpers/counter; share parent/RPC harness; retain human grant scenarios. | tooling-01, tooling-03 |
| scripts/remote-e2e.sh (1–98) | Keep: dynamic script selection, exact owned Docker/key/HOME and accepted-response loss fixture. | — |
| scripts/remote-e2e.ts (1–473) | Refactor common fake-parent/RPC harness; retain independence, indexed return, grants, cancellation/offline transcript. | tooling-03 |
| scripts/remote-jobs-e2e.ts (1–256) | Keep: two-session current-CLI completion wake, stable IDs and cross-session isolation proof. | — |
| scripts/remote-placement-e2e.ts (1–578) | Share network-none SSH harness; inline jsonString only; retain child/worktree/question/drift tests. | tooling-02, tooling-10 |
| scripts/remote-pty-e2e.ts (1–567) | Share parent/RPC plumbing and remove unused counter; retain rendered stale/offline/narrow/modal/legacy controls. | tooling-01, tooling-03 |
| scripts/remote-recovery-e2e.ts (1–304) | Keep: accepted launch/answer response loss, same PID/reply identity and actual /new /resume boundaries. | — |
| scripts/remote-root-placement-e2e.ts (1–835) | Share network-none SSH harness; retain persistent-root clean/drift/no-replay/reply-loss/live-process cancel assertions. | tooling-02 |
| scripts/select-release-notes.ts (1–21) | Keep: tag/version validated notes selection is standalone release command. | — |
| scripts/setup-release-browser.sh (1–27) | Keep: isolated pinned browser downloads/library fallback; no product cache or skipped browser gate. | — |
| scripts/smoke.sh (1–34) | Keep: relocated clean HOME/PATH-empty compiled CLI startup smoke. | — |
| scripts/task-placement-clean-capture.ts (1–570) | Share network-none lifecycle only; preserve natural menus/content/provenance and privacy presentation. | tooling-02 |
| scripts/task-placement-clean-scenario.test.ts (1–65) | Keep: fixture-tool execution and no-false-success/default-child/presentation length coverage. | — |
| scripts/task-placement-clean-video.py (1–146) | Share identical PIL renderer; keep privacy/frame/faststart/decoded-output acceptance. | tooling-06 |
| scripts/task-placement-final-video.py (1–124) | Share renderer or human-choice frozen-video retirement; retain provenance if replay stays. | tooling-06, tooling-12 |
| scripts/tasks-ui-native-proof.py (1–317) | Keep: real SDK streaming-label barriers, background canonical row, failure/hidden thinking/footer/Ctrl-O proof. | — |
| scripts/tasks-ui-proof-build.ts (1–57) | Keep: explicitly non-release compile provenance, dependency read-only and source-stability checks. | — |
| scripts/tasks-ui-proof-screenshots.ts (1–168) | Keep: strict browser text-identical ANSI replay supports more styles than PIL videos. | — |
| scripts/tui-harness.ts (1–184) | Remove discarded has-session query only; preserve controls/transcripts/demo budget/extended Enter. | tooling-10 |
| scripts/ui-cleanup-probe.py (1–232) | Keep: distinct long-output/truncation/spacing/ordered-task-batch UI assertions not fully covered by native proof. | — |
| scripts/update-dependencies.ts (1–139) | Keep: root dependency candidate updates, protected toolchain alignment and labeled hosted fixture. | — |
| scripts/validate-release-tag.ts (1–23) | Keep: stable version/tag gate refuses misleading release metadata. | — |
| scripts/verify-update.ts (1–84) | Keep: actual compiled updater rollback/replacement and staged asset checksum/version verification. | — |
| support/gpt-live-explained.html (1–24) | Keep: human static architecture explainer; explicitly excluded from documentation deletion savings. | — |
| tsconfig.json (1–12) | Keep: concise strict source/scripts/integration/test typecheck configuration. | — |
| scripts/tmux.conf (1–4) | Keep: modified Enter protocol needed by harness and real TUI tests. | — |
| .gitignore (1–17) | Keep: credentials/private runtime/generated output ignores are security and source hygiene, not dead code. | — |
| .gitattributes (1–3) | Keep: significant patch-context whitespace exceptions, not disposable compatibility scaffolding. | — |

## Gaps and verification limits

No assigned unread lines remain. This is a source/usage audit, not execution acceptance: no full tests, asset preparation, builds, provider/device connections or Docker acceptance were run. Shell syntax, Python AST and workflow YAML parsing are the bounded checks only. The first syntax shell attempt failed because the host shell is fish (heredoc parsing); it was rerun successfully with direct bash/python argv, without executing the scripts. External test files were read only where needed for caller/counterevidence; no claim of complete outside-manifest line review. Repository rg cannot prove absence of undisclosed external consumers of an exported research API or CLI, so CLI retirement stays human-owned. Gross/net estimates require a concrete small-helper design and are not promised exact diffs. Shared checkout line counts matched the manifest when checked; no tracked source changes were observed. No wisdom or values changes: requested research only, existing principles cover the conclusions.
