# New OpenAI login and native fast mode (Pi 1.0.3)

## Upstream facts, not a transport guess

Both root dependencies are pinned to 1.0.3. Inspected a fresh frozen install and
the published pi-ai tarball (npm SHA-1 `31463068aa4f979db0f066aa8c1b79b57d310e35`).
The published Responses source matches the installed source byte-for-byte.

- [Canonical provider](https://unpkg.com/@earendil-works/pi-ai@1.0.3/dist/providers/openai.js)
  registers API keys **and** ChatGPT subscription OAuth under `openai`.
  [Legacy provider](https://unpkg.com/@earendil-works/pi-ai@1.0.3/dist/providers/openai-codex.js)
  is explicitly named “OpenAI Codex (legacy)”; it remains OAuth-only.
- [New OAuth](https://unpkg.com/@earendil-works/pi-ai@1.0.3/dist/auth/oauth/openai-chatgpt.js)
  resolves the access token as `apiKey`, without changing base URL or API.
  [ModelRuntime.prepareRequest](https://unpkg.com/@earendil-works/pi-coding-agent@1.0.3/dist/core/model-runtime.js)
  can apply an auth-provided base URL, but canonical OAuth does not provide one.
- [Responses transport](https://unpkg.com/@earendil-works/pi-ai@1.0.3/dist/api/openai-responses.js)
  recognizes ChatGPT sign-in from canonical provider, the **exact** official
  `https://api.openai.com/v1` base URL, and a non-`sk-` resolved credential.
  It omits unsupported sampling/cache fields and still serializes `service_tier`.
  It does **not** rewrite the request to `openai-codex-responses`.

## Fix and boundaries

Canonical API-key and OAuth requests both select `priority`, with distinct API
pricing vs ChatGPT subscription usage/credits confirmation wording. No guessed
account-credit multiplier is advertised. Session/branch/model consent also binds
the auth surface in schema v2; pre-upgrade unbound records fail closed until an
explicit `/fast on` or `/fast off`. Switching auth while confirming or after saving
cannot repurpose premium consent. Resolved credentials and authorization-header
overrides must match the captured canonical billing surface before dispatch.
Exact endpoint/provider/model checks, late tier mutation rejection and explicit
standard-tier opt-out remain. Children bind inherited consent to their own
session/model/auth surface; native task-backend inheritance is still out of scope.

## Direct compaction/cost audit

New OAuth is ordinary Responses traffic: the Codex opaque-checkpoint compactor
must **not** be broadened to it. Its existing API gate and old-checkpoint rejection
are correct. Cache-affine compaction already uses `withStandardProviderTier`;
canonical OAuth now participates correctly without a compaction implementation
change. Added proof for ordinary routing and real-runtime standard-tier requests.

Pi's Responses usage costs remain tier-adjusted token-catalog estimates even with
subscription auth. The footer already detects OAuth independently of provider
name and labels fast costs as catalog estimates; it does not calculate credits.
No direct mismatch requiring a cost change was found. No account billing or
latency/tier guarantee is inferred from mock response usage.

## Proof and limits

- Eight focused suites: **151 pass / 0 fail / 984 assertions**, including the
  isolated native request-history gate. Real AuthStorage/ModelRegistry/ModelRuntime
  plus the pinned Responses serializer prove API-key/new OAuth wire tier, endpoint,
  bearer token, preserved system/tools, standard-tier override and explicit off.
  Tests also cover cost wording, auth changes, credential/header overrides,
  redirected endpoints, stale v1 records, child startup and launch inheritance.
- Root `tsc --noEmit` passes after `prepare-assets.ts`. Focused format and lint
  pass (13 warnings, 1 info); `git diff --check` passes.
- Fresh local frozen dependency install; direct Bun 1.4.2 / Node 24.21.0 paths,
  explicit bash shell. No mise trust change, push, PR, release or product install.
  Logs: `/tmp/bruv-fast-{focused,typecheck,lint}.log`.
- First checks caught old setting fixtures and one fetch stub type; fixed rather
  than weakening assertions. No billable/live-provider or full interactive TUI,
  real SSH, or native task-backend acceptance claim.

Values unchanged: values 1/2/9/10 already require source-based dependency semantics,
essential authorization boundaries, scoped proof and an integration-ready handoff.

## Parent integration

Worker commit `6c046852aeaf8fca205eff5451b80943bcd84014` is integrated as `fb5dda07` on `t3/fix-openai-fast-mode-login`. Parent read the pinned canonical provider, OAuth resource and Responses tier mapping, then reviewed the auth-bound consent and concrete request guard.

On the integrated tree, fast-mode, compaction and job-service suites pass: 92 tests / 541 assertions. Isolated request-history gate passes too: 1 test / 1 assertion. `bun run check` and `git diff --check` pass. No live provider, full TUI or release claim. Direct Bun path worked despite the shell mise trust warning; no trust setting changed.

Code and wisdom are committed locally. No push, PR, install or release requested or performed. To use the fix in the product, publish/install an updated build in a new delivery task and run `/fast on` again to save auth-bound consent. Values reviewed and unchanged: the existing upgrade and authorization values cover the lesson.
