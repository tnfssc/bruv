# tests3 follow-up 2 — read-only code reduction audit

## Scope and evidence

**Complete: 6/6 assigned files, 3,310/3,310 assigned lines.** Read the inventory and wisdom/values.md, then every assigned line in numbered bounded chunks. No assigned chunk was truncated. Other repository reads/searches were supporting traces, not an exhaustive review of those other files. This supplements tests3-report.md; it does not change its coverage of other files.

No source/test/config/wisdom edits, commits, builds, live sessions, paid calls, or test execution. Only this report and tests3-followup2-coverage.json were written. A pre-existing untracked wisdom/quality/code-reduction-audit-2026-10-02.md was left alone. Values/wisdom cleanup is not proposed or counted.

Savings below are physical source lines: **gross = old lines removed; net = gross minus replacement/helper lines**. Exact deletion spans are distinguished from estimated helper formatting. These are proposals, not measured post-edit diffs. No savings from deleting comments/docs or weakening security, data-loss, or cancellation checks are included.

All six files are active Bun test suites, not dead modules: package.json's test script builds then runs ./tests; scripts/ci.sh:57 and .github/workflows/release.yml:167 discover ./tests. Lack of direct imports of a test file is not dead-code evidence. **No safe whole-file deletion or substantial unreachable code was found.**

## Findings

### F2-01 — Constant-fold an identity test expectation

- **Evidence:** tests/openai-session.test.ts:901–904. The expression at :903 replaces the entire literal "model_not_found" with "unavailable or inaccessible". It is exactly the latter string, not an independent conversion oracle.
- **Change:** keep the status===404 condition and expect(...).toContain("unavailable or inaccessible").
- **Savings:** 3 gross (:902–904), 1 replacement, **2 net**. High confidence; behavior lost: none.
- **Counterevidence:** tests :775–779 independently check provider failures; do not delete the 404 assertion or the HTTP rejection/redaction assertions at :897–907. Those check an actual production transport, unlike this literal replacement.
- **Check:** focused offline test named "ws rejected local upgrades report actual HTTP status…"; inspect formatted diff to confirm the condition and all redaction assertions remain.

### F2-02 — One file-local bridge fixture, retaining test-local ownership

- **Evidence:** tests/job-bridge.test.ts:48–54, 94–100, 157–163, 184–190, 211–217, 240–246, 267–273, 304–310, 387–393, 414–420, 453–459 repeat the same seven-line notifications/TaskManager/JobService construction (77 lines). Execute wrappers at :55–59, :164–168, :191–195, :218–222, :247–251 add another 25 repeated lines.
- **Change:** file-local factory returns fresh notifications, manager, service, and an execute closure. Take an execute timeout argument, default 3000; the four later wrapper tests explicitly request 5000. Retain all existing try/finally shutdown blocks. Do not share a manager between tests or generalize the custom jobHandler interceptors.
- **Savings:** **102 gross**, approximately 28 replacement/helper lines, **~74 net** (about 70–76 depending on formatting). High confidence for the seven-line construction; medium-high for combining wrappers.
- **Behavior lost:** none if fresh instances, explicit timeout differences, and callback wiring remain. No test/assertion deletion.
- **Counterevidence:** :118–121 delays startup; :284–287 aborts the third launch; :320–325 aborts before acknowledgement; :429–433 deliberately enlarges a reply; :512–538 simulates a partial batch. A generic handler that hides these would destroy the regression checks. The 3000/5000 distinction is meaningful for :170–176. The typed production constructor is src/tasks/job-service.ts:191–203. tests/helpers.ts:10–26 is a subprocess helper, not a session bridge fixture; it is not a substitute for executeIsolated.
- **Check:** run only this file against an already available, current dist/bruv (do not trigger package.json's build-bearing test script merely for this audit). Preserve every cancellation flag, completion count, ACK ownership, diagnostics, secret-env assertion, and elapsed-time bound. No check was run here; an old dist artifact would not prove current source behavior.

### F2-03 — Small command-registration harness, not a fake question service

- **Evidence:** tests/questions-extension.test.ts repeats capture-only ExtensionAPI scaffolding: :66/:68–73/:81 (8 lines); :87/:101–109 (10); :126/:142–148 (8); :228/:239–247 (10); :263/:302–308 (8); :327/:357–363 (8). Total 52 lines.
- **Change:** a local helper accepts the real getService callback, captures registerCommand, supplies the same no-op on(), and returns command plus registerQuestions' refresh result. Keep each service, context, editor/picker factory, notices, and assertions visible in its test. About six replacement calls plus a twelve-line helper.
- **Savings:** **52 gross, ~34 net** (approximately 30–36 formatted). Medium-high confidence. Behavior lost: none.
- **Counterevidence:** the hooks/subscription test :5–63 and lifecycle tests :185–225/:415–511 need event capture, not no-op hooks. Do not move those onto this small harness. The status-call increment order differs at :435–437 versus :470–472; merging their bodies could invalidate the stale-context oracle. Production registration at src/questions/extension.ts:71–108 captures context/generation/subscription; the harness must call that actual registration, not emulate it.
- **Check:** focused questions-extension suite; retain short-ID ambiguity, exact whitespace, no-history versus corrupt-store diagnostics, selection/version/owner binding, Escape non-mutation, narrow-width rendering, shutdown, stale-context suppression, and non-lifecycle error propagation.

### F2-04 — Fold the native-to-SSH scenario into the existing pagination table

- **Evidence:** tests/remote-jobs.test.ts:125–173 is a 49-line native=3, SSH=3, local=0 pagination case. The table at :175–246 already has the same count=2 mock-native paging algorithm and ordered-ID/total assertions, plus page-size and finite-page bounds (:232–236). Add the missing row [0,3,3].
- **Savings:** **49 gross, 1 replacement row, 48 net**. High confidence in assertion equivalence; behavior lost: only its separate test title, not the scenario.
- **Counterevidence:** do not delete the scenario outright: current table rows do NOT include [0,3,3]. Do not also absorb :80–123 into that table: it runs without the native bridge environment and checks unsupported SSH methods. src/tasks/job-service.ts:825–838 has a distinct non-native fast path; same totals are not proof of same code path. Keep :248–311's raw-ID/cursor guards and :345–375's frozen snapshot under new launches.
- **Check:** run remote-jobs only; confirm a named [0,3,3] case enumerates exactly native0–2 then sshJobId(ssh0–2), six jobs, count=2, total=6, and terminates. Keep shutdown in finally.

### F2-05 — Tiny dead binding inside the goal RPC probe

- **Evidence:** tests/job-bridge.test.ts:585 declares const before=await goal.get(), but the executable string never reads before. The handler's seen list checks goal.get at :599.
- **Change:** replace only "const before=await goal.get();" with "await goal.get();". **0 gross/net LOC; 13 characters removed.** High confidence; no lost behavior.
- **Counterevidence:** the awaited RPC is not dead; deleting it would lose bridge coverage and break the method-sequence assertion. src/typescript/job-bridge.ts:368–372 routes actual goal methods. No claim that the goal feature itself is unused.
- **Check:** focused "goal helpers share…" test; same stdout and method order. Too small to justify a separate implementation task.

## Conditional cuts, NOT safe dead-code findings

### F2-06 — Optional removal of the extra header-only loopback smoke test

- **Evidence:** tests/openai-session.test.ts:348–374 (27 lines) directly opens defaultSocket against localhost and checks Authorization. :375–410 already uses that same defaultSocket, checks Authorization at :401, and additionally verifies a ready authenticated session, exactly one session.update, no key in events, and no errors. src/live/openai-session.ts:146 delegates defaultSocket to upgradeSocket.
- **Candidate savings:** **27 gross/net**, zero replacement, only if this extra smoke path is intentionally no longer required. Medium confidence, conditional on the retained test exercising the same supported runtime/transport.
- **Behavior/coverage lost:** direct-socket open against a peer that immediately closes. The second fixture acknowledges session.update instead. This is overlap, not an exact duplicate of event ordering. No production feature is removed.
- **Counterevidence:** auth transport is security-sensitive; keep :401 and the real defaultSocket path. Do not replace both tests with FakeSocket checks (:94–109), which cannot prove headers reach the network. Retain all rejection-body, stalled-peer, redaction, early-close session, and transport-stage regressions.
- **Check before any cut:** run the retained localhost session test using the production socket implementation; decide whether immediate peer-close smoke coverage is desired. This audit did not execute either test, so it does not certify transport acceptance.

### F2-07 — Optional product cut: remove agent RPC snooze/watch controls, not attention/cancellation

This is a real optional feature decision, **not recommended without explicit acceptance of losing the controls**.

- **Assigned evidence:** tests/job-bridge.test.ts:560–581 (22 lines) exists solely to prove jobs.snooze and jobs.setWatch RPC exposure. tests/remote-jobs.test.ts:116 includes both in its unsupported-method list.
- **Traced implementation:** src/typescript/job-bridge.ts:150–151/:390–391 (4 lines); src/tasks/job-service.ts:103–107 (5 schema lines), :1110–1131 (22 handler lines). That is 31 directly attributable production lines. src/tasks/job-service.ts:23 would need its MAX_SNOOZE_MINUTES import removed while retaining the JobAttentionScheduler type (one line replaced by one, no net LOC).
- **Additional inspected tests:** tests/job-attention.test.ts:133–160 (28 lines) checks these SDK helpers; tests/t3/native-routing.test.ts:196–197 contributes two unsupported-method rows. Both lose purpose if these RPCs are removed. Edit the remote-jobs method list without removing jobs.input/closeInput checks (same physical line count).
- **Bounded savings:** assigned test 22 + production 31 + other inspected tests 30 = **83 gross/net**; counting the import rewrite gives **84 gross, 1 replacement, 83 net**. This is a directly evidenced minimum for an RPC-only cut, NOT an estimate for removing the entire attention subsystem. Prompt text also advertises these methods (src/prompts/execute.md); update it for correctness, but doc lines are not counted.
- **Behavior lost:** agents cannot defer attention notices or disable/re-enable a local job's watch. Unsupported SSH/native helper contract disappears too; unknown-method rejection replaces it. Manual user/agent quiet-period control is useful counterevidence. The methods are live, explicitly documented APIs.
- **Keep:** normal attention scheduling, bounded reminders, completion/failure notifications, jobs.stop/stopWork, job ownership, and every cancellation/data-loss safeguard. Scheduler methods at src/tasks/job-attention.ts:102–136 are deliberately NOT included in this cut or its savings; deleting state/timing there would require a separate full review. Unknown RPCs must remain rejected, not bypass scope checks.
- **Checks if explicitly chosen:** focused bridge/attention/native-routing/remote-jobs tests, plus inspection of generated execute globals and prompt surface. Verify ordinary attention and final delivery still work, and stopWork/cancellation remains unchanged. Not executed in this audit.

## Disposition of every file

| File / fully read range | Verdict and retained evidence |
| --- | --- |
| tests/openai-session.test.ts:1–978 | F2-01 simplification; F2-06 conditional overlap only. Keep model URL/setup/auth (:74–109), resampling (:110–128), input/context authority and bounded tool output (:129–234), heard-versus-generated audio and epochs (:235–343), lifecycle/ASR/tool continuation races (:411–630), undispatched-call/duplicate-ASR/backlog guards (:632–687), interrupted transcripts, cancellation authority and synchronous close (:689–743), allowlisted failures/HTTP body budgets/peer cleanup (:745–934), usage deduplication and root-context preservation (:936–978). :430–461 versus :566–596 differ in whether response.done precedes new speech; :411–429 versus :462–474 differ in successor timing. Do not deduplicate those causal sequences. |
| tests/job-bridge.test.ts:1–662 | F2-02/F2-05; F2-07 product-choice only. Keep multiplexing/errors/no implicit printing (:10–46), foreground/background input (:47–92), post-spawn cancellation (:93–138), framing limits (:139–154), distinct wait/timeout/failure policies (:156–264), concurrent cancellation and pre-ACK disconnect (:266–338), wrapper/batch ACKs (:340–411), oversized ownership release (:413–450), handoff and partial batch failure (:452–558), goal/history helpers (:582–623), and credential stripping with parent capability retained (:625–662). None of these is replaced by direct TaskManager unit tests. |
| tests/questions-extension.test.ts:1–511 | F2-03 only. Keep passive pinned status and subscription teardown (:5–63), spacing and short-ID ambiguity (:65–123), empty/error/corrupt/no-history distinctions (:125–225), saved-answer recovery (:227–260), actual picker factory rendering/choice/free-text/Escape behavior (:262–413), and stale/shutdown versus ordinary status errors (:415–511). No cut to human reply controls or owner/version binding. |
| tests/remote-source-approval.test.ts:1–452 | **Keep; no worthwhile safe reduction identified.** File-local Git fencing and restoration (:13–28), owned temporary cleanup (:29–32), shared fixture/approval helper (:33–106), pinned bytes/human-only approval/deny/cancel/conflicting intent/stale answers/tamper/credential exclusions (:107–216), adapter persistence and offline exact-ID recovery (:217–321), offline stopWork (:322–331), parent-context/no-spoof follow-up (:333–389), human ownership after resolution and ordering (:391–417), diagnostic-only children versus real continuation (:419–452) all serve different contracts. Do not replace saved-ledger, Git-bundle or reconnect checks with mocked decisions. The service's intent conflict and pinned-bundle refusal are real branches (src/remote/source-approval.ts:119/:238). |
| tests/remote-jobs.test.ts:1–386 | F2-04; F2-07 only touches the unsupported-method list after a feature decision. Keep SSH namespace and parent ownership (:43–58), byte-bounded stale inspect/completed visibility (:59–78), non-native local/SSH pagination (:80–123), all table scenarios (:175–246), mixed totals/raw namespace/oversized cursor (:248–311), confirmed terminal versus still-running cancellation (:313–343), frozen list during new launch (:345–375), first journal sequence not being a gap (:377–386). Confirmed cancellation is not equivalent to observed terminal state; never merge those tests. |
| tests/job-service.test.ts:1–321 | **Keep; no high-value safe reduction identified.** Input/delegation validation before spawn (:9–32), EOF and writable stdin (:33–73), metadata-only diagnostics (:75–106), profiles/title/depth policy (:108–184), partial-spawn cleanup preserving original error (:186–232), advisory refresh not stranding launches (:234–259), bounded poll diagnostics (:261–281), real background title delivery (:283–321). The mock task shape repeated at :116–137 could be spread from a local base, but saves only roughly 7 lines after adding that base and introduces shared-object/clone questions; not worth recommending as a new abstraction. The real title-delivery test is not duplicated by a mocked launch-title assertion. |

## Coverage accounting and next checks

Numbered read chunks (inclusive):

- OpenAI: 1–65, 66–130, 131–195, 196–255, 256–315, 316–375, 376–435, 436–500, 501–565, 566–625, 626–685, 686–745, 746–805, 806–865, 866–925, 926–978.
- Bridge: 1–60, 61–120, 121–180, 181–240, 241–300, 301–360, 361–420, 421–480, 481–540, 541–602, 603–662.
- Questions: 1–60, 61–120, 121–180, 181–240, 241–300, 301–360, 361–420, 421–480, 481–511.
- Source approval: 1–60, 61–120, 121–180, 181–240, 241–300, 301–360, 361–420, 421–452.
- Remote jobs: 1–60, 61–120, 121–180, 181–240, 241–300, 301–355, 356–386.
- Job service: 1–60, 61–120, 121–180, 181–240, 241–285, 286–321.

**Recommended non-overlapping reductions:** 206 gross lines, approximately 48 replacement/helper lines, **~158 net** (about 150–162), plus the 13-character dead binding. No production-feature reduction in this subtotal. F2-06's conditional 27 and F2-07's optional 83 are separate, not included. No assertion/cancellation/security cuts are hidden in the subtotal.

Checks performed: static full-line review, repository symbol/caller searches, repeated-span counts, and verification that inventory endpoints equal current file line counts. Checks not performed: tests, typecheck, builds, provider/live acceptance. No edits were implemented, so this is not a passing-refactor claim. Use targeted offline suites after any implementation; do not run a full build/live/paid gate merely to validate this report.
