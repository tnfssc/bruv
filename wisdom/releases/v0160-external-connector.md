# v0.16.0 external connector release

Published stable on 2026-10-04 at 06:54:38Z.

- Release: https://github.com/tnfssc/bruv/releases/tag/v0.16.0
- Successful workflow: https://github.com/tnfssc/bruv/actions/runs/37183737744
- Tag, prepared source and develop matched **3eec281bb270f1cafa61a0de243bbd0c45e00b4f** at verification.
- All20 required assets present: four normal binaries, four connector binaries, eight checksums and four legal/source files. [Verified metadata](v0160-verification.json).
- Hosted publication verified source/digests. Do not download binaries merely to rehash them.

## What shipped

Bruv and bruv-claude-compat are a matched updateable pair. No T3 bundle. bruv web gives explicit setup guidance, not a download or server launch. Keep real Claude state separate. External host is pinned official **v0.0.46-nightly.20261004.2644**, unchanged.

Actual steering, tool execution, local subagent history/status, explicit T3-owned delegation, permissions, durable questions, Stop ownership and reopen were tested. Stop ends the connector and its owned work; Steer does not abort current tools. Forks do not inherit live task/question authority. Normal CLI fast-mode and long-thread fixes fromv0.15.30 remain.

All release gates passed: full deterministic tests, paired smoke/cross-builds, actual Linux updater, native Mac helper and actual Mac updater/helper, and all six native suites on final Linux assets. The native suites cover command idle, same-root local-child return/idle, human controls, app delegation, default steering/Stop/reopen, then command idle again.

## Known limits and next work

This is not full CLI UI parity. Read [release notes](../../support/release-v0.16.0.md) and [setup](../claude-compat/external-t3-setup.md). Local child history/status is not independent child steering/all child controls. Live is explicit same-host opt-in; no browser microphone transport or native Live toolbar. No paid-provider/physical-device acceptance claim. Cross-builds do not prove execution on every target.

T3 may retain cancelled approval cards; explicit Decline clears them. Honest Claude-version/update warnings remain; do not use Claude updater controls for Bruv. Older2623 has a proved upstream Effect queue lost wakeup.2644 passes the actual gates but ships the same dependency: do not call the upstream bug fixed. Reproducer and minimal upstream patch remain in [queue evidence](../claude-compat/proof/result-boundary/README.md).

Proposal23 remains OPEN. Its fullscreen tool-history slice shipped; all assistant prose remains visible. Commentary-phase classification and standalone question cards were not completed. Do not close it as fully implemented.

## Release gate portability fixes

Four blocked attempts published nothing:

-37182001166: setup assumed /usr/bin/node.
-37182435634: a second workflow invocation had the same assumption.
-37182775259: stale packaging assertion still expected that absolute path (1977 other checks passed).
-37183052832: child-history verification reached a developer-only SDK cache.

Configured Node24.21.0 now drives all native gate subprocesses; isolated PATH retains its directory, not caller credentials. Actual relocated-Node tap/model and native command tests pass. SDK0.3.276 is an explicit test-only archive, SHA256f65a23c8272467ec37da496c5a349b10b3b4d04f052209f239f028c5aabdc3ca. Preflight requires its API/version before suites. Full clean setup plus all six suites passed before final dispatch. Active developer-home runtime fallbacks were removed. No production T3 patch or weakened assertion was used.

## Wisdom and values

Feature wisdom keeps exact ownership contracts, protocol proofs, failed attempts and next steps. New lesson here is specific: exercise copied release harnesses with explicit hosted inputs, and select recycled timeline rows by real identity rather than DOM order. Existing values already require real-path/rendered proof and clear ownership, so values stayed unchanged.
