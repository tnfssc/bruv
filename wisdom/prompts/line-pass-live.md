# Live line pass

Worktree: /home/tnfssc/.bruv/worktrees/t3-6c093fbb-5442693331ce-task_d70a41e0
Branch: bruv/prompt-lines-live-d70a41e0

Read values, writing-without-clutter, system.md and src/prompts/wisdom.md. Root wisdom.md is absent.

Traced src/live/** sends: effective context to all three voice providers, Gemini/OpenAI tool replies, GPT Live commentary, replayed voice context, provisional transcript labels and setup probe replies. Found 26 authored nonempty prose lines. Launched 26 fast read-only line workers in inherited space. All 26 returned. Rewrote 10; kept 16. Job IDs, originals, proposals and choices live in .tmp/prompt-line-review/live/manifest.json and per-line records. scope.json lists paths and exclusions. These scratch records stay with this worktree.

Context is data, not new requests. Past tool calls are records, not calls to replay. Image bytes in JSON are not seen images. Queued means admitted, not done. Kept exact transcript labels: changing transcript to speech can imply more than we observed. Kept short request/execute errors rather than blurring their cause. Tool names, schema keys, source tags, variables and wire behavior stay the same.

Imported prompt templates and execute descriptions belong to other slices. User speech, external results and notices are data. Historical prefix matching stays exact. UI help, callback errors and local loopback diagnostics are not model prose.

Tests: 148 pass, 0 fail across 12 focused files; 1,132 assertions. git diff --check passes. Final run: .tmp/prompt-line-review/live/tests-final.log. Added checks for the quoted-context boundary and the full-result/image note. Existing admission, replay, cancellation, permissions and artifact checks stay intact. No provider call or full suite needed for these words.

No known uncovered prose in this slice. Values stayed the same; this applies the writing value, not a new one. No push or PR.
