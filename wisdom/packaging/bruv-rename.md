# Bruv product rename (2026-10-01)

## Ownership and handoff

- Integration worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_74b29f92
- Integration branch: rename/bruv; base: 5485b09460814a441601fd63e9013d73f320f297.
- Parent owns review and PR publication. This implementation does not push, open a PR,
  merge, rename the repository, publish releases, install a local binary, or edit user configuration.
- Independent implementation worktrees and validations are recorded in the sibling
  bruv-core.md, bruv-t3.md and bruv-packaging.md notes.

## Scope and deliberate boundaries

The product, command and packaged executable are bruv. Active app-owned runtime
names, environment variables, prompts, CLI/web branding, release assets, service
names, integrations, tests and maintained entry documentation follow that name.
This is a fresh namespace, not a compatibility layer: no old command or environment
aliases are promised. Dependencies and upstream source revision are unchanged.

Default state moves to ~/.bruv. Existing ~/.die data is **untouched**: no deletion,
migration or automatic fallback. Historical filenames, worktree/branch paths and
recorded validation evidence remain verbatim. Dated wisdom/research and release
history retain old terminology, with explicit history boundaries in wisdom/README.md,
experiments/t3/README.md and the root product/task-placement historical records.

The actual repository remains https://github.com/tnfssc/die. Keep working clone,
issue, API and download URLs at that slug; download assets are bruv-* there. A human
may rename the repository separately and then update these references. Copyright
attribution and third-party upstream identifiers are not product-brand substitutions;
shell die() failure helpers also retain their normal meaning.

## Validation and final handoff

Implementation and integrated validation in progress; final results will replace
this paragraph before handoff. No release or hosted platform success is implied by
local checks.

## Wisdom and values

Entry docs and maintained user guides are updated; historical evidence remains.
Values unchanged: the existing ownership, truthful evidence and coherent delivery
principles already cover this rename. No new general rule is needed.
