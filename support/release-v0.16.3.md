# v0.16.3

## T3 setup and connector shutdown

- `bruv web` now describes provider-UI setup. Start T3 normally; no custom T3 arguments or server environment are required by the intended setup.
- Connector startup checks the isolated SDK home, paired Bruv binary, selected model and local auth configuration before allocating native history or MCP resources. Failures give actionable diagnostics; local readiness is not verified provider access.
- T3-owned HTTP MCP sessions are released before the connector reports completion and reopened for the next turn. This fixes the observed shutdown error after a completed reply, without ignoring cleanup failures.

## Setup and update

Stop active Bruv/T3 sessions, then run `bruv update` to update the CLI and connector together. Run `bruv web` for paths specific to your installation.

In T3 Settings > Providers, add a separate Claude instance for Bruv. Use the absolute `bruv-claude-compat` binary path and an isolated SDK home such as `/home/alice/.bruv/claude-compat-sdk`. Leave launch arguments empty. Set provider-only `BRUV_CLAUDE_COMPAT_HOME` to your Bruv agent directory and `BRUV_CLAUDE_COMPAT_BRUV_PATH` to the normal Bruv binary. Use absolute paths, not literal `~` or `$HOME`. Select exact Bruv provider/model IDs; configure a default in the selected Bruv home for health checks.

Existing auth is reused only through the chosen Bruv home. No secrets or Claude history are copied. Keep your real Claude provider and `~/.claude` untouched. Do not use T3's Claude updater for Bruv.

## Important limits

Full UI-only fork/history support requires the upstream fix in [T3 PR #15598](https://github.com/pingdotgg/t3code/pull/15598). The tested official nightly 2644 does not contain it. On older T3, fork can fail before Bruv starts; this release cannot catch that upstream failure. Basic chat can still work with correct provider settings.

The Claude product-version warning remains unresolved. This release does not claim full desktop parity, physical-device or paid-provider validation. The normal Bruv CLI remains available.
