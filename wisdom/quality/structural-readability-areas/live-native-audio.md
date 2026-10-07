# Live / native audio structural readability

ONGOING: 26/140 baseline files and 3/4 extra files have own primary coverage and accepted current blobs. Not area or whole-repo completion. Exact per-file provenance, all review rounds, hashes, checks and limits are in sibling JSON.

Checkout: `/home/tnfssc/.bruv/worktrees/t3-6b8c09c6-5442693331ce-task_662639e6`
Branch: `bruv/whole-repo-structural-readability-live-n-662639e6`. Initial base `59413c532e6422983f611915e509e8421aa2f363`. Workers and judges retain their durable worktrees; never import worker-local pickup notes. At most three primary/rework workers and three judges.

## Pickup queue

- native/live-linux/tests/backpressure.py: judge running; primary task_b65be047; judge task_c68d41f2.
- native/live-linux/tests/capture-protocol.py: primary running; primary task_c8643d8b; judge none active.
- native/live-linux/tests/source-removal.py: primary running; primary task_ba46a6b0; judge none active.
- scripts/live-isolated-audio.sh: judge running; primary task_1b8756f7; judge task_1a73a583.
- src/live/gpt-live-session.ts: primary running; primary task_35b0a03e; judge none active.
- tests/editor-voice-integration.test.ts: judge running; primary task_90932544; judge task_5f1948bf.

## Accepted structural results

- AudioCore callback cursor makes empty/pair/held-sample state and late lookahead explicit; native Linux playback buffer owns synchronization while Live retains Pulse/AEC effects. Swift output queue owns conversion/delivery separately from hardware lifecycle.
- Bridge separates nonretractable active write from unsent FIFO; Gemini dispatch owns revocable checkpoint/capacity/finally; OpenAI metadata lifetimes and response-owned replies remove map joins. Owner separates canonical history pairing, registered-tool protocol and admission/draining. Extension exposes acquisition/connect/context/device startup rather than buried provider wiring.
- C/native and provider/owner tests isolate accidental shared lifetimes while retaining meaningful cross-transition sequences, real authority/race assertions and independent waveform comparison. Already-clear headers, settings/contracts, metadata and builders legitimately remain unchanged. Counts/tests are not quality evidence.
- Private graph owner is reused; virtual fixture owns only its two modules with one cleanup owner. Protocol owns framing/process; synthetic microphone owns feeder/free/join/error delivery. Related protocol/test final revisions were freshly judged after later edits; old rounds retained.

## Explicit incidental fixes and proof

- Native played(0) before stopped was rejected during stopping: fresh worker task_7ae21cac and judge task_610f6154 reproduce baseline failure and accepted repair; only stopped acknowledges shutdown. No safety relaxation.
- Protocol fixture buffered-response/deadline/feeder-cleanup defects independently reproduced and fixed (task_5ff86413). Private-graph baseline missed played when20ms stimulus ended inside100ms throttle;500ms stimulus now requires positive queue and retains capture/drain/restart/source-removal. Judge task_ab2edd5f independently passed3 real private-graph smokes,17 regressions,desktop module identity and exit23 owned-process/root cleanup.
- OpenAI oversized-output fixture leaked100,050-byte artifact; cleanup independently verified. Owner-test duplicate idle state independently reproduced and corrected. Other potential fixes remain candidates until their judge accepts.

## Combined checks and platform limits

- Shared parent checkpoint95d2e164 joined cleanly at6f8654b8. It included prior live batchf473c8e5 and UI editor-related test95453da9; that test now has its assigned fresh primary/judge. Other-area sources/notes imported unchanged; no sibling merge behind parent.
- Latest shared proof task_8c734875:277 tests/21,718 assertions across14 files,17 Python regressions,root typecheck and40-file formatting all passed. Earlier task_26d1258a:252 tests/21,582 assertions,typecheck/format/lint(all exit0;baseline warnings). Exact scopes/tips in JSON; newer patches need final combined rerun.
- No physical-device, paid/authenticated provider, macOS/Xcode, acoustic/AEC, SSH or compiled-CLI parity claim. Swift source judgments are not compilation. Independent judge dependency-resolution failures are recorded separately from worker/combined runs. Private graph proof resolves that fixture blocker, not desktop parity.

## Remaining coordination

- Finish every pending baseline primary/judge and extra file; rejudge any later changed accepted blob. New test_isolated_audio.py remains candidate-related pending own primary. Resolve all rejection rounds if any; audit final inventory/hashes/unique primary IDs; run final combined checks and clean tracked tree.
- New Python regressions currently manual; parent scripts/ci.sh owner should decide coherent gate wiring. No cross-area CI edits here. Editor-related final test blob must be communicated back to UI/parent when accepted.
- Parent owns one PR #45 and whole Linux gate. No push or area PR. Area commits are safe partial batches only; final result requires full genuine coverage.

Latest accepted batch: isolated graph wrapper (`task_1b8756f7` / `task_1a73a583`) exposes graph-start/verify and one ordered cleanup snapshot;24 regressions+2 independent private graph smokes pass. New test_isolated_audio.py now integrated but own primary pending. Editor voice assigned primary (`task_90932544` / `task_5f1948bf`) accepts final89f3ee58 fixture lifetime improvements;39 independent editor tests pass, UI/parent final-hash reconciliation recorded.
