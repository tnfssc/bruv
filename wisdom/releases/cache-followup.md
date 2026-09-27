# CI and build cache follow-up

User approved dependency caching and asked for sensible build caching. Current v0.15.6 release run 36308999634 stays pinned and must finish unchanged.

Worker prepares scoped dependency/build cache changes in isolated worktree; parent reviews and pushes separately. Cache pnpm/Bun downloads with actual tool versions and platform; investigate compiler/source intermediates. No credentials, user HOME/state, stale dist, skipped verification/tests or release artifact checks. Build output reuse needs exact input/provenance keys. Hosted warm hits must be observed, not inferred from local cache. Values unchanged: correct ownership and evidence already cover this.

Worker task_3623866c in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_3623866c, branch die/add-safe-ci-dependency-and-build-caches-3623866c, base c27ed47. Parent review/integration pending.
