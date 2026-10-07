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
