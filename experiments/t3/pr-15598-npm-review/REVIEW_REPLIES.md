## Macroscope 4177128445 (proposed, not posted)

I checked exact PR head c1310b242 by freshly building and locally installing the Linux-x64 npm launcher/platform tarballs using the repo's packaging scripts. Native fork succeeds through the production npm entry: the installed executable runs __claude-history forkSession, writes a JSON session ID and exits 0. npm uses the SEA branch ([adapter lines 763–765](https://github.com/pingdotgg/t3code/blob/c1310b2429625e704ef20a175e8b2847f58589ba/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L763-L765)).

For the default .mjs build, the adapter is bundled into dist/binCli-DZ5IwGw5.mjs, beside dist/claude-history-worker.mjs ([build entries](https://github.com/pingdotgg/t3code/blob/c1310b2429625e704ef20a175e8b2847f58589ba/apps/server/vite.config.ts#L78-L82)). The sibling URL resolves correctly in that actual emitted artifact; ascending from the source adapter directory would be wrong after bundling. I've retained the current worker path. The environment/cursor regression and installed npm history-only UI trial pass. This is Linux npm evidence, not a desktop or full-CI claim.

## CodeRabbit 4177149395 (proposed, after parent updates branch)

Added a 30-second deadline around the scoped history-fork worker (ClaudeAdapterV2.ts:793–795). Timeout interrupts the scoped operation and releases its subprocess. The new test (ClaudeAdapterV2.test.ts:1613–1658) uses a real stalled Node child: it fails on the original implementation, then verifies a forkSession timeout error and that the child is no longer running after the fix. All 131 adapter tests and a rebuilt, installed Linux npm history-only UI trial pass; server typecheck and targeted format/lint checks also pass (lint retains one pre-existing unused-variable warning).
