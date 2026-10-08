# File layout cleanup

User asked to reduce file clutter. This pass changes file placement, not behavior.

## Homes

- 69 versioned release notes moved from `support/` to `support/releases/`.
  Their names and bytes match HEAD before the move. Their links are absolute.
- 16 Live tools moved from `scripts/` to `scripts/live/`. Dropped the redundant
  `live-` in file names, including `probe-live-*` and `build-live-*`.
  [The tool guide](../../scripts/live/README.md) lists current entry points.
- Release selection, preparation and workflow staging use the new notes home.
  Build imports, package commands, native wrappers, workflows and test fixtures
  use the new Live paths. Shell helpers and onboarding still find the repo root.
- Historical wisdom command transcripts remain as recorded. No old-path aliases,
  runtime changes, evidence deletion or generated-file moves.

The first focused test run found fixture directories and probe file names still
assembled with the old paths. Fixed both; the next run passed.

## Checks

- 135 focused tests passed across release preparation/workflows/publication,
  local install, native helper embedding/workflows and Live probes.
- 13 Python tests passed for isolated audio and the virtual wrapper.
- `bun run check`, `bun run build`, `bun run format:check` and `bun run lint` passed.
  Format/lint still report existing warnings in wisdom and other unchanged files.
- Both moved offline provider smoke commands passed from source.
- The rebuilt CLI passed `bun run smoke:live-onboarding` with fake credentials.
  No paid provider, microphone or speaker was used.
- All 69 note files were compared against their original Git blobs, byte for byte.

No full CI, macOS build or paid/device acceptance was run for this layout pass.
Final read-only review found no concrete issues. It checked consumers, relative
imports, note bytes and links. Diff whitespace checks passed.

Worktree: `/home/tnfssc/.t3/worktrees/bruv/t3-53f4b259`.
Branch: `t3/cleanup-file-structure`. The first pass is a local checkpoint; no release requested.

Values unchanged. Existing ownership, honest proof and history-preservation rules
cover this work; no new general lesson emerged.

## Scope correction

The user rejected stopping after two easy groupings. The requested cleanup is
repo-wide, not just Live and release notes. The root still has 377 loose test
files and scripts still has 61. Audit all owners before deciding what stays.
A broader pass is now in progress. Keep tests recursive, fixtures owned and
all build/CI consumers wired up. Do not mistake this checkpoint for completion.
