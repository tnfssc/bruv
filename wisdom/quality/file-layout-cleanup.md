# File layout cleanup

## Scope correction

The user rejected a pass limited to Live scripts and release notes. Map the whole
requested area before choosing moves. A few easy examples were not the job.
Value 3 now says this explicitly; it extends the earlier placement lesson.

## Layout

- Tests: 377 loose files became three root files: setup and the two repo-wide
  boundary checks. 431 tests/support files moved to feature homes. All 453
  original test/support files remain accounted for. Shared helpers stay shared;
  feature fixtures, executable probes and their tests stay together.
- Scripts: 77 loose files became the published installer, prompt preview and a
  [tooling map](../../scripts/README.md). Build, CI, release, dependency, history,
  remote, Live, terminal capture and performance tools have named homes.
- Release notes: 69 files now live in support/releases, byte-for-byte unchanged.
- Remote main-agent placement: ten modules now live in src/remote/root. Shared
  SSH/repository code stays above it. The execute schema moved to src/typescript.
  No wire names, persisted paths or runtime ownership changed.
- Four loose wisdom notes now live with Live, remote or web. Historical Live
  investigations moved as complete packets to wisdom/experiments/live. Original
  probe/receipt bytes and claims stay intact; packet READMEs state stale imports
  and source revisions. No paid probes ran.
- Historical landing captures now live in site/captures/settings, apart from
  shipped assets. Their tools and fidelity tests remain usable; no capture was
  reacquired. [Capture record](../landing-page/capture-layout.md).

Native code, shared session contracts, root product docs and the externally
shared GPT-Live explainer already have clear roles and stay put. Ongoing old audit
ledgers were not treated as disposable clutter. Historical commands and Git
object references stay historical; navigation links follow moved files.

## Deliberate changes

The duplicate root install.sh was retired. The documented scripts/install.sh
URL and its bytes are unchanged. Old callers of the undocumented root raw-file
URL must use the documented one. No fetching wrapper or second copy remains.

Four Bun test files formerly under scripts are now in recursive discovery:
354 original test files plus four equals 358. The relocated Python presentation
test still needs an explicit Python run. The macOS selector keeps the same
live-*.test.ts family; it does not silently expand to every Live test.

## Integration lessons

Moves need more than import rewrites. Copy fixtures must create nested folders.
Owned subprocess cwd must come from the shared helper's repo anchor, not the
calling test's depth. Directory URLs need their trailing slash. Site has its own
scripts/build.ts; root tooling replacements must not change that local command.
Embedded SDK patch text is generated code, not an import to relocate. Its pinned
bytes were restored, not accepted by changing the expected hash. Frozen updater
proof likewise normalizes only its moved import before checking the old hash.

## Proof and state

The final layout is implemented. Full Linux CI is not green: its last complete
suite run had 3,130 passes, 31 opt-in skips and one default five-second timeout
in the unchanged Markdown hook test. That test passed alone in 2.63 seconds;
all six tests in its file passed. No timeout or assertion was loosened. Treat
this as a load-sensitive verification gap, not a clean full-gate claim.

That gate passed frozen install, format, lint, typecheck, both task-history
resource profiles, paired build and offline transport before the test timeout.
The earlier relocation failures are fixed. The standalone paired smoke passed
separately after the stopped gate.

Final owner review aligned 27 same-depth files: AgentProgress/session tests
with tasks, checkpoint restoration with the connector, and measurement tools
with performance rather than splitting them across UI/T3/CLI. The final affected
family passed 191 tests and typecheck. Discovery remains 358 test files with no
missing originals. A full gate was not repeated after this last test-only move.

The site build and 44 tests plus validation pass in the parent. The site tests
rewrote tracked validation screenshots; those generated changes were restored
to preserve the existing evidence rather than mixing a new capture into cleanup. Relocated Python
suites and native wrappers pass (84 tests total). Child Node verification passed
134 tests. All 69 release notes and 12 archived source/receipt files were compared
with original Git blobs. Static review found no blockers, but execution caught
path issues that its representative inspection missed.

No paid/provider/device acceptance, macOS gate, hosted CI, release or push was
run. Worktree: /home/tnfssc/.t3/worktrees/bruv/t3-53f4b259.
Branch: t3/cleanup-file-structure. This note accompanies the final local
integration commit; no push or PR was requested. Investigate the Markdown full-suite timeout before
claiming a green release gate. Logs: /tmp/bruv-layout-full-ci-final.log,
/tmp/bruv-layout-markdown-isolated.log, /tmp/bruv-layout-owner-tests.log and
/tmp/bruv-layout-final-smoke.log.

## Delegated provenance

- Tests: 372ffd31, worktree /home/tnfssc/.bruv/worktrees/t3-53f4b259-5442693331ce-task_864ff389,
  branch bruv/organize-tests-by-feature-owner-864ff389.
- Landing capture: 4779814f, worktree /home/tnfssc/.bruv/worktrees/t3-53f4b259-5442693331ce-task_c7ca3739,
  branch bruv/separate-historical-landing-capture-pipe-c7ca3739.
- Live packets: db751935, worktree /home/tnfssc/.bruv/worktrees/t3-53f4b259-5442693331ce-task_c1fa7700,
  branch bruv/archive-complete-live-investigation-pack-c1fa7700.

All three scoped commits are integrated. The one-time move inventories were
retired with the later artifact cleanup, rather than kept as more clutter. Git
rename history records the moves. If an exact map is needed, read it from
baf2fcd5c9976ee19a8cbc0ae8839875d714cc38 at wisdom/quality/*-layout-moves.json.
