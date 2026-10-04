# Provider-native fast mode

Bruv's native fast mode is an explicit, session-local provider request setting.
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

- OpenAI API, official `openai` Responses endpoint with API-key auth: `service_tier: "priority"`, matching Codex Fast on API-key traffic too.
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

The footer bolt reports the selected mode, like official Codex, not delivery evidence or a working spinner:

- ` fast on`: the authorized Fast setting is selected; requests use `priority`.
- ` fast off`: the user explicitly selected default/standard for this model.

There is no response-tier observer or confirmation/downgrade state. Official Codex does not classify `response.service_tier` for this badge. A returned `default`, missing tier, or unknown tier does not turn the selected mode off. Existing raw provider-event callbacks remain untouched. Resuming reads the selected setting; stale responses cannot change it. No automatic retry, upgrade, or model swap.

## Cost and compaction policy

Official Codex's optional thread credits and dollar estimates come from account usage data, not a local token multiplier. Bruv has no equivalent account-usage integration. It retains Pi's `usage.cost` catalog totals, without adding a multiplier or inventing ChatGPT credits. Fast sessions show `$…~`; the detailed label is now `(catalog estimate)`, not `(fast estimate)`. Historical estimates keep their marker after opt-out. This is not an invoice or a guarantee of fast delivery.

Pinned Pi 1.0 has model-dependent hardcoded tier multipliers. Its lower-level Codex stream resolver substitutes requested priority for a returned default. But both providers' `streamSimple` wrappers drop the `serviceTier` pricing fallback option in `buildBaseOptions`; our concrete payload guard still writes the correct wire tier. Actual guarded WebSocket default-response tests produce base catalog cost, while priority-response tests produce tier-priced catalog cost. Missing/default response tiers therefore cannot establish a premium price either. Leave those SDK estimates alone; do not mistake them for upstream account prices. A future pricing change needs provider/account evidence, not another guessed factor.
Provider billing is the source of truth.

Both plaintext and native Codex compaction explicitly send `service_tier: "default"`, even if an ordinary captured request was fast.
No hidden premium fast compaction.
No tier from a captured ordinary request leaks into compaction.

## Source evidence

Historical sources (the current source audit below supersedes earlier response-tier status and API `fast` decisions):

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

Release dispatched: https://github.com/tnfssc/bruv/actions/runs/37143993104 from dcb2d747702ee76db75d1e23b21960e8fd8f72e0 on develop. Watch log: /home/tnfssc/.bruv/release-v0.15.29-watch.log. Do not push handoff updates while publication gates require the prepared develop SHA to stay fixed. After success, verify release metadata and assets (no redundant binary download), then commit the final release record.


### First release run failed; off-path correction

Run 37143993104 failed at deterministic tests before packaging/publication: 1737 pass, 20 skip, 9 fail. All nine failures were in subagent-placement.test.ts. nativeFastEnabled looked up model endpoint support even with no enabled/acknowledged setting. These normal launch paths carried only provider/model identity, so normalizedUrl read an absent baseUrl. This was our regression, not an unrelated CI failure.

Reproduced locally: placement suite 4 pass / 9 fail. The helper now returns false before looking at routing/auth unless enabled consent exists. Added a regression with throwing routing/auth getters for absent, off, and unacknowledged settings. Placement plus native-fast-mode and job-service: 50 pass, 0 fail, 277 assertions; typecheck passed. No model-schema weakening or new endpoint fallback. The release-prepared version remains 0.15.29 because no tag was published. A new full release run will use the corrected source, not rerun the failed SHA. Values unchanged: keep untouched paths untouched, and use real-path checks.

Corrected release run: https://github.com/tnfssc/bruv/actions/runs/37144547603 from 0249ae6c on develop. Watch log: /home/tnfssc/.bruv/release-v0.15.29-retry-watch.log. Await all gates, then check publication and assets. Do not push further docs while this run owns the prepared SHA.

Published v0.15.29 at 2026-10-03T18:42:13Z from 0249ae6c1a5314011fc489476a3197f5bea9fb31. Corrected Release run 37144547603 passed all gates. Stable release metadata and all 12 nonempty assets verified. See [final release record](../releases/v01529-fast-mode.md). No install, redundant binary download, or parent-working-tree change.

## Official Codex source alignment (2026-10-04)

Owned worktree: `/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_d63be25a`.
Branch: `bruv/match-native-fast-mode-to-official-codex-d63be25a`.
Fetched with `git clone --depth=1 https://github.com/openai/codex.git /tmp/bruv-codex-fast-upstream` and pinned HEAD **afb436df8b70bb5bc57b86d9a3e829968988cd21** (commit timestamp 2026-10-04T07:12:06Z). This audit used source, not guessed documentation.

### Exact source references and comparison

All links pin that SHA:

- [protocol/src/config_types.rs L526-L553](https://github.com/openai/codex/blob/afb436df8b70bb5bc57b86d9a3e829968988cd21/codex-rs/protocol/src/config_types.rs#L526-L553): Fast serializes to `priority`; fast/priority parse as Fast; default is the explicit standard-selection sentinel. Bruv now sends priority on both official surfaces, rather than API fast / Codex priority.
- [core/src/client.rs L981-L1015](https://github.com/openai/codex/blob/afb436df8b70bb5bc57b86d9a3e829968988cd21/codex-rs/core/src/client.rs#L981-L1015) and [protocol/src/openai_models.rs L984-L1011](https://github.com/openai/codex/blob/afb436df8b70bb5bc57b86d9a3e829968988cd21/codex-rs/protocol/src/openai_models.rs#L984-L1011): catalog filters request tiers and omits the default sentinel on the wire. Bruv's model type lacks this live service-tier catalog. Keep provider-owned alias validation; no hardcoded capability guesses. Keep explicit wire default for opt-out and compaction: that existing no-premium boundary is not incompatible with upstream standard selection.
- [tui/src/service_tier_resolution.rs L7-L74](https://github.com/openai/codex/blob/afb436df8b70bb5bc57b86d9a3e829968988cd21/codex-rs/tui/src/service_tier_resolution.rs#L7-L74) and [tui/src/chatwidget/service_tiers.rs L13-L56](https://github.com/openai/codex/blob/afb436df8b70bb5bc57b86d9a3e829968988cd21/codex-rs/tui/src/chatwidget/service_tiers.rs#L13-L56): UI uses effective selected tier, not response evidence.
- [tui/src/chatwidget/status_surfaces.rs L796-L817](https://github.com/openai/codex/blob/afb436df8b70bb5bc57b86d9a3e829968988cd21/codex-rs/tui/src/chatwidget/status_surfaces.rs#L796-L817): Fast on/off checks current selected priority. Bruv removes confirmed/downgraded/requested labels, callback wrapping, and response state. Compact width uses bolt-fast/off, without checkmarks or question marks. Other footer fields unchanged.
- [codex-api/src/sse/responses.rs L106-L144](https://github.com/openai/codex/blob/afb436df8b70bb5bc57b86d9a3e829968988cd21/codex-rs/codex-api/src/sse/responses.rs#L106-L144): completed-response type consumes usage/end-turn data, not service-tier classification. A default response is not a Codex badge downgrade.
- [tui/src/app/background_requests.rs L847-L865](https://github.com/openai/codex/blob/afb436df8b70bb5bc57b86d9a3e829968988cd21/codex-rs/tui/src/app/background_requests.rs#L847-L865) and [tui/src/chatwidget/thread_usage.rs L224-L255](https://github.com/openai/codex/blob/afb436df8b70bb5bc57b86d9a3e829968988cd21/codex-rs/tui/src/chatwidget/thread_usage.rs#L224-L255): credits/USD estimates use account usage response fields. No local Fast multiplier was copied from upstream. SDK assumptions are recorded above, not endorsed as upstream prices.

### Checks, boundaries, and handoff

Final: 117 tests / 781 assertions passed across native-fast-mode, footer, native-compaction, job-service, subagent-placement, and remote-descendant-environment. Covers API/Codex priority requests; priority/fast/default/flex/auto/unknown/missing responses with unchanged selection; raw callback forwarding; Codex SSE/WebSocket serialization; real ModelRuntime system/tool normalization and SDK cost behavior; in-flight opt-out; inheritance; standard compaction; full/narrow footer rendering. Typecheck, focused format check, and git diff --check passed. Focused lint: 16 warnings / 4 infos, no errors.

First checks caught a stale API tier expectation, a test generic-model typing error, and an incorrect assumption about SDK default-response cost; corrected using observed behavior. Narrow fixture changed from 80 (still full row) to 60 columns. Dependencies reused through a temporary node_modules symlink to the existing parent install (removed after checks); generated ignored runtime-assets copied locally for typecheck. No dependency install, release/install, trust change, parent-source edit, or billable provider call.

Gaps: no live account credit verification, real provider latency/tier guarantee, live model-catalog port, interactive TUI acceptance, real SSH acceptance, or native task backend inheritance. Consent, session/branch/model scoping, auth/endpoint guards, payload mutation protection, and standard compaction preserved; no permission/scope change needed. Values unchanged: source-path evidence, clear proof scope, simple state, and preserving essential boundaries already cover this lesson. Commit belongs to this branch for parent integration; not merged or installed.

### Parent integration

Worker commit 429a9ffc was reviewed and cherry-picked onto local develop as e93d0953. Parent independently read the pinned upstream selection and request mapping. On the integrated tree, the same six suites passed: 117 tests / 781 assertions; typecheck and diff checks passed. The first test launch hit fish syntax before running tests; reran with explicit bash. No source failure.

This change is in local source only. No push, release, install, or live provider claim. Use the source links and worker worktree above for follow-up. Existing values cover this change; none added.
