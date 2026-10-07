# Live / native audio structural readability

Area work in progress. Exact 140-file baseline tracked in sibling JSON; none accepted by initialization. Every file gets fresh primary and independent actual-code judge. At most three primary/rework and three judges run simultaneously. No source edits by coordinator. Candidate worktrees and rejected attempts retained; worker pickup notes excluded from integration.

Pickup: area branch `bruv/whole-repo-structural-readability-live-n-662639e6`, checkout `/home/tnfssc/.bruv/worktrees/t3-6b8c09c6-5442693331ce-task_662639e6`. Baseline area launch `59413c532e6422983f611915e509e8421aa2f363`. Per-file ledger is authoritative for active tasks, candidate bases and final accepted hashes. Cross-area and device/provider limits will be explicit.

## Accepted AudioCore batch

Candidate `693ef090` independently accepted by `task_365b0c49`: callback-owned cursor now shows empty/pair/last-sample playback windows; lookahead and reset decisions are coherent operations, while queue authority and generation-tagged accounting stay intact. Included `native/live/test-core.c` flush regressions; its own fresh primary focus remains pending. Judge reran sanitizer tests, 16 Bun tests (72 assertions), and 30,000-operation baseline differential. No macOS/device/acoustic/concurrency proof. Exact accepted blobs in JSON; no worker note imported.

## Accepted Linux and OpenAI batch

`751c9ba0` / judge `task_13282f24`: synchronized playback buffer operations remove scattered lock/ring/generation reconstruction; Live keeps device/AEC effects. Startup drops redundant opening state. Related protocol assertions and new playback harness included; each needs own focus coverage. Native self-test, sanitizer buffer, no-device protocol/backpressure and 25 Bun tests passed independently. Virtual-device `audio_device` failures also occurred at baseline; runtime parity is not claimed.

`ad16124c` / judge `task_5c3c9aed`: output metadata lifetimes have one owner; response-owned reply entries remove cross-map joins. Wire sends, epoch and cancellation remain session effects; replay IDs remain retained. Related tests included. Independent 49 tests/315 assertions passed; schema checks blocked by unresolved zod for judge, though worker reported 60 pass. Final integration dependency proof remains required. No provider/device/macOS claims.

## Batch proof / unchanged workflow

At `8c131a00`, combined 7-file suite: 87 pass, 0 fail, 564 assertions, including OpenAI schema with shared dependencies (resolves judge-only zod setup gap). `bun run check` completed without diagnostics; changed TypeScript formatting passes; lint exits 0 with existing 8 warnings/7 infos. Job `task_2aacfb38`; no full gate/runtime parity claim.

Workflow primary `task_8194489e` and judge `task_c5d328c7` both find no change needed: helper artifact lane and compiled transport lane already expose separate sequential lifetimes. Judge independently ran 9 tests/100 assertions and YAML contract checks. Accepted unchanged blob in JSON.

## Accepted bridge / Gemini / Swift batch and observed follow-up

Candidates `6d75f289`, `2e381e06`, `b01dac02` accepted by separate judges `task_aeb6dd8f`, `task_aba16011`, `task_660502a4`. Bridge separates active pipe write from retractable FIFO; Gemini dispatch now owns revocable checkpoint and capacity lifetime; Swift output queue owns its conversion/delivery/polling state, hardware ordering remains in Live. Related tests included, own primary coverage pending. Exact proof and blobs in JSON. macOS Swift compilation remains blocked; some independent TS suites lacked dependency resolution and require combined rerun.

**Observed inherited defect, queued rework:** Swift judge reproduced native `played(queuedMs:0)` then `stopped` during stop; TS caller rejects played while stopping, falsely reporting helper failure. Baseline and candidate both affected. Accepted readability does not establish end-to-end stop correctness. Fresh caller worker + regression + new judge required before area completion; no safety relaxation or fixture-only suppression.

New `playback-buffer.cpp` now has its own primary (`task_fc3af74e`) and independent whole-file acceptance (`task_1ce2e593`), not just Linux patch review. Six independent fixtures preserve coherent ring/flush sequences; strict ASan/UBSan harness passed. Exact primary revision replaces earlier related-only blob in ledger.

`native/live/test-core.c` now has fresh primary `task_e7779538` and judge `task_27183ba4` acceptance at its own final revision. Independent scenario lifetimes remove accidental capture/playback history, preserve meaningful sequences and byte-identical flush helper. Baseline/candidate sanitizer runs and three fault-rejection probes passed independently.

Main owner candidate `b6c6eb45` accepted by `task_bb0fe7ca`: history pairing and registered-tool protocol no longer obscure admission/controller/finally lifetime. Current Gemini/OpenAI authority seams inspected with no conflict; closure remains distinct from stopping accepted work. Related owner tests included, own primary still pending. Judge test execution dependency-blocked; combined area rerun required, not inherited 132-pass claim.

Protocol primary `task_113b4141`, judge `task_5ff86413`: Protocol owns framing/process, synthetic microphone owns stream/thread cleanup. Three explicit incidental harness fixes independently reproduced: buffered response missed by select, partial line exceeding deadline, and feeder failure skipping free/delivery. Nine new manual regressions plus helper build/no-device smoke pass. New `test_protocol.py` needs own primary; parent CI owner should consider wiring. Virtual candidate fails first played with audio_device; judge baseline fails earlier at ready, **not** runtime parity. Drain/capture/restart/source-removal remain unproven.

**Native stop follow-up resolved:** fresh worker `task_7ae21cac`, candidate `c8fbb91f`, fresh judge `task_610f6154`. Independent exact-source regression fails before and passes after: bounded played feedback is valid during stopping, but only stopped acknowledges microphone shutdown. Native Swift/Linux and extension teardown combined contracts inspected. 45 independent tests/20,255 assertions plus format/diff/lint passed; no device/macOS execution. Previous bridge acceptance retained as history; final blob updated. Related audio test still needs own primary.

Combined batch at `2465efcb`, job `task_26d1258a`: 252 tests/21,582 assertions across 13 files, zero failures; nine Python protocol regressions pass. `bun run check`, 11-file format and lint all exit 0 (lint 25 warnings/20 infos). Shared dependency symlink and generated Python cache removed after checks; own assets generated. Resolves previous judge dependency-resolution gaps without pretending source/device parity.
