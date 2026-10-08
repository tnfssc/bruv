# Paired updater timeout and error phases — 2026-10-08

## Scope and source

Report: updating to 0.16.21 failed with “Unable to download bruv-linux-x64:
The operation timed out.” The outer catch incorrectly advised checking install
permissions, although the failure was in the download. Installed files stayed
unchanged.

Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_005977ae
Branch: bruv/fix-updater-timeout-diagnostics-005977ae
Base: 0610c21855a77ead9939d94243b5208e5230d865 (Prepare v0.16.21 release).
Read [values](../values.md) and [paired update](../claude-compat/paired-update.md).
Refreshed origin/develop with git fetch, and checked the remote default HEAD with
git ls-remote --symref. Both pointed to the base above at investigation time;
there was no newer relevant source to integrate. No merge was made.

## Evidence and decision

Public GitHub release metadata for v0.16.21 returned HTTP 200:

- bruv-linux-x64: 92,476,896 bytes (about 88.2 MiB).
- bruv-claude-compat-linux-x64: 1,816 bytes (the sibling launcher).
- Their SHA256 files: 81 and 95 bytes respectively.

A HEAD request to the official bruv-linux-x64 download followed the redirect to
release-assets.githubusercontent.com and returned HTTP 200, Content-Length
92476896, application/octet-stream. No binary was downloaded or executed for
this investigation.

The old 300,000 ms deadline applied to metadata, binary downloads and checksums.
The large binary alone requires roughly 308 KB/s sustained to fit five minutes,
before redirects or startup delay. A roughly 1 Mbps connection would need about
12.3 minutes. Binary requests now get 900,000 ms (15 minutes), enough for roughly
103 KB/s before overhead. Metadata and checksum requests retain 300,000 ms: the
observed issue does not justify changing their existing behavior. Each fetch gets
its own signal; the download signal also covers reading its response body.
There is no retry loop, new configuration, or timeout removal.

The installation catch now names the active phase: create staging directory,
download/stage the named asset, verify the staged pair, back up the installed
pair, check concurrent changes, or replace the named installed executable.
Existing inner download/checksum errors keep their asset and cause. No blanket
permissions advice remains. Actual filesystem failures still expose the OS error
and the filesystem phase. Rollback/recovery and unchanged-install text remain.

Canonical asset URLs, SHA256 validation, both staged version probes, macOS helper
probe, identity checks, connector-first publication, backups and rollback are
unchanged. Neither checksum nor paired-install protections were weakened.

## Proof

Run with Bun 1.4.2 and the prepared worktree dependencies:

~~~sh
node_modules/.bin/biome format --write src/update.ts tests/release/update.test.ts
node_modules/.bin/biome lint src/update.ts tests/release/update.test.ts
bun test tests/release/update.test.ts tests/release/update-release-shape.test.ts
node_modules/.bin/tsc --noEmit
git diff --check
~~~

Focused tests: 88 pass, 0 fail, 480 assertions. New tests cover a TimeoutError
before headers and during body consumption, truthful download-phase text, both
old files intact, no probes or replacements, and no staging leftovers. A spy on
AbortSignal.timeout checks the actual fetch sequence budgets: metadata 300000,
normal binary 900000, checksum 300000, connector binary 900000, checksum 300000.
The real non-writable-directory test checks staging phase plus EACCES/permission
denied; the injected publication failure checks the replacement phase. Existing
integrity, paired publication, rollback, release shape and private compiled
updater tests also pass. The compiled fixture updates only its non-running temp
pair, not the real installed pair.

The first test run had 87 pass / 1 fail: the real permission test expected the
removed blanket word “permissions.” Its assertion was changed to require the
actual staging phase and OS permission error, not skipped or relaxed to any error.
Formatting and typecheck pass. Lint exits zero with style/advisory diagnostics,
not a claim of warning-free code.

## Limits and handoff

The report proves a timeout, not the user's throughput or its root cause. The
larger deadline helps slow-but-progressing downloads; it does not cure GitHub/CDN
outages, stalled links or lower-level fetch timeouts. Tests check configured
budgets and simulated failures, not a real fifteen-minute transfer. Public
metadata and HEAD checks do not reproduce the user's network. No real installed
pair was touched, no release or push was performed, and no unrelated source was
merged. A full repository gate and native cross-platform updates were not run.

Values are unchanged: this follows the existing rules to report only what proof
shows, keep work bounded, and preserve paired ownership and user data. This is a
feature-local correction, not a new general rule.
