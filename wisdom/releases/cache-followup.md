# CI and build cache follow-up

User approved dependency caching and asked for sensible build caching. Current v0.15.6 release run 36308999634 stays pinned and must finish unchanged.

Worker prepares scoped dependency/build cache changes in isolated worktree; parent reviews and pushes separately. Cache pnpm/Bun downloads with actual tool versions and platform; investigate compiler/source intermediates. No credentials, user HOME/state, stale dist, skipped verification/tests or release artifact checks. Build output reuse needs exact input/provenance keys. Hosted warm hits must be observed, not inferred from local cache. Values unchanged: correct ownership and evidence already cover this.

Worker task_3623866c in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_3623866c, branch die/add-safe-ci-dependency-and-build-caches-3623866c, base c27ed47. Parent review/integration pending.

Worker 3796474 integrated locally as e78c0c4. Parent caught duplicate release-job env block that text tests missed, merged env maps and added parsed workflow regression preserving RELEASE_SHA/RELEASE_TAG plus cache vars. PNPM_CONFIG_STORE_DIR config probe returns chosen path. Parent workflow tests/typecheck task_b97101ca. No build artifacts cached: exact dependency store keys only, no restored dist or skipped gates. Do not push until running v0.15.6 run 36308999634 finishes; watcher reattached task_7d31225d after original local watch exited while hosted run still active. Hosted cold/warm hit validation follows push.
