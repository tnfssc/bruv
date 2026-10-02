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
