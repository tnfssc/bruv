# Unchanged official T3 2644: bounded revalidation

The official launcher now calls the actual exported harness functions and selects
its driver through replay config, not launcher-source slicing. See
[launcher boundary fix and v0.16.20 six-suite proof](../../official-proof-launcher-boundary.md).

This follows task561a43a1's exact result-boundary queue-race note. Official 2623 failed the first zero-model command idle gate; its waiter-recheck counterfactual was diagnostic only. **No instrumented binary or upstream source edit is used here.**

## Pins

- Release: `v0.0.46-nightly.20261004.2644`, published `2026-10-04T03:41:53Z`.
- Source: `737993303d36e10674c54b95e5bd3826682c99c7`; previous 2623: `fed41fa88bb27cb4325cb208d571393850bc63c2`.
- Supported artifact: `t3-0.0.46-nightly.20261004.2644-linux-x64.tar.gz`.
- Archive SHA256: `5f9e29cf2712c87736556c99ea580606b399897cb846c2401a434a0d05c4eeca`.
- Executable SHA256: `53fbd1c78ab3a01ea91913f65dc17b9d7824f00a81564e06992a73e183054e48`.
- Actual compiled b1649b54 connector: `fa50fecf8f9cf24c939206c269cb56c918d1c1b51f82b65f8f611846888dbdf6`. Copied byte-for-byte from the prior diagnostic harness's real connector, not a synthetic fixture. The local build attempt lacked worktree dependencies; it did not produce the tested executable.
- Existing normal worker: `5da33808892cf3c28ea9816a2e2271c183ddbcd792f7a2893483a40fcde13965`. Every gate records both hashes in invocation.json.
- Bun 1.4.2 for connector build/reproduction; TMPDIR=/var/tmp. Browser runners use /usr/bin/node. Scoped fixture temporary directories are nested under /var/tmp.

The API asset digest and separately downloaded official SHA256SUMS both match the archive. Old 2623 artifacts are untouched. Only Playwright helper modules are reused from its runtime directory; **2644 supplies its own executable, SDK and web assets**.

## Source/lock/patch/SDK

[source-comparison.json](source-comparison.json), [source-hashes.json](source-hashes.json), and [adapter-source.diff](adapter-source.diff) record the bounded comparison. There are 58 commits between the pins.

- Effect remains **4.0.0-rc.115**, with the exact same patch hash `0dfc4bb8ebd80fb3e06b91ef61346f5259517ab0f2437644fe95ae531084b1f5`. Patch bytes are identical; no waiter-recheck hunk was added.
- Claude Agent SDK remains **0.3.276**, with identical lockfile integrity and peer resolution (Anthropic SDK 0.93.0, MCP SDK 1.29.0, Zod 4.6.5). Its version is present in the shipped binary and child-history acceptance evidence.
- Other lockfile entries change. ClaudeAdapterV2 tracks/restores live permission mode, separates continuation query reuse, and marks open tools according to stopped/completed outcomes. Its changes do not supply the proposed queue correction.
- Upstream includes `6108ef3d` ("runs no longer get stuck"), changing EventSink/outbox, session-release record retries, turn-start/run-execution handling. Neither its title nor this replay proves it caused the acceptance improvement.
- [Shipped queue excerpt](shipped-queue-excerpt.txt) shows the original awaitTake: check Done, add taker, no buffered-message/offer recheck. The prior deterministic dependency race remains applicable. Native passes do not prove that latent race impossible.

## Gates and assessment

This table records the original five-suite historical proof. The current composed
release gate has six suites, adding default-controls. The later hosted v0.16.3
final-command failure and bounded harness correction are [documented separately](../../hosted-command-idle-convergence.md); its failed result is preserved in
[hosted-v0163-command-final](hosted-v0163-command-final/result.json), not relabeled as a pass.

| Gate | Evidence |
| --- | --- |
| Two zero-model /bruv status commands, native idle after each | [PASS](command/result.json), empty model-projection, idle screenshots |
| Actual local normal worker, pending followup, one completion wake, child/tool history, **same-root next reply and idle**, cancellation and Stop cleanup | [PASS](subagent/result.json), [idle evidence](subagent/idle-evidence.json) |
| Real permission allow/deny/Stop side effects, saved-question decline/Stop remains pending, same-owner reopen, answer/resume/used-once callback, zero-model command ownership | [PASS](human/result.json), [observations](human/human-observations.json) |
| Native app-owned normal provider worker, scoped worker restrictions, completion delivery and cancellation | [PASS](native-workers/result.json) |
| **Last unchanged official zero-model idle replay** | [PASS](command-final/result.json), both commands idle, zero model calls |

**2644 is a working official candidate for the previously blocked bounded gates**, not a proven Effect race fix. Do not recommend a mandatory local T3 patch based solely on 2623's failure now that 2644 passes these gates. Keep the independent Effect defect report/counterexample distinct from acceptance of this release. No broad matrix or architecture work was performed.

The human gate retains a separate defect: Stop cancels pending permission and prevents its side effect, but the cancelled approval card remains visible; explicit native Decline is required before continuation. No claim that this is fixed, that Live/devices/paid providers are accepted, or that full tab disconnect was tested. Unsupported connector-version/update banners also remain truthful visible gaps.

## Observed UI changes (harness only)

The first continuation replay stopped before the same-root gate because `dab26f582cf7826fec67fbed64b46f59f3421280` adds a second same-title **Finished notification card**. The original live card remains **Completed**. [Captured DOM](initialCardContract/completion-card-dom.json) records both; the strict replay now selects the live Completed card explicitly, without weakening reply/idle/ownership/token assertions. This release also renders the real local child tool result (the old proof retained that rendering gap).

The finalized shared harness fixes copied from task561a43a1 reuse the prepared first native draft, select its project on later New thread actions, handle already-complete onboarding, and ensure server cleanup even if capture fails. Native app-owned children now use titled Finished cards and parent Lineage/sidebar navigation instead of the old generic Open subagent thread/Open parent thread buttons. The replay checks the original parent URL on sidebar return. These selector/setup failures were not queue failures or accepted passes; their [initial-draft](nativeContractChanges/initial-draft-result.json), [completion-navigation](nativeContractChanges/finished-navigation-result.json), and [parent-navigation](nativeContractChanges/parent-navigation-result.json) failures are retained. No production connector/runtime or T3 source was edited.

## Reproduce in fresh isolated caches

fetch-official.mjs refuses existing destinations and pins archive/source/executable. run-trace.mjs rejects any other binary **before server launch**; rejection of unchanged older 2623 was tested. The base replay rehashes the executable after each run. No install, global change, release, unbundle or previous-artifact replacement occurs.

~~~sh
export TMPDIR=/var/tmp
BUN=/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun
P=wisdom/claude-compat/proof/official-2644
CACHE="$PWD/.cache/official-2644-replay-fresh"
/usr/bin/node "$P/fetch-official.mjs" "$CACHE" /home/tnfssc/Code/bruv/.cache/acp-t3-upstream-experience/runtime
/usr/bin/node "$P/compare-source.mjs" "$PWD/.cache/official-2644-source-fresh"

# Use the held real b1649b54 compiled connector, or rebuild that source in a
# workspace with its already-prepared development dependencies:
"$BUN" scripts/build-claude-compat.ts --outfile=.cache/real-connector-2644-replay
export BRUV_CONNECTOR_EXECUTABLE="$PWD/.cache/real-connector-2644-replay"
export T3_UPSTREAM="$CACHE"
# Set BRUV_RUNTIME_BINARY if the held normal worker is elsewhere.

TRACE_SUITE=command PROOF_OUTPUT="$PWD/.cache/2644-command-fresh" /usr/bin/node "$P/run-trace.mjs"
TRACE_SUITE=subagent PROOF_OUTPUT="$PWD/.cache/2644-root-fresh" /usr/bin/node "$P/run-trace.mjs"
TRACE_SUITE=human ACCEPT_HUMAN_CONTROLS=1 PROOF_OUTPUT="$PWD/.cache/2644-human-fresh" /usr/bin/node "$P/run-trace.mjs"
ACCEPT_APP_DELEGATION=1 PROOF_OUTPUT="$PWD/.cache/2644-native-fresh" /usr/bin/node scripts/claude-native-acceptance/run.mjs
TRACE_SUITE=command PROOF_OUTPUT="$PWD/.cache/2644-command-last-fresh" /usr/bin/node "$P/run-trace.mjs"

# Check this committed evidence (not arbitrary new output directories):
/usr/bin/node "$P/verify-proof.mjs"
~~~

Run sequentially; proof destinations must be new. FIXTURE_PORT can select a free loopback port if the human/native default is occupied. Real connector/worker environments use explicit isolated allowlists and deterministic loopback models, never inherited credentials. Private logs stay only in throwaway .cache and are not committed. Only needed projections, results and selected native frames are retained.
