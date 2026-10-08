# Live tools

Run these from the repository root. Product code stays in `src/live/`;
native source and tests stay in `native/`.

## Build and offline checks

- `sh scripts/live/build-helper.sh` builds the macOS helper. Needs macOS and Xcode.
- `bash scripts/live/build-linux-helper.sh` builds the Linux helper. See
  [native setup](../../native/live/README.md) for host libraries.
- `bun run smoke:live-onboarding` checks the built CLI with tmux and fake credentials.
  It does not start voice or open audio devices.
- `bun scripts/live/openai-offline-smoke.ts` and
  `bun scripts/live/gpt-live-offline-smoke.ts` use local fake providers.
- `helper-bundle.ts` is the build plugin for embedding the macOS helper.

## Explicit provider and audio probes

`acceptance.ts` and `isolated-audio.sh` drive audio acceptance.
The `probe-*.ts` commands can use paid providers, credentials or explicitly chosen
private input. Read their usage and opt-in checks before running them.
`probe-input.ts`, `startup-fixture.ts` and `study-trial.ts` are shared probe helpers.

Old notes may name these files directly under `scripts/` with a `live-` prefix.
They now live here; the redundant prefix was dropped. No compatibility copies remain.
