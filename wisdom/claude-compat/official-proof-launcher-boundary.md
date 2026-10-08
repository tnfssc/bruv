# Official proof must call the actual harness

Release run **37831183075 attempt 2**, native job **113515670064**, failed before
launching T3 at run-trace.mjs:31 (release root **2132d1c1**). The proof searched
for the literal inline model.records.some check and sliced through passed = true.
A readability refactor had extracted those checks into verifyModelDelivery().
Linux/macOS passing did not cover this textual join; this failure was not evidence
of a connector or official T3 regression.

## Stable join

- run.mjs exports runAcceptance({ driverPath }); run-subagent.mjs exports
  runSubagentAcceptance({ driverPath, scenario }). Direct CLI execution calls
  those same functions with the existing defaults.
- The official launcher imports those functions, never reads/copies/slices their
  source. The shared replay imports the explicitly configured replayDriver URL;
  default/app-owned driver selection stays unchanged when none is provided.
- Command-only verification still requires **zero** model requests. Subagent
  verification still requires exact once-only root completion/cancellation/return,
  three native child histories, committed source-ID resolution, actual child
  tool/result/answer, and the pinned SDK 0.3.276 reader with correct parent binding.
  No native UI, ownership, idle, token, history, executable-pin or cleanup check
  was removed. Human/default/app-owned verifiers are unchanged.
- Replay finalization regression launches the real replay with its configured
  subagent driver instead of extracting another source-text generation block.
  New offline tests distinguish command/subagent verification, reject unexpected
  inference and duplicate continuations, require native histories, and check
  cleanup/failure publication. Stand-in tests are **not** native acceptance.

When sharing a harness, share its callable function and explicit scenario inputs,
not its source spelling. This is a feature-local instance of the existing values
on testing the real product and leaving usable proof; values need no new rule.

## Actual external revalidation (2026-10-08)

Fresh **bun run build** from integrated base **067fdf60** plus this harness change:

- Bruv runtime SHA256: 1f29adbf446880d0420fadf3dce047e7f144a282eebecb29dced3c1cb14294c8.
- Shipped connector launcher SHA256: 55b58718cdfb8f87e7a947b8e67ec4911bf6fb60cb33d2acfe72f67a39d96246.
- Unchanged official 2644 SHA256: 53fbd1c78ab3a01ea91913f65dc17b9d7824f00a81564e06992a73e183054e48.

scripts/run-native-release-gate.mjs exited **0** with all six suites:
**command, local-child, human, app-delegation, default-controls, command-final**.
Each result passed with the official hash and unmodified flag; every cleanup
record confirms scoped state removed. Local-child resolved/read **8 actual native
child messages** through SDK 0.3.276. Both command suites retained zero model wakes.
All six invocation records identify the same built pair above.

Proof retained at /var/tmp/bruv-launcher-boundary-proof-AUCtnS/proof (including
gate.json, per-suite results/invocations/cleanup and native frames); log at its
sibling gate.log. Historical committed 2644 proof was not overwritten.
The exact owned outer HOME was /var/tmp/bruv-launcher-boundary-proof-AUCtnS/home;
launch used **env -i**, owned TMPDIR, explicit artifact/browser/SDK paths, Node
24.21.0 and loopback inference only. Cached unchanged official T3 and Playwright
1.63.0/headless Chromium were reused; SDK archive was freshly checksum verified.
No live credentials, paid inference, global installation or official code edits.

Focused checks: all 133 native harness Node tests passed (including 6 new
entrypoint cases). CI's Bun runner passed 16 runner/join/entrypoint cases;
release-gate/setup tests passed 15. Focused format/lint and diff checks passed.
No composed native suite skipped. Full ordinary CI, macOS/Android execution,
Live/devices/paid providers and the existing broader acceptance gaps were not
retested here. No workflow or ci.sh edits.

See [official pin/reproduction](proof/official-2644/README.md) and
[official nightly revalidation](official-nightly-revalidation.md).
