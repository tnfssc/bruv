# MCP close: observe the client owner, not server cancellation

Date: 2026-10-01. Starting commit: 3399263. Scope: tests only; no renderer or product lifecycle edits.

## Finding

[CI run 36930539074](https://github.com/tnfssc/bruv/actions/runs/36930539074) failed only the close-during-initialize test (1685 pass, 20 skip, 1 fail). The retained log is /home/tnfssc/bruv-evidence/resume-fix-20261001/ci-failure.log, lines 5839–5857: DELETE was event 1, server stream cancellation was event 2.

The test called the server-side ReadableStream cancel callback `settled`. That callback is a remote HTTP disconnect observation, not settlement of the client request. DELETE travels on another request; receipt of DELETE and processing the disconnected response stream have no required server-side ordering.

The existing client stops admission, aborts its owner controller, drains tracked requests (under the existing close bound), then captures and DELETEs any acquired session. readRpc awaits client reader cancellation and releases its lock in finally before the tracked initialize rejects. No product lifecycle defect was found in this failure.

## Narrow correction

- Keep the real HTTP close-during-initialize test and its acquired-session header check. Observe completion of the **client response reader's cancel** instead of the server stream callback. Assert the full order: initialize-body, settled, delete; missing markers can no longer accidentally pass an index comparison.
- Add a controlled fetch/ReadableStream fixture whose client reader cleanup waits on a promise gate. Assert abort, draining while the gate is held, then settled, delete after releasing it. Initialization must reject and DELETE must carry the acquired session ID. No sleeps, new timeouts, or relaxed ordering assertions.

The gate tests a client's owned cleanup, not eventual server idle cleanup after a lost connection. It does not alter the existing bounded-close policy.

## Proof

Bun 1.4.2 (744846f84), Linux. Commands use that binary's absolute path when PATH lacks Bun.

- Before correction: bun test tests/t3/production-bridge.test.ts --test-name-pattern 'close aborts initialize' --rerun-each 100 — 100 pass, 0 fail, 300 assertions. The rare CI ordering was not reproduced locally; this is not a claim that the old observation was sound.
- Final correction, owned frozen install: bun test tests/t3/production-bridge.test.ts --rerun-each 100 — **1900 pass, 0 fail, 6600 assertions**, 10.96 s.
- Mutation proof: copy src and this test to an isolated temporary directory, link dependencies read-only, remove only close's in-flight wait block, and run --test-name-pattern 'close drains client'. It fails at the held-gate assertion with **received [abort, delete, draining]**, expected [abort, draining] (0 pass, 1 fail). The temporary mutation directory was removed; production code was not edited. This shows the test still catches DELETE-before-drain.
- Related transport/native routing/notification tests: env SHELL=/bin/bash bun test ./tests/t3/production-bridge.test.ts ./tests/t3/native-routing.test.ts ./tests/t3/local-notifications.test.ts — **44 pass, 0 fail, 155 assertions**, 3.42 s.
- Direct tsc --noEmit passes with runtime-assets copied read-only from the primary workspace. Scoped Biome lint/format and git diff --check pass.

## Environment limits and handoff

Initial repetitions used the primary workspace dependency tree through a read-only symlink. Final repetitions use an owned bun install --frozen-lockfile (136 packages, no lockfile changes). No shared dependency edits were made. Asset preparation rejects local Pi host hashes (primary tree: dist/cli/args.js; frozen install: dist/main.js). preparePiHost validates all files before its write phase, so neither failed attempt changed dependencies. Thus bun run check/build/full CI are **not** claimed green here; direct typechecking used copied assets, not a successful fresh asset preparation.

An extra broad tests/t3 sweep had 72 pass and 7 setup failures: two shell-output assertions included the interactive fish/mise untrusted-config banner, and five packaging tests lacked dist/bruv. The relevant tests were rerun with SHELL=/bin/bash; no UI or packaging behavior was changed to hide these failures. Biome check additionally reports existing import ordering; CI-equivalent lint and format pass without unrelated import edits.

Parent should integrate the test/documentation commit and run the release gate in its prepared build environment. No push or release performed. Values unchanged: this is a feature-local application of values 2 (say what proof shows), 3 (one clear owner), and 10 (leave usable proof), not a new general principle.
