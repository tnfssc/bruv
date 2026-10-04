# tests3 code-maintenance reduction audit — PARTIAL

## Overview

Read-only research against the exact 91-file manifest (18,041 lines). **73 files / 7,946 lines were fully read; 18 files / 10,095 lines remain unread. This is not an every-line group signoff.** Every read chunk was examined as text; truncated previews were repaired with overlapping smaller reads. Coverage below means review, not merely loading bytes or grep hits.

The useful reductions are test plumbing, not wholesale suite deletion. Six disjoint safe/refactor candidates offer approximately **226–296 gross lines removed, 91–156 net lines saved**, including replacement helpers/imports. Two optional acceptance-probe cuts add **422 gross/net lines**, only with a human decision to give up that evidence. Estimates are directional, not measured patches; no production/docs/wisdom deletion is counted.

Context read: wisdom/values.md, wisdom/quality/code-quality.md and relevant CI intent in wisdom/ci/full-path-simplification.md. Native Bun discovery is intentional; do not introduce a maintained test scheduler/file list. Package test discovery (package.json:15, scripts/ci.sh:57), macOS live glob (scripts/ci.sh:33), Bun preload (bunfig.toml:2), CLI subprocesses, dynamic fixtures and Docker/script staging were considered. “No import” was not used as an unused verdict.

## Ranked actionable findings

### tests3-01 — Share only offline assistant event envelopes
- **Behavior-preserving refactor; medium-high confidence.** tests/current-pipeline-sdk.test.ts:90–124, tests/phase2-native-sdk.test.ts:125–153 and tests/cache-countdown-sdk.test.ts:43–69 repeat assistant identity/timestamp/usage construction and done/error stream emission. Use one small fixture-envelope/emission helper; keep each actual serializer/capture callback in its test.
- **Evidence:** all three sources were fully read. Their repeated shells differ primarily in content, usage, stopReason and error reason; those should be explicit inputs, not another generic SDK session framework.
- **Counterevidence/boundaries:** current pipeline invokes real anthropic stream and streamSimple, preserves transformHeaders/onPayload, and rejects escaped network; Phase 2 invokes real Codex/Anthropic serializers and distinguishes aborted vs error; countdown exercises onResponse/no-HTTP-hook. These are different coverage and must remain visible. Do not merge scenarios or replace real serializers with an accepting fake.
- **Savings:** 75–95 gross, 25–45 net. **Behavior lost:** none intended. **Check:** run these three focused offline suites with LLM flags unset; preserve event end/error reasons, usage and zero-network assertions, including an injected unexpected serializer failure.

### tests3-02 — Reuse the existing fully drained process runner for disk-history probes
- **Behavior-preserving refactor; high confidence.** Existing tests/helpers.ts:10–26 already does concurrent stdout/stderr drain plus exit collection. Repeated plumbing: tests/history-sdk-099.test.ts:58–70; tests/history-storage.test.ts:63–76,124–135; tests/history-disk-retrieval.test.ts:9–13,57–65; tests/history-storage-cleanup.test.ts:9–13,107–115; tests/history-storage-lifecycle.test.ts:9–13,99–107. Replace the six spawn/drain sites with run([...], {cwd, env}); keep scripts, explicit environment keys and assertion diagnostics.
- **Evidence:** six invocations have the same piped output/drain contract; callers do not use PID, signal, stdin or streaming control. The helper is already broadly imported by CLI/TUI suites (rg evidence).
- **Counterevidence/boundaries:** isolated subprocesses are essential because disk adapter patches the SDK prototype. Do NOT move these scenarios into the test process. Native-vs-adapter comparison is meaningful, not needless compatibility. Preserve original contents, migrations, refs, collision and privacy assertions. Herdr scrubbing at helpers.ts:4–6 is an intentional safety improvement; ensure no probe expects pane identity.
- **Savings:** 45–65 gross, 25–40 net (imports/replacement calls included). **Behavior lost:** none. **Check:** five focused suites in isolation and under normal parallel discovery; assert stderr/exit failures remain readable and both native/adapted cases still run.

### tests3-03 — One owned backend-group test body, two explicit cases
- **Behavior-preserving refactor; high confidence.** tests/t3/web-launcher-process.test.ts:78–147 repeats temp directory, tracked PID set, launcher spawn, PID waits, signal, descendant waits and finally SIGKILL cleanup. Extract that owned-group body and retain separately named cases: stubborn leader/SIGTERM/status143/10s and early-exit leader/SIGINT/status130/5s.
- **Evidence:** both use writeBackend (48–76), completion (41–46) and identical tracked cleanup; only leader behavior, signal, expected code and one parent-alive assertion differ.
- **Counterevidence/boundaries:** do not delete either case: a dead group leader with living grandchildren is a distinct regression. Keep current-process-alive assertion and PID ownership tracking; never replace scoped cleanup with broad pkill. Linux repeated-clean-exit FD/listener test (150–181) is separate and retained.
- **Savings:** 55–70 gross, 15–30 net. **Behavior lost:** none. **Check:** focused process suite on Linux, and existing POSIX platform lane; keep the two existing time limits rather than silently widening one.

### tests3-04 — Share minimal tmux capture/poll/quote primitives, not a TUI framework
- **Behavior-preserving refactor of ordinary paths; medium confidence.** tests/cache-countdown-tui.test.ts:11–22 and tests/startup-tui.test.ts:16–28 duplicate capture-until-text loops and quoting. Related mechanical wrappers: tests/goals-tui.test.ts:18–20; tests/live-spoken-tui.test.ts:12–15; startup-tui.test.ts:114. Add small test helpers beside tests/helpers.ts, parameterizing capture history, interval, socket and optional config.
- **Evidence:** countdown/startup polling use the same 100 attempts, 50ms interval and missing-text diagnostic. Their shell-quote implementations have already drifted: countdown:12 and spoken:15 contain a different backslash sequence than startup:17/goals:19. A shared known-correct argv quotation function removes that maintenance trap.
- **Counterevidence/boundaries:** retain goals' command-bound startup barrier (44–59), Live's waitForLiveTuiStartup, and the plain script PTY first-paint test; generic footer readiness is not equivalent. Keep private sockets/HOME and only their own kill-server cleanup. Existing real paths do not exercise apostrophes; correcting quote handling is a small bug fix, not strictly identical behavior for broken apostrophe paths.
- **Savings:** 35–50 gross, 10–25 net. **Behavior lost:** none intended; apostrophe paths become supported correctly. **Check:** these four focused TUI suites only with existing offline assets/binary, no build/provider; add one shell-quotation roundtrip including spaces/apostrophe and verify config/history options survive.

### tests3-05 — Delete stale Codex token/Phase-1 scaffold from Anthropic-only pipeline test
- **Safe removal; high confidence for six token lines, medium-high for fixture import.** tests/current-pipeline-sdk.test.ts:29–34 builds enc/jwt but all actual auth is offline-key (64,73); :18 imports phase1Fixture but the extension factory is tasks (232). Delete those **7 gross/net lines**.
- **Evidence:** full-file review, rg references confined to declarations, and a bounded read-only Biome lint reported unused jwt and phase1Fixture (plus codex). tests/phase1-compaction-fixture.ts:8–17 exports a registration function, not a self-starting fixture.
- **Important counterevidence:** do NOT automatically count/remove the unused codex import at :7. The dependency's concrete module has a top-level registerSessionResourceCleanup at node_modules/@earendil-works/pi-ai/dist/api/openai-codex-responses.js:704; compat exports a lazy API (compat.js:18,35,113), not proof the concrete side effect already ran. Any additional one-line import removal needs module-side-effect equivalence checked.
- **Behavior lost:** unused synthetic JWT construction and an unused fixture binding, no scenario/assertion. **Check:** repeat bounded unused-binding lint and the seven-case current pipeline offline suite; retain all active anthropic/pipeline hooks.

### tests3-06 — Remove nine lexical runner checks already covered by executed CI fixture
- **Safe test-assertion reduction; medium-high confidence.** Remove tests/ci-web.test.ts:123–124 (root test command/reuse-packed-web substrings) and tests/live-macos-ci.test.ts:11–14,16–18 (runner lane slicing and prepare-before-test checks). Keep live-macos-ci :15 and its workflow/wrapper assertions.
- **Evidence:** tests/ci-runner.test.ts:90–104 executes cache mode, asserts exact build commands and root suite invocation; :130–142 executes macOS and asserts exact install/prepare-assets/source-probe/live-test sequence. These behavioral fixtures detect command removal/order changes without coupling to shell text.
- **Counterevidence/boundaries:** retain ci-web :121–122 wait assertions: the instant stub runner does not fully prove wait-for-delayed-completion. Retain workflow trusted save/exact restore (115–119), validation selection (125–129), macOS workflow tmux/ci:macos and source fallback tests (live-macos-ci:19–26); executable runner does not read GitHub YAML or prove source wrapper fallback.
- **Savings:** 9 gross/net. **Behavior lost:** only duplicated lexical enforcement, not executed command/order coverage. **Check:** focused three CI test files; demonstrate prepare reorder and cache-build-command omission still fail the executed runner fixtures.

## Feature / maintained-evidence cuts — human choice required

### tests3-07 — Retire optional paid Codex plaintext research probe
- tests/current-pipeline-live.test.ts:1–209 is an opt-in BRUV_RUN_LLM_TESTS probe. It installs the special Phase-1-only fixture (:13,127), forces cache-affine-plaintext and checks real model value retention/redaction/resume (:160–195). Its fixture explicitly says production Codex uses Phase 2 (tests/phase1-compaction-fixture.ts:6–7); production registers native before cache-affine (src/agent/extension.ts:249–270).
- **Choice:** stop maintaining *real-provider Codex plaintext Phase-1 acceptance*, not remove production Anthropic plaintext compaction. **Savings: 209 gross/net**, no dependent fixture deletion counted. **Confidence:** high it is active optional research, medium that retiring its evidence is acceptable.
- **Evidence/counterevidence:** CI explicitly disables LLM tests (scripts/ci.sh:57, release.yml:166), but the broad opt-in suite can still discover this file; no caller import is needed. It uniquely tests real model recall, which offline serializer tests cannot replace. It is not dead and not safe deletion. **Behavior lost:** this manual paid acceptance scenario/artifact. **Check:** confirm desired current provider acceptance portfolio with human; keep native SDK/offline pipeline suites; run no paid replacement without separate consent.

### tests3-08 — Give up optional real-model goal helper smoke
- tests/goals-live.test.ts:1–213 has extensive request/usage/artifact evidence, auth readiness, four-dispatch cap and 120s wall abort, all for one real model creating a harmless temporary criterion. **Savings: 213 gross/net**, only if the human no longer wants this acceptance capability.
- **Confidence:** high scope/line count, low desirability without decision. Offline marker/TUI suites do not prove a real model actually uses execute/goal helpers, writes criterion bytes, verifies them and persists completed evidence (:120–177). Hence no safe “duplicate” verdict. **Behavior lost:** opt-in paid goal smoke and bounded acceptance evidence. Keep goal runtime/unit/SDK/TUI coverage.
- **Check:** human explicitly accepts lost real-model assurance; retain goals-marker-sdk and goals-tui checks. No automatic live run. Keep auth/dispatch cap (40-test budget, 60–61) and abort/cleanup (183–210) if probe stays; never simplify them away just to shorten the test.

## Keep rationale and essential boundaries

- **History original bytes and ownership:** reviewed disk suites deliberately use subprocess isolation, differential native SDK oracles, pending publication, collisions, symlinks, migrations and exclusion fences. Their overlap does not justify deleting data-loss/privacy coverage. See history-storage.test.ts:96–148, history-storage-lifecycle.test.ts:26–95 and history-storage-cleanup.test.ts:35–99.
- **Human-only authority:** questions-bridge.test.ts:19–32,51–61 verifies no answer helper; remote-capability-runtime.test.ts:68–105 and127–152 verifies denied secrets and durable regrant without revived old authority. Narrow picker and session-switch tests cover real bugs not “defensive matrices.” Unknown resume role must not become root (resume-safeguards.test.ts:129–130,180–251).
- **Device/provider controls:** waveform PCM checks are not duplicates of display checks. Speaker tests retain abort/deadline, late-factory close and submitted PCM clearing (live-speaker-check.test.ts:117–266). GA Live setup test must stay opt-in and is setup evidence only (live-openai-provider.acceptance.test.ts:6–31).
- **Executable/asset consumers:** update.test.ts:86,254–255 compiles the three-line compiled fixture and self-update fixture; scripts/remote-e2e.sh:16 stages fake-provider.ts; scripts/remote-placement-e2e.ts:159–166 and212 stage Docker/proxy files and execute the proxy; remote-root-placement-e2e.ts:187–195,241 and task-placement-clean-capture.ts:204–216,264 use typed-root assets. These are not unused just because they are not application imports. Python proof files have explicit runnable entrypoints/manual-proof behavior; absent rg callers is insufficient to retire external script use.
- **Security/data-loss checks to keep:** updater checksum/canonical release URL, concurrent target mutation and running self-replacement (update.test.ts:146–223,247–286); strict host keys/no agent forwarding/no TTY (remote-root-transport.test.ts:28–33); settings refusal to overwrite malformed user files (t3/web-launcher.test.ts:142–169); private lifecycle index, bounded contention and kernel-owned lock recovery (task-lifecycle.test.ts:40–220); worktree commit pinning/no secrets, branch non-reset, cancellation/deadline and setup-vs-child trust (worktree-workspace.test.ts:52–305).

## Per-file verdict / exact review coverage

“Keep” is a judgment for fully read files, not proof no future reduction exists. Unreviewed rows intentionally have no keep/remove conclusion. References in this table are inclusive.

| Assigned file | Lines reviewed | Verdict | Findings |
|---|---:|---|---|
| tests/action-label-wiring.test.ts | 1–132 | Keep: real registered tool and native renderer integration, not merely copied formatting. | — |
| tests/agent-progress.test.ts | 1–105 | Keep: byte-fragmented UTF-8, bounded framing, private-content exclusion, retry and handoff status. | — |
| tests/architecture.test.ts | 1–79 | Keep: runtime import ownership and maintained-home contracts; repeated graph scans are minor runtime work, not meaningful line savings. | — |
| tests/background-interrupt-tui.test.ts | 1–120 | Keep: opt-in real interruption/resumption proof; Escape must not kill surviving managed work. | — |
| tests/cache-affine-compaction.test.ts | none; next 1 | UNREVIEWED: no full-line review; next unread line 1. No keep/remove judgment. | — |
| tests/cache-countdown-sdk.test.ts | 1–189 | Refactor only event-envelope duplication (tests3-01); retain dispatch/HTTP-hook distinctions. | tests3-01 |
| tests/cache-countdown-tui.test.ts | 1–55 | Refactor basic PTY plumbing only (tests3-04); retain persisted TTL and uncertainty UI assertions. | tests3-04 |
| tests/ci-remote-cli-source.test.ts | 1–51 | Keep: actual source CLI pipe protocol and offline terminal flow. | — |
| tests/ci-runner.test.ts | 1–142 | Keep executable runner fixture; trim duplicate lexical checks elsewhere (tests3-06). | tests3-06 |
| tests/ci-web.test.ts | 1–130 | Keep cache identity, environment isolation, trust and source validation; trim two duplicated runner checks (tests3-06). | tests3-06 |
| tests/compiled-bun-fixture.ts | 1–3 | Keep: compiled executable entrypoint used by update tests, not an import-only module. | — |
| tests/completion-notification.test.ts | 1–72 | Keep: bounded batch summaries, both command ends and honest failed-agent diagnostics. | — |
| tests/current-pipeline-live.test.ts | 1–209 | Human-choice probe retirement (tests3-07), not dead code. | tests3-07 |
| tests/current-pipeline-sdk.test.ts | 1–353 | Refactor stream envelopes and remove dead fixture scaffolding (tests3-01, tests3-05); retain all seven pipeline scenarios. | tests3-01, tests3-05 |
| tests/fixtures/live-gpt-tui.ts | 1–40 | Keep: dynamically loaded real Live/renderer fixture with fake provider/devices. | — |
| tests/fixtures/remote-e2e/fake-provider.ts | 1–185 | Keep: executable fake HTTP provider staged into remote E2E containers; distinct job, question, capability and cancellation phases. | — |
| tests/fixtures/remote-placement-e2e/Dockerfile | 1–14 | Keep: explicitly chosen isolated OS/SSH container base; Docker COPY is a consumer. | — |
| tests/fixtures/remote-placement-e2e/ssh-proxy.ts | 1–10 | Keep: real SSH byte proxy referenced by staged container command; no import needed. | — |
| tests/fixtures/remote-typed-root-placement/Dockerfile | 1–14 | Keep: typed-root container uses separate settings/profile and server-root proof. | — |
| tests/fixtures/remote-typed-root-placement/entrypoint.sh | 1–6 | Keep: SSH host-key permissions and provider/server startup entrypoint. | — |
| tests/fixtures/remote-typed-root-placement/scenario.ts | 1–169 | Keep: typed-root role/depth, snapshot, child completion, human answer and second-turn/reply-loss proof. | — |
| tests/fullscreen-editor.test.ts | 1–97 | Keep: actual upstream layout/editor integration, wrapping, scrolling and dialog restoration. | — |
| tests/goals-live.test.ts | 1–213 | Human-choice acceptance removal (tests3-08); retain if real model helper-use acceptance is required. | tests3-08 |
| tests/goals-marker-sdk.test.ts | 1–112 | Keep: provider-bound reminder-token exclusion and literal lookalikes across disk resume. | — |
| tests/goals-tui.test.ts | 1–121 | Refactor only mechanical tmux helpers (tests3-04); retain startup command binding and persisted goal transitions. | tests3-04 |
| tests/goals.test.ts | none; next 1 | UNREVIEWED: no full-line review; next unread line 1. No keep/remove judgment. | — |
| tests/gpt-live-context.test.ts | 1–20 | Keep: bounded quoted Unicode observations and explicit omission. | — |
| tests/gpt-live-waveform.test.ts | 1–132 | Keep: nonzero PCM, chunk continuity, one-shot interruption and resampling fidelity. | — |
| tests/helpers.ts | 1–26 | Keep and reuse existing drained subprocess/Herdr-isolation helper (tests3-02, tests3-04). | tests3-02, tests3-04 |
| tests/history-disk-retrieval.test.ts | 1–69 | Keep privacy, stable refs and live exclusions; reuse subprocess runner (tests3-02). | tests3-02 |
| tests/history-sdk-099.test.ts | 1–109 | Keep real native-vs-adapter differential oracle; reuse subprocess runner (tests3-02). | tests3-02 |
| tests/history-storage-cleanup.test.ts | 1–119 | Keep fault-injected pending-journal cleanup and collision non-overwrite; reuse runner (tests3-02). | tests3-02 |
| tests/history-storage-lifecycle.test.ts | 1–111 | Keep migration, symlink, discovery isolation and transactional lifecycle cases; reuse runner (tests3-02). | tests3-02 |
| tests/history-storage.test.ts | 1–148 | Keep SDK differential lifecycle and large-original preservation; reuse runner (tests3-02). | tests3-02 |
| tests/history.test.ts | none; next 1 | UNREVIEWED: no full-line review; next unread line 1. No keep/remove judgment. | — |
| tests/image-fixture.ts | 1–40 | Keep: parameterized PNG generator supports visual/image tests; static base64 cannot replace those pixel cases. | — |
| tests/install-local.test.ts | 1–105 | Keep: platform/helper matrix and atomic installed-executable preservation. | — |
| tests/job-bridge-protocol.test.ts | none; next 1 | UNREVIEWED: no full-line review; next unread line 1. No keep/remove judgment. | — |
| tests/job-bridge.test.ts | none; next 1 | UNREVIEWED: no full-line review; next unread line 1. No keep/remove judgment. | — |
| tests/job-service.test.ts | none; next 1 | UNREVIEWED: no full-line review; next unread line 1. No keep/remove judgment. | — |
| tests/live-dispatch-budget.test.ts | 1–68 | Keep: paid dispatch cap, maxRetries=0 and auth readiness; distinct invocations vs admitted provider calls. | — |
| tests/live-host-bridge.test.ts | none; next 1 | UNREVIEWED: no full-line review; next unread line 1. No keep/remove judgment. | — |
| tests/live-macos-ci.test.ts | 1–27 | Keep workflow/source fallback checks; remove duplicated runner ordering only (tests3-06). | tests3-06 |
| tests/live-notice.test.ts | 1–10 | Keep: small negative startup-notice policy test; deleting it loses that UI assurance, little maintenance saving. | — |
| tests/live-openai-provider.acceptance.test.ts | 1–31 | Keep: explicit paid/key-access opt-in and real GA schema setup acceptance; never run automatically. | — |
| tests/live-probe-input.test.ts | 1–42 | Keep: private-input consent, UTF-8, malformed-input and byte-bound checks. | — |
| tests/live-speaker-check.test.ts | 1–266 | Keep: correlation/aliasing fidelity, honest inconclusive states, abort/deadline/late-factory cleanup and PCM clearing. | — |
| tests/live-spoken-tui.test.ts | 1–74 | Refactor mechanical PTY plumbing only (tests3-04); retain actual delegated spoken-turn rendering. | tests3-04 |
| tests/live-tool-result.test.ts | 1–30 | Keep: structured errors and complete artifacts for image/large results; no fabricated serialization success. | — |
| tests/live-tools.test.ts | none; next 1 | UNREVIEWED: no full-line review; next unread line 1. No keep/remove judgment. | — |
| tests/live-waveform.test.ts | 1–55 | Keep: fixed-width waveform and output/mic state transitions, including repeated deterministic rendering. | — |
| tests/local-agent-termination.test.ts | 1–72 | Keep: signalled-owner-only draining, exactly once, asynchronous shutdown and detach. | — |
| tests/main-agent-mode-sdk.test.ts | 1–227 | Keep: real SDK prompt framing, mode persistence and role/depth authority; different from string-only prompt tests. | — |
| tests/native-compaction.test.ts | none; next 1 | UNREVIEWED: no full-line review; next unread line 1. No keep/remove judgment. | — |
| tests/native-fast-mode.test.ts | none; next 1 | UNREVIEWED: no full-line review; next unread line 1. No keep/remove judgment. | — |
| tests/native-shake-sdk.test.ts | none; next 1 | UNREVIEWED: no full-line review; next unread line 1. No keep/remove judgment. | — |
| tests/openai-session-diagnostics.test.ts | 1–76 | Keep: safe structural diagnostics without provider text/credential leakage. | — |
| tests/openai-session.test.ts | none; next 1 | UNREVIEWED: no full-line review; next unread line 1. No keep/remove judgment. | — |
| tests/phase2-native-sdk.test.ts | 1–352 | Refactor event envelopes only (tests3-01); retain native opaque checkpoints, usage, model switches, disk resume and wrong-API/provider fences. | tests3-01 |
| tests/prompts.test.ts | 1–176 | Keep: canonical source/composition, tool facts, owned prompt markers and role/worktree policy. | — |
| tests/publish-release.test.ts | 1–62 | Keep: idempotent release retry, exact asset verification and unreadable draft-list failure. | — |
| tests/questions-bridge.test.ts | 1–66 | Keep: actual isolated helpers expose ask/read/block/resolve but never a human answer API; stale-write and capacity checks. | — |
| tests/questions-extension.test.ts | none; next 1 | UNREVIEWED: no full-line review; next unread line 1. No keep/remove judgment. | — |
| tests/questions-picker.test.ts | 1–97 | Keep: real picker keyboard, filtering, resizing, narrow-label tails and detail scrolling. | — |
| tests/questions-runtime.test.ts | none; next 1 | UNREVIEWED: no full-line review; next unread line 1. No keep/remove judgment. | — |
| tests/release-browser-setup.test.ts | 1–91 | Keep: pinned browser, no unnecessary dependency install, honest download/ldd/install failures. | — |
| tests/remote-capability-runtime.test.ts | 1–153 | Keep: explicit durable scoped grants, idempotent fencing, sensitive paths, revocation and pending bounds. | — |
| tests/remote-human-rendering.test.ts | 1–233 | Keep: human truthful uncertain/cancel/return/capability states, readable transcript and explicit raw mode. | — |
| tests/remote-jobs-e2e.test.ts | 1–24 | Keep: opt-in compiled CLI real remote job integration entrypoint; invokes shell E2E rather than importing implementation. | — |
| tests/remote-jobs.test.ts | none; next 1 | UNREVIEWED: no full-line review; next unread line 1. No keep/remove judgment. | — |
| tests/remote-offline-menu-pty.py | 1–40 | Keep: independently runnable Python compiled PTY proof of offline revoke confirmation and durable authority ending. | — |
| tests/remote-placement.test.ts | 1–31 | Keep: delegation depth/role and argv-safe workspace boundaries, not speculative compatibility. | — |
| tests/remote-question-bridge.test.ts | none; next 1 | UNREVIEWED: no full-line review; next unread line 1. No keep/remove judgment. | — |
| tests/remote-root-transport.test.ts | 1–37 | Keep: actual SSH invocation proves no TTY, strict host-key checking and no agent forwarding. | — |
| tests/remote-runtime.test.ts | 1–43 | Keep: actual paged-job checkpoint state, not an equivalent local-only unit test. | — |
| tests/remote-session-switch.test.ts | 1–116 | Keep: deterministic session-switch races exclude late ownership, messages and status errors. | — |
| tests/remote-source-approval.test.ts | none; next 1 | UNREVIEWED: no full-line review; next unread line 1. No keep/remove judgment. | — |
| tests/resume-safeguards.test.ts | 1–252 | Keep: unknown role is not root, deliberate worker resume and foreign-wrapper ownership survive reinstall. | — |
| tests/setup.ts | 1–4 | Keep: Bun preload isolates tests from a real Herdr pane (bunfig.toml:2). | — |
| tests/startup-tui.test.ts | 1–163 | Refactor repeated tmux polling only (tests3-04); retain native first paint and skill/warning/autocomplete assertions. | tests3-04 |
| tests/t3/bruv-branding.test.ts | 1–22 | Keep: patch-level API/branding regression test, not a proposed docs cleanup. | — |
| tests/t3/native-routing.test.ts | none; next 1 | UNREVIEWED: no full-line review; next unread line 1. No keep/remove judgment. | — |
| tests/t3/web-launcher-process.test.ts | 1–181 | Refactor duplicated group test bodies (tests3-03); keep all OS process/FD assertions. | tests3-03 |
| tests/t3/web-launcher.test.ts | 1–169 | Keep: pure launch options plus compiled dispatch and first-run/non-overwrite settings boundaries. | — |
| tests/t3/web-source.test.ts | 1–103 | Keep: exact canonical source/patch verification without real-index mutation; existing receipt preserved on rejection. | — |
| tests/task-lifecycle.test.ts | 1–241 | Keep: protected bounded lifecycle index, short writes, contention/kernel-lock recovery and compiled FFI boundary. | — |
| tests/tasks-ui-proof-tooling.test.py | 1–149 | Keep: directly runnable Python harness test; validates fixture gates and negative controls, explicitly not appearance proof. | — |
| tests/tui-harness.test.ts | 1–51 | Keep: separate tmux server and owned-session-only auto-kill behavior. | — |
| tests/update-self-fixture.ts | 1–21 | Keep: executable self-update fixture compiled by tests/update.test.ts:254, using private mock-fetch payload. | — |
| tests/update.test.ts | 1–286 | Keep: checksums/canonical URLs, concurrent-change non-overwrite, staging cleanup and real running self-replacement. | — |
| tests/worktree-workspace.test.ts | 1–305 | Keep: commit pinning, no dirty/secret copying, branch retention, cancellation/setup deadlines and trust ownership. | — |

## Gaps and checks actually performed

- **18 files are unstarted, next unread line 1 for each**, listed explicitly above and complete:false in coverage JSON. They include the biggest native/OpenAI, jobs, goals, question and remote approval suites. No unused/deletion inference or overall subsystem verdict was made for them. Remaining 10095 lines need a continuation reviewer. There was no filesystem access blocker; this pass simply did not complete that review.
- No full build, full suite, provider, live/device or Docker runtime was launched. Checks were reads/rg, manifest-vs-current exact line counts (no drift) and **read-only** targeted Biome unused-import/unused-variable lint on current-pipeline-sdk. Biome exited 0 with three warnings; no fixes applied. Initial shell syntax check failed because shell is fish, then was rerun explicitly under bash. No behavioral refactor implementation or runtime proof is claimed.
- Shared checkout: only this report and tests3-coverage.json were written by this reviewer. No source/test/config/production edit or commit. Values/wisdom were read for context, not changed and not counted as savings.
