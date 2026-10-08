# UI / terminal / CLI structural readability — ongoing

Workspace: /home/tnfssc/.bruv/worktrees/t3-6b8c09c6-5442693331ce-task_f8e968d6
Branch: bruv/whole-repo-structural-readability-ui-ter-f8e968d6
Initial commit: 59413c532e6422983f611915e509e8421aa2f363

## Coverage and pickup

101 baseline files; 36 have launched fresh primary workers. Current statuses: accepted: 30; judging: 3; pending: 65; primary-running: 3. Extra paths: 3, tracked separately in JSON. **Not complete; no area PR/push or whole-repo acceptance.** Parent owns PR #45.

Adjacent JSON is authoritative: one row per baseline/extra file, durable worker path/branch/base/commit, exact related paths, all judge IDs/verdicts/reasons/proof/limits and accepted blobs. Workers and notes retained; worker-local notes are never imported. Up to three writers and three fresh read-only judges. Coordinator joins accepted patches only, never writes source. New or changed final blobs require independent review; related patch judgment never replaces primary focus.

### Active next steps

- Observed TS2741 in tests/task-rows.test.ts repaired by fresh primary task_e44a3fd7 and independently accepted task_c584a1d4; only required no-op invalidate added, all assertions unchanged. Integrated at 77126246. Full merged-area tsc task_6ebc5247 now passes exit 0, including parent common code.
- Active writers/judges and queued candidates are statuses in JSON; fill slots on substantive completion, do not poll. Future workers start at current committed integrated state.
- New tests/ansi-video-renderer.test.py is candidate-related only: once parent renderer patch accepted, launch its own fresh primary then independent judge.
- Cross-area tests/editor-voice-integration.test.ts blob 95453da9cb3f0827a96b955c60f854e905939dac needs Live/native-audio primary reconciliation. tests/subagent-settings-ui.test.ts blob 2657c431fc90d593d5064b33b4a4dfd82d261370 needs execution/tasks/questions primary reconciliation. Both related patches independently accepted; do not infer their required primary coverage.

## Accepted structural reading results

- CLI boot authority and local SDK/presentation lifetime separated; editor voice hooks and terminal mode ownership paired with their restoration.
- Rolling activity uses explicit contiguous runs instead of synthetic keys/counters. Task-row merge chooses lifecycle authority once, refreshes presentation metadata once, publishes once.
- SDK frame ownership, body projection and installation cleanup separated. Density geometry/mouse and thinking/source/streaming each own inverse operations. Execution previews separate live partial spinner from cached settled views.
- Footer clocks have separate observers and one shared lifetime gate. Footer tests own request promises and separate rendering/countdown fixtures; identical suite comparison proves no assertion weakening. Settings picker owns return selection instead of hidden rebuild correction. Monitor has explicit frame roles and per-view read budgets; frozen cancellation authority unchanged.
- Diagnostics separates live observation from durable acceptance, keeping privacy/replay/budget/reentry/generation guards. Profiler attribution and pending-render requests have bounded owners, not broad context bags.
- Interaction root separates one child process lifetime from report aggregation/checkpointing. Runtime/terminal fixture preparation and routing are separate from operational acceptance; fixture equivalence is not visual proof.
- Clear files genuinely stayed unchanged with fresh actual-code judgments (formatters, startup, quiet/settled/projection bridges, diagnostics extension, CLI/diagnostic tests, perf entry/options/report/worker, harness). Exact journeys and checks are per-file in JSON; no name-count scores.

## Combined-code proof

- Batch 1 at fa5689ff: 71 tests/473 assertions; full tsc and six-path format/lint passed after own generated assets prepared. Initial missing assets and broader Biome import-order assist failure retained in ledger.
- Batch 2 at 10508c78: 161 tests/2,032 assertions; full tsc and eight-path format/lint passed, existing 6 warnings/18 infos.
- Judge task_060d7edf accepted exact SDK/density/projection/quiet/settled/rolling/preview join: ten exact source/test blobs in joinProof. Independent 159 tests/13,717 assertions, 2 app-stack failure/shutdown/reinstall probes/32 assertions, base lifetime characterization 1/6. Preserves publication before paint, lazy body suppression, mouse geometry, live overlay over cache, existing children/foreign wrapper/reinstall semantics. Later changes invalidate affected hashes.
- Batch 3 at e4cf5e40: fresh normal CLI + connector launcher built; all 178 tests/1,654 assertions across nine suites passed, including previously unrun compiled CLI cases. Full tsc failed only the fixture contract above. Initial fish inline-quote launch failed before execution; local ignored Bash script corrected it. Repaired final integration full tsc passed at 77126246 (task_6ebc5247).
- Parent accepted common checkpoint 695ade32dc055e22dd56a7bf06c01764973715d2 merged cleanly at bc8f6e5ffb75aa2b27fd939ce60888063e756383. No accepted UI blob changes (audit: zero mismatches). Other-area new/deleted files remain parent/sibling primary ownership, not falsely counted in UI scope. Later combined API gaps remain honest.

## Toolchain and limits

Bun 1.4.2: /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun; PATH inside quoted Bash or local ignored script. Automatic fish setup cannot find bun. Shared node_modules at /home/tnfssc/.t3/worktrees/bruv/t3-6b8c09c6/node_modules is read-only; copy needed runtime assets locally, never prepare/mutate shared dependencies. Coordinator temporary node_modules symlink is untracked and must be removed before final clean-tree delivery. Local batch logs/scripts in runtime-assets are disposable validation artifacts. Disk latest: 136G available.

No provider/device/macOS/authenticated SSH/physical-terminal acceptance. Unit fixtures and shared-prebuilt harness tests do not prove compiled parity; the actual batch CLI build covers only stated CLI tests. No performance-speed claim. Known unchanged limits: diagnostic append/leaf restore non-atomic and reopening may select diagnostic child; SDK getEntries materializes full list despite bounded replay scan; footer disposal suppresses observation rather than cancelling I/O; harness lacks partial-start rollback and capture failure prevents kill, configurable watchdog socket remains unquoted; interaction Promise.all failure does not guarantee child termination and artifact writes are nontransactional. These are explicit retained contracts/limits, not invented safety improvements.

## Final completion requirements

Finish all baseline and extra primary/judge coverage, resolve every rework and cross-area primary final hash, audit unique primaries/exact accepted blobs against tip, run combined focused tests + real full typecheck + format/lint (build only when changed binary paths need it), validate wisdom bytes/fences, remove temporary untracked link, commit clean tracked tree. No accepted source while an actual-code rejection is unresolved. Parent runs whole Linux gate and integrated regression/PR update. Values unchanged: existing ownership/lifetime/independent-judge lessons suffice; propose shared lessons to parent, not competing values edits.

tests/task-rows.test.ts: primary task_e44a3fd7; judge task_c584a1d4 ACCEPT 1b66a8d1dc898e2953e963da9f4af5b663bafd86. Intrinsic whole test readable without structural rewrite. Only invalidate() {} fixes reproduced SDK Component TS2741; exact one-line delta preserves failure path/all assertions. Proof: Independent full tsc: base sole TS2741, candidate exit0; 31 tests /452 assertions both base/candidate; Six-file UI join149/13662; format/lint/diff.

scripts/terminal-perf/interaction-report.ts: primary task_5930e394; judge task_e42d2c99 ACCEPT d5fadc4552948bf4041af05249ccb577b313b269. Run-wide case-ID uniqueness, per-case cohorts and span rules have explicit ownership; case helper validates rather than forwards. Traversal/diagnostic order and opaque own evidence links preserved. Proof: Independent report/CLI20/117 plus event3/14; 12 exact-base error/order differential contracts; Focused strict TS --ignoreConfig; format/lint/diff.

**ANSI renderer REJECT task_c420e381:** no source integrated. Candidate sampled using cached row after audit callback; base rereads timeline entry. Judge reproduced callback replacing rows[0] timestamp: base saves zero samples, candidate one. Intrinsic structure improved, but contract drift is unacceptable. Next free primary slot: fresh worker applies retained candidate in current-base worktree, restores post-audit lookup and adds regression; then fresh judge with original brief/full rejection context. New test remains unintegrated candidate-only.

Density-test fresh primary task_9bb57a1e; judge task_32a06541 ACCEPT cf43fa6ef2bcbb84d142fbd3478300d85d7a0bf6 at a3500820b45fc6b2223b3fc7770027ad4f601474. All27 installs now register cleanup (base20), explicit tested disposal remains. All126 assertions identical; base/candidate27/237 and combined87/679; intentional failure proves base prototype leak/candidate restoration. No production changes.

scripts/terminal-perf/interaction-normalize.ts: primary task_5fb34446, judge task_23bf0f9f ACCEPT e5654ea0d0f92812e5a1bf526f78057f631d4189. One tool-event evidence gate separates direct subset/total/burst reconciliation from ordered timing checks, then projects verified captured text. Missing/zero, raw identities and measurement boundaries unchanged. Proof: Independent21tests/158assertions; Retained raw projections2/1/10/2/13cases equal exact base and validate accepted report join; format/lint/diff. Limits: Retained record compatibility only; no fresh measurements/full catalog/latency/build/typecheck/provider/PTY. All related/new tests still need primary focus.

scripts/ui-cleanup-probe.py: primary task_96febf21, judge task_988afb2b ACCEPT caed7a396d78adb86e2b4e2294806491cb62a0b3. Terminal owns socket/deadline, context owns HOME/fixture/tmux, exercise owns captures, pure assertion evaluation separate, report after teardown. Specific config-write thread/HOME leak independently reproduced/fixed. Proof: 8new+13adjacent Python tests; 18predicate ASTs and SSE1-7 equal; Mocked successful commands/env/reports/seven files equal; Real base/candidate both exit1 same10screen failures/six requests. Limits: Real terminal acceptance NOT passed; no current-source build or universal descendant cleanup guarantee; tmux best effort. All related/new tests still need primary focus.

Action-profiler-test primary task_b9c5eb3e; judge task_432725ee ACCEPT 4bec0ca300a19bd4ee0b9f25438c1d8da4a42ef2. Renderer-only fixtures separate from standard profiler lifetime; six irrelevant attach/dispose cycles removed, all timing/assertions preserved. Independent base16/145, candidate pair33/247, format/lint/diff pass.

ANSI rework task_283b2f40 + fresh judge task_73d21038 ACCEPT f72d5f0a9eea957f45cddd71695e6fad53cb164e: original REJECT task_c420e381 retained, post-audit timestamp reread restored and failing regression independently verified. Eight tests original/rework pass, rejected version fails; six-frame real encode and exception/callback order equivalence pass. Final source b692fce492c0c227e42e9cc4645ce4bded57b27a, new test d5b9aa060a097d8e3b7cda75e52f15b550b646fd now integrated; test primary still pending. No visual/product acceptance.

Proof-build fresh retry task_259c27b0 + judge task_f9504048 ACCEPT 85e990227aa93c12c16337f7a23a686b77661eda. Actual compile/native-proof callers never consume web archive; official T3/release provenance separate and unchanged. Explicit local CLI change: OUTPUT_BINARY only, old2arg rejected, dead archive fields/symlink mutation removed. Source pin/read-only preflight/postcompile recheck/binary hash retained. Independent32Bun/438assertions+13Python, strictTS/Biome and archive-symlink preservation; compile/assets stubs, not native/PTY acceptance. New proof-build test primary pending. Interrupted task_69932f49 worktree preserved.

Second parent checkpoint db885fce5225bf31dbaadba34c14ceb2393f5999 merged at cef74bca0621739e63a5ae98e5b26dd38103141e. Only UI-owned overlap was related editor-voice test; Live assigned primary task_90932544 + independent judge task_5f1948bf accepted final 89f3ee58570d4e8d08bbb8aedf98e1e218524529, now reconciled in extra coverage. Independent scenarios own hold/cancel/release/rearm and fixture disposers;39tests/171assertions. No inferred coverage. Other-area source joins require combined checks; disk119G.

Disk activity primary REJECT task_6f3b1071: all53assertion statements retained but split clean-seeded owner subprocess lost expanded/failed live state. Expanded-owner negative catches base, not candidate. Fresh rework task task_2031ace4 must preserve dirty journey and branch-roundtrip state before rewrite. No candidate integrated. Proposed parent lesson: assertion/AST count preservation does not prove scenario coverage; preserve causal state and use focused negative controls when splitting stateful tests.

## Checkpoint 2026-10-07T14:51:16.063Z

- Baseline: 49 accepted / 101; 3 judging, 1 primary running, 48 pending. Exact ledger is authoritative, not directory coverage.
- Rejected disk-test split resolved by fresh rework task_2031ace4 / judge task_28221777: integrated b4d67b8b, final blob a502768eb70247ad2caceed71f88c1c6aa82533d. One causal controller lifetime preserves expanded failed state; independent expanded-owner negative fails base/rework and passes rejected split. Preserve old attempt.
- Frame dashboard accepted task_0d31b493; integrated 8c4df41f. Options parser accepted task_4c71fe7d; integrated 2d314a4b. New tests have dedicated primaries task_f492439a / task_22861d44 running.
- Primary scripts/tasks-ui-proof-screenshots.ts: task_46eaf8ec. All three writer worktrees/branches saved in JSON.
- Fresh judges: catalog task_ab6bca78; native proof plus tooling test task_fca35838; interaction dashboard plus new DOM test task_a52a6008. Native proof candidate cleanup fix is explicit, unintegrated, not accepted until judgment.
- Combined batch5 task_6adf8626 running against c5c7ab91; log runtime-assets/readability-batch5.log. No full task completion.
- 111G available; all durable candidates/rejected worktrees retained. Shared dependencies read-only. Known auto-setup Bun/mise failure does not stop primary agents.
