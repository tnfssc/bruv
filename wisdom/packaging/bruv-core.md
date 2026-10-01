# Bruv core runtime rename

## Handoff

- Worktree: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_74b29f92-a86675007a5e-task_62d5ce42`
- Branch: `die/rename-core-runtime-to-bruv-62d5ce42`
- Scope: `src/` except `src/t3/`, `tests/` except `tests/t3/`, and this note only. Parent integrates; nothing pushed or published.

## Changes

Fresh product branding now uses bruv/Bruv, BRUV_* app environment variables, ~/.bruv defaults, bruv internal commands, session/runtime identifiers, extension names, execution globals, temp prefixes, prompts, update assets, and matching test fixtures. Camel identifiers include updateBruv, assertBruvPiHost, bruvSystemPrompt, withBruvSystemPrompt, bruvPath, bruvAgent and bruvHostAdapted. No legacy fallback or migration was added. No owned source/test filenames contained the old product name, so no product-branded file moves were needed. The obsolete tagged-source compatibility fixture was renamed to update-release-shape.test.ts/.md and now tests the current updater instead of inventing a renamed historical export or promising a migration.

## Integration boundaries

Other workers must supply these corresponding changes outside this scope:

- scripts/pi-host-adaptation.ts must emit bruvHostAdapted (the runtime gate and tests now require it); renamed patch contents need matching adapted hashes.
- scripts/verify-v071-update.ts still extracts the exact historical v0.7.1 updater. Simply renaming its updateDie call cannot work: modernize it to the current updateBruv source or remove this historical compatibility gate and adjust workflows. Root tests keep its existing script filename expectation pending that owner's decision.
- Packaging/build/harness/scripts must produce dist/bruv and bruv release assets and consume BRUV_* controls. Root tests now expect that fresh contract.
- T3/root test contracts now reference integrations/t3/upstream/bruv.patch, web/bruv-web-bootstrap.mjs, NativeBruvIntegration.production.test.ts, apps/server/src/auth/BruvWebAuth.ts, and T3_V2_BRUV_BINARY / BRUV_WEB_BRUV_BINARY. These filenames and variables must match the T3 worker's implementation.

## Validation

Used existing Bun 1.4.2 and existing dependencies/assets through temporary symlinks (removed after checks); no dependency install, user config/data changes, or trust configuration. Tests use private fixture state, loopback fakes, and disposable update executables, not installed product state.

- 59 pass / 0 fail across 12 files: system-prompt, prompts, remote-descendant-environment, remote-ssh, remote-placement, remote-root-transport, remote-root-client, live-config, live-credentials, live-platform, subagent-profiles, update. Includes private compiled update fixtures.
- 117 pass / 0 fail across 11 files: agent-session, cache-affine-compaction, goals, instruction-mode, job-service, questions, questions-runtime, remote-capabilities, remote-runtime, session-costs, subagent-placement. Set SHELL=/bin/bash to avoid the machine's untrusted-worktree mise output contaminating shell assertions.
- 15 pass / 0 fail in update-release-shape.test.ts: current updater with official repository URLs and private synthetic raw assets; no historical git source required. Total focused checks: 191 passing tests.
- TypeScript tsc --noEmit passed. Biome format check passed for 209 changed TypeScript files. git diff --check passed; scoped boundary audit found no violations.
- Broader attempt: pi-host tests had 15 pass / 5 fail across pi-host and prompts once assets were linked; failures were the unchanged shared Pi adaptation marker and source/compiled CLI prerequisites (dist/bruv absent). Earlier prompt import failed before linking the existing image asset and passed afterward.
- Broader runtime attempt: 115 pass / 23 fail, explained by 21 TypeScript runner tests requiring absent dist/bruv and two shell assertions receiving local mise trust warning text. The clean-shell focused rerun passed all 117 runtime tests. No full integration/build gate claimed; rerun compiled/packaging/T3 tests after merging their owners.

## Residual references

Case-insensitive die search within owned code/tests leaves only actual tnfssc/die GitHub repository/release URLs and repository fixture names, plus unrelated English “bodies.” No DIE_* or app-specific old name remains in scope. Shell die helpers outside scope and third-party identities/attribution remain untouched.

Read wisdom/values.md, configuration/agent-config-discovery.md, packaging/die-only-first-launch.md and packaging/single-binary-packaging.md before editing. Values are unchanged: this is a feature-specific rename/handoff, with no new general lesson requiring a values edit.
