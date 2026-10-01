# Compiled source approval regression (2026-10-01)

Scope: question/source-approval only; no owner/client/presenter, root wiring, runner, capability, or packaging changes. Local commit only; no publication.

## Cause and fix

The unchanged normal-job RPC fixture reproduced the supplied candidate failure at source preflight: `Questions need a current branch tip`.
Execute target discovery/launch persists `custom/die-diagnostic` entries below the current assistant execute anchor and restores the leaf (see `src/diagnostics-extension.ts`). These are journal observations, not human branch navigation or conversation continuations.

`QuestionService.ask` used a raw `getEntries().some(parentId === leaf)` check, inconsistent with its existing mutation ownership rule. It now uses the same ownership check before and inside the ledger lock. No guard was removed: real children, ordinary custom entries, and real descendants through diagnostic chains still reject ancestor asks. Source approval still saves a blocked pending question, never dispatches until a human CLI answer, and keeps original parent ownership and pinned bytes on retry.

Metadata-only watcher during the actual successful compiled RPC run:
- Source question owner session `01a0f746-d0a3-7199-8d2f-2364b4d0e6d9`, branch/assistant anchor `71b62709`.
- Before the toolResult, three children of that anchor were `custom/die-diagnostic` (`5474c4bb`, `1e6367c5`, `6c73a26f`).
- The saved source question was answered `Omit untracked files`, with `answeredFrom: cli`, version 3 and a saved human reply ID; no auto-answer.
- A later toolResult was the meaningful continuation, not the diagnostic siblings.

Focused regressions cover diagnostic-only chains before source preflight, pending/no-decision state and human approval/retry on the original owner, no remote dispatch in a diagnostic-bearing execute branch, real conversation and ordinary custom descendants (including through diagnostics), and an actual ledger-lock wait during which a real child appears.

## Commands and evidence

All commands ran in the child worktree. Environment for every Bun/CLI command:
`BUN=/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun`
`TMPDIR=/home/tnfssc/.die/tmp-pi-removal`

Read-only dependency symlink to lead dependencies. Verified every Pi host adaptation was already prepared before running `scripts/prepare-assets.ts`; no shared dependency writes. Local assets generated; lead actual `dist/die-web.archive.gz` copied locally (no placeholder/full web build).

Direct compile:
```sh
"$BUN" -e 'const r = await Bun.build({entrypoints:["src/cli.ts"],compile:{outfile:"dist/die-source-approval-candidate"},minify:true}); if(!r.success){console.error(r.logs);process.exit(1)}'
```

Candidate: `dist/die-source-approval-candidate`
SHA-256: `c41fb08db77be6302cdc53f93c5779274a2dd1e9f55714115878dea878436d0c`
Reused real web archive SHA-256: `8863c84e6447be971cbed06087c49b7cfc787dc03d52c4b520ba5d64ac24b8dc`

- Baseline: supplied lead `dist/die-placement-candidate` with unchanged `bash scripts/remote-e2e.sh`: exit 1, source preflight failure reproduced.
- New regression before fix: 14 pass, 1 fail (same branch-tip error).
- Focused source/question/repository/capability/jobs tests: 91 pass, 0 fail, 468 expectations across 8 files (7.17s).
- New candidate, unchanged `scripts/remote-e2e.sh`: exit 0, complete RPC PASS, including native human question/reconnect, source omission/retry, safe return, conflict review, explicit offline capability waits, cancellation, artifacts.
- Combined compiled RPC/question PTY gate: 2 pass, 0 fail, 4 expectations (195.94s), unchanged opt-in `tests/remote-e2e.test.ts`.
- Real Pi offline question SDK test: 1 pass, 0 fail, 6 expectations (356ms).
- Biome format on the three scoped TS files; `git diff --check` clean.
- Full `tsc --noEmit` is NOT green: existing unedited `tests/remote-jobs-placement-fixture.test.ts:13` reports TS18048 and TS2339 for `provider.stderr.getReader()`. No scoped source/test diagnostics.

Focused command:
```sh
"$BUN" test tests/questions.test.ts tests/questions-runtime.test.ts tests/questions-extension.test.ts tests/remote-source-approval.test.ts tests/remote-question-bridge.test.ts tests/remote-repository.test.ts tests/remote-capability-runtime.test.ts tests/remote-jobs.test.ts
DIE_BIN="$PWD/dist/die-source-approval-candidate" BUN_BIN="$BUN" bash scripts/remote-e2e.sh
DIE_BIN="$PWD/dist/die-source-approval-candidate" DIE_REMOTE_E2E=1 DIE_REMOTE_PTY_E2E=1 "$BUN" test tests/remote-e2e.test.ts
"$BUN" test tests/questions-sdk.test.ts
```

Logs/artifacts outside Git under `/home/tnfssc/.die/tmp-pi-removal/`: `source-approval-{baseline,red,green,focused,build,rpc,cli-tests,sdk,tsc}.log`, `source-approval-metadata.jsonl` (only entry IDs/types/parent IDs/roles and question ownership/status; no credentials).

Limits: only disposable Docker/SSH and explicit fake/offline providers. No real host, human config/cache/credentials, paid API, WAN, root-runtime/unavailable backend, full web packaging, full-suite, or new verified web producer claim. Capability PTY is not rerun here; the prior placement report owns that proof.
