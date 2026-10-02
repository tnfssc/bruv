# Main-v2 bounded acceptance — 2026-10-02

Read-only follow-up for root commit 5136f8948ccae0bd1e4369d95ca21d8a44ca6e39, upstream main 8bc40b4e07bb7b4b0f71876d59520360c9bf958c.

Tested this workspace's dist/bruv, SHA-256 bba792d4633b6d2e96ee10329fe07bf7494ef076f626560c2e2ac388d458b5e1; canonical patch SHA-256 c2aa1bac4b9b6d484d3532fba52c1a7dd16b1f79445087e0978afc449e2b989d. Exact canonical source/hash independently verified before/after. No old-pin release binary, production/test edits, build, commit, paid/external provider, or prerequisite bypass.

PASS maintained migration gate: independently prepared/verified shipped production source + dependency closure, 13-event history/native/provider graph/settings/usage/cost seed, migration 54→56, separate-process restart preserving total historical cost $0.42 and all seeded fields.

PASS native production gate: nested child, parent handoff, single completion, cancellation subtree/sibling isolation, same-key restart/reconnect, zero duplicate child, owned PID teardown.

PASS real Chromium native/Stop browser gate (relocated executable alone, no JS runtimes on provider PATH); exact stopped-child refresh retained state/transcript. PASS exact-route browser probe through actual web PID restart, retaining one prompt/response, model/mode, route and settled state. PASS strict packaged boot initial/reload and separate maintained startup test (two cold contexts + reload each).

PASS Pi RPC fixtures: 7 tests, 44 unrelated filtered; pre-turn confirmations, identical-content session approval boundary, empty input, edit/command classification. PASS 47 tests across seven root question/migration files (includes four migration guard tests), separately proving saved-question owner/fork/stale-write and offline real Pi SDK/compiled execute bridge behavior. This is not a live browser Pi select/custom-dialog acceptance claim.

Initial browser launches failed only because long TMPDIR exceeded Chromium's Unix socket path bound. Unchanged harnesses passed using short disk-backed /home/tnfssc/.bmv-2hhKfw; failures retained, no production fixes.

Durable report:
/home/tnfssc/Code/bruv/artifacts/code-reduction-implementation/main-migration-acceptance.md

Durable evidence/commands/receipts/screenshots:
/home/tnfssc/Code/bruv/artifacts/code-reduction-implementation/main-migration-evidence

Key files: identity.log, identity-final.log, candidate-build-manifest.json, migration.log, native/proof.json, browser-native/proof.json, route/proof.json, browser-boot.json, startup-proof.json, pi-dialog-complete.log, saved-questions.log. Scripts record exact prerequisites/flags; no full-suite/build repeat.

Not full release acceptance: chunk-layout disposition belongs to another reviewer and remains untouched. Preservation/worktree/full-release/platform, real SSH/capability/offline approvals, paid providers and non-Linux/Android remain not run in this follow-up. No commit/release/install/push performed.
