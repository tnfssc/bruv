# Worktree setup: resolve mise-managed Bun explicitly

T3 worktree creation recorded two setup failures with exit 127: fish reported Unknown command bun. The repo's Bun is provided through mise, but the T3-launched shell can start with a PATH that does not include the mise-managed tools. mise trust authorizes the repository's mise.toml; it does not refresh the invoking shell's PATH. Trust and subsequent setup therefore need separate explicit mise execution: mise trust -y --quiet && mise exec -- bun install --frozen-lockfile && mise exec -- bun run prepare:assets. The first && ensures install/preparation never continue if trust fails; each mise exec resolves Bun from the project tool configuration in its own command process.

This assumes mise and the configured tools are installed/available, and that the repository configuration is valid. It does not install missing tools or change global tool versions; `mise trust` authorizes this repository configuration. T3 batch wording and its failure presentation are upstream behavior outside this repository's control; do not claim this change alters them.

Workspace: /home/tnfssc/.bruv/worktrees/t3-3152ea81-5442693331ce-task_06f0676a
Branch: fix/worktree-setup-mise-exec
Validation: parsed `t3.json` and checked that only the Setup Worktree command changes; `/bin/sh -n` accepts the command. A bounded probe with `PATH=/usr/bin:/bin` ran the trust step and attempted `mise exec -- bun --version`, confirming the command reaches mise from minimal PATH, but mise failed first while resolving pinned pnpm 11.27.1: no `pnpm-linux-x64` asset found (available name is `pnpm-linux-x64.tar.gz`). No dependency install was attempted. This is an environment/tool-resolution blocker, not proof of full worktree setup success.
