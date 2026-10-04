# Bruv worktree setup — 2026-10-04

User asked for automatic setup in t3.json. Read the local Zevium example at
/home/tnfssc/Code/zevium/t3.json. Borrow its named setup/build/check actions,
not its pnpm command or env copying. Bruv uses Bun and a frozen bun.lock.

Setup Worktree runs bun install --frozen-lockfile, then bun run prepare:assets.
Asset preparation is required before importing connector tests. Without it a
fresh checkout fails on runtime-assets/assets/clankolas.png. Leave setup in
foreground: these are prerequisites, not an optional background dev server.

Build and CI Checks use the existing root commands. No web dev action: T3 is
external. No mise trust, global install, env/credential copy, or new tool manager.
Bun 1.4.2 is the pinned repository tool; use the normal project environment.

Validation and PR/release status will be recorded in the cleanup feature note:
[provider cleanup timeout](../claude-compat/provider-end-cleanup-timeout.md).
Values unchanged. Use the existing one-owner and real-path proof rules.
