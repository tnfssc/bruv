# Frozen T3 archive retirement — 2026-10-02

User explicitly approved retiring only the frozen historical T3 code/config archive from the [code-reduction audit](../audits/code-reduction/2026-10-02/README.md). That approval supersedes the audit's original no-archive-cuts status; the audit and its reports remain historical evidence.

- Branch: `bruv/remove-retired-historical-t3-archive-68bc9a0c`.
- Worktree: `/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_68bc9a0c`.
- Pre-retirement Git baseline: `65e3242de4206cd8b123ffbc35c1f233bd7ce536`; original audit baseline: `d80d7058a2f5481f067586fd7042fe2746cff4ae`.
- Removed exactly **24 files / 35,011 physical lines** (including blanks/comments), matching the audit coverage ledger and Git deletion counts. These are historical replay inputs, not active runtime savings.

## Scope and recovery

All paths below are relative to `wisdom/experiments/t3/production-v2/archive/`:

| Removed file | Lines |
| --- | ---: |
| `.agents/patches/last-used-model-incremental.patch` | 249 |
| `.agents/patches/t3-v2-production-candidate.patch` | 12861 |
| `.agents/patches/t3-v2-production-export.json` | 9 |
| `.agents/patches/t3-v2-production-migration-packaging.patch` | 60 |
| `.agents/patches/t3-v2-production-source.json` | 4 |
| `.agents/patches/task-d8a00b29-backend-refinement.patch` | 5284 |
| `.agents/rollback/t3-v2-lifecycle/web--t3-source.json` | 4 |
| `.agents/rollback/t3-v2-lifecycle/web--t3.patch` | 13028 |
| `scripts/build-candidate.ts` | 84 |
| `scripts/die-web-mode-smoke.ts` | 475 |
| `scripts/die-web-model-smoke.ts` | 377 |
| `scripts/die-web-smoke.ts` | 425 |
| `scripts/die-web-stop-smoke.ts` | 520 |
| `scripts/export-candidate.ts` | 67 |
| `scripts/export-worktree.ts` | 62 |
| `scripts/leak-audit/bundled-web-runtime.mjs` | 357 |
| `scripts/leak-audit/current-web-client-source-probe.mjs` | 104 |
| `scripts/leak-audit/current-web-client-tests.mjs` | 77 |
| `scripts/leak-audit/current-web-provider-tests.sh` | 19 |
| `scripts/leak-audit/current-web-provider.mjs` | 73 |
| `scripts/leak-audit/current-web-server-check.sh` | 31 |
| `scripts/leak-audit/current-web-server-runtime.mjs` | 407 |
| `scripts/leak-audit/server-shutdown-probe.mjs` | 60 |
| `scripts/leak-audit/web-runtime-probe.mjs` | 374 |
| **Total** | **35,011** |

Retrieve into a separate empty directory, not over active inputs:

```sh
git archive 65e3242de4206cd8b123ffbc35c1f233bd7ce536 experiments/t3/production-v2/archive | tar -x -C /path/to/empty-replay-directory
```

All 24 paths were individually recovered with `git show <baseline>:<path>` and their line counts verified before commit. Recovered probes keep historical pins/relative paths and need intentional porting before reuse.

Retained byte-for-byte: `archive/.agents/patches/t3-v2-production-README.md` and `archive/.agents/rollback/t3-v2-lifecycle/artifacts--t3-v2-preservation-acceptance.json.bak`. Their claims/instructions describe the old system. Other historical prose, wisdom, audit ledgers/reports and evidence are untouched. The production-v2 README now explains retirement/recovery while retaining its former-layout prose. Updated only the T3 experiment index, gate README and leak-audit README references that described retired inputs as present.

## Consumer verification and checks

Before removal, checked tracked references for every retired basename and archive path across `src`, `scripts`, `tests`, `integrations`, CI/release workflows and root configs. Only documentation outside the archive referred to these files. Confirmed:

- `package.json`, `scripts/build.ts`, and CI/release select `integrations/t3/build/build.ts` and canonical `upstream/{source.json,bruv.patch,bootstrap.mjs}`.
- `scripts/packed-web.ts` fingerprints canonical integration inputs, not experiments; `tsconfig.json` excludes experiments.
- Migration acceptance retrieves its historical production patch from a separate Git commit, not this archive. Active architecture, source-verification, voice-boundary and branding assertions remain intact; no test was weakened or removed.

Passed (Bun 1.4.2; Node 24.15.0 on PATH):

- `bun install --frozen-lockfile` (local ignored dependencies only).
- `bun run check` (asset preparation plus root `tsc --noEmit`).
- `bun test tests/architecture.test.ts tests/no-web-voice.test.ts tests/t3/web-source.test.ts tests/t3/bruv-branding.test.ts`: **10 pass, 0 fail, 55 assertions**.
- Git recovery and unchanged-byte checks for retained archive prose/evidence; `git diff --check`.

Worktree mise config is untrusted; used installed absolute `/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun` and explicit Node PATH rather than changing trust/config. Read complete file-backed check logs (no reliance on truncated previews).

No full builds, release/browser/provider/device gates or full suite: canonical integration code/inputs and active features are unchanged (only its gate README changed). Repository searches cannot rule out private external consumers; old replay now requires Git retrieval. No other experiments were retired. Added this handoff; `wisdom/values.md` is unchanged because this applies existing ownership, proof and historical-retirement lessons, not a new value.
