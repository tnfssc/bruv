# Pi 1.1.0 brings Haiku 5.5

Worktree: /home/tnfssc/.bruv/worktrees/t3-98a10da6-5442693331ce-task_c23e6117
Branch: bruv/update-pi-catalog-for-haiku-5.5-c23e6117

Read values.md and pi-1.0.3-root-host-audit.md before changing dependencies.
Fetched the published npm tarballs for all four direct Pi packages at 1.0.3 and 1.1.0.
The actual Anthropic catalog is dist/providers/data/anthropic.json, reached through models.generated.js and the provider module.
1.0.3 has Haiku 4.5 only. 1.1.0 adds claude-haiku-5-5, named Claude Haiku 5.5, using anthropic-messages. No local model entry or alias was added.
All four direct pins and the installed Pi family now use 1.1.0. Other dependency pins were left alone.

## Source review and retained fixes

Compared actual upstream files before refreshing the source and adapted SHA-256 hashes.
Five guarded files changed: main.js, cli/args.js, core/agent-session.js, its declaration, and core/sdk.js.
Main adds --no-mcp handling. Args adds tool patterns/modifiers, validation, and MCP/codemode help.
AgentSession and SDK add tool-name matchers, MCP registration/activation rules, default modifiers, hidden-tool prompt handling, aborted on agent_settled, and tool duration propagation. The user identity queue anchors and indexed settings/model branch seams remain intact.
Other guarded sources are unchanged. The strict version check now accepts only 1.1.0; exact original/result hashes, idempotence, validate-all-before-write, and hardlink detachment stay in place.
Removed the newly added MCP/codemode help from Bruv too, using guarded reversible seams. Built-in factory removal still permits user-authored extension tools.

Regenerated both reviewed patches against 1.1.0. Coding-agent has the exact same added/removed lines; startup grammar readiness now sits after upstream program-status reporting. The tree selector, entry count and Mermaid fixes stay.
TUI changes still preserve editor, scroll, layout, Markdown tokenization, wrapping and focus behavior. Patched results are byte-identical except upstream's added status exports and resetTextSelection method. Changed diff hunk shapes are not lost fixes. A late attempt to retain the old TUI patch bytes passed git apply, but Bun misplaced the old offset after upstream added resetTextSelection and broke syntax. Restored the regenerated patch with exact 1.1.0 offsets and reran install/check/build/tests. Do not use git apply alone as proof that Bun installs a rebased patch correctly.
New Terminal.setProgramStatus and agent_settled.aborted types required no-op terminal fixture methods and explicit false on settled test events. Partial InteractiveMode fixtures also needed program-status seams.
Updated current pins, patch paths, fast-mode notice, startup expectations and notice generator/release assertions. Historical release notes and the captured 1.0.3 selector geometry comment were left as history.
The upstream v1.1.0 LICENSE matches third_party/pi/LICENSE byte for byte.

## Checks

- Bun 1.4.2: bun install and bun install --force passed and applied both renamed patches.
- bun run check passed, including guarded prepare-assets and TypeScript.
- bun run build passed for both shipped launchers, including a final build after edits.
- bun run generate:notices passed: 211 production packages, 657,015 bytes. Generated bundle remains ignored under dist/release.
- Focused combined run: 209 passes, zero failures, 6,027 assertions across 16 files. Included pi-host, Haiku and Sol catalogs, release-workflows, saved-transcript-startup, SDK wrapping, foreground SDK execution, rolling activity, conversation density, fast mode, compat command/prompt/retry, terminal profilers and scroll layout.
- Extra selector-lifecycle run alone: three passes, zero failures. Its disk count check failed when mixed into the first wider test process; isolation fixed it without code changes. Cross-file fixture interference was not diagnosed in this task.
- Built dist/bruv --offline --list-models haiku with a temporary HOME and nonfunctional Anthropic key lists claude-haiku-5-5 (1M context, 128K output). This proves bundled discovery, not provider access.
- New offline regression checks upstream compat lookup, ModelRegistry availability, the actual ModelSelectorComponent render and selection of that exact ID. No network model call.
- All 13 installed patched TUI files match the reviewed patched 1.1.0 sources byte for byte after the final force install.
- git diff --check passed.

## Gaps

No full Linux CI/full suite, live Anthropic request, real account entitlement check, or rendered interactive terminal acceptance. No PR, push or release. Keep the cross-file selector fixture issue visible if running those script tests in the same process as the main tests.
Values stay unchanged: source review, built-copy proof, honest gaps and wisdom before commit already cover this work.
