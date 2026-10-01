# Product progress, not bulletproof code

User correction (2026-10-01): we spend too much time on deep defensive coding. Trying to cover every edge slows product work and creates our own complexity bugs. Fix observed problems. Accept known gaps. Keep essential security and data-loss protections, not speculative defenses.

Changed value 7 and the existing “Solve real problem” bullet in `src/prompts/system.md`. No new policy layer.

## Shared source

- `src/prompts.ts` embeds `system.md` as `collaborationGuidance()`. `src/agent/extension.ts` appends it at `before_agent_start` for Die roots and all child roles.
- Local children start the same CLI through `src/tasks/job-service.ts`. Server-native tasks use the Die Pi adapter in `integrations/t3/upstream/die.patch`, which starts the Die binary. SSH work starts that binary through `src/remote/owner.ts`. They share the same prompt hook; task role text does not replace it.
- `src/live/main-owner.ts` runs the ordinary start hook and uses its effective instructions for Live. No separate copy of engineering guidance.

Explicit user-owned system prompts still override shared collaboration text. This change does not alter that choice. Markdown is embedded at build time; a source edit does not update a running binary.

Existing delivery tests check every working value reaches the real stream context. Added a small wording check for this correction. No broad hardening or test matrix needed.
