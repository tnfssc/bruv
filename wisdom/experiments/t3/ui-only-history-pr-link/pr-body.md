## Problem
UI homePath reaches Claude subprocesses and the history worker, but direct parent SDK forkSession and fallback child-launch lookup ignore that environment. Repro: set a custom Claude config directory only in provider UI (no server env), create a session, then fork it: SDK reports session not found. This affects scoped native-Claude history generally, not just alternate binaries.

## Fix
Reuse the existing isolated history worker for both SDK filesystem calls with the resolved provider environment; retain cwd/checkpoint and cancellation/error handling. No global process.env mutation, directory copying, default ~/.claude changes, or dependency changes.

## Verification
- On official-2644 source baseline 737993303: 133 focused tests and server typecheck passed. Unchanged official binary reproduced the failure.
- UI-only diagnostic npm/web build on that baseline: actual fork/continuation, rollback and reload/reopen passed; ordinary-Claude fixture unchanged. Modified-host evidence, not an official release or full acceptance.
- Clean cherry-pick onto main eac52f008: identical patch; refreshed frozen-lockfile dependencies, 133 focused tests, server typecheck and format check passed again. UI diagnostic was NOT rerun on this head; desktop/SEA remain unproven.
