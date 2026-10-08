# Bruv worktree setup — 2026-10-04

User asked for automatic setup in t3.json. Read the local Zevium example at
/home/tnfssc/Code/zevium/t3.json. Borrow its named setup/build/check actions,
not its pnpm command or env copying. Bruv uses Bun and a frozen bun.lock.

Setup Worktree runs bun install --frozen-lockfile, then bun run prepare:assets.
Asset preparation is required before importing connector tests. Without it a
fresh checkout fails on dist/runtime-assets/assets/clankolas.png. Leave setup in
foreground: these are prerequisites, not an optional background dev server.

Build and CI Checks use the existing root commands. No web dev action: T3 is
external. No mise trust, global install, env/credential copy, or new tool manager.
Bun 1.4.2 is the pinned repository tool; use the normal project environment.

Validation and PR/release status will be recorded in the cleanup feature note:
[provider cleanup timeout](../claude-compat/provider-end-cleanup-timeout.md).
Values unchanged. Use the existing one-owner and real-path proof rules.

Public T3 schema validation and a real fresh-worktree run pass. Detached proof
checkout: /home/tnfssc/.bruv/worktrees/bruv-setup-check-ed6d6d99. The configured
setup installed locked dependencies, prepared assets, then 15 outer focused
tests (including the isolated runtime suite) and typecheck passed. Parent log:
.cache/fresh-worktree-setup.log. No auth/env files copied.

The full local gate first failed 12 shell-output checks because inherited fish
startup printed mise trust warnings into job output. No product assertion was
relaxed. The T3 CI action now runs env SHELL=/bin/sh bun run ci so its test jobs
use a clean non-interactive shell. This does not change the human login shell or
trust any checkout. The root CI entrypoint itself is unchanged.

Shipped in PR #30 and v0.16.5. Setup and the clean-shell CI action are present
in the released source be86f2257a9033a35366d7914bdb0c431f364036. Release gates
and published Linux pair checksums/versions pass; see the linked feature note.
