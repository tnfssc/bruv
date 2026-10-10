# Compat and T3 line pass

Worktree: `/home/tnfssc/.bruv/worktrees/t3-6c093fbb-5442693331ce-task_b682dca2`
Branch: `bruv/prompt-lines-compat-t3-b682dca2`

## Coverage

82 authored prose lines. One fast, read-only reviewer per line. 89 jobs launched: 82 line jobs plus seven retries. All 82 lines have reviews and a final choice. Ten lines changed; 72 stayed. Six first attempts hit “Rate limit exceeded”; retries returned reviews. One extra retry followed a JSON parse error in a review with template braces. No nested-delegation blocker.

The local audit is in `.tmp/prompt-line-review/compat-t3/`: `manifest.json`, `inventory.json`, `prompts.json`, launch records, raw results, and `review-results.json`. Each line has its original, location, context, send path, job ID, suggestion, and choice. The audit stays in this worktree; it is not committed.

## Choices

MCP descriptions, schemas, and result text come from upstream servers, even when T3 owns the server. Leave that text alone. The repo owns its error prefix, permission gates, app admission checks, and auxiliary JSON prompts. Outbound permission callbacks can reject real tool calls, so their transport errors count too. Human help, commands, Live dialogs, setup checks, and protocol-only notices do not count. The file audit records those paths.

Keep errors as short facts. A failed MCP call may have changed remote state; say that plainly and keep “not retried.” Keep the read-only and trusted-run boundaries. No new rules or advice. A missing session model is “No active model,” not “No active provider.”

Keep the native Agent launch ACK exact. Keep “only normal workers” and explicit root admission: shorter suggestions lost those limits. Tool names, schemas, signatures, variables, upstream data, permissions, and delivery behavior did not change. Auxiliary JSON prompts were already short and stayed.

## Checks

114 focused tests pass across 13 files: MCP, permissions, binding, app workers, runtime, task binding, transport, and all `tests/t3/`. `bun run check`, the paired build, and `git diff --check` pass.

The first runs found full host `/tmp`, two old wording assertions, and a missing compiled binary. After updating the assertions and building, tests passed with `TMPDIR` in this worktree. No shared files were removed. Behavior checks stayed; error-content checks were added.

No review gaps remain. Upstream server prose is outside this slice. Values stayed unchanged; they already cover this work.
