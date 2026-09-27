# Linux local-install warning audit (2026-09-27)

**Not warning-free; do not call this a complete warning fix or release it as such.** This
is the reproduction and handoff for a separate release **after** v0.15.5; no push,
tag, publication, or change to the ongoing release was made. Branch:
`die/eliminate-local-install-toolchain-warnin-04e6d0e5`; worktree:
`/home/tnfssc/.die/worktrees/die-a86675007a5e-task_04e6d0e5`.

## Reproduction and safety

Full `scripts/install-local.sh` ran to completion with
`DIE_INSTALL_DIR=/tmp/die-warning-install.szZp0I` (fresh directory), no
`DIE_SKIP_BUILD`, real pinned T3 checkout, install, web build, backend bundle,
deploy and executable compilation. Captured both streams and pipeline exit status
`0 0`. The full 353278-byte build log is in the worktree at
`artifacts/install-local-warning-baseline.log` (ignored by Git). Other evidence:
`artifacts/install-local-peers-check.log` and
`artifacts/install-local-deprecated-why.log`. Tool PATH explicitly selected
mise-installed Bun 1.4.2 and Node 24.15.0 with its pnpm 11.21.0 launcher;
upstream's `packageManager` resolved pnpm 11.10.0 for the actual install/deploy.
Root `bun install --frozen-lockfile` completed with no package warnings.
`scripts/smoke.sh --reuse-build` passed, and the staged binary printed
`0.15.5`. Neither the user's installed die executable nor storage was touched.
Linux only: no macOS helper or Mac smoke was verified.

The shell launcher separately emitted a mise **untrusted worktree config** error
before every shell command, outside the captured install subprocess. Using explicit
binary paths worked; trusting each ephemeral worktree config is a local environment
decision, not a repository fix. On first T3 fetch, the *captured* build logged
`Load key "/home/tnfssc/.ssh/id_rsa": error in libcrypto: unsupported`. This
is the host's `url.git@github.com:.insteadof https://github.com/` global Git
rewrite plus its unreadable SSH identity; fetch still succeeded. Do not change the
user's global Git config or key to silence it. On a clean upstream checkout with
HTTPS Git config it should not recur.

## Build diagnostics (all remain)

The pinned T3 source is `b488c57f3f9f1688e31c53daee99e29dd1d0baa2`,
with our checked integration patch. Its patched `effect-tsgo` compiler emits
**387 suggestions in 19 diagnostic codes** during server `tsc --noEmit`.
Examples and exact counts from the full log (paths are relative to upstream T3):

| Code | Count | Effect rule | Example |
| --- | ---: | --- | --- |
| TS377009 | 1 | catchUnfailableEffect | `src/provider/acp/XAiAcpExtension.ts(1401,15)` |
| TS377012 | 13 | tryCatchInEffectGen | `src/mcp/AcpMcpStdioBridge.ts(312,9)` |
| TS377015 | 4 | unnecessaryPipeChain | `scripts/acp-mock-agent.ts(842,16)` |
| TS377016 | 5 | effectSucceedWithVoid | `src/mcp/McpSessionRegistry.testkit.ts(22,20)` |
| TS377017 | 6 | unnecessaryEffectGen | `src/mcp/WorktreeMcpService.test.ts(370,3)` |
| TS377019 | 29 | unnecessaryFailYieldableError | `src/auth/dpop.ts(118,20)` |
| TS377095 | 11 | catchToOrElseSucceed | `src/environment/ServerEnvironmentMachine.ts(110,5)` |
| TS377098 | 154 | schemaNumber | `scripts/evaluate-thread-titles.ts(55,25)` |
| TS377099 | 15 | catchToIgnore | `src/device/DeviceHubProxy.ts(144,10)` |
| TS377103 | 2 | syncToSucceed | `src/cloud/selfUpdate.test.ts(108,19)` |
| TS377111 | 7 | abortControllerInEffect | `src/orchestration-v2/Adapters/ClaudeAdapterV2.test.ts(940,26)` |
| TS377112 | 8 | preferTypedSchemaDecoder | `src/orchestration-v2/Adapters/AcpRegistryAdapterV2.testkit.ts(29,32)` |
| TS377113 | 12 | allOfMapToForEach | `scripts/replayRecorderDeferredRegistry.test.ts(21,12)` |
| TS377114 | 25 | mapSomeToAsSome | `src/assets/AssetAccess.ts(193,5)` |
| TS377116 | 20 | catchConditionalRefailToCatchIf | `src/environment/ServerEnvironment.ts(133,11)` |
| TS377117 | 58 | preferSucceedSomeOrNone | `src/assets/AssetAccess.ts(218,46)` |
| TS377118 | 4 | optionMatchToFromOption | `src/provider/acp/AcpSessionRuntime.ts(2064,17)` |
| TS377120 | 12 | flatMapConditionalToFilterOrFail | `src/mcp/McpInvocationContext.ts(65,3)` |
| TS377121 | 1 | raceFirstWithSleepToTimeout | `src/provider/makeManagedServerProvider.ts(255,9)` |

These are source diagnostics in T3, not `src/` of die. In particular changing
`Schema.Number` to `Schema.Finite` at 154 sites changes accepted input;
blind codemods are not safe. Upstream should fix them or a separately reviewed
pinned-source change should be made with behavior tests. No lint/compiler flags
were added to suppress them. Backend typecheck passes despite suggestions.

Web `vp build` warns `Some chunks are larger than 500 kB after minification`.
The bundle listing identifies `heic-to-*.js` at 2,995.22 kB, `_chat-*.js`
at 888.99 kB, `utils-*.js` at 856.12 kB, `main-*.js` at 801.44 kB,
plus several >500 kB lazy chunks. The HEIC library already has its own chunk;
raising `chunkSizeWarningLimit` would hide rather than fix payloads. Splitting
or replacing upstream UI dependencies requires a measured, tested upstream
source/patch change. Rolldown also prints `[PLUGIN_TIMINGS]` (94% of 41.5s in
plugins: 82% Babel, 13% Tailwind, 4% license generator); informational
performance diagnostic, not a compilation failure or warning flag.

`pnpm --filter t3 deploy --prod --legacy` emits
`[WARN] Shared workspace lockfile detected but configuration forces legacy deploy implementation.`
The `--legacy` is explicit in `integrations/t3/build/build.ts`; deleting it
is **not** a valid fix: a controlled `pnpm --filter t3 deploy --prod` failed
`ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE`: modern deploy requires
`inject-workspace-packages=true` in upstream. Changing upstream workspace
install mode and lockfile affects packaging and all workspaces; review and test
portable native assets, self-reference, archive and runtime before switching.

Legacy deploy's fresh resolution also warns of seven deprecated upstream
transitives: `boolean@3.2.0` (`global-agent`/electron-builder),
`crypto-js@4.2.0` (`@clerk/clerk-js`), `glob@7.2.3` and
`inflight@1.0.6` (`@electron/asar`/`temp`), `lodash.isequal@4.5.0`
(`electron-updater`), `rimraf@2.6.3` (`temp`), `uuid@7.0.3`
(`xcode`/Expo). Mostly desktop/mobile parts of the pinned T3 monorepo,
not die's direct dependencies; details in `pnpm why -r ...` evidence above.
Scoped upgrades of individual transitives would override packages' declared
ranges without evidence of compatibility. Review pinned upstream versions or
upstream upgrades instead.

`[WARN] Issues with peer dependencies found` is concrete, not generic: 
`pnpm peers check` exits 1 for `ws@7.5.11` wanting
`utf-8-validate@^5.0.2` while 6.0.6 is installed;
`expo-modules-core@57.0.14` wanting
`react-native-worklets@^0.7.4 || ^0.8.0 || ^0.9.0 || ^0.10.0`
while 0.11.4 is installed; `@expo/require-utils@55.0.5` wanting
TypeScript 5 while 7.0.2 is installed. The latter two are mobile/Expo from
upstream, and changing compiler version for them would invalidate our server
Effect diagnostics; fixing upstream package constraints is not a safe die-only
upgrade. The `ws` peer also needs an upstream dependency graph audit before
changing runtime versions. These peers were surfaced by legacy deploy; frozen
upstream install itself did not warn.

## Next step

For an actually warning-free release, authorize a focused T3 upstream
pin/patch modernization (possibly in collaboration with T3 maintainers) and
review performance, native portability, and peer compatibility. Re-run **the
whole** staged installer with fresh source checkout and capture all streams,
then Linux CI/smoke and macOS CI/helper before publishing. Do not transform
this audit into a warning-free claim. Values unchanged: the existing principles
of honest evidence, preserving user data and safe dependency changes cover
this case; no new general rule emerged.
