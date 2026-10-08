# Orchestration is a tool — 2026-10-08

User approved removing the root leader opening and the child worker-leader prose. No new workflow rule replaces them. Quick work and sharing already live in `system.md`. Orchestration is a tool to use, not the agent's whole job.

Root and child orchestrator prompts keep worktree guidance. Its opening now says "Delegating" so it reads as mechanics when giving work to another agent. Child keeps "You are a {{role}} sub-agent." Mode selection, delegation powers, and custom-base rules stay the same. [Source map](./system-instructions.md) reflects this.

Delivery tests now check retained worktree text, not leader prose. Focused regressions check all removed framing is absent in root/child guidance and real prompt preview.

Checks: 84 pass, 0 fail across prompts, instruction-mode, main-agent-mode SDK, prompt preview, prompt delivery, provider prompt, subagent extension, and Live main integration. Direct `./node_modules/.bin/tsc --noEmit` and `git diff --check` pass.

The first test/typecheck run lacked generated assets. `bun run check` stopped in asset prep: installed Pi `dist/core/agent-session.js` did not match the host adaptation hashes. Copied the existing dependency assets into ignored `runtime-assets/` using the asset script's file map, then tests and direct typecheck passed. No dependency or host guard changed. This does not prove the normal asset-prep gate works.

Values and shared system prompt stay unchanged. [Existing prompt guidance](./prompts.md) already covers judgment, quick work, and sharing. No new value here.

Worktree: /home/tnfssc/.bruv/worktrees/t3-a61691ea-5442693331ce-task_aee4a7d7
Branch: bruv/remove-orchestration-first-prompt-framin-aee4a7d7

Parent integrated the commit on `t3/simplify-orchestrator-prompt` in `/home/tnfssc/.t3/worktrees/bruv/t3-a61691ea`. Parent reran the same 84 tests, direct typecheck, and diff check; all pass. The offline assembled prompt has no leader framing, keeps the shared quick-work and sharing values, and keeps worktree mechanics. Parent used the same generated assets from the worker; the normal asset-prep gate still has the Pi host hash blocker.

Next step: push this branch and open a PR to `develop`. No install or model call. The wider historical prompt review is not part of this edit.
