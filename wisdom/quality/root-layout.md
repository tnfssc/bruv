# Consolidated root layout

Branch: bruv/consolidate-repository-root-layout-1cb32e3b.
Handoff: /home/tnfssc/.bruv/worktrees/t3-53f4b259-5442693331ce-task_1cb32e3b.
This new follow-up finishes root ownership, not another historical-output sweep.

## Ownership and integration

- Reviewed c70562a0371e8e5946e614f9ee0f47a1ecca2a9d → 523f5523: curated
  legal inputs in licenses/third-party. Reviewed 561e3b8c → 23702ffe: retire
  245 completed outputs; CI history collectors use artifacts/ci-history.
- 491f29f5: PRODUCT and ARCHITECTURE in docs; all 69 release notes in
  docs/releases. Release writers, selectors, workflow and tests follow that
  home. Product decisions are not rewritten: only a historical-summary banner
  and navigation corrections. The only other support file, GPT-Live HTML,
  stays unchanged in docs/historical with its snapshot status in a README.
- README, CONTRIBUTING, LICENSE, THIRD_PARTY_NOTICES and tool configs stay
  root entry points. docs/README is the navigation map. No compatibility copies.
- Generated lane 6936491a → 98fb6932 stages rebuildable assets in
  dist/runtime-assets. Both CLI entry points and Photon imports, preparation,
  tests, executable probes and maintained setup guidance use the new path.

Root artifacts stays: CI logs, proofs, screenshots and performance runs are
retained evidence, not disposable compile/distribution staging. Current builds
do not wipe dist, and release packaging explicitly selects binaries/notices
from dist/release, not whole dist. Moving retained runs under dist would blur
that clean/staging boundary and require a broader producer/consumer migration
without product benefit. Asset staging is safely rebuildable; it is embedded
in executables and not shipped as a directory. No runtime fallback is needed.

Generated lane branch: bruv/generated-output-homes-42b79a47. Worktree:
/home/tnfssc/.bruv/worktrees/t3-53f4b259-5442693331ce-task_1cb32e3b-5442693331ce-task_42b79a47.
Parent owns the integrated result; that lane is committed and clean.

## Proof and limits

All 72 doc moves and nine curated license inputs matched original Git bytes
before maintained edits. All 69 releases and the HTML still match exactly.
Moved Markdown links resolve; asset tests check upstream bytes/vendor banners,
unchanged mtimes, regeneration and retained evidence surviving staging cleanup.
Integrated check/typecheck, paired build, format, lint, relocated standalone
smoke, 180 focused tests (1,189 assertions) and one offline Python collector
test pass. Coverage includes packaging, release preparation/selection/workflow,
architecture, prompts, proof builds, shipped launcher templates and image WASM.
Notices reproduce the tracked notice file (211-package payload in ignored dist).
Style checks retain existing warnings. An attempted direct launcher verifier
used a binary where it requires a release directory; the correct all-target
launcher gate tests pass. No full CI, hosted release, paid provider or native
platform acceptance claimed: these path changes have focused integration proof.

No ignored artifacts/runtime state deleted or migrated. Old root runtime-assets
remains ignored solely to preserve local bytes; another checkout’s old generated
paths may remain until its owner safely migrates them. Remaining work is optional
local-data migration and human-requested publication; no push/PR/release done.
Historical receipts stay historical. This note supersedes the earlier layout
note’s root-doc/support choice. Values unchanged: ownership, safe user data,
honest proof and compact handoff already cover the lesson.
