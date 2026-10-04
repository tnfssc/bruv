# Maintained production web patch — reviewer 1 reduction audit

## Completion and accounting

**Complete for the assigned inclusive range: integrations/t3/upstream/bruv.patch:1–2900 (2,900/2,900 lines).** Read sequentially in bounded numbered chunks, including additions, removals, context, diff headers and the partial final hunk. Read wisdom/values.md and artifacts/code-reduction-audit/web-report.md completely. The latter explicitly stopped at patch line 187; this report independently covers the larger assigned range, not the archived experiment patch.

The range contains **2,257 added source lines, 61 minus lines, 409 context lines and 173 metadata lines**. Savings below count maintained **added current source**, not minus lines, context, patch headers, generated bundles or another copy of the same source. Gross means owned current lines replaced/deleted; net subtracts replacements, including any new helper. Estimates are proposals, not measurements from an implemented change.

Behavior-preserving, within-assignment candidates below total approximately **64–80 net lines** (gross about 143). WP1-01 overlaps prior report web-04: do not add both. WP1-07 is a valuable cross-reviewer consolidation with **no assigned-range savings credit**; its whole-patch estimate is separate. No safe small feature cut with large savings was established. Do not manufacture one by removing native task inspection, worktrees, security negatives or delivery/cancellation machinery.

Only these report/coverage files were written. No production edits, build, test suite, provider or Live calls. Read-only source searches, Git object checks and HTTPS reads of pinned upstream source were used. No wisdom/values changes: this is a scoped read-only audit, not new product evidence.

## Build/source/caller evidence

- integrations/t3/README.md identifies upstream/bruv.patch as the sole maintained patch; wisdom/experiments/t3 is archival, not an alternate build pipeline.
- integrations/t3/upstream/source.json pins **66a91077f9abf6e171aad0ceab2519d7272f3ff3**. build/build.ts:49 onward resolves BRUV_T3_SOURCE or the revision-keyed cache, applies this patch and calls verifyWebSource. build/verify-source.ts compares the working tree against a disposable index containing pinned HEAD plus this patch and rejects untracked source. There is no evidenced extra source overlay that makes these additions disposable.
- Available .cache T3 checkouts had older HEADs and none contained this pinned commit object. They were not treated as current source. Pinned raw GitHub reads of apps/server/src/mcp/OrchestratorMcpService.ts and toolkits/orchestrator/handlers.ts returned HTTP 200; only relevant bounded sections were read. No checkout was modified or dependency installation attempted.
- Patch:2051,2059 wires BruvTaskService into the production MCP registration; :2608,2616–2644 and :2709,2726,2735–2799,2808–2812 expose its tools. Root src/t3/tasks/native-task.ts:123–162 calls launch/observe/cancel/list; :132–135 retries ambiguous launch with the same request identity, not caller cancellation. These are live architecture, not unreferenced experiment code.
- Reference-only reads outside 1–2900 are explicitly identified below. They are not exhaustive coverage claims for another reviewer's range.

## Ranked findings

### WP1-01 — Table-drive the loopback activation matrix (duplicate of web-04)

**Location:** patch:16–65; target **apps/server/src/auth/BruvWebAuth.test.ts**, new-file hunk @@ -0,0 +1,101 @@. All 50 lines are owned additions.

**Change:** replace six full config/expectation blocks with named cases plus one default config. Retain the positive loopback web case and each negative: not requested, desktop, wildcard listener, absent host, and Tailscale enabled on IPv6 loopback. Use it.each or a compact table loop with case names. This does not mean deleting any case.

**Evidence:** :18–63 repeats the same four fields. The independent exact-origin/rebinding tests at :67–106 exercise other gates and must remain. **Counterevidence:** this switch grants all administrative scopes (:174–179); negatives are meaningful security coverage. Do not merge them into one vague happy-path test or weaken the request validator.

**Confidence:** high. **Gross:** 50; **net:** 25–35. **Behavior lost:** none; test failures can become clearer when named separately. **Checks after implementation:** patched BruvWebAuth suite with all six cases still enumerated; EnvironmentAuth HTTP/WS negatives; packaged loopback HTTP/WS gate; canonical regeneration/source verification. No checks were run here.

### WP1-02 — Remove narrowly proven unused or redundant owned code

Each subitem is independently actionable; none removes a trust boundary.

| Exact patch location | Target source hunk | Evidence / proposed deletion | Gross / net |
|---|---|---|---|
| :1464 | apps/server/src/mcp/BruvTaskService.ts, new-file +1,606 | Remove the Ref import. The entire 606-line added module has no Ref use. Ref usage in other test/service files is unrelated. | 1 / 1 |
| :2535–2537 | apps/server/src/mcp/OrchestratorMcpService.ts, @@ -1939,6 +1957,9 @@ | Remove the comment, exported __testing object and its separator. Only the added export mentions __testing in the canonical patch; repository root tests/gates/upstream support searches found no stableCommandId/__testing consumer. Pinned upstream has an internal stableCommandId, not this test export. Keep the actual ID function and all production callers. | 3 / 3 |
| :606,610,612–614 | apps/server/src/mcp/BruvDelegationPolicy.ts, new-file +1,119 | Remove PROFILES and the startsWith fast-path; simplify the return to match ? (match[1] as BruvTaskProfile) : undefined. The anchored regex at :611 already requires the exact marker and accepts only fast/normal/orchestrator. | 5 / 4 |
| :1918 | apps/server/src/mcp/BruvTaskService.ts, new-file +1,606 | Delete only the second requestKey inequality. :1915 tests the identical operands before the worktree subexpression; any inequality already makes the whole OR true. Keep requestedBaseRef/requestedBranch/baseRef/branch equality checks and both pre-dispatch and post-dispatch validation phases. | 1 / 1 |
| :1387–1389 | apps/server/src/mcp/BruvTaskService.test.ts, new-file +1,716 | Delete the second branch regex expectation. :1381–1386 already requires kind=worktree and the same branch pattern in toEqual; [0-9a-f] and [a-f0-9] accept the same set. Keep preparation-once, moved-HEAD, sibling pin and uncertain-restart assertions. | 3 / 3 |

**Total gross 13, net 12. Confidence:** high within repository scope. **Counterevidence:** unpublished consumers of internal __testing exports cannot be absolutely excluded, but no public export/entrypoint or consumer is evidenced. Removing the regex prefix fast-path changes trivial regex execution cost, not accepted prompts. Do not extend this reasoning to deleting lineage checks, bounded output or strict wire validation. **Behavior lost:** unused test-export access only; none for evidenced product/test callers. **Checks:** typecheck/lint, profile-marker acceptance/rejection tests, stable replay after credential rotation, native-routing and worktree replay tests. Preserve actual stable IDs even if their unused test access object disappears.

### WP1-03 — One local owned-task predicate, not two independent filters

**Location:** patch:1582–1590 and :1980–1985; target **apps/server/src/mcp/BruvTaskService.ts**, new-file +1,606.

**Change sketch:** define a local predicate requiring app_owned origin, non-null childThreadId and a marked durable profile. Use it in both projection.subagents.find(task => task.id === taskId && isOwnedTask(task)) and projection.subagents.filter(isOwnedTask).

**Evidence:** ownedTask and list duplicate the same three semantic conditions, merely in different order. The first additionally selects the requested ID. Current ownedTask checks the child-null condition after find; the ID is authoritative and expected unique. **Counterevidence:** if malformed projections can contain duplicate IDs, moving the non-null check into find would select a later duplicate rather than reject the first. For strict preservation without relying on uniqueness, share only the origin/profile predicate, keep ownedTask's post-find child-null check, and retain list's additional child-null filter. This conservative version is the estimate below. It avoids making duplicate-ID recovery a new behavior.

**Confidence:** high for conservative shared origin/profile predicate; medium for the shorter all-three version pending uniqueness proof. **Gross:** 15; **net:** 3–4 conservatively (all-three variant ~6–8, not counted). **Behavior lost:** none with conservative variant. **Checks:** list/observe/cancel reject foreign-origin, unmarked and childless tasks; retain subtree-only cancellation and direct ownership lookup; compare pagination/output omission. Keep resultFor's durable-profile and child checks rather than shaving error handling at a trust boundary.

### WP1-04 — Share the five Bruv request-context lookups as an Effect value

**Location:** patch:2616–2645; target **apps/server/src/mcp/toolkits/orchestrator/handlers.ts**, @@ -6,6 +7,36 @@.

**Change:** a feature-local lazy Effect.gen yields McpInvocationContext and BruvTaskService and returns { scope, service }. Each of the five handlers flatMaps that effect to its existing service method. Observe still unwraps taskId; other input shapes stay unchanged. No generic tool factory or dynamic method indexing needed.

**Evidence:** five owned six-line blocks have identical context/service acquisition and differ only in arguments/method. Tools declare precisely these dependencies (:2726). **Counterevidence:** pinned upstream repeats the same style for generic orchestration handlers; those unchanged context blocks are not owned source savings. Do not memoize the resolved scope or create a context object once at layer construction: request auth must be read on each effect execution. A shared effect description is not a cached credential.

**Confidence:** high on behavior; medium-high on final formatting estimate. **Gross:** 30; **net:** 12–14 including ~6 helper lines and ~10–12 replacement handler lines. **Behavior lost:** none. **Checks:** typecheck each handler's inferred dependency/error/success shape, invoke two requests with different scopes, verify each dispatch reaches only its request's service/scope, run MCP toolkit integration and registration tests. No upstream handler savings credited.

### WP1-05 — Share just the repeated test layer-build/service extraction

**Location:** patch:869–872, :988–991, :1120–1123, :1191–1194, :1265–1268; target **apps/server/src/mcp/BruvTaskService.test.ts**, new-file +1,716.

**Change:** a small test-local effect-returning helper builds the existing layer with the provided services and default threadLaunchLayer, then extracts BruvTaskService. Five callers each replace their four-line build/get sequence with one helper call. Leave service mocks, projection maps and assertions local. Keep worktree custom ThreadLaunchService and restart constructions (:1351–1367,1424–1427) separate.

**Evidence:** the five sequences are identical. **Counterevidence:** a helper that runs Effect.runPromise itself changes scoped resource lifetime; do not use one. Nor should it hide the paused cancellation mock or convert integration evidence into pure mock tests. The mocks deliberately differ, and the worktree test has custom preparation ownership.

**Confidence:** high. **Gross:** 20; **net:** 8–10 after ~5–7 helper lines plus five calls. **Behavior lost:** none. **Checks:** all BruvTaskService cases, particularly Deferred cancellation race, cross-thread local injection and restart uncertainty; ensure helper's Scope requirement remains in the calling effect rather than closing a temporary scope early.

### WP1-06 — Optional tiny shared tool configuration, not a toolkit factory

**Location:** patch:2740–2742, :2753–2755, :2766–2768, :2780–2782, :2792–2794; target **apps/server/src/mcp/toolkits/orchestrator/tools.ts**, @@ -42,6 +53,72 @@.

**Change:** one const containing failure: OrchestratorMcpFailure, failureMode: "return" as const and dependencies: bruvTaskDependencies; spread it into the five Tool.make calls. Keep each parameters/success schema, description and annotation explicit.

**Evidence:** these fifteen added lines are identical, and their values are static. **Counterevidence:** generic Tool.make inference must not widen failureMode or dependency types. This is small; if normal formatting/type annotations erase the net saving, leave it alone. Do not attempt to unify task and local-job success schemas or annotate launch as idempotent just because internal request replay exists.

**Confidence:** medium-high pending typecheck. **Gross:** 15; **net:** 4–5. **Behavior lost:** none. **Checks:** generated tool JSON schemas, failureMode and declared dependencies; toolkit list and handler integration. Schema test :2692–2697 currently names only four launch properties although the actual maintained schema adds title/workspace (reference :8046–8063); resolve that pre-existing assertion mismatch without dropping schema coverage. It is not savings credit.

### WP1-07 — Cross-range priority: tests exercise a duplicate lineage walk, not the production one

**Assigned location:** patch:617–651, target **apps/server/src/mcp/BruvDelegationPolicy.ts**, new-file +1,119; tests :517–583 in **BruvDelegationPolicy.test.ts**, new-file +1,107.

**Reference-only duplicate:** patch:5666–5711, target **apps/server/src/orchestration-v2/ProviderSessionManager.ts**, @@ -430,9 +435,71 @@; import :5641. Read those reference lines plus nearby trusted-provider/capability issuance (:5662–5665,5712–5769). Coordinate with that range's reviewer before counting or changing it.

**Evidence:** the exported async deriveBruvDelegationPolicy is used by its tests, but not by the production issuer. The issuer independently repeats trusted-mode/root handling, parent walk, relationship check, seen-ID cycle fence, app-owned marked edge selection, all four terminal states, disposed delivery fence, nearest profile and depth accumulation. Production imports only profileFromMarkedPrompt. The same authority rule thus has two implementations, with unit tests targeting the nonproduction copy.

**Preferred reduction:** make one **Effect-native** derivation accept the projection-loader effect (preserving its error/environment requirements), have the issuer call it, and adapt the existing unit tests to execute that shared effect. Keep the issuer's catch/log/undefined fail-closed handling and exact capability/policy equality before credential reuse. Never bridge the async helper by nested unscoped Effect.runPromise in production: that risks cancellation/context/error semantics and adds a second runtime boundary.

**Counterevidence:** the duplicate is async/Promise code while production is Effect code; text deduplication is not automatically behavior preserving. Terminal or disposed lineage must revoke delegation while retaining separate tools, not fall through to ordinary registry capabilities. Pure helper tests do not replace the actual credential-issuance/reopen integration test at reference :5481–5631.

**Confidence:** high duplication/caller evidence; medium on refactor until Effect typing and cancellation checks. **Gross:** 35 assigned helper lines + ~38 owned duplicate-walk lines outside assignment. **Whole-patch net:** approximately 20–30, after one shared Effect implementation, caller and test adapters. **Assigned-only net:** roughly **-5 to -12** (conversion/test-adapter cost), so **zero positive credit in this report's total**. Do not simply delete the helper and its tests and claim 102 savings: that loses boundary coverage and leaves the duplication's untested production owner intact. WP1-02's profile parser simplification remains independent.

**Behavior lost:** none if consolidated correctly; unused duplicate algorithm disappears. **Checks:** unit root/trusted/untrusted/forged-marker/depth/cycle/terminal/disposed cases on the shared implementation; production credential reopen/rotation with cancelled, terminal and disposed ancestors; denied fast/normal nesting; interruption during projection loads must not mint a permissive token. Keep disposed wake semantics and ancestor authority before child interruption.

## Complete hunk-by-hunk disposition

Locations below are inclusive patch ranges, not target-file line numbers. KEEP means no additional supported reduction beyond named findings; it does not claim the whole unassigned source file was reviewed.

| Patch range | Target source path | Verdict / retained evidence |
|---|---|---|
| 1–107 | apps/server/src/auth/BruvWebAuth.test.ts | WP1-01; retain exact-origin, no-metadata local client, scope and rebinding negatives. |
| 108–179 | apps/server/src/auth/BruvWebAuth.ts | KEEP: explicit bind/mode/Tailscale gate plus exact Origin/fetch-site authorization. Full admin principal makes these essential. |
| 180–234 | apps/server/src/auth/EnvironmentAuth.test.ts | KEEP: integration HTTP/WS, external origin and ordinary missing credential behavior; not equivalent to validator-only tests. |
| 235–307 | apps/server/src/auth/EnvironmentAuth.ts | KEEP: renamed credential path plus no-auth wrapper and WS fast-path. Config recheck is intentional defense at an administrative auth boundary, not removable repeated config validation. |
| 308–347 | apps/server/src/bootstrap.ts | KEEP: four Number→Finite substitutions are type/schema adaptation, not an extra implementation to cut. Minus lines are not current source. |
| 348–407 | apps/server/src/cli/config.test.ts | KEEP: seven added false expectations preserve exact config contract across distinct modes/precedence cases. Rest is context. |
| 408–457 | apps/server/src/cli/config.ts | KEEP: trusted executable env, loopback default, computed flag. The two trimmed env checks could use a local boolean, but extra declaration makes line saving negligible; no credit. |
| 458–470 | apps/server/src/config.ts | KEEP: optional internal flag/comment, needed by auth and test configuration. |
| 471–583 | apps/server/src/mcp/BruvDelegationPolicy.test.ts | KEEP all model/thinking and trusted lineage/cancellation assertions; WP1-07 must retarget, not discard tests. Temp-dir fixture cleanup is missing, not deletion evidence. |
| 584–708 | apps/server/src/mcp/BruvDelegationPolicy.ts | WP1-02, WP1-07. KEEP trusted profile file/model/thinking validation and inheritance; user/provider policy is not duplicated arbitrary parsing. |
| 709–1430 | apps/server/src/mcp/BruvTaskService.test.ts | WP1-02, WP1-05. KEEP asynchronous no-ACK result, subtree/sibling isolation, request conflict/depth/profile/timeout negatives, paused-launch fence, local wake ownership, worktree pin/preparation/restart scenarios. |
| 1431–2042 | apps/server/src/mcp/BruvTaskService.ts | WP1-02, WP1-03. KEEP argv-only Git OID pinning; strict scope; bounded result output; child progress vs own run distinction; durable local wake ownership/stable IDs; pre/post-dispatch replay consistency; setup-once uncertainty; subtree cancellation. workspaceResult is called twice at :1679–1681; a local result avoids repeat work but yields ~0–1 net lines, not a material deletion. |
| 2043–2062 | apps/server/src/mcp/McpHttpServer.ts | KEEP: added import/layer is production reachability, not an unused alternate entry. |
| 2063–2093 | apps/server/src/mcp/McpInvocationContext.ts | KEEP capability and trusted role/depth. Replacing repeated literal profile union with imported BruvTaskProfile improves ownership but saves no net lines here. |
| 2094–2126 | apps/server/src/mcp/McpSessionRegistry.test.ts | KEEP least-privilege credential issuance test and separate preview/worktree access. |
| 2127–2176 | apps/server/src/mcp/McpSessionRegistry.ts | KEEP restricted-vs-baseline capability distinction and trusted policy propagation. Ref formatting expansion is cosmetic, not a second registry implementation. |
| 2177–2378 | apps/server/src/mcp/OrchestratorMcpService.test.ts | KEEP durable cancel with no active run, persist-before-interrupt-failure, command order and terminal async no-ACK/replay tests. Context/minus test fixtures are not owned savings. |
| 2379–2540 | apps/server/src/mcp/OrchestratorMcpService.ts | WP1-02 export only. KEEP thread-scoped stable IDs across credential rotation, workspace propagation, async launch no-ACK, authoritative cancel before interrupt. |
| 2541–2602 | apps/server/src/mcp/OrchestratorMcpToolkit.integration.test.ts | KEEP dependency stub and updated cancelled-state assertions. Stub exists for the real registration dependency, not because it is dead production code. |
| 2603–2648 | apps/server/src/mcp/toolkits/orchestrator/handlers.ts | WP1-04; upstream orchestration context after :2646 is not owned saving. |
| 2649–2703 | apps/server/src/mcp/toolkits/orchestrator/tools.test.ts | KEEP new contract publication assertions; type-format expansion is not removable behavior. Address actual schema keys when implementing WP1-06. |
| 2704–2815 | apps/server/src/mcp/toolkits/orchestrator/tools.ts | WP1-06; KEEP distinct tools, schemas, metadata and registration. Observe/list have actual adapter callers. |
| 2816–2845 | apps/server/src/mcp/toolkits/worktree/registration.test.ts | KEEP ThreadLaunchService stub/provision needed by production MCP layer. Sharing the two six-line stubs across separate tests would need a helper/import and saves little; no asserted gain. |
| 2846–2900 | apps/server/src/orchestration-v2/Adapters/PiAdapterV2.test.ts | KEEP reviewed /mode-before-user assertions and start of shell-vs-agent ownership test. Assignment stops mid fake.emit at :2900; no verdict on the rest of this hunk/test. |

## Reductions explicitly rejected / boundaries

- **Do not delete a “redundant” completion-disposal path in OrchestratorMcpService.** Minus lines :2496–2503 remove the old nonterminal post-interrupt disposal call; these are already absent. Pinned upstream :1490–1518 still defines disposeCompletionDelivery and invokes it for already-terminal tasks, outside changed hunk context. It remains live. Authoritative cancellation's second interrupt dispatch is not duplicate authority; one persists the fence, one signals the active child.
- **Do not delete either launch argument validation phase** (:1825–1844 versus :1911–1927). They bracket an external/durable dispatch and resolve concurrent/lost-response replay, including immutable worktree OIDs. Only the repeated requestKey comparison inside the second phase is redundant.
- **Do not replace local notify durability with ephemeral event delivery.** :1691–1724 binds the shell node/run/provider thread; :1730–1736 uses stable notification ownership; :1778–1784 distinguishes committed from disposed. Auth credential IDs are intentionally not runtime session IDs.
- **Do not remove native observe/list as a feature cut.** They are used by the root adapter and job surface. Read-only state does not ACK result delivery. Launch :2450–2451 explicitly avoids consuming terminal results.
- **Do not drop worktree setup uncertainty or preserveWorkspaceOnCancel.** Tests at :1421–1427 show the reason: a fresh process cannot rerun ambiguous external setup safely. Branch/OID pinning, workspace retention and cancellation fences are not speculative fallbacks.
- **Do not delete rolePrompt solely because instructionMode also exists.** /mode selects a provider instruction mode; marked delegated text supplies task-role context and durable lineage marker. Different layers, not proven redundant behavior. A deliberate prompt cut would change model behavior for only ~7–9 lines, not a large safe reduction.
- **No large safe feature cut found.** Keeping unsupported timeout rejection is small, clear and contract-significant; silently ignoring it changes launch semantics. Removing the deadline field/rejection across schemas/adapters is a user-facing contract cut with modest savings, not dead code. No such cut is included.

## Evidence limits and next checks

All assigned lines read; none skipped. The final assigned source hunk is partial by design. Other patch ranges were consulted only for specific ownership/duplication/schema evidence; this report does not close their coverage. Read-only static checks establish unused import, duplicate predicates/branches, test assertions and production wiring, not executed behavior. Focused checks listed per finding require implementation in a disposable pinned checkout, regeneration via the maintained exporter, source verification and normal gates. No passing-test/build/provider claim is made.
