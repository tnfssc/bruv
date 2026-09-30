# Exact pinned-web reuse in full CI

Ordinary executable changes still run full Linux validation and device-free macOS validation. Docs-only routing is unchanged. No hosted under-60s result is claimed.

## Two distinct receipts

The existing packed-web receipt binds a trusted fresh producer to its current workspace, source checkout, installed dependencies and inherited environment, with a short lifetime. It is **not** cross-run authority. GITHUB_ACTION is shell-step metadata, excluded for same-run release target reuse; actual build configuration remains guarded.

The opt-in CI owner (bun --no-env-file scripts/ci-web.ts key|build) has a separate exact content key. It owns the source pin (including upstream lockfile), canonical patch, bootstrap, producer/verifier, chunk check, pure-Bun packer, tool configuration, actual Bun/Node/pnpm/compiler/libc/OS versions and platform/architecture. CLI sources do not enter this key. Root package.json/bun.lock are included because the chunk checker imports es-module-lexer from that locked graph. Changed upstream locks require a new source pin or canonical patch. Producer inputs changing during preparation/build fail rather than publish ambiguous evidence.

Producer children get a fixed CI/locale/time environment, reset private HOME/TMPDIR, known tool paths, disabled user/global npm configuration, public registry, and only a package-download store location. Credentials, inherited VITE/build variables and GitHub run identity are not forwarded. Bun dotenv loading is disabled; arbitrary root configuration is rejected, and upstream tracked/untracked source plus ignored inputs are checked before install/bundle. Only dependency directories, generated dist/typecheck output, turbo output, reset producer-owned license-generation output and Vite's generated hook support files are allowed. Custom DIE_T3_SOURCE or user .env files belong to fresh local builds, not this contract.

## Cache boundary

CI restores only .cache/ci-packed-web/{payload.gz,receipt.json} using actions/cache/restore with an exact key, no restore prefixes and no cross-OS archive. Only successful trusted default-branch jobs save; PR jobs only read, never promote. Cache trust comes from that workflow writer policy, not a self-asserted digest. A valid entry still needs matching input key, regular files, size and SHA256 verification. Missing, malformed or corrupt entries fall back to a normal fresh checked producer. An immutable corrupt hosted entry cannot be overwritten under the same key; it safely rebuilds until eviction or a producer-key change.

Every hit/miss prepares a verified pinned checkout and runs a frozen dependency install. No source tree, node_modules, private HOME, arbitrary dist tree or credentials are restored. Backend/client build and typechecks may be reused only for identical producer inputs. Independently uncovered client-runtime tsc and **every** current-CLI behavioral web suite still execute. A verified hit is rebound to a new local packed-web receipt, then the current CLI is compiled with --reuse-packed-web. Default local/release builds remain fresh unless explicitly requested otherwise.

## Scheduling and coverage

After build/transport prerequisites, there are only two concurrent groups: complete root tests (native bun test --parallel=4, with Bun's complete discovery) and the unchanged web-validation union, with separate logs. Web vitest pools are bounded to two workers to limit overlap with root workers. Both waits propagate failures; smoke runs only after both pass. Tests read the shared compiled payload/source and create their own homes, ports and scratch files; neither group rebuilds the shared payload. Duplicate standalone server/client tsc is removed because the fresh producer already performs both; client-runtime tsc is retained. No current-CLI tests are cached or moved elsewhere.

Focused proof covers input mutation/mode/toolchain/CLI independence; environment and ignored-config rejection; exact digest/key/malformed-cache misses; same-run GitHub step regression; CI stage union/order and concurrent-group failure propagation. Actual local cold/warm commands/results are in the worker handoff. Hosted all-coverage timing is still required before any broad speed claim.

## Local proof (2026-09-30; not hosted acceptance)

The actual cold-payload full gate took 208.252s: fresh checked producer, current CLI compilation and all 650 web tests passed; root corpus reached 1420 pass/20 opt-in skips/6 failures. Five failures were outdated CI fixture strings following this refactor, one was a temporary-path textual assertion because the private proof TMPDIR contained ".cache/". These were not ignored: coordinated fixtures were aligned preserving all guards/unions, the temporary directory moved outside that substring, focused regressions passed, and standalone smoke passed. The cold gate itself returned nonzero, so this is **not an all-green matched cold baseline**.

The real warm full gate took 129.990s, exit 0: 1426 root tests passed, the same 20 opt-in tests skipped, 0 failures across 203 files; all 650 web tests, client-runtime typecheck, CLI compile, transport and smoke also passed. Before it ran, the pinned checkout, complete dist and root node_modules were deleted; only exact archive cache and public package-download caches were retained. An isolated CLI source comment did not change the exact key. It prepared a new pinned checkout/frozen dependencies, verified the saved SHA256, and compiled the current CLI without rebuilding web. No source-side bundled dist existed on that hit.

Commands with pinned Bun1.4.2/Node24.21.0/pnpm11.27.1 on PATH: empty .cache/ci-packed-web for cold, then DIE_CI_WEB_CACHE=1 bash scripts/ci.sh linux. Warm removes its own pinned source/dist/node_modules before the same command. The proof used private HOME at .cache/full-home and root-test TMPDIR under /home/tnfssc/.die/proofs/task_23c5c02a (outside the workspace). Logs remain in this worker's .cache/{cold,warm}-full-ci.log and .cache/cold-ci-artifacts; latest warm stage logs are artifacts/ci. Final hosted all-coverage cold/warm measurement is still needed; there is no under-60s claim.
