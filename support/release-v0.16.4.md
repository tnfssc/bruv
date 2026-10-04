# v0.16.4

## One runtime, smaller connector

- Bruv now compiles the CLI and connector into one executable. The final local Linux build is about 92.35 MB; `bruv-claude-compat` is a tiny 1.8 KB launcher, not a second bundled runtime. It runs the sibling `bruv claude-compat` without requiring Bun or Node.
- Connector `--version` advertises protocol compatibility `2.1.280`, separately identifying the actual Bruv product version. `--bruv-version` reports `bruv-claude-compat <product version>` for product checks; normal `bruv --version` is unchanged. This is not a Claude account, authentication or model identity.

## CLI activity groups

- Activity headers are padded to align with transcript content, muted by the theme and arrowless. Opening a group reveals compact tool rows; each item's details open independently and retain their state through group collapse/reopen. `/activity` offers group and item controls.
- Assistant prose separates multiple groups within a turn. Background job notices join their uninterrupted source group where provenance permits, or appear in a separate activity group when separated by lasting prose. Failures, cancellations and pending human questions stay visible; task ownership, model context and saved history are unchanged.

## Setup and update

Stop active Bruv/T3 sessions, then run `bruv update` to install the same-version CLI/launcher pair. The existing v0.16.3 updater migration bridge was validated with actual compiled assets, including checksum rejection and rollback. Keep both files together; use `bruv web` for installation-specific setup paths.

In T3 Settings > Providers, add a separate Claude instance for Bruv. Set the absolute launcher path and an isolated SDK historyHome/homePath such as `/home/alice/.bruv/claude-compat-sdk`; leave launch arguments empty. The normal `~/.bruv/agent` auth/settings home and sibling Bruv binary are defaults. `BRUV_CLAUDE_COMPAT_HOME` and `BRUV_CLAUDE_COMPAT_BRUV_PATH` remain optional overrides.

Use full, exact Bruv provider/model IDs for chat and auxiliary models, and configure a default in the selected Bruv home for health checks. Keep SDK history separate from auth/settings and real `~/.claude`; do not change T3's global environment or copy secrets/history. Do not use T3's Claude updater for Bruv.

## Important limits

Full UI-only fork/history support still requires [T3 PR #15598](https://github.com/pingdotgg/t3code/pull/15598); no upstream release containing it is established here. Tested official nightly 2644 lacks the fix, so fork may fail in T3 before Bruv starts. Basic chat can work with correct settings.

On that tested host, the Unsupported version warning is gone, but latest-Claude update notices and the built-in Sonnet 5.5 minimum-version advisory are distinct and remain. This does not claim every banner is gone, paid-model validation, native Android/hardware execution or full parity.

Local combined CI passed 2,013 tests with 23 skips and no failures; all four final compiled tmux cases passed. Compact SDK and all six native suites passed before the last display-only integration, not on the later candidate. The release workflow reruns the actual candidate's native gates.
