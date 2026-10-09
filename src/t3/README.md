# T3 boundaries

- web/launcher.ts retains external, unmodified T3 setup guidance via `bruv web --setup`.
  The browser terminal lives in src/web; it runs Bruv itself, not bundled T3.
  No T3 payload extraction, settings seeding or startup fallback.
- tasks/ retains the owned native task bridge and server task ownership code.
  Its name is not evidence that it belongs to the obsolete bundled web build.
- The old bundled T3 inputs, archive builder and optional validation gates were
  retired. They are not part of the current build or test tree.

See wisdom/claude-compat/external-t3-setup.md for the paired connector, absolute
paths, shared Bruv auth/resources, isolated SDK home, exact genuine model IDs
and manual updates. Packaging does not establish native parity.

Active native host: unchanged official v0.0.46-nightly.20261004.2644; old 2623
is not an acceptable pinned target. Release CI composes existing strict bounded
gates via scripts/release/run-native-release-gate.mjs; proof/official-2644 is immutable
provenance, not a bundled runtime. The upstream Effect queue race remains unfixed.
