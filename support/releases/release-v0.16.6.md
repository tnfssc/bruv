# v0.16.6

## Easier Bruv + T3 Code setup

- Added an illustrated setup README with four real T3 Code screenshots, from choosing the Claude protocol slot to selecting your Bruv custom model. Find it from the main README or the link printed by `bruv web`.
- Reworked `bruv web` into a readable, numbered terminal guide with version checks, the actual connector and SDK history paths, provider/model setup, and a small chat test. It remains guidance only: no installs, launches, or settings changes.
- Corrected stale parent-home advice. Configure the separate Bruv provider instance in T3 Settings; do not change T3's parent environment or ordinary Claude state.

## Limits and updates

The screenshot host, official T3 v0.0.46-nightly.20261004.2644, still lacks the provider-scoped SDK history fix. Native fork can fail before Bruv starts. This release does not fix upstream T3 history or promise full parity. Decline any stale approval card left after Stop.

Stop active Bruv/T3 sessions, then run `bruv update` to update the matched CLI and connector together. T3 updates separately. Never use T3's Claude updater for the Bruv connector.
