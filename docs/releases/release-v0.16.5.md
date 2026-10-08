# v0.16.5

## Reliable turn completion

- MCP session cleanup now honors the configured request timeout instead of a hidden five-second cap. A busy T3 host no longer causes a successful answer to fail just because cleanup takes longer than five seconds.
- Genuine cleanup failures still fail the connector. No retries or false idle state were added.

## T3 worktree setup

- Added `t3.json` with automatic locked dependency installation and runtime asset preparation. Fresh worktrees can run connector tests without a missing image asset.
- CI Checks and Build actions are available from the project scripts menu. Setup does not install the CLI globally or copy credentials.

## Update

Stop active Bruv/T3 provider sessions, then run `bruv update`. Keep the CLI and connector launcher together. Existing provider processes need to be relaunched to use the fix.
