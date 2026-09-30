# Remove inherited Pi MCP, codemode, and tool-search

Implemented 2026-09-30 after user approval of the parent audit recommendation.

- Worktree: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_1d65fa27`
- Branch: `die/remove-inherited-pi-mcp-and-codemode-1d65fa27`
- Audit read from parent: `/home/tnfssc/Code/die/wisdom/dependencies/pi-mcp-codemode-audit.md (parent-only research)`

## Owned boundary

Pi 0.99.1 `main` prepends its built-in extension registry. SDK `createAgentSession` does not load that registry by default. Pi has no public CLI option to omit selected built-ins. We keep Pi main rather than copying its whole startup flow or disabling user extensions.

`scripts/pi-host-adaptation.ts` is called from `scripts/prepare-assets.ts`, alongside the existing hash-guarded SessionManager dependency check. It adapts exactly three dependency files:

- `dist/extensions/index.js`: remove the MCP, codemode, and tool-search imports and factories; retain llama.cpp.
- `dist/main.js`: remove the lazy MCP CLI import and replace the top-level MCP handler with an explicit unsupported-command error (exit 1).
- `dist/cli/args.js`: remove the MCP command/help entries.

The registry is the important seam. Pi passes the resulting factories to both its resource loader and its config command. Removed factories are not registered or invoked: this is not hiding tool names or deactivating them at session start. Settings entries/overrides cannot reconstruct absent factories (stale references are inert); explicit CLI `-e builtin:<name>` selectors fail as unknown. No user settings or MCP config files are rewritten or deleted.

Adaptation accepts only Pi 0.99.1 and exact original/adapted SHA-256 digests. All three files are validated before any write. It is idempotent. Dependency updates must review and update this guard; do not widen it to accept unknown bytes. Temporary local dependency edits are not the implementation: the tracked preparer recreates them after dependency checkout.

`src/pi-host.ts` checks the retained registry plus adaptation markers in main/help before calling Pi main. This catches pristine or partly prepared dependencies. Its import stays dynamic until die has set Pi product/asset paths. Source CLI needs `bun run prepare:assets` after a fresh dependency checkout, just as it needs generated runtime assets; normal build/check already run it. Compiled CLI embeds the adapted modules and needs no installed Pi at runtime.

The rendered config check found a pre-existing host bug: `withDieSystemPrompt` injected a session-only system prompt into the separate `die config` command. Config now bypasses that injection; positional `-- config` remains a session prompt. No broader command-parser rewrite was made.

## Kept on purpose

- Die execute, jobs, and subagent/delegation ownership are unchanged.
- `src/t3/tasks/mcp-client.ts` is unchanged: it is die's separate bounded T3 task bridge.
- llama.cpp remains in the registry and config selector. Other Pi features and user extension loading remain available.
- This is not a sandbox or ban on user-authored tools/extensions. A user extension can register or activate a tool named codemode, or intentionally use Pi's MCP factories. The regression test proves that registration and later activation still work.

Bundle inspection: the MCP CLI lazy module and MCP help text are absent; llama is present. Pi's public SDK barrel still re-exports `createMcpExtension, createCodemodeExtension, and createToolSearchExtension`, so dormant factory implementations remain in the emitted CLI graph. We do not remove those exports (which could break user extensions), transitive packages, or third-party notices just to claim zero MCP/codemode code in the binary. No inherited factory is loaded through the built-in registry, and no inherited top-level MCP command runs.

## Proof and limits

Used an isolated copied node_modules tree from the parent, not an install and not edits to the parent's dependencies. Mise refused the untrusted worktree config. Used the already-installed Bun 1.4.2 by absolute path/PATH without changing trust settings. An initial broader test run had two shell-output failures because the host's fish startup printed mise diagnostics; rerunning with `SHELL=/bin/bash` passed all targeted tests.

- `bun run check` passed (asset preparation, hash guards, TypeScript).
- `bun build --compile --minify src/cli.ts --outfile dist/die` passed. For this CLI-only build, copied the parent's existing web archive to the worktree; did not rebuild/deploy the unchanged T3 web app or run its install steps.
- 149 tests across 15 files passed: pi-host, system-prompt, architecture, attention-sdk, execute-handoff, execute-output-capture, foreground-stop, agent-session, job-service, task-manager, subagent-profiles, subagent-extension, and T3 production-bridge/native-routing/local-notifications. New pi-host suite: 9 tests, including exact adaptation/idempotence/drift, partly prepared gates, trusted project override and explicit built-in selection, source/compiled help/command rejection, and source/compiled RPC session startup with configured stdio MCP servers. Both global and trusted project MCP config remain byte-identical and the startup marker is absent. User extension registration survives.
- Existing compiled CLI standalone/version and branded-help tests passed (2 tests). Installer tests were deliberately filtered out.
- New adaptation/host/regression files pass focused Biome lint/format; `git diff --check` passed. Existing CLI non-null assertions still produce lint warnings; unrelated code was not rewritten.
- Manual tmux PTY checks of both source and compiled `die config` at 120×35 show only `[x] llama.cpp` under Built-in → Extensions, with no MCP/codemode/tool-search entries. This proves the rendered default selector, not every saved-user-config UI flow.

No paid/live LLM call, real external MCP connection, live llama inference, full web rebuild, full platform CI, release, install, or push. The no-start test is a controlled stdio server fixture, not a claim about every user-authored extension or arbitrary code. Parent should run normal integration checks after applying this commit and regenerate the dependency adaptation before using source CLI.

## Values assessment

No values edit. Existing values already cover this: delivered-path proof (1), explicit limits (2), one execute/delegation owner and distinct T3 bridge (3), leaving user work/settings safe (6), a small guarded dependency seam instead of a full fork (7), checking the rendered config surface (8), dependency behavior review (9), and this durable handoff (10). The feature-local lesson is to remove inherited registration and command routes, not just active tools, and prove source as well as compiled entry paths.
