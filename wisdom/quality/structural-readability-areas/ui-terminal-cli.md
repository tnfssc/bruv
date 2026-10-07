# UI / terminal / CLI structural readability — ongoing

Workspace: /home/tnfssc/.bruv/worktrees/t3-6b8c09c6-5442693331ce-task_f8e968d6
Branch: bruv/whole-repo-structural-readability-ui-ter-f8e968d6
Initial commit: 59413c532e6422983f611915e509e8421aa2f363

## Coverage and pickup

101 baseline files; 36 have launched fresh primary workers. Current statuses: accepted: 30; judging: 3; pending: 65; primary-running: 3. Extra paths: 3, tracked separately in JSON. **Not complete; no area PR/push or whole-repo acceptance.** Parent owns PR #45.

Adjacent JSON is authoritative: one row per baseline/extra file, durable worker path/branch/base/commit, exact related paths, all judge IDs/verdicts/reasons/proof/limits and accepted blobs. Workers and notes retained; worker-local notes are never imported. Up to three writers and three fresh read-only judges. Coordinator joins accepted patches only, never writes source. New or changed final blobs require independent review; related patch judgment never replaces primary focus.

### Active next steps

- Full typecheck exposed TS2741 in the SDK-added throwing Component fixture at tests/task-rows.test.ts:249. Fresh primary task_e44a3fd7 reproduced it and proposed only invalidate() {} at 1b66a8d1dc898e2953e963da9f4af5b663bafd86; judge task_c584a1d4 is reviewing the entire primary file plus repair. Not yet integrated. Runtime assertions unchanged; worker reports full tsc passes.
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
- Batch 3 at e4cf5e40: fresh normal CLI + connector launcher built; all 178 tests/1,654 assertions across nine suites passed, including previously unrun compiled CLI cases. Full tsc failed only the fixture contract above. Initial fish inline-quote launch failed before execution; local ignored Bash script corrected it. No passing static claim until repaired final integration rerun.
- Parent accepted common checkpoint 695ade32dc055e22dd56a7bf06c01764973715d2 merged cleanly at bc8f6e5ffb75aa2b27fd939ce60888063e756383. No accepted UI blob changes (audit: zero mismatches). Other-area new/deleted files remain parent/sibling primary ownership, not falsely counted in UI scope. Later combined API gaps remain honest.

## Toolchain and limits

Bun 1.4.2: /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun; PATH inside quoted Bash or local ignored script. Automatic fish setup cannot find bun. Shared node_modules at /home/tnfssc/.t3/worktrees/bruv/t3-6b8c09c6/node_modules is read-only; copy needed runtime assets locally, never prepare/mutate shared dependencies. Coordinator temporary node_modules symlink is untracked and must be removed before final clean-tree delivery. Local batch logs/scripts in runtime-assets are disposable validation artifacts. Disk latest: 136G available.

No provider/device/macOS/authenticated SSH/physical-terminal acceptance. Unit fixtures and shared-prebuilt harness tests do not prove compiled parity; the actual batch CLI build covers only stated CLI tests. No performance-speed claim. Known unchanged limits: diagnostic append/leaf restore non-atomic and reopening may select diagnostic child; SDK getEntries materializes full list despite bounded replay scan; footer disposal suppresses observation rather than cancelling I/O; harness lacks partial-start rollback and capture failure prevents kill, configurable watchdog socket remains unquoted; interaction Promise.all failure does not guarantee child termination and artifact writes are nontransactional. These are explicit retained contracts/limits, not invented safety improvements.

## Final completion requirements

Finish all baseline and extra primary/judge coverage, resolve every rework and cross-area primary final hash, audit unique primaries/exact accepted blobs against tip, run combined focused tests + real full typecheck + format/lint (build only when changed binary paths need it), validate wisdom bytes/fences, remove temporary untracked link, commit clean tracked tree. No accepted source while an actual-code rejection is unresolved. Parent runs whole Linux gate and integrated regression/PR update. Values unchanged: existing ownership/lifetime/independent-judge lessons suffice; propose shared lessons to parent, not competing values edits.
