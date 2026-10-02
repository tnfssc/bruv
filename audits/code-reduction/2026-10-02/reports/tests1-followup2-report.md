# tests1 follow-up 2 — code reduction audit (FULL assigned coverage)

## Scope and proof

Read **6/6 files, every assigned line: 3,207/3,207**. Manifest endpoints match actual lengths. This completes only this follow-up manifest, not all original tests1 gaps. Numbered chunks were capped at 3,300 characters; reconstructed assigned output chunks were verified below 4KB (maximum 3344 bytes). No truncated assigned chunk was accepted. The initial truncated values preview was reread in bounded chunks. Read all wisdom/values.md and tests1-report.md; inspected the concurrent values addition via diff too.

Read-only source audit: no source edits, builds, tests, provider requests, Live/audio operations, fixture execution or commits. Only these two requested audit artifacts were written. Existing unrelated work, including concurrently added audits/ and a values change, was left untouched. Estimates are removed physical source lines (gross), less replacement/helper lines (net), not measured patches. No wisdom/prose savings.

**No entire assigned file or production subsystem is proven dead.** Non-overlapping behavior-preserving proposals below total **gross 290; net 138–180 lines**. Optional diagnostic cut 05 adds 42 lines only after explicit choice. Reconcile the common SDK helper cost with original tests1-01 rather than counting it twice.

## Discovery, shipped paths and dynamic fixtures

- package.json:13–16 builds before root discovery with bun test ./tests. test:llm selects only llm.test.ts, not the paid TUI test here. bunfig.toml:1–2 preloads tests/setup.ts:1–4, scrubbing Herdr pane identity. scripts/ci.sh:57 and .github/workflows/release.yml:166–167 run root tests with BRUV_RUN_LLM_TESTS=0. Missing imports are not non-discovery.
- scripts/build.ts:44–50 compiles src/cli.ts. src/cli.ts:149–175 dynamically dispatches remote owner/root-owner entry modules. src/remote/entry.ts:1,49 reaches runOwnerTask; root-entry.ts:1–3 exposes runRootOwner. Both implementations ship, not merely test-used alternatives.
- remote-owner.test.ts:24 skips outside Linux; :33–36 imports owner with a fixture-specific query because src/remote/owner.ts:28 captures HOME during module evaluation. Generated RPC scripts (:98–106,174–187,254–264,344–364,393–406) are passed to runOwnerTask. Generated runner.ts (:481–496) imports the owner URL into an independent process; :502–542 tests its PID/lock race. These are real dynamic consumers. The implementation ownership fence is src/remote/owner.ts:509–523.
- goals-sdk.test.ts uses real SDK sessions, disk managers, explicit extensionFactories (:78–104,203–277,406–442,548–574), and a compiled dist/bruv path. Streams are offline, but context assembly and shell completion are actual integration boundaries. :484–514 tests missing auth without stubbing success; :516–608 intercepts the real provider boundary. tests/live-dispatch-budget.ts:58–76 disables retries and counts real dispatch; retain it and restoration.
- src/agent/extension.ts:31,662 wires execute. src/typescript/extension.ts:113–147 supplies the per-invocation jobHandler to executeIsolated with session/stop fencing. Subagent test spies capture that real wrapper, not a replacement TaskManager.
- src/live/extension.ts:434–454 constructs GptLiveDelegationBridge for the OpenAI Live model and dispatches retained speech through owner.delegate. Standalone bridge tests cover an active shipping implementation. No Live system was started.
- background-ux-tui.test.ts:8,110 intentionally gates a natural paid real-TUI scenario with BRUV_RUN_LLM_TESTS=1. :139–164 generates a slow shell and launches dist/bruv through tmux with a real model. tests/helpers.ts:10–25 scrubs Herdr and captures subprocess results. tests/turn-boundaries.ts:1–21 checks the all-results-yield batch rule. Default CI skip does not prove obsolescence.

## Findings

### tests1-f2-01 — Share repeated execute/RPC capture mechanics

**Behavior-preserving; high confidence duplication, medium-high refactor confidence. Gross 128; net 88–100 lines.**

Evidence: subagent-extension.test.ts:194–207,211–214,231; :239–252,254–257,274; :281–294,296–299,311; :372–385,387–390,408; :528–541,543–546,577; :666–679,682–683,706; :714–727,740,746. Seven spies capture options.jobHandler, return the same empty execution result, bind execute, then restore. A file-local async helper can perform precisely that with try/finally and return the captured handler. Call at the original bind boundary, passing the original context or cwd-only context explicitly. Restore before real shell launch.

Counterevidence: RPC, print/json waiting, attention/coalescing, shutdown persistence and delegated cancellation are different scenarios. Keep mode/signal/clock setup and all assertions. controlledChildren (:319–341), attentionClockFixture (:343–366), two-session SSH ownership (:751–815), and the outer-execute-error spy (:828–841) have different jobs. Never absorb that failure spy into an always-success helper. Preserve shutdown and restoration on bind failure; no persistent process-wide fixture state.

Behavior lost: none intended. Future checks: offline subagent-extension test, then related execution/handoff tests together; capture restoration on failure, actual shell admission, one wakeup, bounded mixed evidence, persisted ownership and unconfirmed-cancellation denial. No such tests ran here.

### tests1-f2-02 — Extend the original offline SDK setup proposal

**Behavior-preserving; high confidence duplication, medium estimate. Gross 102; net 22–42 lines if self-contained.**

Evidence: goals-sdk.test.ts runtime creation/auth stub at :33–39,139–145,332–338,523–527 plus531–532; resource/default session mechanics at :79–86,94–104,219–225,267–277,407–413,432–442,549–555,563–574. Share isolated runtime and no-discovery SDK session construction, accepting existing runtime, disk manager, factories, model and explicit settings. Keep factory callback bodies and assertions inline. This extends tests1-01 to a previously unread file, not a new generic fake-provider framework. Estimate includes roughly 60–80 replacement/helper lines. Reconcile helper cost with tests1-01 at integration.

Counterevidence: first test alone supplies bruvSystemPrompt (:86); waiting has observe/release/context-filter callbacks (:228–263); print cycles bind print mode (:443); interception requires transport=sse and medium thinking (:571–572). Missing-auth (:484–514) must NEVER use successful offline auth. Provider interception/restoration (:528–543,603–605) must stay visible and ordered. Preserve gated-shell failure release (:320–323), not generic disposal alone.

Behavior lost: none. Future checks: full offline goals-sdk and existing tests1-01 consumers, independently and together, with the compiled fixture supplied by a separately authorized build. Verify isolated auth, no credential refresh/network, four conditional contexts, factory order, waiting→active→completed persistence, bounded print cycles, zero missing-auth dispatch and exactly one intercepted dispatch. Do not redirect paid real-auth acceptance into the helper.

### tests1-f2-03 — One file-local scripted completion constructor

**Behavior-preserving; high confidence duplication, medium refactor confidence. Gross 50; net 18–28 lines.**

Evidence: goals-sdk.test.ts:58–73,154,184–199,387–403 repeats AssistantMessage fields, usage/timestamp, event-stream construction, and queueMicrotask(done then end). A small local helper taking model, content and explicit stopReason can replace the three copies. Keep context capture, counters, script selection and tool arguments at their sites. Does not overlap 02.

Counterevidence: stopReason depends respectively on script index (:64), calls (:190), and content kind (:393). Preserve those expressions rather than inferring one universal rule. The stream allocated at :154 is unused until :194; moving allocation after content selection is the only scheduling-neutral move proposed. Keep done/end ordering and the microtask boundary; synchronous text mocks are not equivalent.

Behavior lost: none intended. Future checks: offline goals-sdk context/call counts, no extra handoff turn, exact waiting/status transitions and both bounded-no-progress and explicit-milestone print cycles. Ensure stopReason matches every scripted branch. No actual provider execution needed.

### tests1-f2-04 — Remove unobserved instrumentation and local redundancy

**Dead test scaffolding/duplicate expectation; high confidence. Gross/net 10 lines.**

- goals-sdk.test.ts:148 and :227–233: the second test's settled variable and seven-line observe factory merely increment a counter. Its sole later appearance at :294 is expect({calls,settled}).toMatchObject({calls:3}), which does not constrain settled. Remove counter/factory and use expect(calls).toBe(3): eight removed lines. This is not permission to remove actual settlement checks.
- goals-sdk.test.ts:318 repeats calls<=3 after exact calls=3 at :294. No await or scripted-stream invocation lies between; synchronous entry/payload reads cannot advance the local counter. Remove the one weaker expectation. Keep :285's earlier calls=1 check.
- background-ux-tui.test.ts:177 declares calls=executeCalls(all) but never reads it in that loop. Later calls (:254) are different scopes and remain used for waiting-only/launch-duration checks. Remove just this declaration.

Counterevidence: goals-sdk.test.ts:342,421–422,445,454,471 genuinely asserts settlement; retain it. :456's continuation bound is not redundant with another test's milestone count. Background helpers/later inventories (:51–65,196,254–279) are active. Removing an observer can change callback ordering, but this callback does nothing except the unobserved increment. If settled was intended to be asserted here, adding that assertion is a coverage improvement, not a reduction claim.

Behavior lost: no asserted behavior; one unasserted counter and duplicate failure location. Future checks: offline goals-sdk; static scope check for the unused TUI declaration. Do not enable paid TUI merely to verify deletion of a pure unused local.

### tests1-f2-05 — OPTIONAL: stop saving extra sanitized full-session diagnostics

**Feature cut, not dead code; high confidence cost, medium-low confidence desirability. Gross/net 42 lines. Requires explicit choice; excluded from safe totals.**

Evidence: background-ux-tui.test.ts:67–107 is a 41-line diagnostic projection called only by the writer at :327. No script/test/workflow reader of session.sanitized.json was found in the bounded reference search. Delete both only if this diagnostic is unwanted. Keep text (:22–30), evidence.json (:325–326), all scenario predicates (:170–318), socket teardown and fixture cleanup (:328–329).

Counterevidence: wisdom/tasks-ui/background-ux-audit.md:5–13 describes real-model/terminal probes and retained local evidence. Humans may read artifacts without importing them. evidence.json has frames/events/tool args, not the full assistant/tool/user chronology. Because the temporary fixture is deleted, removing the projection loses useful post-failure diagnosis. The paid acceptance scenario itself is not obsolete or replaced by backend tests.

Behavior lost: diagnostic chronology on success/failure, not assertions or runtime recovery coverage. Never replace it with raw session/auth/provider dumps; retain the no-reasoning diagnostic surface. Future checks after approval: static consumer inventory and a synthetic offline failing diagnostic path that still propagates its original error, cleans its owned socket/fixture, and saves evidence.json. Real paid UX acceptance is separately authorized. Prefer keeping the feature if its chronology is useful.

## Exhaustive per-file verdicts / rejected reductions

| Assigned range | Verdict | Findings |
|---|---|---|
| subagent-extension.test.ts:1–866 | Keep all policy/lifecycle/race/ownership scenarios; share capture mechanics only. | 01 |
| goals-sdk.test.ts:1–608 | Keep SDK context/waiting/cycle/auth/provider tests; share mechanics and remove unobserved scaffold. | 02,03,04 |
| remote-owner.test.ts:1–553 | Keep; no compelling net reduction. | none |
| root-owner.test.ts:1–493 | Keep; no compelling net reduction. | none |
| gpt-live-delegation.test.ts:1–353 | Keep; no safe scenario deletion identified. | none |
| background-ux-tui.test.ts:1–334 | Keep paid natural-TUI acceptance; remove unused local; optional diagnostics only. | 04,05 |

- **Remote owner:** accepted/PID/startTime edits (:93–97,169–173,249–253,339–343,388–392) deliberately model recovery ownership. Four five-line copies could become four calls and an 8–10-line helper (gross20/net6–8), but hide the fence and state used in later handshake scripts. Not worth the abstraction; excluded from totals. Child-PID variant (:502–505) is distinct. Keep profile/depth/model conflicts, stable intent, uncertain answer replay, unresolved questions, journal gaps and the lock race. Identical answer requests at :298–299 intentionally test idempotency.
- **Root owner:** fixture(), FakeInference and until() already own common mechanics (:25–92). Create/prompt/UI replay tests exercise different durable ledgers (:93–120,121–197,431–474). Unknown writes/dead owners versus dispatching reconciliation (:198–257) have different ingress/state paths. Export denials before create, accepted, unknown and failed-close (:398–416) cover different states. Reopened dialogs (:476–493) test disk recovery, not merely rendering. Keep secret projection, tracked-only upload, digest verification and confirmed-close export gates.
- **GPT Live delegation:** same IDs versus distinct concurrent IDs (:50–73,212–228), interrupt versus late correction (:75–87,157–171), failed reserved admission (:230–242), pending eviction success/failure (:253–280), UTF-8 versus tiny deltas/long chunks (:282–328), and future-loss/overlapping corrections (:330–353) exercise distinct ownership/data-loss states. Similar result kind strings do not justify matrix deletion. Spoofed cancellation/job-output tests (:89–131) are essential. fixture() already shares ordinary construction; deferred-promise helpers save too little.
- **Natural TUI:** yieldedEntries at :189 is stronger than checking one stop/handoff flag. Responsiveness, arithmetic before finish, useful work, no waiting loops and exactly one automatic completion are separate contracts (:212–308). Final snapshot recomputation (:253–269) is not automatically duplicate work. Interim evidence.toolArgs (:196) helps failures before :255; retain it. Naively using tests1-02's offline launch/environment helper would erase this deliberately paid real-model flow. Sharing only tiny socket/capture wrappers has no compelling net gain here.

## Validation limits

Only source/reference/line-count checks completed. No runtime pass claim, measured patch saving or repo-wide unused-code proof. Discovery/source traces establish reachability, not provider availability. Future checks must retain independent security/recovery/data-loss assertions. No source, wisdom or values edits were made by this audit; the requested write restriction precludes a forced wisdom update.
