# Project wisdom

Project wisdom is context saved for the next agent. It is not a model memory database. It gives no permission. User's words come first.

## Shape

Project wisdom defaults to `wisdom/` at project root. A project may set
`"wisdomDir": "docs/agent-notes"` in its existing `.bruv/settings.json`.
Merge that field with the settings already there. Relative paths start at the
project root; absolute paths work too. Values live in `values.md` inside that
directory. `/wisdom` and the injected prompt use the same resolved path.

The nearest `.git` marker (directory or worktree file) or `.bruv/settings.json`
marks the project root. Without either, the session's starting directory is the
root. Changing a tool's shell directory does not change it. Untrusted project
settings are ignored, as with the rest of project settings.

This is one field, not a new settings system. No global or environment override,
UI, migration, file creation, or file moving. The reader uses the existing JSON
settings file and only reads the project key. Bad JSON or a non-string or empty
`wisdomDir` is an error, not a silent switch back to the default.

Put wisdom with the feature or system it explains. Keep the choice, reason, current state, and handoff together. Do not split files only because one part is a decision, audit, release note, or handoff.

No `index.md` is required. Make a short map only when it helps. There is no pending queue or cleanup worker. Agents write useful context straight into the right wisdom file.

## Prompt contract

Root guidance lives in [src/prompts/wisdom.md](../../src/prompts/wisdom.md). It tells agents to save choices, reasons, state, and handoff context with the feature they explain.

[Values](../values.md) hold lessons that help across the project. Read them before big work. At a big finish or handoff, review new wisdom. After a release or wide review, check all affected systems. Merge or change old lessons before adding more. Link where each lesson came from. Say when it helps and when it does not. No new lesson? Leave values alone. At finish, say what wisdom changed and what values changed. Values stayed same? Say why.

This is the agent's job. It is not a background cleanup worker or required index. See [how values were derived and what was covered](derived-values.md) and the [practice audit](consolidation-practice-audit.md).

## Integration

`src/wisdom/extension.ts` adds wisdom guidance for root agents. It also registers `/wisdom`, which reports the durable location. Child agents do not get the root wisdom prompt.

## Configurable directory handoff (2026-10-02)

**Why:** projects should choose where durable context belongs. Keep configuration
thin: one existing project field, one path resolver, and two consumers. Absolute
paths in both the command and prompt remove doubt when the session starts below
repo root. The wisdom Markdown stays the source of the guidance, with two path
slots filled by the extension.

**Runtime scope:** root agents still get the wisdom guidance; child agents still
do not get the root stewardship prompt or command. CLI, native server, and SSH
root sessions use their own project context through the same extension. Commit
`.bruv/settings.json` so new worktrees and tracked SSH snapshots carry the
setting. Relative paths resolve inside that destination checkout. Absolute paths
remain machine-specific; no parent directory or untracked files are copied just
because wisdom points there.

**Paths:** `src/wisdom/location.ts`, `src/wisdom/extension.ts`,
`src/prompts/wisdom.md`; user example in `README.md`.
Branch: `bruv/add-thin-project-wisdom-setting-72ded808`.
Worktree: `/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_72ded808`.

**Proof:** focused wisdom, prompt-source, real SDK request, subagent extension,
prompt delivery, and native SDK tests pass (59 tests). They cover the default from a nested project directory, a real delegated Git
worktree with tracked settings, configured
command/prompt/values agreement, non-Git project settings, absolute paths, project
trust, invalid values, child exclusion, and the configured path in an actual SDK
provider request (offline capture, no model call). `bun run check`, focused Biome lint, and `git diff --check` also pass.

**Remaining gaps:** no live SSH acceptance run for this small path change. No
release. Files are not migrated; teams must place wisdom where they configured
it. Values stay unchanged: this is a local configuration choice, not a new lesson
that applies across systems.

## Reference folders moved into wisdom (2026-10-04)

The user asked to move audits, docs and experiments here. Their new homes are
`wisdom/audits/`, `wisdom/docs/` and `wisdom/experiments/`. Keep the existing
Go experiment note in the last folder. No source or evidence was dropped.

Repo links, setup-guide URLs, probe commands, shell root paths and the few probe
imports from product source now use the new layout. Biome still excludes the
experiments. Captured logs, JSON receipts and patches keep their original bytes
and old paths as evidence; they are not current run instructions. The illustrated
[setup guide](../docs/t3-code/README.md) still includes its images.

Keep `integrations/t3/` for now. It holds inputs for optional T3 web builds,
source verification, packed-web receipts and acceptance gates. Current tests read
its source pin, patch, bootstrap and shared contract fixture. The default paired
CLI/connector build does not use this old web build. Removal needs a separate
choice to retire those consumers together. The integration README still names a
`build:web` package script that no longer exists; use the actual optional tooling
in `scripts/ci-web.ts` when reviewing that boundary. Nothing under integrations
was moved or removed in this change.

Checks: all 425 moved tracked files are present. All 1,078 previously resolving
local Markdown links still resolve. All 22 moved shell scripts pass `bash -n`.
The setup-guide tests and selected relocated CLI, native-question and transcript
probe tests pass: 20 tests, 207 assertions. No Docker, provider, browser or full
archived-probe run. No release. Values stay the same: this applies the existing
shared-memory and ownership lessons, not a new project-wide rule.

Workspace: `/home/tnfssc/.t3/worktrees/bruv/t3code-34db5acd`.
Branch: `t3code/move-audits-docs-expts`.

### Follow-up: remove the old integration

The user then approved removing the optional tooling and its tests too. This
supersedes the keep-for-now choice above. Task `task_a4993fe0` owns the code
cleanup in `/home/tnfssc/.bruv/worktrees/t3code-34db5acd-5442693331ce-task_a4993fe0`,
branch `bruv/retire-old-bundled-t3-integration-toolin-a4993fe0`. The parent owns
these already-moved reference folders and their docs. Preserve the current paired
CLI/connector build and external T3 setup flow. Remove the old integration and
its orphan executable consumers, not the historical evidence. Integrate the
worker commit and check the combined work before calling removal done.

Move follow-up checks: keep Git recovery commands on their original archive
paths; old commits do not contain the new wisdom paths. Keep upstream `docs/...`
references and arbitrary `wisdomDir` test examples unchanged too. The real SDK
(8 tests) and wisdom extension (10 tests) pass in separate processes after locked
dependency installation and asset preparation. Running those two files in one
Bun process loses Git from PATH in the delegated-worktree test after the SDK
tests; that order-dependent suite issue is outside this folder move. No test was
weakened. Integration retirement is now applied from the worktree named above.

Final follow-up: the integration retirement and combined reference move now
pass full Linux CI. Read-only reference review found no issues. The installer
fixture's inherited CLI override was isolated without changing product behavior.
See [the removal and full-gate record](../quality/obsolete-integrations-removal.md).
The parent changes are uncommitted; no release was made. Values remain unchanged.
