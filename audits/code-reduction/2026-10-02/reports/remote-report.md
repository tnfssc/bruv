# Remote code-maintenance reduction audit

## Overview

Read every line of all **37 assigned files / 9,312 lines**, including large files in contiguous bounded chunks. Initial truncated displays were reread in bounded chunks; coverage is not inferred from grep. Manifest counts match current files. This was research only: no production, test, configuration, wisdom or build changes; no provider calls, SSH connections, live systems, build or test suite executed.

The clearest opportunities are an unused capability implementation, an almost byte-identical SSH transport, and test-driven fallback/dead rendering paths. **remote-01–07 together: approximately 410–425 gross production lines removed, 300–350 net production lines**, plus approximately **40–60 net test lines** for remote-01 after retaining/moving meaningful assertions. These are estimates, not patch measurements. No docs/wisdom count toward savings. Feature cuts below are alternatives, not additive totals.

Context read: wisdom/values.md; relevant typed-root-owner, startup-replay-followup and untracked-preview-and-lock notes. Particularly important: preserve immutable launch/reply identity, distinguish delivery from settlement, do not replay unknown work, and do not discard user caches to simplify startup.

## Ranked actionable findings

### remote-01 — Remove the unused volatile capability implementation; test the durable implementation instead

- **Class:** safe removal of unused production implementation; coverage-preserving test consolidation. **Confidence: high** for current repository, not a claim about unpublished external consumers.
- **Location:** src/remote/capabilities.ts:54–173, plus class-only randomUUID import at :1 and Handler/Pending/bytes/valid at :12–16. Keep the shared types at :8–11, maximum at :7, confinement helper at :17–52, and Grant if the durable client still uses it.
- **Evidence:** a no-ignore search across src, tests and scripts finds LocalCapabilities/allowOwnerGrant only in this definition and tests/remote-capabilities.test.ts:5,20,40–43,56,66,80. No CLI registration, dynamic lookup, build asset or script entry uses the class. Actual production flow is OwnerCapabilityMailbox and ClientCapabilityStore in capability-runtime.ts:103–308,385–471, called by services.ts:44–79,123–146,197–210 and owner.ts:241–265,473–477. The volatile queue has different duplicate semantics (submit returns false; durable reply returns true for identical retry), so it is not even a faithful production fixture.
- **Counterevidence:** capabilities.ts itself is live: durable code imports readGrantedRepoFile and common types (capability-runtime.ts:7–14,436–455). Its filesystem security tests at tests/remote-capabilities.test.ts:29–37 are useful and must remain. Do not delete the file wholesale.
- **Tests:** remove the four tests exercising the retired class (:18–28,38–63,64–76,78–94), but move missing wrong-task/wrong-kind/output/input-limit/revocation assertions into real-store tests before deleting them. tests/remote-capability-runtime.test.ts:18–38 already covers reload/identical replay/conflicts; :39–66 covers abort/deadline/revoke/terminal fencing; :67–104 covers sensitive paths, named skills/tools and revocation. Retain traversal/symlink/binary/nonregular/oversize tests against the real reader. Generic arbitrary handlers (tool:echo/tool:slow) are not a shipped feature and need not be ported as a second implementation.
- **Savings:** production gross ~126, net ~124–126. Test gross ~69–76, net ~40–60 after assertion relocation. **Behavior lost:** no shipped behavior; only the unused in-memory handler API and its self-tests. Recheck repository-wide references and run focused capability/runtime/service tests when implementing.

### remote-02 — One SSH stdio transport, parameterized by the fixed control entrypoint

- **Class:** behavior-preserving refactor. **Confidence: very high.**
- **Location:** src/remote/ssh.ts:1–84 and src/remote/root-transport.ts:1–84.
- **Evidence:** read-only diff shows exactly three differences: imported type, exported function name, and --remote-control versus --remote-root-control at :34. Spawn flags, quoting, timeouts, output limits, teardown and parse errors are identical. Both are live: client.ts:63,118 and root-client.ts:35,110.
- **Change:** retain one internal transport implementation taking only a fixed trusted entrypoint choice; expose the existing typed adapters as thin wrappers (or update their internal imports). Share validHost/validPath too. Do not make arbitrary remote commands agent-provided.
- **Keep:** BatchMode, strict host checking, no forwarding/local command/credential delegation, executable quoting, bounded response/stderr, TERM-to-KILL escalation, and unknown-outcome errors. These are not gratuitous fallback code.
- **Counterevidence/tests:** tests/remote-root-transport.test.ts:5–37 verifies root command/SSH flags; tests/remote-ssh.test.ts:6–44 exercises oversized output from a TERM-ignoring peer. These are complementary, not duplicate tests to drop. Exercise both adapters through the same fake-ssh fixture, including spaces/apostrophes in executable paths and no-TTY flags.
- **Savings:** gross ~84, net ~72–78 production lines. **Behavior lost:** none.

### remote-03 — Require the configured question service in the root runtime

- **Class:** behavior-preserving production refactor / removal of test-only fallback. **Confidence: high.**
- **Location:** src/remote/root-runtime.ts:8–15,43–44,48–85, especially :51–84.
- **Evidence:** the only production registerRootRuntime caller is src/agent/extension.ts:612–615 and always supplies questions.service plus questions.syncRemote. That configured ordinary runtime owns continuation and SSH-mirror dispatch. The fallback constructs a new QuestionService and manually duplicates queued → dispatching → sendMessage → delivered logic, although production immediately returns at :51.
- **Change:** make RootJobs.questions required, synchronize it and use its service directly; answering returns the configured service's saved question. Remove the manual continuation branch, not the actual QuestionService owner/version checks or configured callback.
- **Counterevidence:** tests/root-runtime.test.ts:53–60 supplies only jobs, and its IPC test :119–127 explicitly expects the fallback to send one message. Update this fixture to supply the real configured continuation service rather than retaining a second production path to satisfy it. The configured-path test :146–179 already asserts one onAnswered callback and zero duplicate backend messages. Other fixture-only dispatchRootFacet callers must also supply questions.
- **Savings:** gross ~36–40, net ~30–35 production lines; no test deletion savings assumed. **Behavior lost:** standalone internal test/harness invocation without a configured question service, not shipped root behavior. Run root-runtime tests with real service wiring; preserve wrong token, stale version, wrong branch, retry-once and incomplete-close checks.

### remote-04 — Remove impossible detail branches and the nonexistent record.messages fallback

- **Class:** safe dead-code removal for the detail branches; current-protocol refactor for synthetic snapshots. **Confidence: very high / high respectively.**
- **Location:** src/remote/root-presenter.ts:360–493, especially :363,404–449; synthetic snapshots at :320–321,653–654,710–711.
- **Evidence:** render returns expandedRootTranscript immediately at :363 when details is true. Thus every subsequent !this.details gate is invariably true during ordinary rendering, and :441–449 is unreachable; the label assembled at :417–422 is used only by that unreachable block. Expanded rendering already has its distinct live implementation at :280–305. Keep that, Ctrl-O, compact action captions, failure reasons and task rows.
- **Snapshot evidence:** RootRecord (root-contract.ts:45–53) has no messages field; RootStore/owner never populate one. A search for messages in root-contract/root-store/root-owner/root-client finds no producer. Current snapshots carry root_facets/jobs/taskRows, not a full conversation replacement. Consumers cast record to any solely for this hypothetical envelope. Tests fabricate it with as any (tests/remote-root-presenter.test.ts:108,208,279,432), rather than exercising actual wire observations.
- **Change:** delete unreachable expanded-action code and unneeded gates; replay message_end events in test fixtures instead of giving RootRecord a made-up messages property. Keep event replay, hidden display:false content checks, real facet snapshot handling and retention-gap warnings. This does not solve bounded history gaps; neither did the nonexistent fallback.
- **Counterevidence:** these tests express useful privacy/reopen semantics; do not remove those assertions. External custom producers of an undocumented messages field were not examined. If that is an intentionally supported contract, declare it and fix the real owner instead of calling it dead.
- **Savings:** gross ~25–30, net ~24–29 production lines; test-fixture rewrites not counted as savings. **Behavior lost:** none with the current typed owner; hypothetical undocumented messages envelope stops replacing event history. Run root-presenter tests in both detail modes, task completion/error/handoff, hidden internal answers, streaming, and reconnect replay.

### remote-05 — Share the four equivalent durable JSON replacement helpers

- **Class:** behavior-preserving refactor. **Confidence: high.**
- **Location:** src/remote/owner.ts:37–53; services.ts:26–43; repository-wire.ts:35–51; root-client.ts:79–97.
- **Evidence:** all serialize JSON, exclusively create a private UUID temp file, sync the file, close it, rename to destination, then sync the parent directory. There are four local maintenance copies of the same mechanism. services adds parent mkdir; root-client adds cache-size validation. Preserve these at the callers.
- **Change:** one feature-local synchronous durableJsonReplace helper and small caller-side setup/limits. Preserve current error propagation and durability ordering; avoid a configurable all-purpose storage framework.
- **Counterevidence:** capability-runtime.ts:44–71 uses immutable link-if-absent, not replacement; artifacts.ts:112–138 writes validated binary content; source-approval.ts:43–47 currently does not fsync; client.ts:170–201 is asynchronous with chmod/cache limits/cleanup. They are *not* equivalent replacements to collapse indiscriminately. No savings for those are counted. SQLite journals also have distinct ownership semantics.
- **Savings:** gross ~71, net ~35–48 production lines after one helper/imports and preserved mkdir/limit wrappers. **Behavior lost:** none. Run owner/client/repository-wire/root-client tests with failed writes and retry evidence; verify mode 0600 and file+directory fsync remain. Do not relax immutable receipts or add an overwrite fallback.

### remote-06 — Replace the staged integration probe with a real typed import

- **Class:** behavior-preserving refactor. **Confidence: high.**
- **Location:** src/remote/jobs.ts:314–322; repository-wire.ts:276–283; jobs.ts:6 already imports repository-wire.
- **Evidence:** jobs dynamically imports a module it already statically imports, casts away the type, declares launchPreparedRepository optional and throws an integration-missing error. The function is now present/exported in the same build at repository-wire.ts:277. This is a leftover optional-integration probe, not a real runtime module option.
- **Change:** statically import the trusted prepared entrypoint and call it when the default repositoryLauncher and durable preparation are selected. Keep injected launcher behavior for tests. Type the prepared arguments so absence is a compile-time failure.
- **Counterevidence/security:** do not bypass the prepared entrypoint or delete its validation simply because launchRepository also validates when preparedSnapshot is present. Its unconditional validation rejects untyped callers with missing prepared bytes; that is meaningful. Tests/remote-source-approval.test.ts:255–281 uses an injected launcher; tests/remote-repository-wire.test.ts:172–179 proves prepared bytes are not silently recaptured after approval.
- **Savings:** gross ~11, net ~7–9 production lines. **Behavior lost:** only a impossible-in-current-build optional integration error. Run source approval and repository-wire tests, including unchanged retry intent and pinned digest corruption.

### remote-07 — One validated repository-result downloader for child and root clients

- **Class:** behavior-preserving refactor, lower priority. **Confidence: medium-high.**
- **Location:** src/remote/repository-wire.ts:415–445 and root-client.ts:411–438.
- **Evidence:** both request offset pages, base64-decode, enforce chunk/total/next-offset bounds, ensure stable result metadata, concatenate bytes, verify snapshot+digest and save the patch. The root copy additionally checks canonical base64 and uses a 32 MiB MAX; child uses a 128 MiB MAX and bounded page count. Those differences should be explicit options, not accidentally erased.
- **Change:** a small downloader accepting a request callback, maximum bytes and expected snapshot, returning verified bytes/result. Keep identity fencing, successful-completion gates, locks, receipts and integration in their existing owners. Use strict decoding on both, and preserve each caller's limit.
- **Counterevidence:** the enclosing workflows are not duplicates: a root returns only after closed/exit0, while a child returns after verified done; their local descriptors and lock policies differ. Do not merge clients/owners wholesale. An abstraction that needs separate state machines would not reduce maintenance.
- **Savings:** gross ~59, net ~10–20 production lines. **Behavior lost:** none; malformed noncanonical child base64 would become rejected (stricter invalid-input handling). Run remote-repository-wire/root-client tests for empty patches, changing metadata, gap/no-progress, mismatched digest/snapshot, large transfers, offline retries and review-only results.

## Feature cuts — human choice, not safe-removal claims

### remote-08 — Retire the alternate legacy /remote task inbox/launch/answer workflow

- **Class:** feature cut. **Confidence: high about overlap, medium about net scope.**
- **Scope/evidence:** extension.ts:50–56 explicitly filters session-owned work out of the old inbox. New owned tasks already use jobs and /questions (jobs.ts:153–501; question-bridge.ts:48–168; agent/extension.ts:582–585). Nevertheless extension.ts:221–559 maintains a second choose/picker/question/launch/retry/cancel flow; :585–678 maintains old launch/launch-repo(-json)/answer commands; menu.ts:32–164 maintains legacy menus; human-rendering.ts:293–408 and extension.ts:81–88,147–156,195–209 maintain their own notice/history dedup path. client.ts:515–587 is the separate answer client; question-bridge uses control(), not answer().
- **Possible cut:** leave connect, diagnostic cached status/transcript, and owned jobs/questions/source approvals; stop creating new work via legacy launch commands, remove the unowned interactive task inbox and its old answer route. Preserve old cache readability, result artifacts and explicit reconciliation or provide an intentional read-only archive view. Do not delete caches or infer old tasks have completed.
- **Counterevidence/behavior lost:** these are live human entrypoints, not dead code. scripts/remote-e2e.ts, remote-pty-e2e.ts, remote-recovery-e2e.ts and remote-capability-pty-e2e.ts exercise them; tests/remote-extension.test.ts:45–50 tests path parsing; :1371 tests owned/unowned split. Human launch now tags jobSessionFile (:437,:588,:634), so it also affects live owned jobs even though the inbox excludes them. Removing it loses direct-existing-server-repo child launch, legacy untracked confirmations, old inbox actions and /remote answer syntax. Legacy uncertain task/repository IDs need an explicit reconciliation path, not silent replacement.
- **Keep/rehome:** capabilityMenu at extension.ts:244–379 contains essential human grants/offline revoke controls; retain it behind an owned-task action or equivalent command. Do not count its 136 lines as deleted while keeping grants. Keep safe human rendering and question/owner validation.
- **Savings:** gross ~600–850, net ~500–750 production lines after replacement diagnostics/capability access/reconciliation, **excluding** remote-01–07 and any test/fixture deletion savings. Bound depends on chosen archive UX. Test reduction only after remapping important offline/reopen/reply-loss/cancel/source-conflict assertions to normal owned placement; no fixture-wide deletion estimate. Needs user decision plus actual terminal validation (menu/back, narrow screen, offline, reopen and old uncertain work).

### remote-09 — If main-agent SSH placement is not wanted, retire the entire typed root subsystem

- **Class:** major optional product cut, not a cleanup recommendation. **Confidence: high scope.**
- **Location:** root-cli.ts:1–56, root-client.ts:1–458, root-contract.ts:1–77, root-entry.ts:1–23, root-options.ts:1–76, root-owner.ts:1–619, root-presenter.ts:1–733, root-runtime.ts:1–219, root-store.ts:1–215, root-transport.ts:1–84: **2,580 assigned lines**.
- **Evidence:** actual integration is src/cli.ts:167–198 (--remote-root-* and --place startup), src/agent/extension.ts:612–615 (private root facet server), and scripts/build.ts:45–47 (CLI bundling). The entrypoints are shipped even though normal task placement does not import root files. Existing child SSH jobs use owner/client/jobs, not RootStore/RootTranscript. Tests/fixtures/remote-typed-root-placement and root-owner/runtime/client/presenter tests are counterevidence of deliberate product support.
- **Behavior lost:** main root running on the server with local thin TUI, durable attach/detach, root human dialogs/jobs/questions, close-with-child-settlement, root snapshot return and --place startup. Ordinary delegated SSH tasks can remain. Keep archived root state/results; removing code is not authority to delete sessions or orphan active owners.
- **Savings:** gross 2,580; net ~2,550–2,580 assigned production lines, before external CLI integration cleanup; no test/docs savings counted. **Alternative, not additive:** absorbs root-side savings of remote-02/03/04/05/07. Confirm strategic removal, reject old flags clearly, audit active-root retirement, then verify local startup and child SSH placement. Do not call this a small harmless feature.

### remote-10 — Drop parent-repository capability RPC if snapshots suffice

- **Class:** optional feature cut. **Confidence: medium-high.**
- **Scope:** capability-runtime.ts:1–471; services.ts:44–148,169–215; capability-specific portions of capabilities.ts:7–52, owner.ts:233–265,473–477, protocol.ts:18–20,61–62, extension.ts:244–379,679–691; matching needs/grant/revoke menu/render branches. security.ts remains required by repository snapshots.
- **Evidence:** requestLocalCapability only operates under BRUV_REMOTE_RUNTIME_STATE (services.ts:181–182); snapshots already provide a remote repository. Explicit grants are therefore an additional product capability, not required to launch delegated work. There is no whole-machine transfer or credential copy to preserve as a fallback.
- **Behavior lost/counterevidence:** remote workers can no longer ask the parent for current bounded repo reads, named skills, git status/diff; offline durable capability waits/replies/revokes disappear. Live grant/revoke commands and capability PTY/runtime tests demonstrate it is implemented, not dead. Users depending on updates or local-only skills lose those workflows. The direct source snapshot and normal human questions must remain.
- **Savings:** roughly gross 850–1,050, net 800–1,000 production lines after clear unsupported-operation responses, assuming remote-01 already removed; no test/fixture savings counted. Overlaps remote-08 capability UI and remote-05 services helper savings: do not add those twice. User must choose snapshot-only workflow, retain old grant/reply state as an archive rather than auto-reviving authority, and verify remote placement, source approvals and result return without capability fallback.

## Keep rationale and per-file verdict

Each range below is the complete assigned file (not sampled); finding IDs identify opportunities, not authorization to delete the file.

| File (all lines read) | Verdict / essential reason | Findings |
|---|---|---|
| src/remote/artifacts.ts:1–239 | Keep task-owned allowlisted text artifacts, digest/offset checks, symlink refusal, limits, incomplete manifests and retry cache. Binary save differs from JSON helpers. | — |
| src/remote/cancellation.ts:1–76 | Keep native owner cancellation route and paginated settlement proof; acknowledgement is not exit. Commands are used as RPC prompt entrypoints by owner.ts:608. | — |
| src/remote/capabilities.ts:1–173 | Remove volatile class; keep actual bounded confined reader/types unless capability feature intentionally cut. | remote-01, remote-10 |
| src/remote/capability-runtime.ts:1–471 | Keep durable immutable mailbox, task/grant/request fences, bounded queues and safe local read tools. Not replaceable by volatile maps. | remote-10 |
| src/remote/client.ts:1–618 | Keep pre-network intent, cache locks, pinned owner/epoch, contiguous transcript, uncertain cancel/reply state, fair refresh. Legacy answer API is cut-dependent. | remote-08 |
| src/remote/entry.ts:1–50 | Keep compiled bounded stdin endpoint and strict field allowlist; CLI dynamic import at cli.ts:150 is real usage. Wrapper reduction alone is negligible. | — |
| src/remote/extension.ts:1–751 | Keep connect authority, refresh isolation/generation, actual runtime registration and grant/revoke controls. Alternate legacy inbox is the substantial optional cut. | remote-08, remote-10 |
| src/remote/human-rendering.ts:1–443 | Keep terminal-safe readable status/transcript, gaps/review warnings; legacy notice dedup can go only with old workflow. Do not replace human display with raw protocol. | remote-08, remote-10 |
| src/remote/job-artifacts.ts:1–58 | Keep capture of scoped native output before CLI buffer release; output-loss/pagination/10 MiB warnings are useful boundary proof. | — |
| src/remote/job-delivery.ts:1–100 | Keep durable completion/attention outbox, identity dedup, leased claims and bounded retry. Not redundant with volatile event source. | — |
| src/remote/job-events.ts:1–52 | Keep session-scoped volatile observations/subscriptions and monotonic terminal guard. It projects, never authorizes. | — |
| src/remote/job-observations.ts:1–121 | Keep durable session attribution, cached labels, bounded final/actionable context and compact completion summary. Parsing preview does not confer authority. | — |
| src/remote/jobs.ts:1–501 | Keep normal job adapter, role/depth rules, immutable owned lookup, source approval, stable cursors and partial stopWork truth. Remove optional-integration probe. | remote-06 |
| src/remote/menu.ts:1–231 | Keep sanitization/pending-question projection used by observations; legacy-only picker/action/completion parts are cut-dependent. | remote-08, remote-10 |
| src/remote/operations.ts:1–78 | Keep bounded diagnostic transcript/status and explicit legacy-launch denial; types are used by typescript/job-bridge.ts:108–110. Do not turn launch compatibility into a delegation bypass. | — |
| src/remote/owner.ts:1–856 | Keep real detached child execution, boot/PID fencing, journal bounds/continuity, answer receipts and native-settled completion. Share replacement helper, not owner state machines. | remote-05, remote-10 |
| src/remote/placement.ts:1–46 | Keep server-side untrusted role/depth/workspace validation and explicit child environment. Client checks are not a substitute. | — |
| src/remote/protocol.ts:1–78 | Keep task wire contract distinct from root wire semantics; capability variants are feature-dependent. | remote-10 |
| src/remote/question-bridge.ts:1–180 | Keep real question mirrors, parent branch pin, CLI-human provenance, same reply ID and uncertain dispatch reconciliation. Not a parallel question authority. | — |
| src/remote/repository-wire.ts:1–503 | Keep immutable descriptors, upload continuity/digest/orphan-history checks, prepared-source validation, successful-return gates and repo locks. Share atomic/downloader mechanics only. | remote-05, remote-07 |
| src/remote/repository.ts:1–396 | Keep safe orphan snapshot and conservative integration. Index/HEAD/work fingerprints, exact untracked approval, unsupported-tree refusal, retained patches and attempted-apply receipts prevent loss/disclosure. | — |
| src/remote/root-cli.ts:1–56 | Keep genuine root depth check and human-pinned target resolution; no local coordinator/provider starts. | remote-09 |
| src/remote/root-client.ts:1–458 | Keep durable pointer/command IDs, root intent pin, cache limits and closed/exit0 source return. Share two mechanical helpers. | remote-05, remote-07, remote-09 |
| src/remote/root-contract.ts:1–77 | Keep typed root commands/dialog semantics separate from delegated tasks; messages envelope is not declared here. | remote-09 |
| src/remote/root-entry.ts:1–23 | Keep compiled root control endpoint, flushed response and bounded stdin; not unused just because dynamically imported. | remote-09 |
| src/remote/root-options.ts:1–76 | Keep deliberate main-session placement parsing and local/remote option separation. This is a CLI entry contract, not unused import clutter. | remote-09 |
| src/remote/root-owner.ts:1–619 | Keep durable once-only root acceptance, claims, actual model verification, private facet IPC, dialog type checking and confirmed successful close. Child owner is not a compatible replacement. | remote-09 |
| src/remote/root-presenter.ts:1–733 | Keep actual thin TUI, human controls, compact/expanded views, task rows and detach-not-abort semantics; remove unreachable/synthetic branches. | remote-04, remote-09 |
| src/remote/root-runtime.ts:1–219 | Keep authenticated private facets and real jobs/questions/cancellation settlement; require configured service rather than fallback continuation. | remote-03, remote-09 |
| src/remote/root-store.ts:1–215 | Keep FULL/WAL durable acceptance/commands, claims before dispatch, canonical immutable intent, ordered retained event gaps and no automatic respawn. | remote-09 |
| src/remote/root-transport.ts:1–84 | Replace duplicated mechanics with fixed root adapter; endpoint and SSH security stay. | remote-02, remote-09 |
| src/remote/runtime.ts:1–118 | Keep private child checkpoint, native questions and paginated jobs/artifact settlement; settled model turn alone cannot close native work. | — |
| src/remote/security.ts:1–11 | Keep shared credential/config path exclusion. It is not a secret-content scanner and is still needed for snapshots even without capabilities. | — |
| src/remote/services.ts:1–215 | Keep result/artifact servicing and authoritative capability requests; share JSON helper, optional capability feature is separate. | remote-05, remote-10 |
| src/remote/source-approval.ts:1–250 | Keep exact human CLI provenance, pinned include/omit bytes, unchanged retries and cancellation. Two captures are not a proven needless duplicate: choices must reference immutable input, not recapture later. | — |
| src/remote/ssh.ts:1–84 | Keep one canonical secure transport implementation; root difference is only fixed entrypoint. | remote-02 |
| src/remote/untracked-preview.ts:1–53 | Keep bounded NUL inventory, lower-bound counts and no bulk approval after truncation. Backend full snapshot inventory serves a different security job. | — |

## Security/data-loss boundaries that must survive reductions

- Human target authorization is separate from cached connectivity and credentials; no agent-selected host or implicit credential transfer. Keep no-forwarding SSH flags and executable quoting.
- Keep role/depth validation on both sides, and genuine root isolation. Legacy tool launch denial is intentional policy, not dead compatibility behavior.
- Save immutable task/command/reply identity *before* dispatch, and preserve unknown outcome. Do not replace uncertain work, steal another parent session, infer completion from assistant prose or treat cancel acknowledgment as terminal exit.
- Keep explicit human source inclusion and grant/revoke provenance. A remote request/worker answer is not permission. Offline local revoke must not wait for owner connectivity.
- Keep confined regular-file readers, credential-path exclusion, Git hook/filter/textconv restrictions and orphan history-free transfer. Security checks with similar names guard different trust boundaries.
- Keep transcript continuity/gap reporting, output/disk limits, original artifacts and uncertain apply receipts. Review-only fallback for changed local index/HEAD/work, new/deleted/mode-changed paths and untracked results is essential, not gratuitous compatibility.
- Keep private root token/socket stripped from child/execute environments (outside-set integration), authenticated human facets, configured continuation ownership, closed/exit0 return and complete child cancellation inspection.

## Gaps / scope of evidence

Every assigned source line is reviewed; there is no next unread assigned line. Outside-set investigation was targeted reference tracing and relevant test/build/script excerpts, not an exhaustive audit of all tests/fixtures or external automation. Unpublished external import consumers and persisted state written by historical/custom builds were not available; feature retirement therefore needs deliberate compatibility/archive decisions. No findings rely on missing static imports alone: hidden CLI endpoints, dynamic imports, CLI bundling, private command routing and external fixture scripts were checked.

Checks actually performed: bounded complete source reads, manifest line-count comparison, repository-wide reference searches, read-only transport diff, and targeted caller/test/script inspection. No implementation, executable/provider acceptance, full build or tests were run. Needed checks are listed per finding; terminal/fixture checks remain required for feature/UI changes, not inferred from passing backend tests. Docs and wisdom are context only and were not changed or counted as savings.
