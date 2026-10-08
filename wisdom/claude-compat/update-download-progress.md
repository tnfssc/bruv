# Update download progress — 2026-10-08

Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_2f20e906
Branch: bruv/add-updater-download-progress-2f20e906

This is the progress piece of the updater follow-up. Parent will join it with
another worker's timeout and error wording changes. This branch leaves those
settings and messages alone. No push, release or real installed update was done.

## What changed

updateBruv keeps onDownload(version). The small optional onDownloadProgress
callback reports the asset, received body bytes, optional size, elapsed time and
downloading/complete/failed status. It reads the response body in chunks. It does
not estimate received bytes from a clock. A complete event means only that the
binary body arrived, not that the update passed verification. Each asset finishes
its progress line before its checksum request.

Size comes from a valid response content-length, or the optional nonnegative safe
integer size on the already resolved official release asset. Size is a display
hint, not a new acceptance check. Missing or invalid size stays unknown. SHA256,
staged pair/version/helper checks, replacement and rollback stay as they were.
Readers release their locks; unfinished reads are cancelled without replacing the
original read error with a cancellation error. Staging cleanup stays with the
existing paired installer.

The root CLI uses the same display for normal and connector update entries. A TTY
rewrites one line, at most every 100 ms, with asset, bytes, percent when known,
average speed and ETA when calculable. The line ends on completion or failure.
It also ends before the CLI prints its result/error. The asset shortens first to
fit the terminal width. Plain output has no ANSI or carriage returns: one start
line, byte progress at most every ten seconds, and a final line per asset.

For the parent's measured 7,376,878 bytes after 120 seconds out of 92,476,896,
the formatter shows:

~~~text
Downloading bruv-linux-x64 7.0 MiB / 88.2 MiB (7%) · 60.0 KiB/s · ETA 23m 5s
~~~

That input came from the parent. This worker did not repeat the upstream probe.

## Proof

~~~sh
bun test tests/release/update-progress.test.ts tests/release/update.test.ts \
  tests/release/update-release-shape.test.ts tests/claude-compat/connector-update.test.ts
node_modules/.bin/tsc --noEmit
node_modules/.bin/biome format src/update.ts src/update-progress.ts src/cli.ts \
  tests/release/update-progress.test.ts tests/claude-compat/connector-update.test.ts
~~~

The four focused files pass: 117 tests, 779 assertions. The new tests use actual
ReadableStream chunks and check byte events before the rest of the body is allowed
to arrive. They cover both assets, known/unknown size, body abort, reader release,
consumer failure cancellation, checksum failure and untouched installed files.
The existing updater checks still cover staged versions and rollback.

The compiled root CLI fixture runs normal update, connector subcommand and launcher
against private temporary pairs with synthetic release bodies. All three print
plain progress lines in the right order. TTY writer tests check rewrites,
throttling, narrow width and line completion; these are not a human terminal or
real GitHub network acceptance test. No actual installed binary was replaced.

## Limits and handoff

Speed is the per-asset average since its request started, including connection
wait. It is not an instantaneous speed. No timer invents progress during a stall;
the last line stays visible until more bytes arrive or the request fails. Very
narrow terminals can lose trailing fields after shortening the asset. Bodies
still stay in memory for checksum validation; chunks are assembled into one byte
array, not spooled to disk. No memory-budget or upstream-network claim is made.

Parent should join and run the timeout/error worker's patch with this one. Neither
piece adds retries. Native platform and live network acceptance remain with the
parent. Values did not change: showing real work, preserving user data and giving
honest proof boundaries already live in wisdom/values.md.
