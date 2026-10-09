# Template line pass

Worktree: `/home/tnfssc/.bruv/worktrees/t3-6c093fbb-5442693331ce-task_8f9ab36d`.
Branch: `bruv/prompt-lines-templates-8f9ab36d`.

143 active prose lines. One fast read-only job per line. Also reviewed 17 dormant Live lines, 8 syntax-only lines and one count-placeholder draft. Re-reviewed the exact overflow suffix. 169 jobs launched and finished. 33 lines rewritten; 136 kept. IDs, originals, proposals, decisions and send paths stay in `.tmp/prompt-line-review/templates/manifest.json`. Run outputs stay there too.

Read values, writing wisdom and `src/prompts/wisdom.md` first. There is no root `wisdom.md`.

System and wisdom now put purpose and tradeoffs first. Roles, goals and handoff text say what matters in less space. Tool facts stay apart from values. Exact APIs, limits, approval paths, cancellation, question delivery, checkpoint headings and template names stay intact. Longer line suggestions were not better. Security facts are worth the words.

`live.md` has no current send path. Kept it dormant; its old tools are not the current Live API. Active Live uses `gpt-live.md`. Preview prose means the offline sample payload, not human-only disclosure or local errors. `system-prompt.ts` sends selected user text or the shared base; it adds no prose of its own.

Build passed. 170 focused tests passed across final runs in 15 files, including 47 prompt tests, SDK delivery, Live, goals, wisdom and compaction. `git diff --check` passed. Full `/tmp` blocked one early run; tests use `.tmp/test-tmp`. Built `dist/bruv` for SDK checks. Fixed stale wording assertions. One shutdown test hit its 5s limit in the combined run, then passed unchanged on recheck. No behavior assertion weakened.

Remaining gap: dormant `live.md` was not exercised; no current caller sends it. No full repo suite or model call.

No runtime folders changed. Values stayed same: they already say values over rules and plain talk. No push or PR.
