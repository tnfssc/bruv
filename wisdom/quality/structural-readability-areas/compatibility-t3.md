# Compatibility / T3 structural readability

83 initial files; all start pending. Each requires its own fresh primary worker and independent actual-code judge. Area source edits belong to durable file-worker worktrees only. No source accepted yet. Ledger: `compatibility-t3.json`.

Area checkout: /home/tnfssc/.bruv/worktrees/t3-6b8c09c6-5442693331ce-task_dc14408d; branch `bruv/whole-repo-structural-readability-compat-dc14408d`; initial commit `59413c532e6422983f611915e509e8421aa2f363`. Max three primary/rework workers and three judges concurrently. Related changes will be integrated coherently and final changed blobs rejudged; new helpers require primary coverage. No worker pickup notes are imported.

Proof limits: no tests yet; native/provider/device/SSH acceptance requires real environments and is not inferred from fixtures. Parent owns full gate and PR #45.

## First accepted boundary

`src/t3/tasks/native-task.ts`: independent judge `task_2c886e04` found no change needed at blob `9152be57bb326b4f919518efe6d13be4b10c363b`. Strict contracts, exceptional launch replay and caller-owned lifetime are already visible. Primary proof: 36 focused tests, 154 assertions. Important qualification: adapter does not replay cancellation ambiguity, but MCP transport may resend after 404. No source patch or worker pickup note imported. Other files remain pending/in flight; this is not area completion.

## Accepted runtime ownership patch

Integrated exact candidate `cb1bcfc8` runtime + regression test, not worker note. Judge `task_9a477342` ACCEPT: history queue/parent/sticky failure now share lifetime owner, runtime drains at lifecycle boundaries; shared message-body conversion leaves child frame policy at caller. Base/candidate serialized-history comparison preserved replay property order. Writer: 27 runtime tests plus 5 companion pass/7 SDK skips, typecheck/format/lint. Judge test rerun blocked by module resolution; no live/full gate. Runtime test still needs its own fresh primary focus.

Batch checkpoint: parent integration `6a285569` contained only common progress notes since initialization; no useful source merge needed. Disk 156 GiB available. Area batch proof job `task_554a7ded` generates area-owned runtime assets and runs runtime/history/task-binding/prompt-ownership, typecheck and focused format/lint. Result pending; never inferred from worker results.

## Accepted MCP ownership patch

Integrated exact candidate `17c4c9e3` MCP client + late-old-404 regression, not worker note. Judge `task_645854a5` ACCEPT: complete POST exchange now one owner and reconnect no longer maintains a second shared promise; caller cancellation stays separate from owned handshake. Sessions still drain/delete; transport 404 retry is not adapter ambiguity replay. Stable keys are derived, not freshly persisted. Writer 47 tests/180 assertions + typecheck/format/lint; judge 10 notification tests + 11 direct probe assertions, full focused reproduction blocked by zod resolution. Related test primary coverage still pending. Integrated runtime batch `task_554a7ded` passed: 6 outer tests, 7 SDK skips, typecheck/format/lint (4 inherited warnings,14 infos).
