# Tool line pass

Worktree: /home/tnfssc/.bruv/worktrees/t3-6c093fbb-5442693331ce-task_3ded78b7
Branch: bruv/prompt-lines-tools-3ded78b7

## Coverage

182 authored model-facing lines. One fast read-only worker for each. All 182 reviews finished. 89 first attempts hit a rate limit; each retry finished. 271 jobs for those lines. One raw external stack line was reviewed in excess and left out of coverage.

10 lines changed; 172 kept. Evidence lives in this worktree's ignored .tmp/prompt-line-review/tools/: manifest.json, per-line files, coverage.json, exclusions.json, and send-paths.json. Each line has its original, context, job IDs, advice, and final choice.

Traced execute replies, question helpers and saved-answer turns, history reads and errors, and wisdom injection. Root CLI/UI text stays out. Shipped build adapters and patches add no model-facing prose. Imported execute and wisdom prompt assets belong to the prompt owner, not this slice.

## Choices

State ownership and delivery as facts. Human answers still use /questions. Saved replies still start a new parent turn; no tool replay or in-place child resume. Remote ledger ownership and the manual-shake safety boundary stay intact.

Keep compact diagnostics. Some advice changed branch meaning or dropped string-array detail; rejected it. Tool names, variables, limits, output framing, and behavior stay unchanged.

## Checks

Build passed. 188 focused question, history, TypeScript, and wisdom tests passed. Wording checks changed; behavior checks stayed. Added the blank-code error to the runner's existing failure test.

The first run hit a full /tmp. A repo-local TMPDIR put the no-project wisdom fixture under Git. Final run used an isolated /dev/shm temp dir and passed. Logs stay with the evidence. No line jobs remain. Full repo suite not run.

Values stayed unchanged. They already cover plain talk, judgment, and keeping exact facts.
