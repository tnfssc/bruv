# experiments1 — code-reduction audit

## Overview

Read-only audit of the 39 assigned files. **38 files were read completely; the 13,028-line rollback patch was read only through line 192. Next unread line: 193.** Actual assigned size is 14,475 lines; 1,639 lines were reviewed. The manifest reports 32 lines for remote-review/index.html; the current file has 33, all read, including its very long CSS/JavaScript lines in contiguous character chunks. No claim of full-group line review.

Most files are runnable research entrypoints, fixture assets, or safety assertions—not unused production modules. The clearest reduction is 344 lines of deliberately non-runnable historical scripts. A small duplicated source guard and unused page state offer another 9–13 net lines. Optional behavior cuts below save a separate 105–107 assigned lines. **No savings are claimed for the unread rollback patch, documentation, wisdom, unassigned files, or generated evidence JSON.** Counts are physical source lines, including existing comments/blank lines; gross means existing lines deleted, net subtracts replacement/helper lines. Inline state edits can remove code without removing a physical line.

Context: read wisdom/values.md; relevant archive/preview context, remote task-proof boundaries, and the native-question ownership-fix note. Neither wisdom nor production/tests/config was edited. References were traced with rg, including hidden archival paths and explicit script/Docker consumers. No Docker, build, provider, Live, or full suite was launched.

## Ranked actionable findings

### experiments1-01 — Retire five non-executable historical script copies

**Classification:** safe removal from current executable/build surface; historical archive-retention choice remains. **Confidence:** high about no current runtime effect, medium about whether humans still want these recipes retained in-tree.

Owned scope:
- experiments/t3/production-v2/archive/scripts/build-candidate.ts:1–84 (84 lines).
- experiments/t3/production-v2/archive/scripts/leak-audit/current-web-client-source-probe.mjs:1–104 (104).
- experiments/t3/production-v2/archive/scripts/leak-audit/current-web-client-tests.mjs:1–77 (77).
- experiments/t3/production-v2/archive/scripts/leak-audit/current-web-provider-tests.sh:1–19 (19).
- experiments/t3/production-v2/archive/scripts/leak-audit/server-shutdown-probe.mjs:1–60 (60).

**Evidence:** experiments/t3/production-v2/README.md:3–10 explicitly says byte-for-byte historical relocation, original paths retained, port before reuse, no release gate and no automatic execution. The builder's imports at :5–6 resolve to missing production-v2/src/t3/web/archive.ts and archive/web-source.ts. Its root/pin/cache at :8–11 are historical. The leak probes at source-probe:7–14, client-tests:7–9, provider-tests:4–9, shutdown-probe:8,17 similarly address old checkouts/inputs rather than the maintained integration. package.json:25 points build:web to integrations/t3/build/build.ts; scripts/build.ts:6,37 and integrations/t3/build/build.ts:53,71,103,107,133,140 use the current integration's source/patch/bootstrap. Scoped reference searches found archive descriptions and the archived client-tests → archived source-probe chain, not an active release invocation.

**Counterevidence:** these were intentionally preserved, not accidentally abandoned. The candidate is an exact-input non-adopted packaging recipe (builder:15–18,40–41,64–82); the client probe deliberately reproduces a timeout-retained media capture (client-tests:32–46), not a meaningless test. Source-probe:45–50 intentionally asserts the old defect still exists. Deleting them loses historical runnable recipes after porting, not their current product behavior. Git retrieval must remain possible if archive consumers need this provenance. Do not relabel the old expected-leak assertions as current regression coverage.

**Action:** delete these five historical implementations once in-tree recipe retention is no longer desired; do not repair their old roots or add compatibility wrappers. Leave current gates untouched. **Gross 344; net 344.** Rollback patch/pin are NOT included.

**Checks before adoption:** repeat no-ignore scoped reference search for exact filenames/paths; inspect historical archive/export consumers owned by other reviewers; verify current package/build/CI source inputs still name integrations/t3; confirm old timeout/shutdown findings have current tests if that behavior is still supported. Existing current coverage examples include tests/t3/production-bridge.test.ts:69–124 and integrations/t3/gates/packaged-smoke.ts:314–319, but these are not asserted to replace every old leak test. No full build is needed merely to remove unreferenced archival scripts.

### experiments1-02 — One source-integrity guard for preview setup and run

**Classification:** behavior-preserving refactor. **Confidence:** high duplication, medium exact savings.

experiments/t3/preview-v2/setup.sh:69,73–83 and run.sh:16–27 each verify the same PIN, hash the same git diff excluding the same five tracked test paths, reject other drift, and carry the same four-item untracked allowlist. setup.sh:74,80 versus run.sh:18,24 demonstrate the two copies. A small sourced local script, using their already-identical SOURCE/PIN/PATCH variables, can hold that exact guard once. Do not generalize into a framework or merge setup-only metadata at :84–89.

**Gross 24 existing lines; net 8–12** after a 10–14-line shared check plus two source invocations (format-dependent). The win is one safety-policy owner, not simply shorter shell.

**Counterevidence / behavior:** both entrypoints are independently callable; keep verification on both. run.sh is used by combined-probe.sh:31, integrated-real-probe.sh:36, clock-probe.sh:36 and browser-live-run.sh:7. Both currently exclude OrchestratorReplayFixtures.integration.test.ts from tracked diff hashing but do not allow it as a new untracked path; preserve this distinction rather than silently widening accepted drift. Optional no-patch behavior and binary/source metadata are separate contracts.

**Checks:** bash -n; isolated temporary Git fixture with pinned clean tree, expected patch, wrong HEAD, tracked drift, each currently allowed staged test, and one disallowed untracked file. Compare setup and run rejection behavior without invoking pnpm, a provider, or shared .runtime. Preserve pin/hash validation and explicit refusal to replace an existing runtime (setup:65–67).

### experiments1-03 — Remove unused atlas variables, not the atlas

**Classification:** safe dead-code removal. **Confidence:** high.

experiments/remote-review/index.html:11 declares base but :24 constructs links directly from literal GitHub paths. :23 initializes selected and :24 writes it, but no code reads it; show already takes i and derives the active tab/panel directly. Complete inline-script review (:10–32) and identifier search confirm no dynamic exposure; both variables are inside the IIFE.

**Gross 1 physical line; net 1** by deleting :11; removing the two inline selected fragments adds no line savings. No behavior lost. Do not count deleting the page, evidence copy, static styling, or wisdom links as code-reduction savings.

**Checks:** parse inline JS and smoke tab click/arrow/Home/End focus plus evidence links. Keep aria-selected/tabindex/focus behavior in :24 and reduced-motion/user override in :31.

## Feature cuts requiring human choice

### experiments1-04 — Drop successful exit for the historical broken-question outcome

**Classification:** compatibility/diagnostic feature cut; NOT behavior-preserving. **Confidence:** high.

experiments/remote-native-question-probe/verify.ts:54–83 waits for either delivered completion or the old owner-branch warning, diagnoses the first diagnostic/toolResult sibling layout, and exits 0 when the durable question remains pending unless REQUIRE_NATIVE_ANSWER=1. run.sh:20 invokes this verifier without setting that opt-in. This is deliberate old-binary reproduction support, not just defensive error handling.

The historical fix is documented in wisdom/remote-workspaces/native-question-ownership-fix.md:3–17; the SSH fixture already requires delivered completion (experiments/remote-ssh-native-question/client.ts:38–44). No active CI/tool consumer of REQUIRE_NATIVE_ANSWER was found; wisdom records its deliberate use for strict regression runs. DIE_BIN override still allows old staged artifacts, so do not infer all callers want strict behavior.

**Action if approved:** always require delivered answer/follow-up; remove the warning-success arm, 24-line pending diagnostic branch, REQUIRE_NATIVE_ANSWER switch and outcome alias. Keep the bounded until timeout diagnostics at :12–32. **Gross 29–31; net 25–27.** Behavior lost: a known broken historical binary no longer produces a successful diagnostic run. It should fail clearly; question ownership, rejection, duplicate and reply-ID checks at :33–53,85–101 remain.

**Checks:** saved fixture of pending old warning must fail; delivered fixture must pass; unauthenticated/wrong-choice/unknown-ID replies still reject, duplicate answer must not add a turn. Test these locally with deterministic mocked fetch/status, not a paid provider. Docker/native acceptance is a later optional validation, not something performed in this audit.

### experiments1-05 — Stop maintaining the earlier actual-agent detach runner

**Classification:** optional research-feature cut. **Confidence:** medium; not safe deletion solely because no imports exist.

experiments/remote-agent-probe/run.sh:11–35 owns a full packaged-agent fixture with a four-second disconnected interval and a fresh viewer; :36 optionally exports PROBE_TRANSCRIPT. The later task POC verifier (experiments/remote-task-poc/verify.ts:12–46) checks retry deduplication, contiguous replay, three real model turns across detach, two successful tools, final answer/outcome and an offline CLI transcript. Its runner invokes that verifier at run.sh:58; the SSH runner also invokes it at experiments/remote-ssh-probe/run.sh:104.

**Counterevidence:** predecessor verify.ts:7–26 explicitly checks detach before any completed tool, /work placement, and one agent_end. Those assertions are not textually equivalent to the task POC assertions. The old probe is independently documented and its export was manually used (wisdom/remote-workspaces/remote-agent-probe.md:13). This is a simpler non-journal baseline; task POC is a more complicated owner, not proof that the first experiment has no value.

**Action if approved:** retire this baseline and use the task POC as the supported actual-agent lab. **Owned gross/net 36/36** for this runner only; no unassigned server/client/verifier savings counted. Behavior lost: minimal baseline, its standalone detach timing report and PROBE_TRANSCRIPT export. If coverage must be retained, migrate the missing explicit placement/early-detach/agent_end assertions first; their added lines reduce these net savings and belong to another owner's files.

**Checks:** reference/export-consumer search; compare fixture assertions; ensure the remaining supported runner passes deterministic disconnect/reconnect and preserves full tool output. Keep random container names/token, loopback binding, read-only root, non-root tmpfs ownership, resource caps and owned cleanup (:6–17) in whichever runner survives.

### experiments1-06 — Retire the older deterministic browser replay lane, not live snapshot preparation

**Classification:** optional research-feature cut. **Confidence:** medium.

experiments/t3/preview-v2/browser-followthrough.mjs:8–11 discovers pairing URL from an old dev log; :24–28 navigates fixture-specific welcome/Settled/Previous agents controls with fixed waits and swallowed parent-selection errors. :33–37 then strictly checks a fixed replay child ID, a Hello marker, and inserts a fixture-label overlay. This is not production browser logic or a generic browser helper.

The separate browser-live-followthrough.mjs:79 writes browser-live-proof.json; browser-live-prepare.sh:2,7–12 copies a CLOSED real-engine DB without overwriting existing proof state. The owned JSON labels that lane honestly as a stopped-provider snapshot (:2,18–19). Do not merge these into one generalized fallback script: replay data and engine snapshots prove different things.

**Action if approved:** retire the old replay follow-through lane. **Owned gross/net 44/44.** Behavior lost: rendered static replay parent→child assertion, logs and its two screenshots. Keep the closed-engine lane; it is counterevidence to wholesale preview deletion, not proof of identical coverage. No savings counted for JSON evidence or screenshots.

**Checks:** locate manual consumers/capture instructions; port the exact replay relation assertion to a maintained browser fixture if still required. Retain real rendered navigation assertions, exact marker counts, refresh behavior and clear fixture labels. Never count source hashes alone as rendered proof. If an equivalent test is added, subtract its lines from the net estimate.

### Non-overlapping totals

- Historical scripts + shared guard + unused state: **gross 369, net 353–357** (344 of that is historical archive source, not active runtime complexity).
- Independent optional cuts experiments1-04/05/06: **gross 109–111, net 105–107** before any migrated assertions.
- Combined alternatives above: **gross 478–480, net 458–464**. No patch, pin, docs/wisdom, external files, or evidence JSON counted. Nothing was deleted by this audit.

## Keep rationale and essential boundaries

- **Granted file access is not a redundant wrapper:** experiments/remote-cli-experience/repo-read.ts:12–16 canonical confinement and no-follow open reject traversal, symlink escape and unsafe file kinds. :19's stat size check and :4–9's READ_MAX+1 streaming bound solve different races: the file can grow after stat; strict UTF-8 rejects malformed data. Keep close in finally (:21), nonblocking regular-file check and all bounds. It is used by cli.ts:1 and tested by repo-read.test.ts:5–17. Do not replace it with Bun.file(path).text(). No reduction identified.
- **Durability tests protect real loss boundaries:** log.test.ts:8–16 checks paging/cursor mismatch, oversize, persisted replay, truncation and modified-record corruption; cli.ts:2 uses that EventLog. bounded-log.test.ts:3–7 tests reserve-outcome/count/envelope limits; dependency.test.ts:3–31 tests duplicate/conflict, deny→grant, record injection and coercible IDs. These concise fixtures are not duplicates merely because their implementations also validate input.
- **Protocol and offline verifiers are executable gates:** task-poc/protocol.ts:15–18 rejects auth/version/profile/identity failures, called by run.sh:34; verify.ts is shared with the SSH probe. SSH-native-question/client.ts:27–30 verifies reconnect consistency, :46–57 observes the duplicate actually reaching native RPC, :58–67 performs no network reads after shutdown. HTTP verify.ts:95–100 instead checks unchanged completion after repeat; these are related but not interchangeable coverage. Do not extract a generic assertion framework for these small differing cases.
- **Network lab is intentionally deterministic, not an unauthenticated production service:** server.ts:1,25–40 runs no arbitrary model/code; :79–88 persists accepted intent before responding, :18–23 reports unknown after owner crash rather than replaying effects. :60–68 validates cursor/limit; :90–104 distinguishes exact repeated replies from conflicts. compose.yaml/run.sh configure its service; tests exercise replica safety and admin 204 handling. Atomic rename (:10–12) is fixture persistence, not a claim of fsync/exactly-once durability. No production fallback should be extracted from it.
- **Shared SSH assets are live experiment dependencies:** remote-ssh-probe/sshd.Dockerfile and sshd_config are built/used by remote-cli-experience/run.sh:35, remote-ssh-native-question/run.sh:33 and remote-ssh-probe/run.sh:32. Keep password/interactive auth disabled, no agent/X11/TTY, StrictModes, loopback published ports and host-key verification in consumers. Root public-key fixture login and local TCP forwarding enable the Docker tunnel; they are not an unexplained production compatibility layer.
- **Preview bridge coverage is distinct and useful:** bridge-client.test.ts:5–31 tests fresh-client status/cancel authorization and redirect credential refusal; :42–81 tests protocol/session cleanup, SSE notification/wrong-ID filtering and cleanup on rejection. launch-args.test.ts:5–13 tests four accepted CLI spellings and retaining upstream extensions. These are manually discoverable Bun tests, outside root tests/ and tsconfig.json's includes. Current tests/t3/production-bridge.test.ts:69–124 has related coverage, but not a demonstrated byte-for-byte replacement for this preview client. Keep until preview feature retirement, not by no-import inference.
- **Clock probe cleanup is not excess caution:** clock-launcher.mjs:7–18 records PID start time; clock-probe.sh:18–29 uses anchors before killpg to avoid killing reused/unowned groups. :9 refuses overwriting a pre-existing test; :31 removes only owned staged test/PID file. Preserve timeout and process identity. This historical timing lane is not proven covered by generic SIGTERM smoke.
- **Setup/run isolation is essential:** setup.sh:38–67 stages before publish and refuses replacing a mismatched runtime; :86–89 rejects binary/revision drift. run.sh:9–14 validates ports/overrides and :28–30 isolates HOME/XDG/T3 state. setup's moved ROOT at :4 resolves to experiments/, so its default dist/die/research-mirror paths merit a separate correctness check; that is NOT a proven deletion saving and does not justify removing isolation or provenance checks.
- **Read portion of rollback patch contains security behavior, not junk:** patch:31–118 exercises explicit loopback no-auth and hostile origin/Host rejection; :135–184 implements loopback/same-origin guards; :187–192 creates an administrative principal. Never transfer this privilege without those boundaries. The remainder was not reviewed; no conclusion about dead/duplicated implementations there.

## Per-file verdicts

All paths below are relative to experiments/. Line ranges are current physical lines.

| File | Read | Verdict / findings |
|---|---:|---|
| remote-agent-probe/run.sh | 1–36 | Optional baseline retirement only, experiments1-05; working manual entrypoint/export. |
| remote-cli-experience/log.test.ts | 1–16 | Keep: distinct persisted-page integrity and loss cases. |
| remote-cli-experience/repo-read.ts | 1–22 | Keep: active capability confinement and race-safe bounded read. |
| remote-native-question-probe/Dockerfile | 1–10 | Keep: runner and SSH-native fixture both COPY it; non-root isolated owner. |
| remote-native-question-probe/verify.ts | 1–117 | Keep strict assertions; optional historical BLOCKED-success removal, experiments1-04. |
| remote-network-lab/client.test.ts | 1–53 | Keep: offline replica, invalid-page non-persistence, empty admin DELETE. |
| remote-network-lab/run.sh | 1–28 | Keep: Compose/demo/test/offline entrypoint, owned cleanup/readiness. |
| remote-network-lab/server.ts | 1–111 | Keep: deterministic impairment workload, idempotent launch/reply and unknown-on-restart. |
| remote-review/index.html | 1–33 | Keep interactive atlas; remove unused local variables, experiments1-03. |
| remote-ssh-native-question/client.ts | 1–68 | Keep: transport phase CLI, reached-native duplicate check, disk-only offline evidence. |
| remote-stream-probe/run.sh | 1–9 | Keep: Node strict-check/test/measurement/verifier entrypoint; different runtime purpose. |
| remote-stream-probe/verify.ts | 1–25 | Keep: total event delivery and actual queue/page bounds across 19 scenarios. |
| remote-task-poc/bounded-log.test.ts | 1–7 | Keep: reserve terminal slot and envelope cap coverage. |
| remote-task-poc/dependency.test.ts | 1–31 | Keep: explicit idempotency, denial and typed-record trust boundary coverage. |
| remote-task-poc/Dockerfile | 1–10 | Keep: owner plus required dependency/bounded-log assets; not interchangeable with native-question image. |
| remote-task-poc/protocol.ts | 1–21 | Keep: negative protocol CLI called by task runner. |
| remote-task-poc/verify.ts | 1–63 | Keep: durable/full/offline actual-agent proof, also called by SSH runner. |
| remote-transcript-probe/run.sh | 1–6 | Keep: transcript codec test/probe entrypoint and optional fixture input. |
| remote-workspaces/scenario.ts | 1–15 | Keep: demo.ts:6/client.ts:2 share identical execute source to prove target cwd/dynamic import/shell behavior. |
| t3/preview-v2/bridge-client.test.ts | 1–81 | Keep: auth, redirects, activation no-op, protocol/SSE/session cleanup; preview-specific client. |
| t3/preview-v2/bridge-launch-args.test.ts | 1–13 | Keep: short four-spelling parameterization and upstream extension retention. |
| t3/preview-v2/browser-followthrough.mjs | 1–44 | Optional old replay browser lane cut, experiments1-06; not equivalent to engine snapshot lane. |
| t3/preview-v2/browser-live-prepare.sh | 1–12 | Keep: closed-DB handoff and explicit no-overwrite boundary. |
| t3/preview-v2/browser-live-proof.json | 1–20 | Keep: generated proof/provenance, not maintained executable complexity; no savings claimed. |
| t3/preview-v2/clock-launcher.mjs | 1–34 | Keep: targeted stdin/signal/process-identity diagnostic instrumentation. |
| t3/preview-v2/clock-probe.sh | 1–36 | Keep: pinned owned-process cleanup and no-overwrite probe staging. |
| t3/preview-v2/run.sh | 1–45 | Keep dispatcher/isolation; share duplicate source guard, experiments1-02. |
| t3/preview-v2/setup.sh | 1–109 | Keep materialization/provenance; share duplicate source guard, experiments1-02. |
| t3/production-v2/archive/.agents/rollback/t3-v2-lifecycle/web--t3-source.json | 1–4 | Keep paired historical source identity pending whole rollback review; cannot sever patch provenance. |
| t3/production-v2/archive/.agents/rollback/t3-v2-lifecycle/web--t3.patch | 1–192 of 13028 | INCOMPLETE; next unread 193; no whole-file verdict/savings. Read auth section should not be weakened if ported. |
| t3/production-v2/archive/scripts/build-candidate.ts | 1–84 | Historical non-runnable script retirement candidate, experiments1-01. |
| t3/production-v2/archive/scripts/leak-audit/current-web-client-source-probe.mjs | 1–104 | Historical source-only pin/known-defect probe; retire script, experiments1-01, not current guards. |
| t3/production-v2/archive/scripts/leak-audit/current-web-client-tests.mjs | 1–77 | Historical generated timeout-retention test recipe; retire only archive copy, experiments1-01. |
| t3/production-v2/archive/scripts/leak-audit/current-web-provider-tests.sh | 1–19 | Historical old-pin mocked-provider test selector; retire archive copy, experiments1-01. |
| t3/production-v2/archive/scripts/leak-audit/server-shutdown-probe.mjs | 1–60 | Historical old-server lifecycle diagnostic; retire archive copy, experiments1-01; current shutdown gates remain. |
| remote-ssh-probe/sshd.Dockerfile | 1–7 | Keep shared Docker SSH asset with three known runner consumers. |
| remote-ssh-probe/sshd_config | 1–15 | Keep fixture auth/tunnel/security restrictions; shared Docker asset. |
| remote-cli-experience/repo/.gitignore | 1 | Keep fixture pycache exclusion; negligible source and legitimate repo handoff input. |
| t3/preview-v2/.gitignore | 1 | Keep .runtime exclusion; prevents private caches/state entering snapshots. |

## Checks performed and gaps

- bash -n passed for every assigned shell script; node --check passed for every assigned .mjs. These are parser checks, not proof the archived paths execute.
- bun test experiments/remote-task-poc/bounded-log.test.ts experiments/remote-task-poc/dependency.test.ts: **4 pass, 0 fail, 14 expectations**. Their imported modules are pure validation functions; no container/provider or generated shared file writes.
- Filesystem existence checks confirmed the candidate's missing relocated imports and the old source-probe's missing archive/web/t3-source.json. package/build/CI source and outside callers were traced with scoped rg; default-ignore results were not relied on for hidden archive references.
- No live/provider/Docker/browser tests, setup/install/build commands, destructive cleanup, commits or source edits were performed. External private automation may still invoke manual runners; in-repo absence alone does not authorize deleting them.
- **Main unfinished work: rollback patch lines 193–13,028 (12,836 unread lines).** Continue contiguous numbered chunks from 193, trace each affected upstream file and its test/build uses, then decide historical rollback retention. It is much larger than the completed files and could change the ranking; no estimated deletion credit is taken now. Active current T3 patch is a different input; don't infer equivalence from similar filenames.
- Full feature retirement requires checking unassigned sibling runners/assets and migration assertions with their owners. This report estimates owned savings only. Wisdom/values remain unchanged because this was research-only and existing boundaries already describe these cases.
