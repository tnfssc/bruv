# Whole-input sentence review

Closed on 2026-10-10 for PR #71, starting from `8b992f3d97518221404348838f7d41798d9eb9d8`. No delegation. This continues the earlier PR work; it does not treat earlier pass counts as proof.

The user asked for every owned sentence sent to a model: short words, short sentences, values over rules, exact facts kept. I read the prompting wisdom and values first, followed the actual emitters, reviewed prose and short labels, made edits, then read the resulting sources and complete request frames again. The final pass found no further owned source, voice, repetition or meaning issue within the recorded scope.

## Inventory

- [Sentence ledger](./sentence-review.jsonl): 2,932 source literals and 133 nonempty prompt-asset lines. Every row has `keep`, `rewrite` or `exclude` and a reason. `text` is the final source text; changed rows include `before`. `sentences` lists the reviewed units. The row's decision and reason apply to each unit, including short fragments. A removed line has empty final text and its original in `before`.
- [Short-label ledger](./sentence-review-atoms.jsonl): 768 distinct one-word labels/tokens at 5,929 locations. These keep exact spelling and case. They include API fields and states, not just prose. No short sentence was skipped for being short.
- [Source registry](./sentence-review-sources.jsonl): 380 tracked files in `src`, `native`, `patches` and `scripts`, with source hashes and either literal IDs or an exclusion reason. Excluded paths are recorded, not silently dropped.
- [Current request map](./system-instructions.md): entry points, assembly order, conditional messages, dynamic data and external ownership.

The ledger is a review snapshot, not a generator, runtime filter or permanent test oracle. Source paths/lines locate the reviewed occurrence. Nested templates may have their own rows; this is not a count of unique facts. Sentence boundaries are reading aids; API/code text stays whole in `text`. The numbers show what was accounted for, not whether it is good writing.

User text, third-party help, provider output, shell/file data and recorded history remain intact. Their source paths and routes are named in the map. Test and study user/assistant stimuli stay data. Paid study directions and mock-result labels were reviewed as authored model input.

## What changed and why

Errors and notices now state the failed condition and useful next step without formal runtime jargon. Exact API names, supported providers, limits, permission checks, hidden-context protection and loss warnings remain. A TypeScript AST comparison found no change outside literal text and formatting in the reviewed production/study files.

The reread caught several things a prompt-file-only review misses:

- `/remote` reports enter model history through `pi.sendMessage`. Menu-only labels are excluded; published reports and caught errors are included.
- `remote.status()` reads saved backend state. The help now says so. A command failure or unknown delivery is no proof of an answer or finished stop. A revoke notice is not a confirmed remote-state change.
- Voice handoff now names the actual tool, `execute`. It retains the complete snapshot lookup, missing-entry warning, user-selected export path and branch boundary.
- Paid Live studies contain their own instructions and mock-result wrappers. These were shortened too. Recorded requests, prior replies and multilingual stimuli were preserved.
- Tool help had a redundant code example and UI expansion advice. Shared values and wisdom repeated points already present in the same request. Those repeats are gone.

A condition-specific failure can repeat a field name or state from tool help: it reports what happened on this call. That is different from sending the same instruction manual twice. Separate GPT Live speech requests still need their own delegation and stop facts.

## Complete requests read

Read root and fast/normal/orchestrator child frames, paused-goal injection, custom-base and append behavior, first and later turns, execute/external-tool results, saved human answers, remote completion and human `/remote status` history. Read native context plus the SDK-built provider payload, including external schema help. Read Codex and Anthropic plaintext compaction payloads and the tool-free auxiliary JSON request. Traced direct Live, GPT Live, native compaction and handoff assembly against the same owned assets and their distinct wrappers.

The captures preserve external sentinels and repeated user append text. One execute declaration carries the manual. Bare SDK fixtures also retain upstream documentation and built-in tools on purpose; they test coexistence and are not the ordinary Bruv loadout. No external prose was normalized to force a clean count. The existing upstream Anthropic converter still drops root schema description/title and constraints while keeping nested schema prose. Bruv registration preserves the source schema. This review does not claim every provider transmits every external schema field; see [the prior finding](./all-instruction-surfaces.md#proof-and-limits).

## Checks and limits

`bun run check`, `bun run build`, `bun run lint` and `bun run format:check` pass. `git diff --check` passes. Tests were run one file per Bun process with a short temporary path outside any Git repository, avoiding shared SDK state and Unix socket path limits.

The broad run covered 362 test files. Twelve files initially failed on old text assertions; those assertions were updated without dropping behavior checks. The affected/probe rerun passed all 32 files. Compaction and native-runtime captures were rerun after adding optional capture output and passed too. All three opt-in compiled connector cases passed with the built binary pair and a loopback fake provider. That run exposed stale preflight text checks and an older auxiliary-prompt matcher in the mock provider; both were updated. The compiled cases cover real child execution, auxiliary JSON and preflight rejection without paid provider calls.

One existing failure remains: `tests/live/live-paired-runtime.test.ts`, test `paired Pi wakes its canonical backend on an async job completion without a synthetic user turn`. It sees `Job launched, waiting. Task complete: PAIRED_ASYNC_DONE` but never receives `Async completion inspected by paired coder.` It fails on both this tree and an isolated archive of unchanged `8b992f3d` with the same installed dependencies/runtime assets. This is an async follow-up behavior failure, not a wording mismatch. It was not hidden, relaxed or fixed as part of prose work.

Paid model/device/remote integration checks remain opt-in and were not run. Offline captures prove what is sent; they do not prove a model will obey it. Study instruction hashes changed, so old paid trial outcomes do not validate the new wording.

## Lesson saved

Trace the sender and the next request, not the filename or UI label. Human-visible output may also be model history. Read composed text: a short replacement can still overclaim evidence, and removing an example can leave broken punctuation. Keep one home for general facts and retain call-specific evidence.

No new project value was needed. The existing [writing value](../values.md) and [value-based prompting guidance](./writing-without-clutter.md#value-based-prompting) already cover plain words, facts and judgment. The new evidence belongs with these prompt sources and the inventory.
