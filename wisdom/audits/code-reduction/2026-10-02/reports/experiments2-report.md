# Code-maintenance reduction audit — experiments2

## Overview

Read-only research; no production, test, configuration, or wisdom edits and no repository commit. **36/37 assigned files were read completely (1,589 lines).** The 12,861-line archived candidate patch was read only through line 175; its next unread line is **176**. Total examined assigned lines: **1,764/14,450**. This is explicitly **not** a complete every-line audit of the assigned group.

The useful larger reductions are choices to stop maintaining parallel experimental products, not evidence that unimported scripts are dead. Three conditional feature retirements remove **403 assigned physical lines gross, approximately 323–368 net**, allowing 35–80 replacement test lines outside this set. Immediate small safe/current-dependency cleanup removes **7 lines gross / 5 net**. These overlap the feature retirements and must NOT be added to 403. Archived candidate, result snapshots, docs, and wisdom contribute **zero** booked savings.

Context: read wisdom/values.md and relevant remote task POC / upstream-first migration checkpoint context. Current root tsconfig includes src, scripts, integrations/t3 and tests, not experiments. Root package.json runs ./tests; scripts/ci.sh:57 does likewise. integrations/t3/build/build.ts:6 imports the canonical upstream source manifest. Searches of production/build/test/config surfaces found no direct references to these experimental paths, but the experiment runners, Docker COPY instructions, staged test copies, manual workflows, and external invocations below are real counterevidence to “unused.”

## Ranked actionable findings

### experiments2-01 — Retire the standalone remote CLI/repository prototype after moving its unique assertions

**Classification:** feature cut requiring human choice; not safe deletion today. **Confidence:** high that it is a parallel lab implementation; medium that canonical tests can replace all its coverage without further work.

**Assigned scope:** wisdom/experiments/remote-cli-experience/cli.ts:1–105; cli.test.ts:1–16; repo-read.test.ts:1–19; repo/test_handoff.py:1–116. **Gross: 256 lines; net: 196–231** after an estimated 25–60 focused, normally formatted canonical regression lines. Other lab files and runner edits are outside this owner's savings.

**Evidence:** cli.ts independently implements state/journal reconciliation (12–20), HTTP framing (27), launch/repository capture and history transfer (34–50), paged/hash-checked catchup (52–68), patch return/integration (70–81), and human/file replies (83–102). This is a substantial second product surface rather than a thin entrypoint. Canonical equivalents already have tests: tests/remote-client.test.ts:51–69 checks changed owner/retry/offline state; tests/remote-repository.test.ts:21–43 checks tracked working state, staged-index preservation and duplicate integration; :44–64 checks drift and creations; :66–82 checks explicit untracked transfer and hidden edits; tests/remote-capabilities.test.ts:29–34 exercises traversal, escaping symlink, large and invalid UTF-8 inputs.

**Counterevidence / why conditional:** wisdom/experiments/remote-cli-experience/run.sh:77 actually executes this CLI, :88–177 has multiple repository/file-grant cases, and :80–81 offers a manual interactive workflow. cli.test.ts:13–14 proves crash-lagged metadata and a pinned high-water catchup target, not just cursor arithmetic. repo-read.test.ts:16–19 proves a growing opened file remains bounded and the reader did not consume it all. Canonical file access rejects symlinks (src/remote/capabilities.ts:22–33), whereas this lab explicitly allows an in-repository symlink (repo-read.test.ts:9); these are not equivalent implementations. Python tests additionally distinguish capture refusal for assume-unchanged (:35–45), remote staged plus unstaged results (:68–75), index/head/worktree drift (:77–90), and conflicting patch nonmutation (:100–105). Production coverage located so far does not prove every one of these assertions. The lab's deliberate history bundle (cli.ts:38,45,49) also differs from the canonical orphan-baseline/source-commit tests in tests/remote-repository.test.ts:97–114.

**Behavior lost:** old fake-provider HTTP CLI commands, its history-bundle/disposable-repository workflow and in-repo symlink allowance, and Python prototype regression execution. Bruv's shipped CLI must remain unchanged.

**Checks before removal:** inventory each of the seven CLI and seven Python test cases against canonical tests; port missing high-water, fsynced-journal/metadata, file-growth, capture-hidden-edit, unstaged-result and patch-nonmutation assertions; rerun focused remote-client/repository/capability/question tests. Retire the corresponding lab run.sh modes together with their owned implementation; do not simply delete tests and leave live runner commands dangling. Any replacement Docker/SSH demonstration should invoke current source/packaged Bruv, not recreate this HTTP/state adapter.

### experiments2-02 — Drop deterministic browser replay DB population, retaining same-real-child browser proof

**Classification:** feature cut requiring human choice. **Confidence:** high about duplication of acceptance routes, medium about whether deterministic visual fixtures remain desired.

**Assigned scope:** wisdom/experiments/t3/preview-v2/capture-browser-fixture.sh:1–34 and seed-browser-fixture.ts:1–47. **Gross/net: 81/81 lines**, assuming the existing real-snapshot route is sufficient and needs no replacement. No external harness or docs savings counted.

**Evidence:** capture-browser-fixture.sh:12–29 copies and rewrites an upstream integration test to dump its replay result. seed-browser-fixture.ts:19–44 manually mirrors upstream event/projection persistence, including seven table/column mappings (:36–43). Every upstream schema change can require another maintenance pass here. An existing distinct real-snapshot route, browser-live-seed.ts:15–23, verifies actual stored event IDs and adds only project-list metadata. It is invoked by browser-live-prepare.sh:12; browser-live-followthrough.mjs:76 reads the real integrated process proof.

**Counterevidence:** deterministic nested-subagent replay is valuable for reproducible graph/UI fixtures, independently of whether a real integration run exists. It is not identical to the scripted real success/cancel case. These two files are manual entrypoints even without imports. The SQL transaction is real protection, not pointless ceremony.

**Behavior lost:** direct preparation of the deterministic upstream nested replay in the isolated browser database, including its reproducible provider-specific visual fixture. Keep upstream replay tests; this proposal removes only our dump/import adapter, not their graph/replay coverage.

**Checks:** confirm browser workers no longer require .runtime/subagent-v2-nested-result.json or the synthetic database; perform same-parent/same-child rendered-browser acceptance from the real database copy, including nested task display if needed. Keep the real event-ID checks, closed-copy workflow, loopback isolation and truthful fixture labeling. Do not replace this with a generic import mode in browser-live-seed.ts: that would recreate the maintenance burden and weaken its “metadata only” boundary.

### experiments2-03 — Retire the mock-only MCP tool-registration extension

**Classification:** feature cut requiring human choice. **Confidence:** high it is fixture-only; medium for the required test migration.

**Assigned scope:** wisdom/experiments/t3/preview-v2/bridge-extension.ts:1–66. **Gross: 66; net: 46–56**, allowing 10–20 replacement assertion lines outside this set. If experiments2-04 happens first, incremental figures are **62 gross / 42–52 net**; do not count the same four lines twice.

**Evidence:** the file itself declares mock-only ownership (:1). It builds its own tools/list pagination (:9–17), schema adaptation (:21–24), content conversion (:25–28), and Pi tool registrations (:39–60). The real activation file instead makes execute the only model-visible tool (bridge-activation.ts:9–17), leaving upstream's generated extension loaded for approvals. combined-PiAdapterV2.integration.test.ts:75 and integrated-real-PiAdapterV2.integration.test.ts:129 select that activation. The mock extension therefore validates an intentionally different registration path.

**Counterevidence:** bridge.test.ts:42 supplies tools/list descriptors, and :88 explicitly passes bridge-extension.ts to an actual RPC fixture. It is not unused. tools/list pagination, error/result propagation and extension shutdown might still be useful transport-contract checks; do not delete them on the assumption that real-engine success proves every transport case. The similarly named production T3McpClient in src/t3/tasks/mcp-client.ts is a different class, not this fixture's consumer.

**Behavior lost:** model-visible mcp__t3-code__* tools in this old mock fixture, not real execute-only delegation. No production delegation/approval behavior should be lost.

**Checks:** port any missing transport/error/auth/cleanup assertions to bridge-client.test.ts or tests/t3/production-bridge.test.ts, then remove or rewrite bridge.test.ts's explicit extension invocation. Keep scoped bearer authorization, stable request IDs, status recovery, revocation, sibling denial, interruption, and single-owner delegation coverage. Do not merge local subagent and T3 ownership just to eliminate the wrapper.

### experiments2-04 — Small dead-state and current-API cleanup while retaining the labs

**Classification:** safe removal plus behavior-preserving current-dependency refactor. **Confidence:** high for dead state/import and alias; high for currently installed TypeBox API, lower if old unsupported TypeBox versions must remain supported.

* bridge-extension.ts:38,41 creates/pushes registeredNames but never reads it: delete **2 gross/net** lines. Repository search finds those two uses only.
* bridge-extension.ts:8 is a one-line connect→initialize alias, called only at :35. Call initialize directly and delete the alias: **2 gross / 1 net** (including replacing the call line). Retain the actual initialization, list pagination and shutdown.
* bridge-extension.ts:22–23 casts/probes optional Type.Unsafe before falling back to an unrestricted object. The installed typebox exports Type.Unsafe as a function (checked without starting a model). Directly use the required API for supplied schemas, retaining Type.Object for missing schemas: **2 gross / 1 net**. This intentionally stops masking an unsupported dependency API; it does not remove valid descriptor handling.
* cli.ts:7 imports mkdirSync but never uses it: **1 gross/net** line. dirname in :6 is also unused, but removing that import specifier saves **zero physical lines** and is not inflated into savings.

**Total: 7 gross / 5 net.** No behavior lost on current dependencies. These five net lines are all inside experiments2-01/03 feature scopes. No broad helper framework is warranted for such small savings.

**Checks:** focused CLI tests, bridge-client/bridge fixture tests and an experiment-local typecheck; verify malformed/missing schemas and tools/list pagination still behave as before. No full build or paid/live provider run is needed for the dead declarations.

## Feature-cut choices and accounting

Keep all labs: take only experiments2-04 (5 net). Retire only the standalone remote CLI: 196–231 net, plus four bridge cleanup lines if its mock lab stays. Retire all three specified features: **403 gross / 323–368 net**, inclusive of overlapped cleanup. Estimates are physical lines, not token or byte savings; dense one-line tests are not artificially expanded into deletion credit. Retiring a feature is a user decision, not “no import found.” The giant archived patch is explicitly not included in any scenario.

## Per-file verdict and keep rationale

Paths below use these prefixes: R = wisdom/experiments/; P = wisdom/experiments/t3/preview-v2/; A = wisdom/experiments/t3/production-v2/archive/.agents/patches/. Every range is inclusive.

| Assigned file | Reviewed range / verdict |
|---|---|
| R remote-agent-probe/verify.ts | 1–40: keep. run.sh:35 invokes it. Detach-before-result, subsequent model turns, real workspace markers and exactly one agent_end are distinct evidence, not duplicate unit tests. |
| R remote-cli-experience/cli.test.ts | 1–16: experiments2-01 conditional migration, not blind test deletion. Crash-lag, uncertain answer and future metadata cases are unique. |
| R remote-cli-experience/cli.ts | 1–105: experiments2-01 / 04. Keep fsync, intent IDs, owner pinning, unknown outcomes, hash/size bounds, explicit grants and no-overwrite returns unless retiring this workflow. |
| R remote-cli-experience/repo-read.test.ts | 1–19: experiments2-01. Retain growing-file and fatal UTF-8 coverage; its allowed internal symlink differs from production. |
| R remote-cli-experience/repo/test_handoff.py | 1–116: experiments2-01. Preserve staged-index/nonmutation assertions in their canonical owner before retiring the Python prototype. |
| R remote-failure-probe/check-before.ts | 1–11: keep. run.sh:36 needs this pre-kill gate to prove execute is in flight; the later postmortem cannot replace timing control. |
| R remote-failure-probe/check.ts | 1–72: keep. run.sh:47 invokes it; lost-response gate, retry configuration identity, restart-unknown, no blind replay, offline replica and deliberately damaged replica are distinct checks. :59 creates a corruption fixture, not dead output. |
| R remote-failure-probe/results.json | 1: keep as bounded provenance, not executable maintenance savings. It records real blocked-response byte counts and unknown outcome. |
| R remote-native-question-probe/policy.test.ts | 1–22: keep. Exact pending/answered retry and exact native owner/version are separate contracts; property-order equivalence at :18 catches an overstrict comparison. Both native-question runners invoke it. |
| R remote-native-question-probe/run.sh | 1–20: keep. Small direct-Docker/HTTP packaged route differs from the SSH route; copying/staging and readonly container constraints are necessary fixture isolation. |
| R remote-network-lab/admin.ts | 1–12: keep. Imported by client.test.ts:44 and demo.ts:5; centralizes admin response/error handling and timeout. Inlining duplicates those rules for no useful net saving. |
| R remote-ssh-native-question/run.sh | 1–93: keep. Reuses the native-question server but adds genuine pinned SSH/disconnect/offline proof. Host-key rejection :51–58 and reconnect :78–92 must not be replaced by HTTP tests. Bind retries address ephemeral-port races rather than speculative compatibility. |
| R remote-ssh-probe/sshd-entrypoint.sh | 1–6: keep. sshd.Dockerfile:5 copies it as container entrypoint. Mode-600 key installation and exec process ownership are essential; absence of TS imports is irrelevant. |
| R remote-stream-probe/core.test.ts | 1–57: keep. Cursor/epoch, independent history/notice limits, oversized-event nonconsumption, full-frame byte bound and false-vs-true boundary case test different bugs. The last boundary test is not subsumed by broad page tests. |
| R remote-task-poc/bounded-log.ts | 1–6: keep. owner.ts:2 imports it; multiple Docker runners stage it; Dockerfile:5 COPYs it. Terminal outcome reservation prevents silent data loss. Another shared abstraction would be larger. |
| R remote-task-poc/dependency.ts | 1–44: keep. Owner Dockerfile:6 stages it; run.sh:11, remote-ssh-probe/run.sh:25 and remote-failure-probe/run.sh:11 share the owner fixture. Reply and capability validation differ in payload/status semantics; a generic validator adds indirection for little saving. |
| R remote-task-poc/results.json | 1–28: keep bounded provenance. Explicit fake-provider label and false/unproved coverage flags prevent overstating acceptance. Not a docs/data deletion target. |
| R remote-task-poc/verify-denial.ts | 1–10: keep. run.sh:117 invokes it. Denial-terminal/no-resume cannot be inferred from happy-path completion. |
| R remote-task-poc/verify-dependency.ts | 1–36: keep. run.sh:101 invokes it. Independent work while waiting, explicit dependencies, duplicate receipts, absence of premature outcome and final real tool text are distinct checks. Extracting its 5-line JSONL parser and the denial verifier's parser would introduce enough helper/import code to erase savings. |
| R remote-transcript-probe/probe.ts | 1–119: keep. probe.test.ts:3 imports it; :91 is a legitimate standalone benchmark entrypoint. Fatal byte-bounded decoder, framing model and compression measurements have different roles. No equivalent production decoder was established; do not swap in an unrelated line reader that silently replaces invalid UTF-8. |
| R remote-transcript-probe/tsconfig.json | 1–16: keep. Local strict/noEmit check boundary; root tsconfig deliberately excludes experiments. Removing it loses local validation unless explicitly selecting another project. |
| R remote-wire-bench/bench.test.ts | 1–111: keep. Broad :37–49 and exact :60–100 batch tests overlap but one covers a 32-event stream and the other exact byte/time/oversized/out-of-order boundaries. Moving them into one test saves only wrapper/setup lines; no useful coverage-preserving implementation reduction established. Changed-payload :51–58 is stronger than changed-ID :22–24 and must remain. |
| R remote-workspaces/runner.ts | 1–4: keep. runtime.ts:27 selects executablePath dynamically. It is already the desirable 4-line adapter to production's real stdin executor. |
| P bridge-activation.ts | 1–20: keep. bridge-client.test.ts:3 imports it; real integration test :129 launches it by extension path. Single model-visible execute owner while retaining upstream approval hooks is essential behavior. |
| P bridge-extension.ts | 1–66: experiments2-03 / 04. Mock-only, but bridge.test.ts:88 genuinely launches it. |
| P bridge-launch-args.ts | 1–12: keep. bridge-launcher.ts:6 and dedicated test import it. Different documented CLI flag forms and path-equivalent de-duplication are actual launcher syntax, not generic historical fallbacks. Preserve incoming upstream extensions. |
| P browser-live-seed.ts | 1–25: keep. browser-live-prepare.sh:12 invokes it; it verifies same actual events and changes metadata only. Sharing its six SQL lines with synthetic seeding would require a helper plus imports and retain the higher-cost table mappings. |
| P capture-browser-fixture.sh | 1–34: experiments2-02. If retained, keep backup/EXIT restoration and isolated TMPDIR; do not strip safety just to shorten the script. |
| P clock-PiRpc.integration.test.ts | 1–126: keep. clock-probe.sh:34 stages it beside upstream PiRpc.ts, resolving its otherwise nonlocal import. Frozen TestClock pending teardown and real-clock process/transport/stdin closure are complementary; simple status checks cannot replace them. The 3-line closed helper could be inlined but is not meaningful savings. |
| P combined-probe.sh | 1–31: keep. Stages combined-PiAdapterV2.integration.test.ts; its detached process-group cleanup checks /proc start identity (:21–23) before kill, unlike ordinary timeout. Remove neither ownership nor target-overwrite refusal for a shorter runner. |
| P integrated-process-proof.json | 1–82: keep bounded sanitized acceptance evidence. browser-live-followthrough.mjs:76 consumes it. It explicitly limits proof to a scripted case and retains auth/sibling/revocation/finalization outcomes. |
| P integrated-process-proof.sh | 1–33: keep. OS exec evidence distinguishes RPC providers, execute workers and local subagents; counts and allReaped are not interchangeable with application result markers. |
| P seed-browser-fixture.ts | 1–47: experiments2-02. Seven manually mirrored projection mappings are the maintenance hotspot; if retained preserve transaction and isolated database discipline. |
| P upstream.patch | 1–80: keep. setup.sh:10,55 and run.sh:6 apply/verify it. Reconstructed authenticated invocation, same task/transfer ID, unchanged child-turn count and one parent task are meaningful exactly-once reconnect assertions. |
| A t3-v2-production-candidate.patch | **1–175 only; incomplete, next unread 176.** First two auth diffs preserve explicit web-loopback-only no-auth and same-origin/DNS-rebinding protections. No whole-patch verdict or savings claimed. |
| A t3-v2-production-export.json | 1–9: keep pending archive decision. adopted:false, upstream revision, patch hash and clean-apply marker are reproduction metadata; not proof of current adoption. archive/scripts/export-candidate.ts:11,48 produces its patch/metadata pair. |
| A t3-v2-production-migration-packaging.patch | 1–60: keep pending archive decision. The dynamic binCli import and explicit-args Promise API coexist with upstream standalone runCli; the overload is an embedding boundary, not proven dead fallback. Current production uses canonical integration source, but manual archived replay remains possible. |

## Essential boundaries to keep

* Human-owned decisions are not fabricated by a controller or inferred from model text. Native owner/version, exact pending question, idempotent receipts, denial-terminal and task-ended file-read refusal must remain.
* Stable intent IDs plus persisted pre-send state prevent ambiguous retries becoming duplicate work. Restart uncertainty stays unknown; epoch mismatch refuses merge, never triggers blind replay.
* Transcript bounds must reject/mark gaps rather than silently claim completeness. Preserve byte-based record/frame caps, fatal UTF-8, fsynced journal reconciliation, bounded growing-file reads and reserved terminal outcomes.
* Repository capture must not leak unselected files/history; returned patches must not overwrite drift, staged index, mismatched snapshots, new/untracked remote files or conflicting previous results. Canonical history omission is intentionally safer than the disposable lab bundle.
* Loopback publishing, pinned SSH host keys, no forwarded agents/credentials, readonly fixtures, and start-identity-aware owned-process cleanup are security/lifecycle boundaries. Never turn deletion savings into weaker authorization or broader cleanup.
* Real browser proof must refer to real exported event IDs/children. Synthetic replay may be retained for fixtures but cannot substitute for that acceptance claim.

## Checks performed and gaps

Passed bounded, offline checks with Bun 1.4.2: 21 tests across cli.test.ts, repo-read.test.ts, policy.test.ts, bench.test.ts and the outside-set transcript probe.test.ts; 4 stream core tests; 7 Python handoff tests with PYTHONDONTWRITEBYTECODE=1. These wrote only test-owned temporary files/repositories and ephemeral local fixture state, not checkout source/generated assets. Scoped git status for assigned experiment directories remained clean. Installed TypeBox API inspection reported Type.Unsafe = function.

No full build/suite, Docker/SSH runtime, paid model, Pi provider process, Live system, browser capture, archive apply/export/build or root asset preparation was run. Bridge/clock/integrated behavior above is source/reference evidence, not a fresh acceptance run. Static reference searches cannot exclude every external/manual invocation.

**Major coverage gap:** A/t3-v2-production-candidate.patch lines **176–12861** were not read (12,686 lines). Resume at 176, in contiguous bounded chunks, then trace each diff's canonical replacement and archived consumers. archive/scripts/build-candidate.ts:10–18 still names/verifies the candidate; archive/scripts/export-candidate.ts:11 names its output. Their paths are archive-relative and should not be assumed runnable unchanged; neither archival location nor an adopted:false manifest proves no historical reproduction value. The current canonical-source migration context favors removing replaced custom maintenance, but it does not justify unreviewed wholesale deletion. No generic “large patch bad” finding or 12,861-line savings is booked.

Wisdom/values unchanged: research-only authorization and existing values already cover the observations. No documentation cleanup is proposed.
