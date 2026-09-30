# Faster full-source CI

## Intent and correction

The user wants normal work fast, with the relevant confidence and less machinery. Our earlier 46-second selected-source probe ran fewer checks. The user rejected it as reward hacking. That tier is removed; its timing is not completion.

All executable, build, test and unknown changes now require full ordinary CI. Only safe edits to existing reference docs use a cheap path. Keep the cumulative trusted baseline and fail-closed CI policy gate. Product remote CLI/PTy tests stay.

## What ships

- Use native Bun parallel tests, not our custom scheduler or maintained test-file list. Linux uses three root workers plus one web worker. macOS uses three workers. The hosted Linux runner reported four CPU slots.
- Reuse only an exact, checked web payload. CLI sources are excluded from its producer key; pin, patch, bootstrap, producer/packer code, locks, tools, platform and controlled build environment are included. Bad/missing cache rebuilds.
- Cache hits still prepare a fresh pinned checkout and frozen dependencies, then build the current CLI and run every current-CLI behavioral test. No source, node_modules, credentials or prebuilt CLI is restored.
- PR cache restore is read-only. Saves require a successful run on the trusted default branch (confirmed develop).
- Root and web test groups overlap after build. Both failures propagate. All existing web selections and client-runtime typecheck stay. Server/web typechecks belong to the same-input producer, not duplicate standalone calls.
- Release target binaries embed one verified archive with --reuse-packed-web instead of repeated repacking. Fresh local/release builds remain fresh by default.
- Use installed tmux when present. Linux fetches shallow HEAD plus the exact v0.7.1 updater tag; baseline planning still has full history. The real shallow fixture passed all 15 updater compatibility tests.

Coverage boundary: Release no longer runs on every develop push. Final packaged-browser, Mac-binary and updater gates now run only for actual releases. Ordinary CI keeps the complete root/source/web union, but is **not identical to the old combined CI plus Release-on-every-push pipeline**. Do not count removal of packaging as an execution speedup of those checks. Release readiness still needs actual Release gates. No further release was published; v0.15.14 is unchanged.

## Hosted proof

Both runs used commit **23e7f2075275e501e04b16156a8e3b269cc3b586**. Both passed every planned job and CI policy. One sample each, not p95.

| Run | Event | Whole workflow | Linux gate | Linux job | macOS job |
| --- | --- | --- | --- | --- | --- |
| [36782905694](https://github.com/tnfssc/die/actions/runs/36782905694) | push, cold payload | **341s (5m41s)** | 257s | 311s | 38s |
| [36783585589](https://github.com/tnfssc/die/actions/runs/36783585589) | workflow_dispatch, warm payload | **202s (3m22s)** | 148s | 176s | 41s |

Whole time is createdAt to updatedAt, including setup, queue, cache/post work and aggregate gate. Cold: 21:59:43Z–22:05:24Z; warm: 22:06:20Z–22:09:42Z, 2026-09-30. Warm logged an exact verified payload hit. Cold saved that payload successfully.

Both Linux runs: **1,438 root passes, 20 existing opt-in skips, zero failures, 203 files**. All **650 web tests** passed (281+158+26+9+138+38), with typechecks, transport, current CLI compilation and smoke. macOS: 285 passes, 3 existing opt-in skips, zero failures across 41 files. No test filter or timeout increase.

Full logs: /home/tnfssc/.die/ci-full-cold-green.log and /home/tnfssc/.die/ci-full-warm-green.log. Earlier worker local warm 129.990s was not hosted acceptance. The earlier local cold 208.252s failed fixture assertions and is not a matched green baseline.

## What the failures taught us

- Hosted receipt creation followed upstream .claude/skills as a file. Internal directory links now record link identity; their owned targets are hashed normally. External/excluded-tree links fail closed. GITHUB_ACTION is step metadata, not a payload input.
- Fake receipt fixtures repeatedly launched real pnpm. A private version shim reduced them from about20s to about2s; explicit version drift and real native archive smoke remain. Production tool checks were not removed.
- Eight pagination scenarios and four shell-budget cases shared one 5s test timer. They are separate default-timeout cases now. All elapsed-time and result assertions remain.
- Notification tests now control child-close and attention-clock events through the real TaskManager. They test the intended coalescing window, not OS scheduling luck. Repeat-flush checks still require exactly one wakeup.
- Native web replay counted a marker anywhere in message history. Replay and terminal requests both contain it. The fixture now forces exact initial/replay/terminal phases and checks two identical responses, two completed runs, one projected output, scoped authorization and cancellation. The old filter fails deterministically in the negative control. See [fixture phases](../t3/t3-native-hosted-fixture-phases.md).

## Still needs care

**Under one minute is not achieved.** Warm preparation was about41s, CLI compile8s, and overlapping root/web groups about94s. The root suite alone took89.50s on the hosted runner. Keep the whole-workflow number visible. Do not replace it with one fast step or local timing.

The prior pnpm cache was998,280,461 compressed bytes and took28s to restore. Upstream supportedArchitectures installs all OS/CPU/libc targets for portable production. A future host-only dependency preparation path on a verified payload hit may help. It is not implemented or proved. Do not drop portable producer dependencies or web checks. Native worker-budget tuning is also unproved beyond the accepted3+1 run.

## Code and pickup

Key owners: scripts/ci-web.ts, scripts/packed-web.ts, integrations/t3/build/build.ts, scripts/ci.sh, scripts/ci-web-validation.sh, .github/workflows/{ci,release}.yml. See [cache design](packed-web-reuse.md) and [native root proof](root-test-parallelism.md).

Durable completed worker worktrees under /home/tnfssc/.die/worktrees/:
- die-a86675007a5e-task_23c5c02a, branch die/reuse-unchanged-web-build-in-full-confid-23c5c02a, commit64a909b → integrated10e9364.
- die-a86675007a5e-task_58c6e2d7, branch die/make-timing-fixtures-deterministic-witho-58c6e2d7, commit45bf4f8 → integratedc75aa7a.
- die-a86675007a5e-task_3a9ad30d, branch die/fix-native-web-replay-fixture-accounting-3a9ad30d, commite1c313b → integrated426d57c.
- Custom shard worker5a5a2cf remains only as historical proof; it was reverted. Native Bun owns discovery/execution.

No workers or hosted proof runs remain active. Final proof docs are the only follow-up. Use TMPDIR=/home/tnfssc/.die/tmp-pi-removal for Git signing and tools; /tmp filled during this work. Local pnpm11.27.1 is at $TMPDIR/bunx-1000-pnpm@11.27.1/node_modules/.bin; CI sets it up normally.

Values2 and10 were updated for confidence, honest scope and parallel/focused verification. No further value was added: fixture counting and timing errors fit the existing proof rule.
