# CI and build cache follow-up

User approved dependency caching and asked for sensible build caching. Current v0.15.6 release run 36308999634 stays pinned and must finish unchanged.

Worker prepares scoped dependency/build cache changes in isolated worktree; parent reviews and pushes separately. Cache pnpm/Bun downloads with actual tool versions and platform; investigate compiler/source intermediates. No credentials, user HOME/state, stale dist, skipped verification/tests or release artifact checks. Build output reuse needs exact input/provenance keys. Hosted warm hits must be observed, not inferred from local cache. Values unchanged: correct ownership and evidence already cover this.

Worker task_3623866c in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_3623866c, branch die/add-safe-ci-dependency-and-build-caches-3623866c, base c27ed47. Parent review/integration pending.

Worker 3796474 integrated locally as e78c0c4. Parent caught duplicate release-job env block that text tests missed, merged env maps and added parsed workflow regression preserving RELEASE_SHA/RELEASE_TAG plus cache vars. PNPM_CONFIG_STORE_DIR config probe returns chosen path. Parent workflow tests/typecheck task_b97101ca. No build artifacts cached: exact dependency store keys only, no restored dist or skipped gates. Do not push until running v0.15.6 run 36308999634 finishes; watcher reattached task_7d31225d after original local watch exited while hosted run still active. Hosted cold/warm hit validation follows push.

First hosted runs 36309583195/36309583805 rejected workflow before jobs: runner context unavailable in job env. Parent moved store setup to step writing RUNNER_TEMP paths into GITHUB_ENV. 16 workflow tests now pass. Adding actual actionlint validation (task_d85e5615, artifacts/actionlint-bin) before repush; parsed YAML/text checks alone missed context validity. v0.15.6 already published unaffected.

Fixed workflow pushed 02327ad. actionlint passed; 16 tests pass. Valid hosted cold runs CI 36309732905 and Release dry-run 36309732944 queued. Watch logs /tmp/die-cache-cold-{ci,release}.log. After success inspect cache-save logs and rerun same CI SHA once to prove warm restores; do not dispatch new release for cache validation.

User requested accurate mise.toml. Parent added Node 24.21.0 and pnpm bootstrap 11.27.1 alongside Bun 1.4.2, matching CI/release/live workflows. T3 packageManager selects pnpm 11.10.0 inside its checkout; comment records distinction. No global tool installation or trust change implied. Values unchanged.

Cold CI 36309732905 cancelled by newer mise push, not test failure; macOS succeeded and saved cache. Hosted annotation showed cache v4 Node20 deprecated. Parent verified latest actions/cache v6.1.0 immutable SHA 55cc8345863c7cc4c66a329aec7e433d2d1c52a9 and action.yml using node24 via GitHub API; updated pins, actionlint + 16 tests pass. New push will supersede CI again; wait final stable run before warm rerun.

Hosted release dry-run 36309732944 passed and saved pnpm-11.10.0-Linux-X64-d56f76d98708b275f4af8dbe9cd7608597eaf8ad76b2802621ddfce12d9f1377 (~998 MB) plus Bun Linux (~209 MB); macOS Bun (~56 MB) also saved. Full log /tmp/die-cache-cold-release-full.log. Latest CI 36309940829 still running; after it completes rerun same SHA for warm-hit proof. Cache action now v6.1.0/node24 on latest e7e92b4.

Warm proof complete: CI 36309940829 attempt 2 passed on same e7e92b4. Logs /tmp/die-cache-warm-full.log show primary-key hits for pnpm Linux and Bun; pnpm install resolved 849, reused 848, downloaded 0; deployment reused 159, downloaded 0. Full build/tests still ran. This closes dependency-cache hosted verification, not build-output caching. Values unchanged.

Measured CI 36309940829 attempts 1 vs 2: Linux job 394s -> 393s; shared gate 362s -> 353s; warm Bun+pnpm restore 18s. First Linux logs confirm both cache misses and 844 downloaded / 4 reused. Warm has 0 downloaded / 848 reused. Overall 1s (~0.3%) is normal noise, not proven speed gain. macOS already warm in first attempt; do not call that cold/warm. Dependency caches eliminate downloads but build/test dominates. Logs /tmp/die-cache-first-ci-full.log and /tmp/die-cache-warm-full.log.
