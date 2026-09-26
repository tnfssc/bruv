# Remote task model setup

## Existing die behavior

Code inspection, not credential access:

- src/tasks/subagent-profiles.ts stores fast, normal and orchestrator profiles in ~/.die/subagents.json on the runtime host. Model names use provider/model. Each profile may omit model or thinking.
- resolveProfile falls back to its parent context for missing fields. Missing both configured and parent model throws.
- src/tasks/job-service.ts local CLI path resolves that profile against ctx.model and ctx.thinkingLevel before spawning. The native delegation branch has its own backend policy; this local helper is not proof of its model choice.
- src/tasks/subagent-settings-ui.ts exposes /subagents in the TUI and lists ctx.modelRegistry.getAvailable(). Its save notice explicitly says changes apply to future sub-agents. That list is not a paid-provider request or proof credentials still work.

No user's profiles, auth files or tokens were read for this investigation.

## First remote shape

Do not invent a second broad settings format. Resolve settings on the remote runtime. We can reuse the existing remote normal profile as the default if it contains a model, or ask the user to set a remote default during onboarding. The current remote task POC uses a fixed fake profile only; it does not implement this reuse yet.

Important: local CLI fallback was designed with an actual parent model context. A remote worker service with no parent conversation cannot silently substitute the Mac's Live model. We need an explicit remote fallback/default or a clear model-not-configured result. Model auth is remote even if the Mac chooses which allowed profile to request.

Handshake should report supported protocol, runtime version, profile names and resolved model/thinking metadata. No credentials. Distinguish configured auth, verified recent provider access and expired/failed auth. A model name in a config file is not access. Task acceptance records effective immutable configuration; later profile edits affect future tasks, not running tasks.

For first product slice, one remote normal profile is enough. Keep optional per-task overrides explicit. Reject an unavailable model rather than quietly switch cost/provider. Repo revision, local capability permissions and setup recipes are separate from model selection; they should not hide inside a model profile.

No production edits. Values unchanged: existing simple design, explicit ownership and truthful readiness cover this decision.
