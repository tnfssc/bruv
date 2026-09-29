# Pi 0.99.1 / GPT 6.1 Sol integration (2026-09-29)

Implementation worktree: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_a0bcdcc4`; branch: `die/upgrade-pi-and-enable-gpt-6.1-sol-a0bcdcc4`.

## Ownership and durable worker branches

All workers start at `2b38a430f617580cbc399313dcc4a627503a2123`. Their worktrees use the implementation path above plus these suffixes:

- `-a86675007a5e-task_4595481d`: `die/pi-history-parity-4595481d`, disk-backed history parity.
- `-a86675007a5e-task_2aa8e5fb`: `die/pi-runtime-regressions-2aa8e5fb`, goal/TUI runtime.
- `-a86675007a5e-task_705eaf7c`: `die/sol-upstream-registry-proof-705eaf7c`, catalog and picker proof.
- `-a86675007a5e-task_7ebc23fc`: `die/pi-upgrade-independent-audit-7ebc23fc`, independent integration audit.

## Dependency and license evidence

The actual npm latest Pi AI endpoint returned 0.99.1 on 2026-09-29. All four direct Pi packages are pinned to 0.99.1; transitive Pi packages align in bun.lock. This also brings upstream's OpenAI 7.19.0 dependency. No daily dependency workflow or T3 source pin/patch changes.

Compared https://raw.githubusercontent.com/earendil-works/pi/v0.99.1/LICENSE byte-for-byte with third_party/pi/LICENSE (cmp exit 0). Curated fallback now includes pi-codemode and pi-mcp, still gated on explicit package names and exact 0.99.1. Notice generation: 128 production packages, 552399 bytes. Release notice tests retain fail-closed unknown/unpinned checks.

## Validation setup

Use Bun 1.4.2 and Node 24.21.0 installed executable directories explicitly in PATH, with a bash wrapper (the parent shell is fish). Set MISE_TRUSTED_CONFIG_PATHS to this worktree's mise.toml process-only and use a neutral TMPDIR such as $HOME/.die/tmp-pi-a0bcdcc4. No global mise trust is needed. Mise's pnpm installer currently cannot match the upstream tarball asset; bunx provides pnpm 11.27.1, and T3 selects 11.10.0 through its packageManager field. Put the bunx cached .bin directory directly on PATH; do not run pnpm exec at the root (new pnpm auto-installs there). Any incidental root pnpm files were removed. Bun frozen install alone can retain pnpm symlinks, so the owned worktree root node_modules was removed and reinstalled with bun install --frozen-lockfile before final validation. This ensures the tested graph actually comes from bun.lock.

## Integration findings

DiskEntryStore now publishes on the first user **or** assistant message, including branch/reopen paths; setup-only state stays private. Tiny session_info names are kept in the metadata skeleton so upstream's direct fileEntries name lookup remains correct. getEntryCount uses the metadata ID index, without loading bodies. Real native/adapted subprocess parity covers publication, names/clearing, counts, reopening and user-only branching. Collision recovery and bounded-storage tests retain their assertions at the new publication boundary. Only after this review was prepare-assets updated to require exact Pi 0.99.1 plus SessionManager SHA-256 `046b6a1109ac3f0ed893bb85bf0648709362fa926a5da75761216cf2fcf9d926`.

Goal waiting/handoff did not require a production semantic change. Its shell fixture was invalid under fish; the replacement explicitly invokes sh, gates an actually running owned job, checks persisted waiting and no premature provider turn, then requires completed=1/failed=0. TUI coverage also verifies subsequent pause/status command routing. ExtensionToolContext adds tools/executeTool; die's execute implementation does not consume those fields, so existing fixture annotations now correctly describe the tool context. Independent API/event audit found no further concrete regression.

Sol metadata proof is in [model verification](../models/gpt-6-1-sol-upstream-verification.md). Both OpenAI and Codex offer exact ID `gpt-6.1-sol`; offline tests use in-memory dummy credentials of the appropriate type, render the real selector, and select with Enter. The built standalone CLI also lists Sol offline with a dummy OpenAI key. None of these prove live account entitlement or service availability.

## Validation results

- Fresh T3 web build from the pinned source/patch: passed, including both application typechecks. CLI build then packed this freshly built web runtime via --reuse-web (not another checkout's stale artifact).
- Built executable standalone smoke: passed. Loopback-only OpenAI default transport probe: source and compiled CLI both passed (session.updated and HTTP 401 handling).
- Web backend deterministic selection: 259 tests / 15 files passed; native production integration against this binary: 1 passed; web model behavior: 158 passed; contracts: 26 passed; client projection: 9 passed.
- Final clean Bun frozen-lockfile root deterministic suite: **1353 pass, 20 skip, 0 fail**, 1373 tests / 193 files, 30773 assertions. Command: DIE_RUN_LLM_TESTS=0 bun test ./tests. Focused CLI/history/catalog/execute/goal SDK and TUI run: **63 pass, 0 fail**. No guard or assertion was disabled.
- Final clean build SHA-256: `1f058272a93f3bc4c7dfc99584c86cb9401d6eb255fa332549af06cddc3fd361` (dist/die). Smoke and source/compiled offline transport were rerun successfully on this clean artifact.
- Typecheck, format and lint pass (lint reports 591 warnings and 822 informational diagnostics; exit 0); frozen Bun install and notices generation pass. Pi LICENSE cmp passes.

Initial runs before generated assets / compiled binary naturally failed; those are not runtime regression evidence. They were superseded by the complete built runs. The early goal fixture and old SDK guard failures were investigated rather than silenced.

No paid/live provider call, push, tag, publish, or user-installed die replacement was made. The existing isolated CLI install test only exercises a disposable temporary HOME.

## Values assessment

Existing values 1/2 (delivered-path evidence and honest limits), 6 (preserve user work/guards), 9 (behavioral dependency review), and 10 (durable handoff) cover the lessons. No general values edit needed.

## Release readiness and remaining limits

Ready for the parent release process on the tested Linux platform: aligned dependency upgrade, exact guarded SDK source, clean frozen install, fresh web build, compiled CLI, full deterministic suite and focused integration proof pass. Version remains 0.15.11; parent chooses the release version and performs release CI/signing/publishing. No push/tag/publish or local executable installation occurred. macOS packaging/live hardware and paid GPT-6.1 Sol API/account access were not tested. Catalog costs are upstream metadata, not a pricing or entitlement guarantee.
