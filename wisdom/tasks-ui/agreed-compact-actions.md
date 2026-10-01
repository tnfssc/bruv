# Agreed compact streamed actions and canonical tasks

## Authority and final rules

[Full human decisions](ui-discussion-checkpoint.md) include superseded proposals. The user has now authorized implementation. This summary uses the final choices, not the early draft cc7f181 (preserved in history).

- Foreground: one animated spinner from tool-call start, initially alone; label grows with parsed tokens and remains beside the spinner while code streams and runs. Success is ✓ label, not a plain label. Failure is ✗ label — actual concise error. No executing/executed boilerplate, separator dot, raw code, or duplicate settled row. Schema label precedes code; no new prompt-order instruction. Code-first streams stay safe.
- Successful text output stays collapsed; existing Ctrl-O reveals existing source/output. No collapsed truncation/image count/background count. Images remain. Storage failure is distinct: ✓ label — ⚠ couldn’t save full output.
- Background launch and completion share ONE row per typed task identity. Static ↗ title while active; ✓ title on actual successful completion; ✗ title — exit N only with recorded failure code; ✗ title — failed without code; ⊘ title — cancelled only after confirmation; ✗ title — timed out only actual timeout. Unknown and human input are ? title — status unknown / needs your input. Missing title uses existing ID. Multiple tasks, tasks without source call, snapshots and reopen must remain truthful. No model-prose parsing, child-count guesses, new coordinator, or backend rewrite.
- All default failures/warnings are single-line. Expanded diagnostics remain. Quiet5m/review10m and N more checks are hidden only from human transcript; wakes/cadence/owner delivery unchanged. Rare real aggregates retain ✗ N more tasks failed, ⊘ N more tasks cancelled, ? N more tasks unresolved, ? Task update — status unknown. Never invent test counts.
- Hidden thinking has no placeholder; existing toggle unchanged. Hide only transient Tool output: collapsed. Expanded notice/header/wrapper/stdout/stderr unchanged. Footer cost/context/cache/model/thinking/path all untouched; hiding cache was REJECTED.
- Local normal conversation and placed-root align; preserve display:false hiding for snapshots/streaming/expanded, /ps and /questions authority, source return and thin-client responsibilities.

## Ownership and baseline

Integration worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_77080c99
Branch: die/implement-agreed-compact-streamed-action-77080c99
Fetched origin/develop bada7e5 (repo origin already tnfssc/bruv). Draft rebased cleanly from cc7f181 to 7627cdc on that base. Fetch succeeded; an SSH id_rsa libcrypto warning was observed, not a rename failure. No broad branding edits.

Independent durable workers (base 7627cdc):
- Foreground: task_5d10e9d2
- Typed background lifecycle/canonical rows: task_a9b2e181
- Placed-root presenter: task_0720c30e, branch die/placed-root-normal-transcript-alignment-0720c30e
- Native PTY harness: task_b0cca465, branch die/native-pty-capture-scenario-tooling-b0cca465
Each worktree is beneath /home/tnfssc/.die/worktrees/die-a86675007a5e-task_77080c99-a86675007a5e-task_<ID suffix>; exact receipts are completed below.

## Validation scope

Use focused regressions and real SDK event transitions plus native compiled PTY appearance. New readable screen text and screenshots must show actual new source, not recycled pixels or source/hash assertions. Reuse actual cached web archive honestly as local UI proof, never fabricate its absent manifest. Parent owns CI/push/PR/merge/release; no upload/paid providers/real hosts in this work.

Values reviewed: existing 8 (honest UI/appearance) and 10 (bounded parallel work and durable handoff) already cover this feature. No new value or broad value rewrite.

## Native review correction before acceptance

First integrated native source a9cb864 passed the local 25-check capture, but root take1 was REJECTED after actual screen review: its helper finished inside the default foreground wait, so background-only capture omitted sourceCallId and the jobs facet produced a second checked helper row. Do not present root-native-capture-1 as acceptance.

The fix records every typed subagent result as a canonical task, even when it finishes inline; only actually background results populate backgroundJobs/model handoff prose. Inline shell calls remain normal foreground actions. TaskSummary now exposes the manager’s existing background-delivery fact (notifyOnComplete); root ignores those explicit inline jobs as orphan rows without changing /ps, lifecycle ownership, cadence or wakes. Native/SSH/old summaries without this local flag remain observable.

Review also found root’s early task-row return hid independent outer execute failure/handoff/storage errors. Those now remain visible; successful launch storage warnings share the first canonical row, not a duplicate checked launch action. SDK background row composition preserves the same warning and handoff separation. Focused tests retain actual structured isError/details and typed launch identity; no expectation was weakened to infer success.

The placed-root scenario now explicitly requests async waitSeconds:0 and holds the fixture helper two seconds so the actual native viewport must show one ↗ named helper before completion, then one ✓ named helper after reopen, with no separately checked launch label. The assertion now rejects the exact observed defect.

## Upstream rename integrated during final validation

Final freshness fetch found origin/develop eaf8827 (merged PR19, the full human-owned bruv rename), newer than initial bada7e5. Rebased all feature commits cleanly, no conflicts. The unrelated rename work is preserved; there is no feature diff to footer or execute model prompts. Preserved pre-rename branch: die/ui-before-bruv-rebase-77080c99.

Actual rename blocker: the old read-only cache failed the new Pi-host hash check for dist/main.js. No shared dependency was changed. Switched this worktree’s symlink to the already prepared, read-only /home/tnfssc/.die/worktrees/die-a86675007a5e-task_ac1fe302/node_modules cache, verified every cached patch before===adaptPiHostFile(before), and prepared only local runtime-assets. Proof-only paths changed to BRUV_CODING_AGENT_DIR and dist/bruv-web.archive.gz to match the new compiled entrypoint; existing root capture environment changes came from upstream. Use the actual cached bruv archive in that rename worktree for subsequent native proof. No install, fabricated manifest, or broad feature branding rewrite.

Root take at pre-rebase 5119d17 passed both new visible canonical-row checks but the receipt still selected its first (now deliberately running) /ps snapshot. Capture now reads a fresh normal /ps snapshot before close and verifies that latest typed snapshot is completed. Prior takes are retained as rejected/incomplete, not silently reused.

## Native proof and handoff at e5f5ba9

- Tested/compiled source: e5f5ba9124318a62690d57265192f0de0030e802, rebased onto origin/develop eaf8827 without conflicts. Final native executable: artifacts/tasks-ui-bruv-native; SHA256 363234fcbfd525583c537e493aed1b3acc26fd8367e7c007f3a81d1f8572cc89. Build receipt: artifacts/bruv-native-ui-final/build.json. Uses Bun 1.4.2 and the actual renamed cached web archive, without fabricating a manifest or claiming release packaging.
- Focused regressions: artifacts/bruv-final-focused-tests.log — 172 pass, 0 fail, 966 assertions across 11 files. Proof mechanics: artifacts/bruv-final-mechanics.log — 13 pass. Prepared typecheck: artifacts/bruv-final-typecheck.log — passed (empty). Formatting and diff checks passed before the external edit noted below. Earlier failed logs remain preserved as historical failures.
- Local native capture: artifacts/bruv-native-ui-final/. All 11 full PNGs were opened and inspected by this orchestrator: spinner-only, partial-label, label-code-stream, foreground-running, foreground-success, expanded-ctrl-o, code-first, concise-failure, background-launched/running/success. The real SDK inference stream drives native rendering; source stays hidden for code-first. One actual shell task ID row changes from static ↗ to ✓, without a separately checked launch row or task completion notice. Hidden thinking and collapsed notice are absent. Existing footer fields remain visible; Ctrl-O shows existing source/output/header and expanded notice. Screens have matching readable text, raw PTY evidence, requests and report.json.
- Placed-root capture: artifacts/bruv-root-native-final/. All nine PNGs opened and inspected. 02-work.png has one ↗ Review the project guide; 05-detached.png and 08-written.png have the same single ✓ row. No checked launch label. Reopen, normal /ps and /questions, saved answer and source return are exercised by the native Docker-isolated scenario. Parent independently approved the observed single-row local/root views in PARENT_VISUAL_REVIEW.md. Repeated ordinary assistant prose is preserved intentionally: server-journal.jsonl contains two distinct provider messages ded819bf and eeab9ac0 with that exact text, not duplicate rendering or task notices.
- Limits: native snapshots rendered as full unedited ANSI terminal replays via cached Chromium, not a continuously recorded video. Deterministic fake inference; Docker network none; no real hosts, paid providers, user credentials, publication or upload. Task uncertainty/cancel/timeout/save-warning/image/multiple-launch/outer-error contracts are focused tests, not all separately staged in native screenshots. Parent owns full CI and release acceptance.

### Concurrent edit requiring parent ownership confirmation

After these captures, src/remote/root-presenter.ts acquired an uncommitted expandedRootTranscript helper (mtime 2026-10-01T19:09:55Z) outside this session's jobs/history. It appears intended to restore the original expanded transcript path from develop. Preserved, neither reverted nor silently committed by this orchestrator. The above compiled proof is explicitly e5f5ba9 and does not include this edit. UI_FINAL_COORDINATION.md records this handoff seam: confirm owner, finish/test/commit that change and record any required new native proof before claiming a frozen final release candidate. All parent coordination files and dependency links are left untracked and intact.

## Parent final-scope correction

Parent integration tree /home/tnfssc/.die/worktrees/bruv-compact-ui-release-20261001, branch ui/compact-actions-release, starts atbf47296. Original orchestrator tree and its concurrent uncommitted edit remain untouched. Parent reviewed that edit against published expanded RootTranscript and independently adopted the restoration in the clean tree, simplifying constant expressions. Expanded detail ordering/role captions remain as before; compact rows alone pair results by call identity. New feature tests had accidentally required changed expanded captions and ordering, contrary to the user’s deferred scope. Their expanded expectations now assert original ordering/raw result visibility; all compact outcome/privacy assertions remain. A new regression checks original assistant/tool argument/Action/result layout and hidden-message filtering.

## Contract note from Mac CI follow-up

Tool-call failures and caller cancellation remain rejected executions; a compact display change must not turn them into successful `isError` results. Emit launched task rows at launch so they remain visible if a later execution fails, and retain truthful failure output in the error. Live short labels are typed optional execute arguments, not prompt instructions; default rendering hides source until expansion.
