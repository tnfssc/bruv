# Execution code-reduction audit

## Overview

Read **all 8,798 lines in all 36 assigned files**, including comments, types and blank lines. The numbered source was displayed in 119 bounded chunks; initial truncated displays were superseded by those complete chunks. No production/test/configuration edits, builds, full suites, providers, live sessions or commits. Only this report and its coverage JSON were written.

There is no justified whole-module dead-code deletion: the CLI, agent extension, remote presenters, compiled executable and runtime assets use this group. Best reductions are a native JSONC parser, unreachable worktree alternatives, repeated launch/render/settlement bodies, and obsolete folding machinery. **execution-01–08: roughly 342–432 gross / 188–279 net lines**, not a promise of measured diff size. Optional feature cuts are separate and require a human decision.

Estimates include code/type/comment/blank lines removed from the assigned source, not documentation/wisdom. NET deducts replacement source and a small allowance for focused new assertions; existing assertions should generally move, not disappear. External wiring/test deletions are identified but not credited. Findings use disjoint source regions unless explicitly stated; alternative feature cuts must not be added to refactors affecting the same region. Confidence means confidence in the opportunity, not that an implementation has passed tests.

Context read: wisdom/values.md; canonical typed task-row, SSH delivery, local termination and automatic-worktree-setup notes. These explain current contracts, not deletion savings. Wisdom/values stayed unchanged because this is read-only research.

## Ranked actionable findings

### execution-01 — Replace the hand-written JSONC scanner with Bun.JSONC.parse

- **Class:** refactor preserving supported JSONC syntax, with a narrow malformed-input tightening. **Confidence: high** for source execution; compiled acceptance still required.
- **Location:** src/tasks/worktree-workspace.ts:63–139 (two scanner passes, string/escape/comment state and trailing-comma lookahead); call at :153. Use the native parser directly; remove the test-only exported wrapper rather than retaining a one-line alias.
- **Evidence:** package.json:41,46–47 declares Bun types 1.4.2 and Bun >=1.4.1; scripts/update-dependencies.ts:81–82 already uses Bun.JSONC.parse. The read-only probe on Bun 1.4.2 matched both parsers for line/block comments, trailing commas, escaped quotes and comment-looking string content. tests/worktree-workspace.test.ts:30–49 covers precisely that setup syntax.
- **Counterevidence / behavior:** the existing scanner accepts a closed JSON object followed by an **unterminated block comment**; Bun rejects it. Probe: `{"x":1}/*unfinished`. Both reject an unclosed object. Do not claim bit-for-bit equivalence on malformed files. Rejecting malformed setup configuration is preferable, but acknowledge this change explicitly.
- **Savings:** GROSS 76; NET 60–70, allowing a few native-parser/invalid-config assertions. No dependency needed. No lost valid setup feature; keep script validation, size limit and digest at :141–174.
- **Checks:** migrate the existing parser assertion to native parsing/readWorktreeSetup; keep comments-in-command, async:false and first selected script coverage; add the observed unterminated-comment case. Later run the focused worktree tests and a compiled CLI worktree-setup fixture; neither was run here.

### execution-02 — Remove unreachable alternatives after the inherit/native early exits

- **Class:** safe removal / behavior-preserving simplification. **Confidence: high.**
- **Location:** src/tasks/job-service.ts:395–398 rejects every native timeout, so the timeoutMs spread at :433 can never contribute. :545–626 returns for inherited workspaces, so the remainder is necessarily worktree: remove alternate inherit summaries at :635–638, the :653 condition, the undefined-source branch at :655–664, conditional continuity args at :667–668, create/inherit choice at :682–690, and branch discriminant at :686. The helper results are non-optional on this path.
- **Additional tiny dead duplication:** src/typescript/job-bridge.ts:315 chooses request_blocked in both ternary arms. :573–577 performs the same failed-reply/controller cleanup that fallback=true performs again at :593–596; keep the delivery_failed diagnostic, do the cleanup once.
- **Evidence:** discriminated Workspace schema :37–56, defaults :378 and all explicit returns :458,:534,:625 exclude other placement kinds. These are control-flow proofs, not import-absence arguments.
- **Counterevidence:** inherit/worktree preparation ownership differs intentionally. Do **not** delete the split itself, native timeout rejection, preparation cancellation, pinned source commit, trust continuity, or automatic setup. The old inherit wording at :793–797 describes an active contract, not dead behavior.
- **Savings:** GROSS 30–51; NET 15–31. No behavior lost.
- **Checks:** existing job-service, worktree-workspace, native-routing, subagent-placement and job-bridge protocol tests; specifically waitSeconds:0 returning a preparing ID, inherit wait starting after session creation, batch pinning, setup failure/cancellation and rejected native timeout. Keep failed-response ownership tests when consolidating cleanup.

### execution-03 — Build the local agent command/session metadata once, not twice

- **Class:** behavior-preserving refactor. **Confidence: medium-high.**
- **Location:** src/tasks/job-service.ts:550–593 versus :743–786 repeats prepareAgentSession metadata, CLI --session/--mode/json/-p/--model/--thinking/-- prompt arguments, title/displayCommand, scrubbed child environment, depth/type, closed stdin and notification defaults.
- **Action:** use a small local launch-spec builder and common session-preparation call with explicit cwd/taskId/continuity arguments. Keep inherited spawn and prepared activation, their timeout ownership and their waits/catches separate. Reuse setupShell at src/tasks/worktree-workspace.ts:272–276 for ordinary shell dispatch (:353–358) instead of duplicating platform shell selection.
- **Evidence:** both agent argument lists and environment bodies are textually equivalent except documented continuity args, cwd, fixed ID and timeout handling. Session manager preparation already has one canonical implementation (src/tasks/agent-session.ts:5–34).
- **Counterevidence:** :595–617 cancels already-launched inherited siblings after batch failure; :787–790 settles independently reserved worktree children. Unifying those policies would be a behavior change. Worktree trust/system-prompt continuity is not an obsolete fallback.
- **Savings:** GROSS 60–75; NET 25–40 after the builder/test adjustments. No behavior lost. Keep the builder local; a new generic launch framework would erase the savings.
- **Checks:** inspect mocked TaskLaunch argv/env assertions in job-service/worktree tests, explicit title and thinking:off, option boundary before --, inherited batch failure, worktree activation and timeout through preparation. Verify actual compiled child invocation later, without providers.

### execution-04 — Share the monitor's repeated bounded-output and agent-activity rows

- **Class:** behavior-preserving refactor. **Confidence: high.**
- **Location:** src/ui/task-monitor.ts:253–270 and :314–331 are the same no-output/whitespace/output rows followed by the same quiet-age/phase/event-count rows. The two manager.inspect calls at :224–228 and :309–313 differ only in byte budget.
- **Action:** one helper appends output rows with the selected byte/visible-row budget; one common agent-activity block after the view-specific branch. Preserve the list-versus-inspect headings and SSH first-page labels.
- **Evidence:** selected task and outputEnd drive both bodies; both use cleanOutput, age, theme and the same formatting. No new state or registry is needed.
- **Counterevidence / boundary:** do not remove separate metadata/layout budgets, fitRows(:38–60), zero-height action suppression(:143,:161–163), frozen stop ownership(:145–147), or terminal-control stripping. Output preview and inspect are real different views, not redundant features.
- **Savings:** GROSS 45–55; NET 20–30. No behavior lost.
- **Checks:** tests/task-monitor.test.ts:20,80,154,184,214 (bounded preview, rows 0–9, inspect/back, frozen identity, control stripping); task-monitor-source tests for cached SSH output and changed ownership. Compare rendered rows at narrow widths, not only helper strings.

### execution-05 — Express footer candidate layouts as shared parts, not four copied arrays

- **Class:** behavior-preserving refactor. **Confidence: medium-high.**
- **Location:** src/ui/footer.ts:348–423. First two candidates differ only in branch-qualified project; the last two differ only in project presence/order. live/remote/task/fast/cost/context/cache/extra are copied repeatedly. Questions/shortQuestions also repeat suffix decisions at :279–302.
- **Action:** name the common full and short parts once, then construct the four existing candidates in their existing order. Share question-status interpretation while retaining its long/short labels. Keep the simple first-fitting loop and columns helper.
- **Evidence:** every candidate is built in one render with the same values; widths change selection, not underlying status authority.
- **Counterevidence:** shorter candidates intentionally move questions ahead of project/model. A greedy generic priority allocator could hide blocked questions or change the approved narrow-terminal behavior. Do not replace status text with a guessed count or drop unknown/pending voice/fast cost indicators.
- **Savings:** GROSS 65–85; NET 30–50. No behavior lost if row output is equivalent. This region does not overlap the optional descendant-cost cut below.
- **Checks:** existing footer width/status snapshots, questions waiting/blocked/saved combinations, live/remote/fast badges, Unicode widths, context unknown, voice billing unknown, /status expansion and third-party statuses.

### execution-06 — Delete the unused folding path and unused executionStarted parameter

- **Class:** safe removal. **Confidence: high.**
- **Location:** src/ui/execution-previews.ts:23–36 and :74; src/typescript/extension.ts:81. Every production foldedRows call (:90,:171,:187,:189,:227) supplies head=tail=0 and expanded=true. No production caller reaches the omitted-row/expandHint branch. The executionStarted argument is explicitly ignored.
- **Evidence:** repository rg finds foldedRows only in this implementation and tests/execution-previews.test.ts:12,:262 (the test only calls width=0, returning before folding). Other executeInputPreview uses are production registration and renderer tests. Expansion still matters at the outer renderer level.
- **Action:** replace foldedRows with a small sanitize-and-wrap function (width<1/text-empty check plus wrapTextWithAnsi). Remove expandHint/getKeybindings import and the unused positional argument at the caller/test sites. Keep expand/collapse itself, ANSI/control sanitization and full expanded source/output.
- **Counterevidence:** this is an exported internal helper and tests mention folding; repository-visible export use was checked. A third-party deep import is not disproven, but there is no published package API (package.json is private, CLI bin is dist/bruv).
- **Savings:** GROSS 19–23; NET 17–21. No current production behavior lost; obsolete internal helper signature changes.
- **Checks:** execution-previews, foreground-execution-sdk, conversation-density tests; expanded source/results and handoff wrap; no compact extra rows at completion and all image protocols retained.

### execution-07 — One terminal-settlement tail for preparing and spawned tasks

- **Class:** behavior-preserving refactor. **Confidence: medium.**
- **Location:** src/tasks/task-manager.ts:386–402 and :650–663 repeat clearing completion/resolver, budget retention, resolution, completed event, completion diagnostic and optional notification. Common status/time/timeout fields also occur at :368–377 and :643–648.
- **Action:** share only the final publish/resolve/retain tail, receiving the already-built inspection. Leave progress.finish, process teardown, final-answer substitution and prepared-task error/abort handling with their respective owners.
- **Evidence:** ordering is identical: retain budget before resolution/events, diagnostics before notify, and shutdown suppresses notifications. These repeated lines can have one owner.
- **Counterevidence / boundary:** a final answer is not the activity log. Spawned completions have actual exit/signal and AgentProgress.failed; failed preparation has no process exit. Do not derive either from the other, conflate failure with kill, or collapse foreground/background acknowledgement semantics.
- **Savings:** GROSS 32–42; NET 15–25. No behavior lost with identical ordering.
- **Checks:** task-manager, worktree-workspace, job-bridge delivery tests and completed-output-budget checks; listener snapshots already budget-bounded, foreground result preservation, failure preparation, timeout/kill and shutdown notification suppression.

### execution-08 — Keep one timer-arm implementation in attention scheduling

- **Class:** behavior-preserving refactor. **Confidence: high.**
- **Location:** src/tasks/job-attention.ts:226–238 duplicates timer clear/deadline/count/setTimeout behavior of :312–327. #schedule can compute next, call #clearTimer for Infinity, and delegate to #armIfEarlier for finite deadlines.
- **Evidence:** both finite paths already refuse to postpone an earlier timer and increment timerSchedules on new arms. Both clamp delay to the same 32-bit bound. No queue or per-job timer is required.
- **Counterevidence:** #schedule checks disposed; keep that guard. Do not replace the scheduler with per-output resets or polling: quietNotified, watch grace, snooze and arithmetic review catchup all have active tests and different policy semantics.
- **Savings:** GROSS 15–25; NET 6–12. No behavior lost.
- **Checks:** tests/job-attention.test.ts:198,:227,:248,:289 cover noisy output, late attachment/watch grace, clock jumps and inspection failure; preserve diagnostic counter/timer assertions as well as notice contents.

## Feature cuts requiring human choice

These are functioning features, not unused modules. Each estimate excludes test-file deletion credit; feature-specific tests can go only when the behavior is explicitly retired. Keep all remaining cross-feature assertions.

### execution-09 — Stop rewriting native conversation spacing/thinking prose

- **Location:** src/ui/conversation-density.ts:1–529; installation src/cli.ts:221–226. Optional broader cut: src/ui/quiet-tool-ui.ts:1–64 and its CLI installation.
- **Savings:** density alone GROSS/NET **529** owned lines; including the quiet-tool behavior **593**. External CLI wiring changes are uncredited. These replace native rendering, so no substitute implementation is needed.
- **Behavior lost:** compact user/non-user boundary spacing, no extra tool-carrier gaps, condensed plain thinking summaries, and (if broader cut chosen) hiding hidden-thinking/collapsed-output status labels. Native Markdown and editor remain; typed task rows in sdk-task-rows must remain.
- **Evidence:** the density module patches global Container methods, each component render/mouse/update, parent indexes, weak references/finalization and restoration just to implement presentation choices. This is a small aesthetic policy with unusually broad SDK-seam maintenance.
- **Counterevidence:** comments :228–245 and canonical-row wisdom describe deliberately approved spacing; tests/conversation-density.test.ts and foreground-execution-sdk prove real interaction/restore behavior. Native spacing may be noticeably less usable. This is not a safe default deletion.
- **Confidence:** high that removal saves the stated implementation; product desirability unknown. **Checks:** native chat with ordinary prose, structured/fenced thinking, tool-only carriers, images, expanded tools, mouse clicks, reopen/resume and startup; verify remaining sdk-task-rows wrappers install/uninstall correctly without density in the chain.

### execution-10 — Retire descendant-dollar aggregation, keep root/voice billing truthful

- **Location:** src/tasks/session-costs.ts:1–285; src/ui/footer.ts:2,:195,:217–226,:267,:329,:425–440,:464,:468–499,:549.
- **Savings:** GROSS 315–335 / NET 300–325 owned lines. The tracker itself is 285; remove its integration/poll, not unrelated footer usage, cache timer, branch subscription or disposal. Does not overlap execution-05's candidate arrays.
- **Behavior lost:** root footer no longer totals recursively linked local child-session spending (including failed/killed work and child compactions). Individual durable session usage remains; root total must be labeled root-only rather than silently presented as whole-job cost.
- **Evidence:** only src/ui/footer.ts imports this tracker in production. It recursively scans session directories, reads bounded relation prefixes, caches inodes/offsets/partial records, deduplicates entry IDs and rediscovers links every two seconds. No launch/stop/recovery path depends on it.
- **Counterevidence:** tests/session-costs.test.ts:39–172 explicitly distinguish branches, ordinary forks, copied metadata, atomic replacement and failed compaction costs. These are useful billing semantics; removing only fallback metadata handling (:185–217) would quietly undercount existing sessions, not safely simplify the feature.
- **Confidence:** high isolation/savings, product desirability unknown. **Checks:** remove descendant-total assertions only after the cut decision; keep root precompaction/nested usage, voice unknown and native-fast unavailable billing tests, footer disposal and session-switch resource checks.

### execution-11 — Drop the local lifecycle diagnostic sidecar, not lifecycle ownership

- **Location:** src/tasks/task-lifecycle.ts:1–175; integration src/agent/extension.ts:475–486,:496–507,:530–542 (outside ownership, no savings credit).
- **Savings:** GROSS/NET **175** assigned lines. External hook deletion likely another 35–45 lines, explicitly excluded from totals.
- **Behavior lost:** protected bounded .jobs.jsonl metadata audit, including closure-unobserved records after shutdown watchdog expiry. Actual TaskManager cancellation/events, diagnostics, typed transcript rows, SSH/native outboxes and durable launch identities stay.
- **Evidence:** rg of taskLifecycleFile/jobs.jsonl finds the writer and tests but no production replay reader; it is a diagnostic feature, not the job database. It introduces Linux-x64-only Bun FFI/libc flock, synchronous locking/read/truncate/write/fsync and protected inode validation for this optional index.
- **Counterevidence:** external human/scripts may inspect the sidecar even without an import. tests/task-lifecycle.test.ts:20–237 prove file protection, contention, positional writes, killed-writer lock release and compiled persistence; tests/subagent-extension.test.ts:691–703 checks ownership anchoring. The evidence does not prove nobody uses its forensic value.
- **Confidence:** high internal isolation, medium external-use certainty. **Checks:** get an explicit diagnostics-retirement decision; keep task/diagnostic/session ownership assertions when removing sidecar assertions; validate shutdown timeout still reports unknown closure through existing diagnostics.
- **Boundary if retained:** O_NOFOLLOW, mode/inode/link checks, nonblocking lock, short-write completion and lock release must stay. Removing the lock while keeping truncate/append would be a data-loss simplification, not acceptable savings.

### execution-12 — Reject oversized images rather than auto-resizing them

- **Location:** src/typescript/images.ts:1–4,:17–24,:68–120,:135–136,:148,:167–169,:196–210,:213; src/typescript/execution.ts:46,:101,:239,:245–253,:266,:328. Keep showImage itself and its validation/limits.
- **Savings:** GROSS 90–115 / NET 75–95 owned lines after simpler size rejection/decode and tests. No binary/WASM lines credited.
- **Behavior lost:** automatic Pi/Photon resize and coordinate-scale notes for >5 MB images; users must resize explicitly before showImage. Smaller PNG/JPEG/WebP and multiple image ordering remain.
- **Evidence:** current resize feature requires a lazy Pi import, temporary global fs.readFileSync patch to redirect embedded WASM, base64-size conversions and trusted dimensions on the parent. Asset is built by scripts/prepare-assets.ts:59 and imported via Bun file loader, so it is emphatically not unused.
- **Counterevidence:** tests/typescript-images.test.ts:121,:175 exercise real oversized files/bytes and recovery after resize failure; packaging needs the embedded WASM bridge because compiled dependency path lookup differs. Retaining resize but simply removing that bridge is not justified.
- **Confidence:** high isolation, unknown desirability. **Checks:** <=5 MB success, >5 MB explicit rejection, originals unchanged, caught failure followed by valid send, channel atomic failure/cancellation, byte/image/total limits and compiled image delivery. Remove coordinate-metadata cases only with this feature cut; keep parent MIME/base64 validation.

### execution-13 — Retire hidden nested-options compatibility

- **Location:** src/tasks/job-service.ts:108–115,:347.
- **Savings:** GROSS/NET about **8** lines; not worth prioritizing over the above.
- **Behavior lost:** direct JobService.handle requests with {options:{...},...} are no longer accepted. Public execute shell/jobs helpers still accept their documented separate options argument: src/typescript/job-bridge.ts:183–187,:349,:386–391 already flattens it before dispatch.
- **Evidence:** searched native/root/service callsites and job-service/native-routing/placement tests use flat params; no nested-options case found. Agent dispatch routes at src/agent/extension.ts:614,:622–630,:687 do not add this wrapper.
- **Counterevidence:** Options is open-ended, and deep/internal callers outside the repository are not disproven. This is removal of permissive compatibility, not dead code proven by imports. Keep strict schema validation after deletion.
- **Confidence:** medium-high for repository callers. **Checks:** job helper validation and all native/SSH/root routing tests; explicit regression that helpers' ordinary options continue working while a nested raw request rejects.

## Keep rationale and per-file verdicts

Every row below was fully reviewed from line 1 through the stated last line. “Keep” means no independently justified reduction beyond referenced findings, not that every implementation choice is ideal.

| Assigned file (last line) | Verdict / rationale | Findings |
|---|---|---|
| src/tasks/agent-progress.ts (153) | Keep UTF-8/event bounds, private reasoning exclusion, final-answer versus progress distinction; :125/:134 reassigns failed redundantly but negligible, not a worthwhile standalone cut. Used by task-manager:341–349. | — |
| src/tasks/agent-session.ts (34) | Keep early durable header, private permissions, dynamic SDK import and disposal of both managers (:12–32). A launch/provider stall still needs a diagnostic identity. | execution-03 |
| src/tasks/completion-batcher.ts (52) | Keep bounded debounce/max-wait and disposal/reset. Reset is active at src/agent/extension.ts:918; two timers prevent starvation under continuous completions. | — |
| src/tasks/completion-notification.ts (84) | Keep bounded small/large batch evidence and omitted IDs (:15–45,:73–83). Large batch compression and ordinary detailed blocks are different policies; deletion loses useful bounded reporting. | — |
| src/tasks/foreground-stop.ts (49) | Keep ACK-before-abort and same-session/branch checks (:19–47); shutdown must not swallow its own cancellation report or abort another session. | — |
| src/tasks/job-attention.ts (405) | Keep one bounded state per live job, real I/O versus watch grace, quiet/review/snooze, and notice waiters (:148–172) used at print boundaries; share timer mechanics only. | execution-08 |
| src/tasks/job-service.ts (1155) | Keep backend placement/policy distinctions, saved launch identity, partial batch identity reporting, cursor advance bounds and session-scoped stopWork. Refactor duplication without changing authority. | execution-02, execution-03, execution-13 |
| src/tasks/local-agent-termination.ts (26) | Keep cooperative SIGTERM draining: grandchildren have separate process groups. Root/native deliberately do not install it (agent/extension:512–515). | — |
| src/tasks/resume-safeguards.ts (185) | Keep bounded metadata reads, unknown fail-closed confirmation and picker role labels (:27–54,:156–179). Cache/multi-install restoration serve the actual SDK picker; dropping them is not an unused wrapper cleanup. | — |
| src/tasks/session-costs.ts (285) | Keep if aggregate billing remains; fork detection, incremental UTF-8 records and replacement resets are active semantics. Whole feature is isolated enough to cut deliberately. | execution-10 |
| src/tasks/subagent-profiles.ts (72) | Keep strict settings, atomic private save (:49–58), inheritance and depth/type policy. Shared with remote owner/jobs/placement/root-options, not only local UI. | — |
| src/tasks/subagent-settings-ui.ts (37) | Keep thin command-to-searchable-panel adapter, cancel-before-save, malformed settings errors and non-TUI guidance. Removing it forces manual configuration for little gain. | — |
| src/tasks/task-lifecycle.ts (175) | Keep all file safety if sidecar retained; otherwise cut the diagnostic feature as a unit, not half its protections. | execution-11 |
| src/tasks/task-manager.ts (800) | Keep bounded running/finished output, first termination reason, group escalation, preparation cancellation and delivery ownership. Share terminal publication only; tiny spawn wrapper exists because activation shares #spawn. | execution-07 |
| src/tasks/task-monitor-source.ts (201) | Keep SSH cache-only projection, bounded output, identity/owner/epoch checks (:123–129,:165–177), unknown status and pending-stop honesty. It is not a competing task registry. | — |
| src/tasks/task-monitor.ts (40) | Keep /ps command wiring and panel-scoped merged source disposal (:20–35), active at agent/extension:585. | — |
| src/tasks/text-preview.ts (14) | Keep shared head/tail command/title/session previews; omission count needs its small fixed-point calculation (:3–10). Used by service and completion notifications. | — |
| src/tasks/worktree-workspace.ts (276) | Keep argv Git/ref/path/collision safety and pinned base, retained worktrees, automatic setup config selection. Native Bun can own JSONC scanning. | execution-01, execution-03 |
| src/typescript/error-diagnostic.ts (62) | Keep bounded hostile-value/accessor handling; isolated user code can throw proxies/objects. CLI imports it directly (cli:17). Different from ordinary internal error.message helpers. | — |
| src/typescript/execution.ts (331) | Keep isolated worker, teardown, provisional ACK commit, stream draining, explicit capture failure and atomic image channel. Signal-group kill differs from TaskManager because execute must reap descendants even on successful leader exit (:175–179). | execution-12 |
| src/typescript/extension.ts (242) | Keep invocation/branch ownership, launch-row emission before outer error and active/foreground shutdown sets. outputPad compatibility cache (:33–46) is still necessary: pinned Pi ToolRenderContext types:347–372 has cwd but no outputPad, despite a separate context exposing it at types:1115. | execution-06 |
| src/typescript/images.ts (215) | Keep byte/count/channel caps and parent MIME/canonical-base64 validation. Lazy Photon/WASM code is active build behavior, optional only by retiring resize. | execution-12 |
| src/typescript/job-bridge.ts (700) | Keep bounded framing, ID validation, non-launch versus provisional foreground ACKs, disconnect notification ownership, and internal globals. Legacy remote.launch/launchRepository methods currently reject through remote/operations:58–61; not a path to silently restore or claim unused. | execution-02 |
| src/typescript/output-capture.ts (314) | Keep independent preview/capture budgets, drain beyond cap, partial UTF-8 decoding, unique private files and storage-failure metadata. writtenBytes versus capturedBytes is intentional; simple tail buffers are not equivalent. | — |
| src/typescript/runner.ts (338) | Keep compiled bare-package/#imports/export-map/CJS and lazy ESM graph resolution. CLI internal flag dispatch (cli:74–76) and build entry (scripts/build:46) mean this is not dead without an ordinary module caller. Similar resolution expressions have small helper potential, but no proven major safe deletion. | — |
| src/ui/action-label.ts (45) | Keep shared evidence-only error/attempt labels and terminal sanitation; used by local execute and remote root-presenter. Action success must not be inferred from model prose. | — |
| src/ui/conversation-density.ts (529) | Functioning, expensive SDK-seam feature; keep unless native presentation is explicitly accepted. Weak refs/restoration are required while patching global containers. | execution-09 |
| src/ui/editor.ts (70) | Keep thin native editor adaptation with mouse/IME/autocomplete preserved and width priority; not a duplicate editor implementation. Startup host docking uses bruvCompactEditor. | — |
| src/ui/execution-previews.ts (255) | Keep static action/task rows, expanded evidence, timers stopped at settlement and failure/artifact warnings; remove only unreachable folding/signature residue. | execution-06 |
| src/ui/footer.ts (562) | Keep root history reduced-cache (not message retention), unknown billing, questions, branch/model/extension status and correct disposal. Layout duplication reducible; descendant aggregation optional. | execution-05, execution-10 |
| src/ui/quiet-tool-ui.ts (64) | Keep if approved quiet behavior stays; two SDK policies are distinct from spacing. Restore only its own prototypes. | execution-09 |
| src/ui/sdk-task-rows.ts (155) | Keep typed launch/notice ownership, reopen restoration and native image children. The sibling scan is costly-looking, but replacing it with another mutable task registry is not a demonstrated line saving. | — |
| src/ui/startup.ts (76) | Keep quiet getter seam across settings reload and editor-before-first-paint seam; later footer editor installation is not equivalent (startup:28–33). Remove neither as a duplicate without changing first paint. | — |
| src/ui/subagent-settings.ts (225) | Keep real searchable catalog, unavailable current model, inherit, focus, back/discard/save. The panel replaces manual model IDs with usable human controls. | — |
| src/ui/task-monitor.ts (373) | Keep active selection/inspect/stop UX and constrained-terminal safety; duplicate output/activity rendering can be shared. | execution-04 |
| src/ui/task-rows.ts (199) | Keep canonical typed serialization/status projection, late-snapshot terminal dominance, source+ID identity and bounded aggregate outcome warnings. tasks/remote adapters are active producers, not automatically obsolete compatibility. | — |

## Essential boundaries not to trade for line savings

- Saved session/invocation/call IDs and ACK timing prevent duplicate children and quietly lost terminal answers. Keep scoped native/SSH role/depth rejection, pinned human target and source approval; cached observation never grants permission.
- First termination cause, process-group escalation, local child SIGTERM drain, setup/preparation abort and shutdown watchdog protect ongoing work. Pending/unknown is not stopped; final assistant message is not process exit.
- Keep Git option/ref validation, fixed base commit, collision rejection, private session/output/settings files and atomic settings writes. Never reset/reuse existing branches or delete retained worktrees to reduce ownership code. Current setup policy is automatic and separate from agent trust; do not invent an approval fallback.
- Keep bounded IPC/image/output/events, UTF-8 safety, explicit gaps/omissions and failure metadata. Preview is not complete output. Parent image validation remains necessary even if helper code looks duplicate.
- Keep sanitized terminal content and frozen action target/SSH owner epoch. Preserve mouse geometry and restoration while any SDK wrappers remain.

## Tests, fixtures and gaps

No tests/fixtures were assigned to this reviewer. Relevant tests/callers were inspected for evidence; no blanket fixture/test deletion saving is claimed. Pure source-level repeated coverage is **not** a substitute for compiled CLI, reopen/resume, native/SSH ownership or real rendered checks. Keep those boundaries while moving assertions with implementation refactors. Tests specific to retired optional features can be removed only with the feature decision; retain mixed tests' unrelated assertions.

Performed only bounded filesystem/rg inspection and a six-input, in-memory JSONC comparison. No proposed refactor was implemented or test suite run. Source file lengths were rechecked against the manifest with no mismatch. Shared-workspace production edits by other reviewers were not needed for this audit.

Remaining uncertainty: compiled Bun.JSONC acceptance, external human/scripts reading .jobs.jsonl, deep internal API consumers, exact replacement diffs and whether native UI/partial billing/no-resize behavior is acceptable. All source-review coverage is complete; there is **no next unread assigned line**. Follow-up should choose the smallest findings first, implement separately, then run only their focused checks plus necessary packaged/UI acceptance.
