# Integrated normal-session remote follow-up (2026-09-27)

Work in progress, not a completion or release claim. Parent worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_90d61a8a, base 5c760e05dbd063c124577e108c66248825fd53f7. User says finish the whole normal-session path, Docker only; no external host, publishing, installation or push. Saved answers in user-decisions.md remain binding. Main Live stays execute-only.

## Ownership / resume

- Native targeted questions, durable replies, progress/reconnect, cancellation and profile: task_3186c2c0, /home/tnfssc/.die/worktrees/die-a86675007a5e-task_90d61a8a-a86675007a5e-task_3186c2c0. Own existing src/remote production modules.
- Repo snapshot / safe return: task_1e761842, /home/tnfssc/.die/worktrees/die-a86675007a5e-task_90d61a8a-a86675007a5e-task_1e761842, branch die/remote-repository-snapshot-and-safe-retu-1e761842. New repository modules; parent wires transport/CLI.
- Explicit repo-local capabilities: task_8102da11, /home/tnfssc/.die/worktrees/die-a86675007a5e-task_90d61a8a-a86675007a5e-task_8102da11, branch die/remote-explicit-local-capabilities-8102da11. New capability modules; parent wires transport/CLI.
- Normal CLI Docker acceptance: task_965e3f89, /home/tnfssc/.die/worktrees/die-a86675007a5e-task_90d61a8a-a86675007a5e-task_965e3f89, branch die/integrated-docker-normal-cli-acceptance-965e3f89. Own scripts and fake-provider fixtures.
- Parent owns assembling all hooks, typed execute bridge, truthful prompts/docs, combined regression and review.

## Environment / baseline evidence

Installed Bun is /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun; Node /home/tnfssc/.local/share/mise/installs/node/24.21.0/bin/node. Mise emits untrusted-config warnings but invoking installed tools works. Frozen-lockfile install passed. Full web build initially hit missing pnpm, not a remote product failure. For CLI iteration copied unchanged /home/tnfssc/Code/die/dist/die-web into this worktree and used scripts/build.ts --reuse-web, then bun run check: passed. This does not replace parent's release web gates.

Baseline rebuilt normal CLI Linux Docker/SSH fake-provider lifecycle passed (/tmp/remote-integrated-baseline-e2e.log). This is first-slice baseline, not evidence for pending integration. No Mac or real provider claim. Values unchanged: this work applies existing whole-path, durable ownership and honest state values.
