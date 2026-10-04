# Archived rollback patch: assigned-range reduction audit

## Scope and method

Read **every assigned line, 8801–13028 inclusive (4,228 lines)** of `wisdom/experiments/t3/production-v2/archive/.agents/rollback/t3-v2-lifecycle/web--t3.patch`, in 46 bounded chunks. No assigned chunk was truncated. The first range begins inside PiRpcClient.ts; only its assigned tail is covered. Hunk headers and narrowly needed consumer/cleanup cross-references outside the assignment were searched/read but are **not** included in coverage or savings. This is **not a review of the whole 13,028-line patch**. Read wisdom/values.md first. No builds, tests, provider calls, production edits, or commits were performed. Upstream comparisons used read-only GitHub source requests, not provider APIs.

## P3-01 — Retire the historical rollback patch from the working tree, conditionally

**Recommendation:** after the parent joins all reviewers, consider deleting the *complete* archived patch, with its exact Git recovery reference retained. Do not delete just this range: that would corrupt a rollback asset. This is repository archive reduction, **not dead executable code removal**.

**Evidence:**
- Assigned patch lines 8801–9039 contain RPC parsing, request correlation/timeouts and process teardown; 9148–9542 contain session-file implementation/tests; 10895–11434 contain a complete historical text-generation implementation/tests. They are stored as patch records, not executable modules in this checkout.
- Current executable root: package.json scripts build/build:web; scripts/build.ts:6,32–46 selects the maintained web build and src/cli.ts. tsconfig.json:11 includes src, scripts, integrations/t3 and tests, not experiments.
- integrations/t3/build/build.ts:49–79,97–108 selects **integrations/t3/upstream/bruv.patch**, verifies the pinned checkout, and applies only that patch. Lines 116–149 typecheck/build/deploy/package that input. integrations/t3/build/verify-source.ts:10–29 verifies the exact HEAD-plus-selected-patch graph and rejects untracked source. scripts/packed-web.ts:39–53 fingerprints integrations/t3 and the selected source, not this archive.
- Actual test readers tests/no-web-voice.test.ts:7 and tests/packed-web.test.ts:61,124 use the maintained patch. Hidden-file-aware searches of current src/scripts/tests/integrations/.github and archive executable scripts found no reference to web--t3.patch or t3-v2-lifecycle. No automatic archive loading was found.
- Standalone archived scripts were checked too: archive/scripts/build-candidate.ts:8–17 and export-candidate.ts:8–11 select the different .agents/patches/t3-v2-production-candidate.patch. export-worktree.ts:5–12 selects an old canonical web source/export, not this rollback file. These scripts do not turn this particular rollback snapshot into a current build input.

**Counterevidence / recovery boundary:** the code was not originally unused. Historical Pi driver imports/calls makePiTextGeneration at patch:878,953; adapter/probe/RPC tests consume the old transport (search hits at 5093,7045,7789,8621). Those are limited consumer cross-references, not additional reviewed ranges. The archive name explicitly promises rollback, and a human can manually apply it even without a script reference. Removing the file loses convenient local reconstruction of that historical lifecycle implementation. It is tracked; git log identifies archive commit **380b09f**. Before deletion, verify exact bytes can be recovered with git show from a retained commit, preserve the matching source-pin/replay instructions, and decide whether offline/local rollback convenience is still required. Do not transfer this deletion to current implementations.

**Confidence:** high that the default current executable/build does not consume this rollback asset; medium that removing the archive is desirable without the owner's retention decision. An explicitly supplied external/custom build or manual git apply remains possible.

**Behavior lost:** none from the normal shipped build; immediate checked-out historical rollback/research reconstruction only. No runtime cancellation, authentication, file recovery, or resource bounds should be removed.

**Gross/net savings:** this reviewed contribution contains **3,617 code-bearing patch records**: 2,930 added, 239 removed, 448 context. Gross = net 3,617 repository code records if the complete archive is retired with Git-based recovery and no replacement code. **Executable LOC saved: 0.** These are physical patch records, including old/new versions, not unique source LOC. Excluded from savings: 346 blank/comment-only records and 265 diff metadata records; no unread range or prose is counted. Do not sum this contribution with whole-file estimates or P3-02. If retention wins, savings = 0.

**Checks needed:** parent must finish/join the other ranges; confirm no independent release/rollback workflow points to this asset; verify exact Git retrieval and source pin; repeat static reference/build-input checks after any coordinated removal. No live/provider gate is needed to establish archive non-consumption. Functional equivalence of current code was not tested here.

## P3-02 — Test-only resumed-file cleanup no-op (only if historical code is revived)

**Evidence:** patch:9534–9535 exports cleanupResumedPiSessionFile as Effect.void. Its only textual consumers in the historical patch are the test import at 9167 and call at 9196. The survival assertion is at 9197. Historical startup rollback already has the real owner: freshFile/lease-gated cleanup at patch:7011–7016, and freshFile-gated failure cleanup at 7132–7134. Neither calls this no-op.

**Simplification:** if this historical implementation is ever restored, omit the empty API and its test import/call. Keep the resumed-file survival assertion, the fresh-only ownership checks and all containment/header/permissions/interruption tests. Do not invent a resumed-file deleter or collapse fresh and resumed cleanup ownership.

**Counterevidence:** the name/test documents an important recovery promise; it is not an unsafe cleanup operation. Deleting it is optional, not grounds to delete validation or survival coverage. Current shipped Pi ownership differs, so this is not a requested current-source edit.

**Confidence / behavior lost:** high that this historical exported no-op has no production consumer in the patch; medium priority. Runtime behavior unchanged; the named no-op/testing affordance disappears.

**Gross/net savings:** four historical added code records (9534–9535,9167,9196), no replacement; **0 current executable LOC**. Fully overlaps P3-01, so combined incremental savings remain 3,617, not 3,621. Check historical adapter failure/resume tests if reviving the code; none were run here.

## Shipped comparison and keep decisions

Current source pin is **66a91077f9abf6e171aad0ceab2519d7272f3ff3** (integrations/t3/upstream/source.json). It was unavailable in local cached Git objects; read-only pinned upstream source was fetched for needed comparisons. No claim of complete upstream review follows.

| Reviewed patch lines | Decision / comparison |
|---|---|
| 8801–9147 RPC tail/schema | Correlation, timeout, bounded parsing and fail-all/close safeguards are meaningful. Historical callers exist. Current upstream provider/Layers/PiProvider.ts:30–37,136–143 and textGeneration/PiTextGeneration.ts:17,70–89 use orchestration-v2/Adapters/PiRpc.ts, not these provider/pi files. Do not carry a second transport forward. |
| 9148–9542 session file/tests | Keep private modes, exclusive creation, bounded header reads, containment, symlink rejection, exact cwd/id matching, and cleanup on interrupted allocation (9366–9522). Only the tiny P3-02 API is optional. |
| 9543–10128 startup/tests | Historical discovered Die defaults and bootstrap rewrite are superseded, not automatically equivalent: maintained overlay:6297–6379 uses BRUV_WEB_BRUV_BINARY, Pi default plus orchestrator option and bruvWebNoAuth. Retain the ordinary pairing-vs-local-no-auth distinction; no authentication cut proposed. |
| 10129–10595 PTY implementation/tests/selection | Maintained overlay:6380–6834 still owns Bun PTY and Node fallback selection. Added implementation lines in BunPtyAdapter.ts match the historical implementation exactly (comparison ignores diff headers); retain native process handles, exit callbacks and signal kill behavior. Historical tests include real native child cases, not provider tests; no tests executed. |
| 10596–10894 subscriber stream/tests; 11435–11474 WS | Maintained overlay:7008–7157 has identical added subscriber implementation lines, and :7201–7248 still wires terminal attach/events through it. Retain event/byte limits, explicit overflow failure and idempotent registration cleanup. Maintained tests also cover repeated listener lifecycles (:6984 onward). An ACK window is not a substitute for this upstream queue bound. |
| 10895–11434 text generation/tests | Historical driver consumer is real, but current upstream PiDriver.ts:20,142,191 owns a different PiTextGeneration. Upstream PiTextGeneration.ts:109–129 waits for settlement then asks get_last_assistant_text instead of maintaining local delta/completed-message buffers. The newer launch at :70–85 disables extensions/tools for background helpers; do not restore historical extension-capable behavior by deleting a safety boundary. No separate savings claimed for code already superseded. |
| 11475–11737 composer; 11910–12076 traits | Custom Die selector and generic instructionMode trait filtering are historical UI policy. Neither those fields nor these file hunks occur in the maintained overlay/pinned counterparts checked. This is already absent from shipped code, not an additional live reduction. Do not assume the modes or narrow-screen controls are unnecessary just because this snapshot is stale. |
| 11738–11909 timeline; 12439–12627 session logic/tests | Historical handoffText extraction, folding exceptions and dedicated prose row/tests are not present under those names in pinned counterparts or maintained overlay. Archive removal loses historical evidence of that presentation; it does not prove current handoff presentation equivalent. No current user-facing feature cut proposed. |
| 12077–12096,12197–12247,12414–12438,12778–12937 branding/contracts | Pi remains a real upstream integration. Current overlay:5965–6052 adapts the upstream Pi driver to the trusted Bruv executable; upstream settings.ts:830–861,1374,1548,1676 owns Pi settings. Do not remove Pi runtime/settings based on absence of old hunks. |
| 12097–12196 PR handoff cache; 12248–12413 highlighter cache | Historical bounds/tests are genuine resource work, but these added cache symbols are absent in the pinned files and maintained overlay checked. Only archive removal is counted; not a rationale for removing bounds from a live implementation. |
| 12628–12777 terminal client retry/tests | Historical retryTransportFailureAfter and terminal-specific 100 ms retry are absent in checked current upstream files and overlay. Server overflow bounds are still shipped. Client recovery equivalence is an untested gap, not a safe deletion claim. |
| 12938–13028 host runtime/tests | Maintained overlay:8186 onward has identical added helper/test lines. BUN_BE_BUN is intentionally removed for ordinary app children and enabled only for interpreter children; keep this separation and SEA-vs-Bun distinction. Historical consumer hits at 517,669,1025,8054,9012 refute calling these helpers unused. |

## Completion

All 4,228 assigned lines covered, including code, tests, diff context and metadata. Coverage ledger is an array of contiguous inclusive represented-file segments. Other patch reviewers own all remaining lines. Only the requested report and coverage ledger were written; wisdom/prose and production files were not edited.
