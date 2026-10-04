# Connector version/defaults interface (2026-10-04)

Task b189315a owns connector semantics, not main src/cli.ts/build/install/update.
User explicitly supersedes earlier advice never to advertise a Claude-compatible version.

- Native connector --version: 2.1.280 (Bruv compatibility; bruv <package version>).
- --bruv-version: exact bruv-claude-compat <package version>, for new installer/updater checks.
- Normal bruv --version must remain unchanged (packaging owner).
- launch.ts exports these identities and connectorLaunchDefaults. Default auth home is
  homedir()/.bruv/agent; normal helper is process.execPath if its basename is bruv[.exe],
  otherwise sibling bruv[.exe]. Overrides remain supported; only ~/ and ~ expand.
- Main CLI may dispatch runConnector(args) for its connector subcommand. Runtime
  children must use normal bruv, never the wrapper.
- SDK CLAUDE_CONFIG_DIR remains explicit: upstream parent-side history/fork also
  needs provider homePath. A hidden connector-only default would not fix it.
- Old 0.16.3 update.ts compares the ENTIRE connector --version string. No single
  stable string can also satisfy its exact real-product check. Packaging owner
  handles safe migration/manual repair. No staged/env-dependent identity.
- T3 Claude updater must not overwrite the wrapper; supported range and latest
  update UI are distinct.

Tests/proof and remaining observations are appended before handoff. Values remain
unchanged: this is a requested compatibility profile with separate honest product
identity, not a false auth/model claim.

## Handoff proof

[Bounded proof and resolved failures](proof/version-defaults/README.md). Focused
source 22/22 plus isolated runtime 25/25; compiled actual SDK 0.3.276 3/3 (153
assertions); TypeScript check passed. Official unchanged 2644 UI parses 2.1.280,
Unsupported warning absent, custom loopback model chat works with neither BRUV
override and no server CLAUDE_CONFIG_DIR. Its latest-Claude update and built-in
Sonnet 5.5 min-2.1.284 advisory remain; do not claim every banner disappeared or
Anthropic auth. The future thin launcher/migration is not tested here.

Parser arguments.ts also changes only the new --bruv-version action. No main
src/cli.ts, package/build/install/update/workflow edits. Values unchanged; this
uses existing values on explicit user intent, truthful split identity, small
defaults and rendered proof. No new general lesson needs a values rule.
