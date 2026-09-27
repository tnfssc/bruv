# Pinned T3 native deploy dependency patch (2026-09-27)

The pinned revision is `b488c57f3f9f1688e31c53daee99e29dd1d0baa2`. Lasting checkout: `.cache/die-t3code-b488c57f3f9f1688e31c53daee99e29dd1d0baa2` on branch `die/native-deploy-dependencies` within worktree `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_a478759f-a86675007a5e-task_8c344dd9`. HEAD remains pinned. Working tree is die.patch then dependencies.patch. The incremental patch was generated against a locally committed baseline of die.patch; canonical die.patch was never modified. Build verifies both patches in a disposable index.

The incremental patch enables pnpm 11 `injectWorkspacePackages: true` and regenerates the lockfile with injected workspace directory snapshots. `pnpm install --frozen-lockfile` and `pnpm --filter t3 deploy --prod` succeeded; modern deploy installed 158 production packages and a 319 MB standalone trial directory at `/tmp/die-modern-deploy-test`. Full `bun integrations/t3/build/build.ts` produced `dist/die-web.archive.gz` with SHA256 `48305d713b766d6e0ffebb5067859ffc076dedc56f3b030dd8288b867d228786`. The build checks cross-platform ffi-rs assets and fixes the local package self-reference.

Warnings are not all gone: `pnpm install --lockfile-only --ignore-scripts` still reports seven deprecated transitives. `pnpm why -r` traces boolean/glob/inflight/lodash.isequal/rimraf to desktop Electron packaging, uuid to Expo/Xcode, and crypto-js to Clerk through web/desktop/mobile. `pnpm peers check` exits 1: ws@7.5.11 requires utf-8-validate ^5 but receives 6.0.6 through mobile React Native middleware; expo-modules-core@57.0.14 requires worklets through 0.10 but receives 0.11.4, and @expo/require-utils@55.0.5 requires TypeScript 5 while the upstream catalog pins 7.0.2. These peer mismatches are outside die server production. Changing the compiler or worklets without compatibility evidence, or overriding peer constraints, would hide rather than resolve them. Clerk crypto-js remains in web. No blanket suppression, desktop/mobile pruning, or giant upgrade.

`bun test integrations/t3/build/verify-source.test.ts` passed. Archive extraction to `/tmp/die-native-archive-extracted/48305d713b766d6e0ffebb5067859ffc076dedc56f3b030dd8288b867d228786` succeeded; extracted self-reference resolves inside extraction and darwin-arm64, linux-x64-gnu, and win32-x64-msvc ffi-rs package manifests are present. From `/tmp`, `node <extracted>/dist/bin.mjs --help` exited 0. Focused backend `pnpm --filter t3 exec vp test run src/auth/EnvironmentAuth.test.ts` passed (19/19). Full `pnpm --filter t3 test` was stopped after over three minutes with no test result (only the Vitest RUN header); it is **not** a passing suite. See `/tmp/die-deps-backend-tests.log`. Full staged installer integration belongs to parent. No release/push/publish changes. Values unchanged: existing honest-evidence and scoped-dependency principles cover this local recipe.

## Follow-up: scoped browser/server dependency closure

For die's browser/server artifact, pnpm workspace now contains apps/server, apps/web,
packages/*, and scripts (the latter is required by server/web TypeScript imports of
scripts/lib). Desktop, mobile, infra, and lint-plugin workspaces are not installed.
The scripts workspace drops two desktop-only dependencies, @electron/asar and
@electron/osx-sign; desktop packaging from this scoped checkout is intentionally
unsupported. Unused Expo/React Native patchedDependencies entries were removed from
both pnpm metadata files so pnpm 11 does not reject the scoped install.

The only crypto-js path was @clerk/electron -> @clerk/clerk-js. The browser
ClerkProvider from @clerk/react hotloads clerk-js remotely when cloud auth is
used and does not declare crypto-js locally. @clerk/clerk-js 6.34.1 still
requires crypto-js ^4.2.0, so upgrading the Clerk pin cannot remove this
transitive. This die-only browser build removes the Electron auth shell/import,
Electron passkey test and Electron dependency from web; it retains a browser
managed-auth compatibility test. Never use this patch to build upstream desktop.

Proof: frozen install with 11 workspaces, pnpm peers check (no issues), both
web and server TypeScript typechecks, browser-auth tests (3/3), web build,
server build:bundle, modern --prod deploy (158 packages) and deployed CLI
--help all passed. Lockfile-only repeat and frozen install had no deprecated
or peer warning. Existing web oversized chunk and plugin timings diagnostics
remain separate. The incremental patch is verified against the two-patch
source contract. Values unchanged: this is an application of the existing
scoped-dependencies and honest-evidence principles, not a new principle.
