# ACP: packaging and web command boundaries

Research only, 2026-10-03. No removal or release is approved. User wants findings and discussion first.

## What the current repo does

- src/cli.ts routes the web subcommand to src/t3/web/launcher.ts before normal CLI startup. It starts the bundled backend, not merely a browser link.
- Launcher seedWebSettings writes providerInstances.pi with Bruv binaryPath and enables Pi; it also supplies BRUV_WEB_TASK_EVENTS. This is the current patched Pi RPC integration, not ACP registration.
- scripts/build.ts always prepares the web payload before compiling the CLI. scripts/packed-web.ts and src/t3/web/archive.ts own receipt/archive checks. src/t3/web/embedded.ts owns runtime extraction. Removing just the web command would not remove this producer or payload.
- README currently promises the executable includes T3 and needs no separate Node/Bun install. Independent upstream T3 installation changes that promise and setup ownership. Update help/install/docs together if adopted.
- Current locally built Linux executable is about 202 MiB; its packed web archive is about 114 MiB (du output). This is a current artifact measurement, not a measured size/speed saving for an ACP-only binary. No such binary exists yet.
- CLI state is ~/.bruv/agent. Bundled web state is ~/.bruv/web. Extracted payload cache is under XDG_CACHE_HOME/bruv/web-runtime or ~/.cache/bruv/web-runtime. Do not delete user state when removing build/extraction code.

## Proposed command shape, not implemented

A documentation-only web command can explain installation of supported upstream T3, running it separately, adding the exact Bruv ACP command, auth/model setup, and known feature gaps. It must not claim to start/manage a server or open a ready session if it merely prints instructions. Do not auto-install latest upstream or silently rewrite its settings unless separately chosen. Version tested instructions and a stable documentation link are less coupled than bundling another app. Actual registration syntax waits for the upstream experience research.

## Data and release questions

An external T3 process must not be pointed at existing Bruv web data as an assumed migration. Current patched provider/session/task/custom-event shapes may not match unmodified upstream; source and migration tests must decide this. Keep old data and documented rollback/read-only recovery until an explicit migration is proven. Fresh ACP sessions and migrating existing histories are different acceptance claims.

If adopted, remove obsolete web source producer, patch, embedded archive, build dependencies, CI/release web gates, notices and docs together, but keep still-used native/remote/task paths until ownership research says which can go. Replace removed integration tests with actual ACP experience tests, not no-op success. Distribution can become simpler; task ownership and session continuity do not become simple merely because the transport is standard.

Values unchanged. Existing one-owner, actual-path proof and no data-loss guidance covers these observations.
