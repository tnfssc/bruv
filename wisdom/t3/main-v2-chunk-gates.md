# Main v2: maintained chunk gates

## Change and location

- Worktree: `/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_c550b21e`.
- Branch: `bruv/replace-retired-chunk-layout-assertions--c550b21e`; base Bruv `5136f8948ccae0bd1e4369d95ca21d8a44ca6e39` (upstream main repin).
- Applied the parent [read-only review](../../../artifacts/code-reduction-implementation/main-chunk-gate-review.md), located at `/home/tnfssc/Code/bruv/artifacts/code-reduction-implementation/main-chunk-gate-review.md`.
- Deleted `integrations/t3/upstream/chunks.test.mjs`: custom sidebar/composer/timeline splits and historical main/chat byte caps are retired contracts, not features.
- Replaced `chunks-large-data.test.mjs`: require main and its complete static manifest closure to have nonempty emitted files; require actual upstream HEIC CSP and Shiki WASM package-suffix matches, nonempty files, dynamic flags and exclusion from that closure. C++/Elisp JS payload matches must exist, be nonempty and outside startup, permitting shared C++. Chat route must exist, be dynamic and stay outside startup. Compare emitted filenames so eager shared-file aliases fail. Main is a real manifest chunk but not marked `isEntry` in either bundle.
- `chunks-startup.test.mjs` and all three existing graph regressions unchanged. One compact regression adds valid shared C++, missing HEIC match, missing/empty C++ file and eager HEIC/shared-file alias rejection.
- `verifyWebChunks` now selects both gates for fresh producer/reuse-web repack; `scripts/ci-web.ts::webInputs` includes the maintained payload gate, invalidating old CI keys. Packed receipt fingerprints already cover integration files. README/repin note record the replaced contract and runtime limits.
- 59 fewer gate lines; 13 fewer maintained code/test lines overall, including regressions/wiring. No compiler plugin, upstream patch/pin, package, lock, warning threshold or receipt edits.

## Checks (Bun 1.4.2 / Node 24.21.0)

- PASS `T3_WEB_DIST=<dist> node --test integrations/t3/upstream/chunks*.test.mjs`: 2/2 for each read-only bundle:
  - Old: `/home/tnfssc/Code/bruv/dist/bruv-web/dist/client`.
  - Candidate: `/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_aceee262/.cache/main-v2/source/apps/web/dist`.
- PASS direct `verifyWebChunks` invocation against both paths: 2/2 each, without producing/repacking anything.
- PASS root `bun run check`; scoped Biome format on the four changed JS/TS files.
- PASS `bun test tests/t3/web-chunks.test.ts tests/ci-web.test.ts tests/packed-web.test.ts`: 38 tests / 104 assertions. Receipt tests use disposable fixtures, including a tiny native compile, not a full producer.
- Logs/scripts: `<worktree>/.cache/chunk-gates/{final-checks.log,producer-verify.log}`. Absolute installed tools, candidate root node_modules read-only symlink and this worktree's disk-backed temp used; no dependency install. Initial local pnpm PATH omission was corrected before the passing run.

## Limits and next owner

No full build, release, push or mutation of either source/dist. Parent owns one fresh normal producer after integration to obtain the changed-gate receipt; do not manually waive/reissue it. Manifest/graph proof is not real HEIC decoding, Pierre WASM C++/Elisp tokenization, browser boot/reload, history/native acceptance or timing proof. Another worker owns candidate browser probes; no result inferred here. Values unchanged: existing upstream ownership, fewer parts and bounded honest proof already explain this correction.
