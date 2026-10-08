# v0.16.14

- Stop the Bruv connector from triggering Claude Code update recommendations in T3. Connector --version now says Bruv connector without a semantic version.
- Keep normal bruv --version, connector --bruv-version, and the native protocol handshake separate and unchanged in meaning.
- Route connector update commands through Bruv's verified paired updater, not Claude's updater. Keep checksum checks, repair, rollback, and older-updater support.
- Update install, release, smoke, and setup checks for the connector identity. No T3 patch or machine-wide setting is needed.

## T3 limit

On unchanged T3 v0.0.46-nightly.20261005.2702, a private browser test confirms the update popup and Update action disappear while custom-model chat still works. T3 treats the CLI version as unknown. Version-gated built-in Claude models can be hidden and their separate model-too-old warning can remain. This does not suppress other providers' update notices or promise every future T3 version behaves the same.

Restart T3 after updating the Bruv pair so it probes the new connector.
