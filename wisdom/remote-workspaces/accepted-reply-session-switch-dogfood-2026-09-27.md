# Accepted-answer loss and in-app session-switch dogfood (2026-09-27)

## Reproduce after combining UI changes

From the combined branch, with a locally compiled dist/die and Bun on PATH:

    REMOTE_E2E_SCRIPT=scripts/remote-recovery-e2e.ts BUN_BIN=/absolute/path/to/bun bash scripts/remote-e2e.sh

For a reusable genuine web runtime, run bun run prepare:assets; bun scripts/build.ts --reuse-web after supplying dist/die-web; do not substitute placeholder assets. The shell fixture constructs fresh keys, loopback-only Docker SSH owner, fake owner provider, isolated HOME/cache, and a one-shot SSH response drop, then removes its container/image/HOME. No external host/provider or real credentials. The local parent model is fixture-only and command-only; compiled interactive binary receives real tmux keyboard input. Re-run after final UI rebuild; script reads DIE_BIN (default dist/die).

## Observed, clean final run

Exit 0 on binary 0.15.9 SHA256 fd3710b2812b1f8bee3f3080f7332429ca225086c5d9349a278cb3daf35f8df9. Real web archive reused from local source at /home/tnfssc/Code/die/dist/die-web, packed SHA256 7686d28f46c1731ace8eab80dee6fdea0e9e2c0201337f72e461a40107bcfcbd. The initial default web build failed for missing pnpm; successful compile used --reuse-web. tsc --noEmit, bash -n, git diff --check passed. Fixture cleanup left no die-remote-e2e containers.

- One-shot SSH wrapper forwarded an actual answer request to native Docker owner, verified owner returned its reply receipt, stored that response in disposable fixture state, *then* discarded stdout and returned 42. Local RPC exposed “Native reply outcome uncertain” (not DNS). It persisted replyId 30015f19-d14d-4d10-86c1-d793259f3784; owner question contained ACCEPTED_ON_OWNER. Sync and explicit retry of the same saved question/reply ID ended delivered and still one owner answer. This tests recovery after server acceptance, not merely pre-connect failure. The owner receipt at drop time was still uncertain; acceptance is not final delivery.
- In same compiled binary, tmux session launched an owner task; **in-app /new** changed session file (old suffix a184-d9623836112e.jsonl; new suffix a184-d96593e8e09e.jsonl). Launch in new session had new owner; old task retained original owner. Separate RPC client answered old owner's pending question; after >5 seconds (background refresh) new tmux pane had only own active/question status and neither old task ID nor old answer text. This tests no observed cross-session notification and no cache ownership adoption in this bounded path.

Limits: no arbitrary crash/network partition exactly-once proof, no real model-quality claim, and no general no-notification guarantee for every session transition. Earlier run needed extra Enter because input was pasted during startup; a subsequent pass was spoiled by editing the running shell fixture. Final unassisted clean run above exited 0. No product source changed; assertions make previously untested paths repeatable on final combined binary.

## Combined-branch accepted-launch loss extension (2026-09-27)

Run: `SHELL=/bin/sh TMPDIR=$PWD/.cache DIE_BIN=/home/tnfssc/.die/worktrees/die-a86675007a5e-task_f0abdd8e/dist/die BUN_BIN=/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun REMOTE_E2E_SCRIPT=scripts/remote-recovery-e2e.ts bash scripts/remote-e2e.sh`. Exit 0; compiled binary 0.15.9 SHA256 **b56f42c174f7e288dea2ac007333c543643d3bc38fbffc45d77a0fba0c96f547**. Fresh disposable Docker owner, fake provider, loopback-only forwarded ports, disposable keys/HOME; container/image removed. No parent binary or product code changed.

- Wrapper intercepted only the marked launch after forwarding to real owner and checking successful response taskId/state; saved reply, discarded it, exited 42. Cache showed unknown outcome; RPC reported launch outcome unknown. Explicit `/remote retry <same taskId>` recovered task **58fd9b9b-2f73-4c88-8cd8-15e02d202ba1** and native question. Owner task directory set remained one entry and persisted native PID/startTime stayed the same (PID 47). Acceptance-reply loss, not DNS failure.
- Existing accepted-answer loss reconciled replyId **b78b55c9-8de1-47e0-b737-231607bd69b1**. In-app `/new` check passed: distinct old/new session files, no old task ID or answer in new pane after refresh. `bash -n scripts/remote-e2e.sh` and `git diff --check` passed.

The one-shot drop and stable owner task identity demonstrate no duplicate owner task or changed recorded native dispatch in this bounded run; **not** an exactly-once guarantee for arbitrary crashes, PID reuse, journal corruption, or network partitions. No real model-quality or general notification guarantee. First attempt failed a fixture assertion checking the wrong local error text (cached lastError stores SSH failure; RPC surfaces “Launch outcome unknown”); corrected assertion and clean rerun passed. `/tmp` was nearly full, so temporary fixture files used worktree `.cache`.
