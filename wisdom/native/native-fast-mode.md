# Provider-native fast mode

Die's initial native fast mode is an explicit, session-local provider request setting.
It is separate from `/mode fast` and sub-agent profile `fast`: it doesn't change the model, thinking level, or instructions. New supported CLI/SSH subagents inherit the parent’s active fast setting.

## Commands and consent

- `/fast` and `/fast status` only report status; a bare command never enables billing.
- `/fast on` needs the TUI premium-cost confirmation. Noninteractive launches must include `--accept-cost`.
- `/fast off` records an explicit model-bound opt-out and sends `service_tier: "default"`. Sessions/models that the user hasn't touched aren't overridden.

The setting is stored on the active session branch with its exact session, provider, and model identity.
A new session starts off.
A model switch activates only an authorized record already on that branch for the switched-to exact model.
New CLI/SSH subagents inherit active parent fast consent at launch. The launcher sends a fresh BRUV_SUBAGENT_NATIVE_FAST bit, never an ambient inherited bit. The child consumes it once and writes its own session/model setting if its endpoint and auth support fast mode. This includes nested orchestrator children. Unsupported providers stay untouched. Parent /fast off affects future launches, not already-running children. Explicit child settings win on resume.

The separate T3-native task backend does not accept this launch setting yet. Its contract and provider launch mapping remain follow-up work; do not claim inheritance for that path.

## Supported surfaces and wire values

Supported surfaces, not model aliases, determine the wire tier:

- OpenAI API, official `openai` Responses endpoint with API-key auth: `service_tier: "fast"`.
- Codex, official `openai-codex` endpoint with ChatGPT sign-in: `service_tier: "priority"`, matching the official Codex client's Fast wire mapping.

Die forwards the selected model alias unchanged and lets the provider validate model/tier availability. There is no hardcoded model allowlist or prefix check. The old catalog gate rejected `gpt-6.1-sol` even on the supported Codex surface; adding one alias would only postpone the same failure for the next catalog change. An alias being forwarded does not guarantee premium support: provider errors remain provider errors, with no automatic retry or model swap.

Explicit opt-in, billing consent, exact session/branch/model authorization, endpoint checks, and auth routing remain required. Custom gateways, alternate endpoints, Anthropic, and other providers are rejected before dispatch. This removes a stale capability guess, not a billing or routing boundary.

Anthropic support is deferred.
Its native API mechanism is `speed: "fast"` plus the `fast-mode-2026-02-01` beta header, not an effort change.
Supporting its direct/subscription auth and availability semantics safely needs a separate adapter.

## Runtime compatibility and status evidence

Pi 1.0 OpenAI Responses and Codex SSE/WebSocket serializers support `serviceTier`.
Die so uses a narrow compatibility seam first added for Pi 0.85 and tested against Pi 1.0: the active `ModelRuntime` instance's private `prepareRequest`/`streamSimple` sequence and the registry's `runtime` reference.
Enabling fast, or restoring an enabled record at session start, reports an error instead of becoming a no-op if that seam is absent.
The patch is scoped to the bound runtime instance and is removed at session shutdown; it doesn't patch `ModelRuntime.prototype` globally.

Request selection is synchronous and request-local.
At the concrete `streamSimple` call, die snapshots the session/branch authorization, provider/model IDs, requested tier, and OAuth-versus-non-OAuth gate.
That boolean gate distinguishes the supported billing/auth surfaces; it isn't a claim that die identified a particular account.
After asynchronous auth preparation, die checks the prepared provider/model IDs, endpoint support, and auth gate.
It writes the snapshot tier into the initially serialized payload before the extension payload-hook pipeline, then validates the final model and tier after every hook and before provider dispatch.
A request with no authorization snapshot is still completely untouched even if the user enables fast or changes model/session while preparation is awaiting.
Conversely, on/off or model changes affect the next request, not one already captured.
Hook exceptions aren't a safety boundary.

Only agent requests routed through the bound `ModelRuntime` have this guarantee.
Calling a low-level provider module's `streamSimple` API directly bypasses die and isn't a supported native-fast integration.
Registry auth, headers/hooks, context filtering, sampling/reasoning settings, tools, and SSE/WebSocket transport are otherwise unchanged.

The footer bolt is provider status, not a working spinner:

- ` fast on (requested)`: enabled, but no response tier has been seen yet.
- ` fast confirmed`: this request returned `priority` or `fast`.
- ` fast downgraded (default)`: the response returned a non-fast tier.
- ` fast off`: the user explicitly selected default/standard for this model.

Pi 1.0 exposes raw stream events. The guard watches response.completed through a request-bound onProviderStreamEvent callback and forwards the existing callback. It uses the returned service_tier, never the requested tier, as proof. Missing/unknown tiers stay requested. Opt-out, model/session changes, and shutdown cannot be overwritten by a stale reply. Standard compaction does not change fast status. Response evidence is not persisted; reopening starts at requested until another reply arrives.
It performs no automatic standard retry, upgrade, or model swap.

## Cost and compaction policy

Codex documentation describes model-dependent ChatGPT credit multipliers, while API Fast uses separate token pricing.
Die doesn't invent or display credit estimates.
Pi 1.0 prices both priority and API fast responses. The footer uses its usage.cost totals without another multiplier. Fast sessions show a dollar catalog estimate with ~, not a permanent $?. This is not a ChatGPT credit estimate or an invoice. If the response omits its tier, Pi prices the requested tier; status still stays requested. Historical fast usage remains marked as an estimate after opt-out.
Provider billing is the source of truth.

Both plaintext and native Codex compaction explicitly send `service_tier: "default"`, even if an ordinary captured request was fast.
No hidden premium fast compaction.
No tier from a captured ordinary request leaks into compaction.

## Source evidence

Sources for provider mechanics and wire mapping (not a model capability allowlist):

- OpenAI API Fast mode: https://developers.openai.com/api/docs/guides/fast-mode
- Pinned Codex commit `ad931a45b201e3877d6ba542ba5dbbd85e7e31b4` request mapping (`Fast => "priority"`, while both `fast` and `priority` parse as Fast): https://github.com/openai/codex/blob/ad931a45b201e3877d6ba542ba5dbbd85e7e31b4/codex-rs/protocol/src/config_types.rs#L527-L550

## Alias-forwarding fix handoff (2026-10-01)

- Worktree: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_df2e76e7`.
- Branch: `die/remove-native-fast-model-alias-gate-df2e76e7`.
- Resume state: implementation complete; commit on this branch, not merged into parent. Inspect `git log -1` for the fix commit. No running work or pending decisions. Next step is parent review/integration.
- Evidence: `bun test tests/native-fast-mode.test.ts tests/sol-model-catalog.test.ts` (23 pass), `bun test tests/native-compaction.test.ts` (41 pass). Alias forwarding includes `gpt-6.1-sol`, formerly excluded aliases, and an unknown future alias on both official surfaces; untouched/on/off wire tiers remain covered.
- Environment: dependencies installed with `bun install --frozen-lockfile`; the worktree's mise config was untrusted, so tests used the installed Bun 1.4.2 binary at `/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun` without changing trust settings.
- Remaining limitation: offline serializers/SDK tests, not a billable provider call; actual alias/tier availability is deliberately provider-owned.
- Values review: `wisdom/values.md` unchanged. Value 7 already says to remove speculative defenses while preserving essential protections; this feature-specific decision applies that value rather than introducing a new general lesson.

## Codex fast follow-up (2026-10-03)

Worktree: `/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_c9443bef`. Branch: `bruv/fix-codex-gpt-fast-mode-c9443bef`. Parent workspace is busy; leave it alone. The delegated worker was stopped. Parent did the diagnosis and edits.

Found a request-path bug. The guard bypassed ModelRuntime.streamSimple without normalizeContext. Pi 1.0 providers expect system prompt and tools in transcript messages. Separate systemPrompt/tools fields were lost. Old wire tests normalized their own inputs, hiding this. A real ModelRuntime Codex test now covers untouched/on/off. Before the fix, untouched passed but on sent "You are a helpful assistant." Normalize before async auth, then dispatch the transcript.

The user's command message and footer showed successful opt-in, not a refusal. Do not describe the context bug as a command refusal. The user then asked for subagent inheritance and a useful tier/cost display. Those CLI/SSH paths and the footer are now changed as described above. Native backend inheritance remains open.

Proof: 128 tests passed across native-fast-mode, native-compaction, footer, job-service, remote-placement, remote-jobs, remote-jobs-placement-fixture, remote-runner-placement-fixture, remote-descendant-environment, and remote-repository-wire. 896 assertions. Covers inherited child startup, off/unsupported/root behavior, launch environment, real SDK normalization and tier pricing, SSE/WebSocket tier confirmation, downgrade/missing tier, stale opt-out, and footer estimates. No billable provider call, real SSH host, or T3-native acceptance run. Final typecheck and git diff --check passed. Focused lint reported warnings/info, no errors. Tests use SHELL=/bin/bash to avoid fish/mise startup noise, and the installed Bun 1.4.2 binary; no trust setting changed.

Handoff: implementation and tests are committed on this branch; inspect git log -1 for the commit. Not merged or installed. Next: review/integrate this commit without disturbing the parent workspace. Native backend inheritance still needs its own contract and provider-launch change. Values unchanged: existing values on proof scope, real-path tests, simple design, and useful handoffs cover this work.

## Default-branch release integration

User asked to push to default and release. Release worktree: `/home/tnfssc/.bruv/worktrees/bruv-release-fast-v01529`. Branch: `bruv/release-fast-v01529`. Based on origin/develop eb07b0d7, not the busy local develop tip. Only ba52c365 was cherry-picked as 40778e73. The two environment conflicts retain released branch behavior and add only the fast-mode bit. Unrelated local native-connector and task-UI work is not included. Human notes are support/release-v0.15.29.md. Release dispatch and publication checks are pending.

Release candidate proof on the actual default-branch base: frozen install, typecheck, whole-repo format check, diff check, and the same 128 tests / 896 assertions passed.
