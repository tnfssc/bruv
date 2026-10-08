# Native transcript pricing — 2026-10-08

## Scope and provenance

Independent worktree: /home/tnfssc/.bruv/worktrees/t3-e6f23453-5442693331ce-task_b1f45946
Branch: bruv/pass-native-transcript-costs-to-t3-b1f45946
Parent baseline: a3fa7d98331762daf17ab09659bed8ad750f11ec (v0.16.17).
Task: task_b1f45946. Code, focused offline tests and this note are committed together; no release/install or T3 fork changes.

Read [values](../values.md), [native history](native-history.md) and [earlier cost-unavailable diagnosis](../native/native-cost-unavailable-v055.md). Values unchanged: this applies the existing truthful-accounting, immutable-history and independent-proof principles, not a new repeated lesson.

## Observed seam and fix

Official T3 v0.0.46-nightly.20261005.2702 usage parser requires message.usage before it considers assistant records; it reads top-level costUSD into reportedCostUsd. Its exact rate lookup does not map prefixed Pi IDs such as openai-codex/gpt-6-astra, gpt-6.1-sol or gpt-6-luna. The root appendMessage hook dropped both usage and cost. Child translation kept usage but the durable writer dropped cost.

Root and child writes now supply the actual assistant Pi usage.cost.total as costUSD, plus the existing Claude-shaped token fields (new for root). Model IDs remain the exact provider/id. No renamed models, T3 rates, settings overrides, fabricated prices, token re-estimates, history rewriting or provider requests. User/tool-result entries remain unpriced.

NativeHistory validates supplied costs and persists them on assistant entries. Its bounded identity index carries the recorded cost across reopen, so priced replays cannot change or erase it. Old cost-absent replays stay single-write and immutable; they are not backfilled. Parent identities, UUIDs, causal chains, fork provenance and import authority are unchanged. The actual SDK fork preserves the additive costUSD field.

## Catalog semantics and limits

Pi 1.0.3 Usage.cost is numeric with no independent availability flag. calculateCost computes its total from the selected model's catalog rates (including tiers); it is not necessarily a bill or subscription charge. T3 calls this path providerReported; that is T3's label, not a claim of invoice verification. Built-in catalogs carry rates, while provider-composer also defaults a custom definition lacking cost to all-zero rates. Consequently a finite Pi zero alone cannot distinguish an explicitly free/zero-priced model from an omitted custom-model price. This patch preserves explicit finite zero totals and does not invent a missing total, strip provider prefixes, or decide availability by total truthiness. Missing, null, non-finite or negative totals are omitted and remain Unpriced without a rate mapping. It cannot repair upstream Pi default-zero ambiguity; supplying accurate custom catalog pricing is still the catalog owner's responsibility. The three requested IDs are not present in this pinned built-in catalog; tests use offline assistant fixtures with their exact IDs and real supplied usage totals.

Imported historical context retains its existing synthetic Pi cost behavior; this change only records new actual assistant append events. Existing local journals are untouched. T3 supports exact-model custom prices for those old records. No override has been saved. No live paid-provider or rendered usage-page acceptance is claimed.

## Proof

Unmodified official parser/pricer sources supplied read-only in /home/tnfssc/.bruv/cache are byte-identical test fixtures; [fixture provenance and hashes](../../tests/claude-compat/fixtures/t3-usage/README.md). Tests parse actual written JSONL with mightCarryUsage + parseClaudeLine and priceUsage with an empty rate table. Exact named models, all four token fields, nonzero totals and known zero price successfully. Unknown totals stay omitted/unpriced. Child replay/reopen rejects changed cost and adds no duplicate; legacy replay remains byte-identical.

- bun test tests/claude-compat-runtime.test.ts tests/claude-compat-transcript-usage.test.ts: 4 top-level passes (the runtime wrapper runs its full isolated offline connector suite), zero failures.
- BRUV_REQUIRE_CLAUDE_SDK=1 BRUV_CLAUDE_SDK_PATH=/home/tnfssc/Code/bruv/.cache/claude-compat-boundary/package/sdk.mjs bun test tests/claude-compat-history.test.ts tests/claude-compat-transcript-usage.test.ts tests/claude-compat-task-child-journal.test.ts tests/claude-compat-task-projection.test.ts tests/claude-compat-task-binding.test.ts: 32 passes, zero failures/skips. Real SDK 0.3.276 fork/import/reopen and pending-tool safety included; no model calls.
- bun run check: passes after local dependency repair.

Initial worktree setup/check hit Unsupported Pi host file for agent-session.js; normal reinstall reused the same contaminated cache. Reinstalling this worktree's dependencies with a private ignored .cache/usage-dependency-cache and --force restored the pinned bytes, allowing normal prepare:assets and typecheck. No checksum guard was weakened, shared cache changed, installed settings edited or production artifact replaced.

## Existing rows and parent integration

The running T3 reports v0.0.46-nightly.20261005.2702. Its LiteLLM cache contains the bare-model rates below but no openai-codex-qualified keys. Parent independently fetched that exact tag's parser/pricer and checked all three prefixed fixtures: each is Unpriced without costUSD and providerReported with a recorded cost. The worker used those unchanged sources as test fixtures. Upstream MIT terms are kept with the fixtures.

For old rows, add these exact IDs in T3 Usage custom prices. USD per million tokens:

| Model | Input | Output | Cache read | Cache write |
| --- | ---: | ---: | ---: | ---: |
| openai-codex/gpt-6-astra | 10 | 50 | 1 | 12.5 |
| openai-codex/gpt-6.1-sol | 2 | 10 | 0.1 | 2.5 |
| openai-codex/gpt-6-luna | 0.1 | 0.5 | 0.01 | 0.125 |

These are list-price estimates, not a Codex subscription bill. Exact-model overrides take precedence over recorded costs and stay fixed until changed. Do not globally strip provider prefixes; different providers can have different rates.

Browser tools are off for this thread. A separate shell Playwright browser loaded Usage, but could not connect to the environment. A direct WebSocket diagnostic returned 401 EnvironmentAuthInvalidError, missing_credential. No private session credential was reused; no T3 settings were changed. Live page acceptance remains open.

Parent integrated worker commit 5ab870c24676c6756c08a038f7254e41fa24c8e6 as d89597be on t3/fix-t3code-model-pricing. Review task_28727763 found no confirmed bugs. Parent then added a stable assistant message.id from the existing native UUID. T3 uses message.id for cross-file dedupe; pricing newly visible root records without it could double-count copied fork history. Runtime tests now check the official parsed dedupe key. This is accounting identity, not a fabricated provider request ID.

Parent's first runtime test attempt failed on missing generated runtime assets; prepare:assets found the same stale-cache Pi digest mismatch as the worker. Parent restored frozen dependencies with a private .cache/usage-dependency-cache, keeping the digest guard intact. Parent integration checks passed: bun test tests/claude-compat-runtime.test.ts tests/claude-compat-transcript-usage.test.ts (4 top-level passes, including the full isolated runtime suite), bun run check, targeted Biome format and git diff --check. The initial setup failure was resolved by the pinned private-cache reinstall, not by changing host adaptations. No release, installation, T3 restart or paid provider call. Values unchanged: the existing truthful-accounting, exact-identity and real-path proof values already cover the lesson.

Delivery: commits on t3/fix-t3code-model-pricing are ready for a PR against develop. No installed behavior changes until a later release or install. Existing rows still need user-saved custom prices; the separate headless browser had no authenticated connection. Do not call the current page fixed from these source/offline checks.
