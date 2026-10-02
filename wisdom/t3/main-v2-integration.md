# Main v2 integration — released in v0.15.27

User chose upstream main instead of nightly and approved release after validation. No feature cuts. Pin8bc40b4e07bb7b4b0f71876d59520360c9bf958c; branch metadata main, immutable fetch/build revision. Published tag e82f33ffec59303049c2068a5196a786e316516b. [Release proof](../releases/v0.15.27-main.md). All work/jobs complete.

## Decisions and code

- Repin5136f8 integrated as9300802. Current official Pi already existed; no second adapter or task/question/security/cancel seam removed. Product/test patch payload unchanged outside regenerated lock. [Repin details](main-v2-repin.md).
- Five old chunk failures reproduced identically on previous/new pins; heavy payload bytes identical. Retired compiler/component split assertions were stale. Replace with real nonempty codec/grammar/chat-route laziness checks, retaining cycle guard, and include the check in producer/repack/cache identity. b752a6f integrated as9fc1144. [Gate proof](main-v2-chunk-gates.md).
- One extraction test rejected unrelated .cache ancestors. b0e1942 integrated as3116877 narrows assertion to actual hostile bruv-live-cache path; integrity/victim checks unchanged.
- Native replay compared arrival-order arrays; TUI read before stdout.9dd6b9f integrated as078507d forces reverse arrivals and checks exact ordinal/response identity; bounded visible output waits preserve and strengthen only-confirmed-task cancellation. [Repeated/negative proof](main-v2-test-scheduling.md). Production unchanged by test corrections.

## Validation

Fresh normal parent producer passed after gate changes, using .cache/bruv-t3code-8bc40b4e07bb7b4b0f71876d59520360c9bf958c and disk temp .cache/main-producer-tmp. No forged receipts or repeated reviewer builds. Final root1720pass/20intentional opt-in skips/0fail,32968assertions; web645pass;11focused artifact/source tests; standalone smoke; typecheck/format/lint. Logs artifacts/code-reduction-implementation/main-*.log.

[History/native/browser acceptance](main-v2-acceptance.md): seeded usage/cost/history restart, native child/Stop/reconnect without duplicate launch, actual initial/exact-route reload/backend restart, Pi dialog fixtures separately from saved-question ownership. [Browser feature proof](main-v2-browser-features.md): real HEIC render1280x854, actual shared/Pierre-worker WASM cpp+Elisp tokens;277served assets match immutable candidate bytes. Parent inspected HEIC and C++ screenshots. Unrelated aborted telemetry requests retained.

Failed local attempts are saved, not waived: initial .cache assertion, one rerun missing pnpm PATH, isolated Herdr socket reset (isolated12tests passed), concurrent replay order/TUI output failures fixed as above. Final full root run passed with complete toolchain and the same .cache temp setup. Short disk TMPDIR was needed for Chromium Unix socket path limits.

Hosted release37072282424 passed all gates. [Published release](https://github.com/tnfssc/bruv/releases/tag/v0.15.27). Limits remain: no blanket paid-provider/device/all-codec/all-language/SSH/platform acceptance inferred from these tests.

## Durable work

Candidate/replay proofs: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_aceee262, branch bruv/repin-t3-integration-to-upstream-main-aceee262, .cache/main-v2. Gate worker: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_c550b21e, branch bruv/replace-retired-chunk-layout-assertions--c550b21e. Scheduling proof: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_9aa40600; exact branch and evidence in its handoff. Parent reports under artifacts/code-reduction-implementation/main-{migration-acceptance,chunk-gate-review,browser-features}.md.

Wisdom records the decisions and bounded proof. Values stayed unchanged after broad review: existing upstream ownership, real-path proof and obsolete-test-contract guidance covers these lessons.
