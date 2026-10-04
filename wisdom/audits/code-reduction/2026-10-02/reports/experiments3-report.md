# experiments3 maintenance-reduction audit

## Overview

**Partial audit: 62/63 assigned files fully read, 9,167 current lines examined.** The 5,284-line backend-refinement patch is not reviewed (next unread line **1**). This is not an EVERY-line completion claim. The manifest totals 14,450 lines; the current task-poc tsconfig has 16 rather than 15 lines. Coverage records the current file, including its closing line.

This group is mainly purpose-built, manually invoked research harnesses and frozen T3 historical scripts. The best ongoing-maintenance reduction is sharing pinned-SSH fixture setup and deterministic fake-model framing, not removing failure/security assertions. Large physical deletions require choosing to retire historical experiment replay. There is no evidence here that a production feature is unused merely because it has no import.

Only this report and its coverage ledger were written. No production/test/config changes, commits, builds, provider calls, live systems or container launches. Read-only bash syntax checks and Python AST parsing passed. Context: wisdom/values.md and relevant production-preservation/task-poc notes; no wisdom/docs deletion savings.

## Ranked actionable findings

### experiments3-01 — One owner for pinned-SSH fixture setup

**Behavior-preserving refactor; high duplication confidence, medium savings confidence. Gross 100–120 removed lines; net 35–55 lines.**

- Locations: wisdom/experiments/remote-ssh-probe/run.sh:19–72 and wisdom/experiments/remote-cli-experience/run.sh:20–77. Both create three keys, mount only server-side key material, establish a fresh isolated network/container namespace, publish only loopback SSH, write correct/wrong known_hosts, assert wrong-host-key rejection, and retry loopback forwarding with readiness checks.
- Action: extract one narrowly scoped fixture initializer/forwarder into an experiment-local sourced shell helper. Keep owner Docker-context construction, state/volume policy, client function and scenario assertions local. Parameterize the owner fixture and readiness command; do not create a general remote connection abstraction.
- Evidence/callers: each file is an executable entrypoint; SSH runner calls task-poc/client.ts at :72; CLI runner invokes cli.ts at :77. Their main bodies really use the duplicated functions. This is shared implementation, not dead code.
- Counterevidence: CLI uses native-question owner, experience event log, tmpfs and repository/file capabilities; SSH uses durable task-poc volume and transport-byte counters (:107–111). Those cannot be folded into one scenario or dropped.
- Behavior lost: none if startup/cleanup and negative host-key evidence remain identical. Keep StrictHostKeyChecking, isolated key selection, IdentityAgent=none, ForwardAgent=no, wrong-key rejection, resource constraints, only-owned cleanup and bounded bind retries.
- Checks needed: bash -n, then separately rerun both offline Docker/SSH scenarios in a permitted disposable environment; include CLI repository safe/conflict/read/denial/cancel modes and a forced forward-port collision. Verify cleanup leaves no owned containers/keys and both wrong-key tests still fail for the intended reason. Not run here.

### experiments3-02 — Share deterministic OpenAI fixture framing, not controller state

**Behavior-preserving refactor; high confidence. Gross 100–120 lines; net 50–70 lines after helper/import/container-copy overhead.**

- Locations: remote-agent-probe/server.ts:13–27,36–45; remote-task-poc/owner.ts:119–133,146–160; remote-native-question-probe/server.ts:106–141; remote-workspaces/rpc-agent-demo.ts:55–69,79–88 (all under wisdom/experiments/).
- Each constructs the same two chat-completion chunks plus DONE and an execute tool-call envelope. Use one small SSE/execute-call fixture module with explicit id/model/created values. Preserve Bun Response return semantics. Do not absorb filesystem setup, state machines, question ledgers, caps or process lifecycle into it.
- Evidence/callers: server.ts files are copied into Docker contexts by remote-agent-probe/run.sh:11, remote-task-poc/run.sh:11, remote-ssh-probe/run.sh:25, remote-failure-probe/run.sh:11 and remote-cli-experience/run.sh:26. The latter dynamically loads /opt/log.ts (native server :22). A new shared module must be copied into these contexts; relative-import searches alone would miss this build-asset use. rpc-agent-demo.ts is a shebang/CLI entrypoint and has its own viewer/reconnect modes (:9–34).
- Counterevidence: native question fixtures support real persisted questions and file capabilities, task-poc models explicit dependencies and unknown-on-restart, and the early agent probe checks real filesystem/stat behavior. Sharing their model framing does not imply equivalent transport or approval coverage. Keep their individual request/result assertions.
- Behavior lost: none. Metadata currently differs, including a real created timestamp in the local RPC demo; pass those values rather than silently standardizing evidence.
- Checks needed: verify every Docker COPY/staging path; focused fixture response snapshots plus actual offline RPC runs. Ensure tool results feed the second request, execute remains the visible tool, auth/epochs/caps and each controller's cleanup remain unchanged.

### experiments3-04 — Tiny proven-dead state and a tautological guard

**Safe at runtime; high confidence. Gross 7 lines; net 6 lines, plus one unused import identifier (0 line savings).**

- preview-v2/browser-live-followthrough.mjs:17–18 defines the literal marker array and immediately asks whether it contains the literal just inserted. Remove :18: it never checks the target projection despite its error text. Keep real rendered body checks :67–73, exact child route :60, refresh :62–63, and captured-engine identity :76–77. Gross/net **1/1**.
- production-v2/archive/scripts/die-web-smoke.ts:87,371 is an unread local passed flag. :92–93 creates messages solely to calculate another unread local last. Remove those four lines; do not remove passed fields in JSON artifacts. Gross/net **4/4**.
- production-v2/archive/scripts/die-web-mode-smoke.ts:30,109 creates modeRequests and an unnecessary requests alias. Replace them with one typed requests declaration. Gross/net **2/1**.
- remote-cli-experience/log.ts:1 imports existsSync but the complete file never references it. Remove the identifier only: **0 whole lines**.
- Counterevidence: archived scripts deliberately preserve bytes (production-v2/README.md:3–6); changing their provenance is a human archival-policy decision even though execution behavior is unchanged. Prefer leaving these tiny historical changes alone if experiments3-03 is not selected.
- Checks needed: TypeScript unused-symbol check or static reference search, and confirm the browser still rejects missing rendered markers. No lost user behavior or coverage; the tautology was never coverage.

## Feature cuts requiring human choice

### experiments3-03 — Retire frozen old-web executables, keep maintained gates and evidence

**Feature cut: historical rerun/porting convenience. High confidence that these are not active build inputs; medium confidence that nobody needs manual historical replay. Gross/net 3,168/3,168 owned script lines.**

Scope: production-v2/archive/scripts/die-web-mode-smoke.ts:1–475, die-web-model-smoke.ts:1–377, die-web-smoke.ts:1–425, die-web-stop-smoke.ts:1–520, export-candidate.ts:1–67, export-worktree.ts:1–62; leak-audit/bundled-web-runtime.mjs:1–357, current-web-provider.mjs:1–73, current-web-server-check.sh:1–31, current-web-server-runtime.mjs:1–407, web-runtime-probe.mjs:1–374. Prefix: wisdom/experiments/t3/.

- Evidence: production-v2/README.md:3–13 explicitly identifies a byte-preserving historical archive, inactive incremental patches, unchanged now-broken relative paths, no release gate and no automatic execution. scripts/leak-audit/README.md:18–20 points to current product tests/T3 gates instead. The scripts really target old .cache/die-t3code or old pin 719a76... (e.g. bundled runtime :12–14, current server runtime :14–22), and the archived checker still executes its former scripts/leak-audit path (:31). Root build imports integrations/t3/build/build.ts (scripts/build.ts:6); its source manifest is integrations/t3/upstream/source.json (:6). tsconfig.json:11 and package.json:15 scope maintained compile/tests outside experiments. Repository rg found no executable caller into this archive apart from its own stale references.
- Counterevidence: absence of automatic callers is not absence of external/manual use. These are real CLI scripts. Four browser smokes verify different things: compact modes and persistence; actual selected HTTP model; native task/PTY rendering; streaming/shell/idle-worker cancellation. bundled-web-runtime has shipped Bun/no-forced-GC measurements, current-web-server-runtime has inspector/forced-GC measurements, and current-web-provider instruments locks/tasks/logger sinks. Current production tests are not a demonstrated replacement for every one of these historical observations.
- What is lost: rerunning/porting old acceptance harnesses and old exporters, not current application functionality. Keep saved result JSON, captured provenance and patches; count **no docs, wisdom, patch or JSON evidence savings**. Frozen code already has little active maintenance cost: 3,168 is a physical source reduction, not a claim that 3,168 lines are maintained release code.
- Checks before deletion: obtain explicit archival-retention decision; check external scripts/users, all tracked filenames and CLI instructions; map needed current mode/model/PTY/Stop acceptance to maintained T3 gates and rendered tests. Do not replace actual browser acceptance with only backend assertions. Preserve isolated-index export, source drift checks, atomic patch publication and PID-identity cleanup in any retained/current replacement.

### experiments3-05 — Retire the earlier local actual-RPC continuation proof

**Feature cut; medium confidence. Gross/net 428/428 owned lines.**

Locations: wisdom/experiments/remote-workspaces/rpc-agent-demo.ts:1–261 plus wisdom/experiments/remote-agent-probe/client.ts:1–11, Dockerfile:1–8, server.ts:1–148. These repeatedly show one real RPC controller continuing two execute calls after a viewer disappears (local demo :201–240; agent server :46–59,:71–74). task-poc/owner.ts:193–205 retains that model continuation inside the richer fsynced task/epoch owner; task-poc/run.sh:35–58, SSH run :78–104 and failure run :25–54 exercise stronger reconnect/retry/crash cases.

Counterevidence: the early agent fixture checks stat/isFile/path, its run.sh:35 invokes a dedicated detach verifier, and the local demo proves a separate-process viewer over a local journal rather than Docker/SSH. They remain runnable CLI/build assets; no production import is required. This is not a safe claim of full test subsumption. Lose those convenient early proof reproductions; retain local A-vs-B placement demo/runtime (they demonstrate a different controller ownership distinction). Decide whether that older proof is still needed, compare assertions, and retain the unique filesystem checks in the surviving permitted offline harness before cutting. External runners/verifiers require coordinated treatment; their unowned lines are not in this estimate.

### experiments3-06 — Narrower alternative: retire only the older unpinned inspector probe

**Feature cut; high duplication confidence, medium retirement confidence. Gross/net 374/374 lines.**

wisdom/experiments/t3/production-v2/archive/scripts/leak-audit/web-runtime-probe.mjs:1–374 largely duplicates current-web-server-runtime.mjs:1–407: inspector RPC, forced-GC samples, websocket subscribe/interrupt, sequential/concurrent/held/http loops, results and temporary-state teardown. Differences are old .cache/die-t3code selection (:13), missing pin/hash provenance, version-1 results and cleanup that remembers only numeric descendant PIDs (:43–92), whereas the newer harness records startTime and refuses recycled PIDs (:58–119).

Do **not** replace the newer harness with the old one or remove PID identity checks. Do not count the shipped-Bun black-box harness as a duplicate of inspector runs. Human must accept losing pre-pin comparison reproduction; saved historical results remain. Check all manual entrypoints and confirm any desired comparison can use an explicitly ported current harness. This is included in experiments3-03, not additive.

## Savings and overlap

- Ongoing refactor candidates 01+02: gross **200–240**, net **85–125** lines; estimates include added helper/glue code. No security or data-loss boundary removed.
- Small runtime cleanup 04: actual listed gross **7**, net **6** lines; unused import is 0 line savings. Archival byte-policy caveat applies.
- Optional physical cuts 03+05: **3,596** owned lines. 06 is already inside 03; archive portions of 04 are also inside 03. 05 overlaps 02's early agent/local RPC components; if cut, recompute 02 savings only over task-poc/native-question framing instead of adding its full estimate. No global all-findings sum is claimed.

## Keep rationale / essential boundaries

- Persistent acceptance, terminal monotonicity and explicit unknown outcomes: task-poc/owner.ts:77–104,317–325,368–388. Denial/cap/restart cannot be treated as successful continuation; fsync is not needless state. Client identity/epoch and contiguous bounded page checks (:77–112) prevent silently merging unrelated histories.
- Exact Git source capture and return: cli-experience/repo/handoff.py:32–42,49–81,100–148. Preserve omitted untracked privacy, sparse/symlink/gitlink refusal, staged-vs-unstaged fingerprint, prewritten exclusive uncertain-apply receipt, conflict refusal and worktree/index preservation. Repo probe run.py:128–159 checks index-only and nonselected changes; similar helpers enforce different launch policies.
- Human authority: native-question-probe/policy.ts:1–17 and server.ts:182–207,247–282 retain owner/task/id/version scope, exact choice and late/conflicting reply refusal. The fixture's agent-readable bearer is not proof of adversarial human-only authority; do not generalize it into production approval.
- Retained event/transcript caps, gap/torn-tail/UTF-8 failures and original-result integrity: cli-experience/log.ts:15–25,35–49; stream core.ts:40–69,107–126,136–148; transcript probe.test.ts:11–36. All-byte boundaries and single-byte iteration are different decoder delivery patterns; neither is expendable repetition.
- Preview tests intentionally span different seams. bridge.test.ts:34–133 checks actual Die execute advertisement plus rejection through a mocked MCP; combined integration :40–107 checks adapter direct/launcher scope; real integration :150–200 checks idempotent child spawn/cancel, one result delivery, sibling isolation and revoked credentials. Keep these security/ownership assertions, token nonlogging, redirect:error and session close (bridge-client.ts:59–93,122–128). Protocol JSON/SSE paths have tests and are not an unneeded compatibility fallback.
- Isolation tests exercise the actual shell parser and fixture checkout, not just a reimplementation of its guards. integrated-real-probe.sh:8–25 refuses overwriting staged helpers and signals only matching PID start identities. Keep private state, loopback binding and cleanup ownership.

## Per-file verdicts

Line review includes comments, blank lines, configs, saved JSON and the complete 249-line incremental patch, not just executable statements. Indentation was trimmed for compact display in some contiguous chunks, without omitting line content. Initial truncated previews were reread in smaller overlapping chunks; they were not used as full-file proof. The large backend patch is explicitly not covered.

| File | Lines read | Verdict | Findings |
|---|---:|---|---|
| wisdom/experiments/remote-agent-probe/client.ts | 11 | Keep the separate short-lived HTTP viewer; optional early-probe retirement. | experiments3-05 |
| wisdom/experiments/remote-agent-probe/Dockerfile | 8 | Keep non-root container isolation if this early probe remains; optional retirement. | experiments3-05 |
| wisdom/experiments/remote-agent-probe/server.ts | 148 | Keep actual RPC continuation assertions; share fixture framing or retire the early probe. | experiments3-02, experiments3-05 |
| wisdom/experiments/remote-cli-experience/log.ts | 55 | Keep hash-chain, torn-tail rejection, fsync and bounded paging; unused import only. | experiments3-04 |
| wisdom/experiments/remote-cli-experience/repo/handoff.py | 157 | Keep Git capture/integration safeguards and uncertain-apply receipt; not equivalent to the older repo probe. | — |
| wisdom/experiments/remote-cli-experience/run.sh | 188 | Refactor duplicated SSH fixture setup without merging scenario assertions. | experiments3-01 |
| wisdom/experiments/remote-failure-probe/check-canonical.ts | 9 | Keep damaged-replica check: verifies canonical replica was not overwritten. | — |
| wisdom/experiments/remote-failure-probe/check-offline.ts | 10 | Keep offline full-result assertion, not merely successful reconnect. | — |
| wisdom/experiments/remote-failure-probe/events.ts | 33 | Keep independent bounded owner-event paging used during the crash test. | — |
| wisdom/experiments/remote-failure-probe/gate.ts | 44 | Keep real dropped-response gate; discarded response is not equivalent evidence. | — |
| wisdom/experiments/remote-failure-probe/run.sh | 57 | Keep lost acceptance / SIGKILL / epoch / damaged append runner and its external entrypoints. | — |
| wisdom/experiments/remote-failure-probe/tsconfig.json | 1 | Keep isolated noEmit Bun typecheck configuration. | — |
| wisdom/experiments/remote-native-question-probe/policy.ts | 17 | Keep exact payload keys, answer choice and scoped owner/version checks. | — |
| wisdom/experiments/remote-native-question-probe/server.ts | 332 | Keep native-question/capability integration; share deterministic model framing only. | experiments3-02 |
| wisdom/experiments/remote-network-lab/client.ts | 102 | Keep durable simulated replica and contiguous page validation. | — |
| wisdom/experiments/remote-network-lab/compose.yaml | 26 | Keep pinned containers, loopback bindings and resource limits for the network lab. | — |
| wisdom/experiments/remote-network-lab/demo.ts | 180 | Keep real toxiproxy latency/bandwidth/outage comparisons; not covered by application-delay simulations. | — |
| wisdom/experiments/remote-network-lab/results.json | 189 | Keep saved measurements and truthful simulated/sample limitations; no deletion savings claimed. | — |
| wisdom/experiments/remote-network-lab/setup.ts | 10 | Keep independently invoked toxiproxy setup; run.sh invokes it. | — |
| wisdom/experiments/remote-repo-probe/run.py | 170 | Keep isolated staged/index/conflict handoff cases; its old selection policy is not interchangeable with handoff.py. | — |
| wisdom/experiments/remote-ssh-probe/results.json | 31 | Keep saved SSH provenance/counters/caveats; no deletion savings claimed. | — |
| wisdom/experiments/remote-ssh-probe/run.sh | 111 | Refactor shared pinned-SSH fixture setup; retain SSH-specific disconnect/counter assertions. | experiments3-01 |
| wisdom/experiments/remote-stream-probe/core.ts | 150 | Keep event retention/page caps, notice gap signaling and replica duplicate validation. | — |
| wisdom/experiments/remote-stream-probe/probe.ts | 282 | Keep poll/notify/direct comparison and burst/reconnect variants; modeled differences are intentional. | — |
| wisdom/experiments/remote-stream-probe/results.json | 880 | Keep saved benchmark rows; verify.ts consumes them and rerunning overwrites them. | — |
| wisdom/experiments/remote-stream-probe/tsconfig.json | 20 | Keep Node-specific isolated noEmit configuration; not the Bun probe tsconfig. | — |
| wisdom/experiments/remote-task-poc/client.ts | 125 | Keep offline replica and owner identity/epoch/page caps; used by several external runners. | — |
| wisdom/experiments/remote-task-poc/owner.ts | 437 | Keep fsynced stable acceptance and terminal/unknown behavior; share model framing only. | experiments3-02 |
| wisdom/experiments/remote-task-poc/restart-check.ts | 5 | Keep tiny completed-owner restart assertion invoked by run.sh. | — |
| wisdom/experiments/remote-task-poc/run.sh | 117 | Keep distinct original/dependency/denial owners and completed-restart checks. | — |
| wisdom/experiments/remote-task-poc/tsconfig.json | 16 | Keep Bun noEmit configuration (all 16 current lines read; manifest says 15). | — |
| wisdom/experiments/remote-transcript-probe/probe.test.ts | 44 | Keep complete fixture roundtrip, every UTF-8 split, byte-at-a-time and explicit failure coverage. | — |
| wisdom/experiments/remote-wire-bench/bench.ts | 238 | Keep modeled lazy payload/batch/gzip/status comparisons; not equivalent to streaming queue or transcript decoder. | — |
| wisdom/experiments/remote-workspaces/client.ts | 39 | Keep pi-server attach/detach helper and its CLI branch; external usage cannot be inferred from imports alone. | — |
| wisdom/experiments/remote-workspaces/demo.ts | 173 | Keep target filesystem identity and A-vs-B controller-ownership comparison. | — |
| wisdom/experiments/remote-workspaces/rpc-agent-demo.ts | 261 | Optional retirement of earlier local actual-RPC proof; otherwise share model framing. | experiments3-02, experiments3-05 |
| wisdom/experiments/remote-workspaces/runtime.ts | 168 | Keep local controller/TaskManager experiment and shutdown ownership; explicitly not an SSH implementation. | — |
| wisdom/experiments/t3/preview-v2/audit-isolation.ts | 14 | Keep historical protected-artifact audit with its captured baseline; not a current-release gate. | — |
| wisdom/experiments/t3/preview-v2/bridge-client.ts | 142 | Keep authenticated JSON/SSE MCP client and session close; these are protocol variants, not speculative fallback. | — |
| wisdom/experiments/t3/preview-v2/bridge-launcher.ts | 26 | Keep launcher: tests stage/invoke it and it activates inherited session bridge guidance. | — |
| wisdom/experiments/t3/preview-v2/bridge.test.ts | 133 | Keep positive and rejection execute-only model-advertisement proof. | — |
| wisdom/experiments/t3/preview-v2/browser-live-followthrough.mjs | 81 | Remove tautological marker-array guard only; keep exact route, refresh, rendered marker and engine-proof checks. | experiments3-04 |
| wisdom/experiments/t3/preview-v2/browser-live-proof.previous-20260920T180553Z.json | 20 | Keep historical browser proof as evidence; no deletion savings claimed. | — |
| wisdom/experiments/t3/preview-v2/browser-live-run.sh | 24 | Keep explicit isolated browser ports/home/profile launch, not production startup. | — |
| wisdom/experiments/t3/preview-v2/combined-PiAdapterV2.integration.test.ts | 107 | Keep direct and bridge adapter scope/reaping evidence; integration staging is an external caller. | — |
| wisdom/experiments/t3/preview-v2/integrated-real-PiAdapterV2.integration.test.ts | 210 | Keep integrated real orchestrator child/replay/cancel/delivery/auth/revocation assertions. | — |
| wisdom/experiments/t3/preview-v2/integrated-real-probe.sh | 36 | Keep staging refusal, private harness and PID-start-time-aware cleanup. | — |
| wisdom/experiments/t3/preview-v2/isolation.test.ts | 92 | Keep real shell offset injection/decimal normalization/state override/drift fixture tests. | — |
| wisdom/experiments/t3/preview-v2/protected-baseline.json | 17 | Keep historical baseline hashes as audit inputs; no deletion savings claimed. | — |
| wisdom/experiments/t3/production-v2/archive/.agents/patches/last-used-model-incremental.patch | 249 | Keep inactive incremental model-intent patch as provenance; explicit project pin and resumed model distinctions are substantive. | — |
| wisdom/experiments/t3/production-v2/archive/.agents/patches/t3-v2-production-source.json | 4 | Keep inactive upstream source pin as provenance; no deletion savings claimed. | — |
| wisdom/experiments/t3/production-v2/archive/.agents/patches/task-d8a00b29-backend-refinement.patch | 0 | UNREVIEWED: 0 lines examined; next unread line 1. No content-based removal recommendation. | — |
| wisdom/experiments/t3/production-v2/archive/scripts/die-web-mode-smoke.ts | 475 | Optional retirement of frozen old-browser mode probe; preserve unique compact/persistence/mode-vs-reasoning coverage elsewhere first. | experiments3-03, experiments3-04 |
| wisdom/experiments/t3/production-v2/archive/scripts/die-web-model-smoke.ts | 377 | Optional retirement of frozen old-browser model-switch probe; its actual HTTP-model assertions are substantive. | experiments3-03 |
| wisdom/experiments/t3/production-v2/archive/scripts/die-web-smoke.ts | 425 | Optional retirement of frozen old-browser task/PTY probe; unused locals can be removed if no byte-exact archive requirement. | experiments3-03, experiments3-04 |
| wisdom/experiments/t3/production-v2/archive/scripts/die-web-stop-smoke.ts | 520 | Optional retirement of frozen old-browser stop probe; streaming, shell and idle-worker stop cases are distinct. | experiments3-03 |
| wisdom/experiments/t3/production-v2/archive/scripts/export-candidate.ts | 67 | Optional retirement of obsolete candidate exporter; isolated index, race verification and atomic publication remain essential in replacements. | experiments3-03 |
| wisdom/experiments/t3/production-v2/archive/scripts/export-worktree.ts | 62 | Optional retirement of obsolete canonical exporter; isolated index and byte verification remain essential in replacements. | experiments3-03 |
| wisdom/experiments/t3/production-v2/archive/scripts/leak-audit/bundled-web-runtime.mjs | 357 | Optional retirement of old bundled black-box probe; unlike inspector probes it measures shipped Bun without forced GC. | experiments3-03 |
| wisdom/experiments/t3/production-v2/archive/scripts/leak-audit/current-web-provider.mjs | 73 | Optional retirement of old source instrumentation; verifies lock/task/logger retention, not merely RSS. | experiments3-03 |
| wisdom/experiments/t3/production-v2/archive/scripts/leak-audit/current-web-server-check.sh | 31 | Optional retirement of old-pin terminal/auth test-and-pack runner; not an automatic gate. | experiments3-03 |
| wisdom/experiments/t3/production-v2/archive/scripts/leak-audit/current-web-server-runtime.mjs | 407 | Keep exact process-identity cleanup and pin/provenance if old inspector harness retained; optional archive retirement. | experiments3-03 |
| wisdom/experiments/t3/production-v2/archive/scripts/leak-audit/web-runtime-probe.mjs | 374 | Narrow retirement candidate for duplicated older unpinned inspector harness; historical comparison loss requires human choice. | experiments3-03, experiments3-06 |

## Gaps / next work

1. **wisdom/experiments/t3/production-v2/archive/.agents/patches/task-d8a00b29-backend-refinement.patch:1–5284 unread. Next unread line 1.** This large patch remains a separate full-content review task. Archive provenance establishes inactivity, not whether its implementation is duplicated, safe to delete or security-sensitive. No savings counted for it, and no content verdict invented from filenames/diff headers.
2. No live/provider/Docker/browser/full-build/full-suite validation run. Syntax checks do not establish behavioral equivalence of proposed fixture extraction or coverage parity for optional cuts.
3. Caller searches cover tracked repository code/scripts/build/test configuration plus relevant archive/current-owner context. Untracked automation, external users and historical operational invocations cannot be disproven by rg; require confirmation for retirement.
4. Some preview/archive root-relative paths intentionally remain old after relocation. This audit does not repair them or mistake an unrunnable archived location for unused production functionality.
5. No wisdom or values edits: research-only request; existing values already require truthful proof, one execution owner and preservation of human work.
