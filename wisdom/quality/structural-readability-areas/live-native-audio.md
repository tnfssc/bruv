# Live / native audio structural readability

ONGOING: 26/140 baseline files and 3/4 extra files have own primary coverage and accepted current blobs. Not area or whole-repo completion. Exact per-file provenance, all review rounds, hashes, checks and limits are in sibling JSON.

Checkout: `/home/tnfssc/.bruv/worktrees/t3-6b8c09c6-5442693331ce-task_662639e6`
Branch: `bruv/whole-repo-structural-readability-live-n-662639e6`. Initial base `59413c532e6422983f611915e509e8421aa2f363`. Workers and judges retain their durable worktrees; never import worker-local pickup notes. At most three primary/rework workers and three judges.

## Pickup queue

- native/live-linux/tests/backpressure.py: judge running; primary task_b65be047; judge task_c68d41f2.
- native/live-linux/tests/capture-protocol.py: primary running; primary task_c8643d8b; judge none active.
- native/live-linux/tests/source-removal.py: primary running; primary task_ba46a6b0; judge none active.
- scripts/live-isolated-audio.sh: judge running; primary task_1b8756f7; judge task_1a73a583.
- src/live/gpt-live-session.ts: primary running; primary task_35b0a03e; judge none active.
- tests/editor-voice-integration.test.ts: judge running; primary task_90932544; judge task_5f1948bf.

## Accepted structural results

- AudioCore callback cursor makes empty/pair/held-sample state and late lookahead explicit; native Linux playback buffer owns synchronization while Live retains Pulse/AEC effects. Swift output queue owns conversion/delivery separately from hardware lifecycle.
- Bridge separates nonretractable active write from unsent FIFO; Gemini dispatch owns revocable checkpoint/capacity/finally; OpenAI metadata lifetimes and response-owned replies remove map joins. Owner separates canonical history pairing, registered-tool protocol and admission/draining. Extension exposes acquisition/connect/context/device startup rather than buried provider wiring.
- C/native and provider/owner tests isolate accidental shared lifetimes while retaining meaningful cross-transition sequences, real authority/race assertions and independent waveform comparison. Already-clear headers, settings/contracts, metadata and builders legitimately remain unchanged. Counts/tests are not quality evidence.
- Private graph owner is reused; virtual fixture owns only its two modules with one cleanup owner. Protocol owns framing/process; synthetic microphone owns feeder/free/join/error delivery. Related protocol/test final revisions were freshly judged after later edits; old rounds retained.

## Explicit incidental fixes and proof

- Native played(0) before stopped was rejected during stopping: fresh worker task_7ae21cac and judge task_610f6154 reproduce baseline failure and accepted repair; only stopped acknowledges shutdown. No safety relaxation.
- Protocol fixture buffered-response/deadline/feeder-cleanup defects independently reproduced and fixed (task_5ff86413). Private-graph baseline missed played when20ms stimulus ended inside100ms throttle;500ms stimulus now requires positive queue and retains capture/drain/restart/source-removal. Judge task_ab2edd5f independently passed3 real private-graph smokes,17 regressions,desktop module identity and exit23 owned-process/root cleanup.
- OpenAI oversized-output fixture leaked100,050-byte artifact; cleanup independently verified. Owner-test duplicate idle state independently reproduced and corrected. Other potential fixes remain candidates until their judge accepts.

## Combined checks and platform limits

- Shared parent checkpoint95d2e164 joined cleanly at6f8654b8. It included prior live batchf473c8e5 and UI editor-related test95453da9; that test now has its assigned fresh primary/judge. Other-area sources/notes imported unchanged; no sibling merge behind parent.
- Latest shared proof task_8c734875:277 tests/21,718 assertions across14 files,17 Python regressions,root typecheck and40-file formatting all passed. Earlier task_26d1258a:252 tests/21,582 assertions,typecheck/format/lint(all exit0;baseline warnings). Exact scopes/tips in JSON; newer patches need final combined rerun.
- No physical-device, paid/authenticated provider, macOS/Xcode, acoustic/AEC, SSH or compiled-CLI parity claim. Swift source judgments are not compilation. Independent judge dependency-resolution failures are recorded separately from worker/combined runs. Private graph proof resolves that fixture blocker, not desktop parity.

## Remaining coordination

- Finish every pending baseline primary/judge and extra file; rejudge any later changed accepted blob. New test_isolated_audio.py remains candidate-related pending own primary. Resolve all rejection rounds if any; audit final inventory/hashes/unique primary IDs; run final combined checks and clean tracked tree.
- New Python regressions currently manual; parent scripts/ci.sh owner should decide coherent gate wiring. No cross-area CI edits here. Editor-related final test blob must be communicated back to UI/parent when accepted.
- Parent owns one PR #45 and whole Linux gate. No push or area PR. Area commits are safe partial batches only; final result requires full genuine coverage.

Latest accepted batch: isolated graph wrapper (`task_1b8756f7` / `task_1a73a583`) exposes graph-start/verify and one ordered cleanup snapshot;24 regressions+2 independent private graph smokes pass. New test_isolated_audio.py now integrated but own primary pending. Editor voice assigned primary (`task_90932544` / `task_5f1948bf`) accepts final89f3ee58 fixture lifetime improvements;39 independent editor tests pass, UI/parent final-hash reconciliation recorded.

Backpressure primary `task_b65be047` / judge `task_c68d41f2`: removes producer-thread lifetime, keeps actual unread pipe saturation (independent3 runs65269/65536bytes before exit74). Deadline/diagnostic proof retained; reproduced baseline3 open handles now closed. Blocking mutation killed/reaped after5.001sec. Standalone fixture, no maintained caller found; CI integration remains parent-owned.

Source-removal primary `task_ba46a6b0` / judge `task_46031fcf`: scenario and process/framing lifetime separate; only stopped completes evidence.24 regressions pass;partialEOF baseline2.012s vs candidate.010s rejection independently reproduced. New test_source_removal.py own primary pending. No physical unplug proof; virtual graph may reroute.

GPT session primary `task_35b0a03e` / judge `task_86206c2a`: one terminalclose result, explicit teardown and usage finality, semantic context correlation instead of reverse wire parsing; redundant serial lifecycle removed without weakening terminal fences.57 independent tests+1paid skip and teardownfailure probe passed;owner suite asset-blocked. Related GPT-session tests own primary pending.

Playback primary `task_1ea27d33` / judge `task_542a0b36`: pending sample/turn boundary owner and timeline credit owner separate from epoch/pipe/flush scheduler authority.53 independent tests/20,755 assertions pass. Immediateflush/stalewrite serialization retained;pipe acceptance and queuezero not physical silence. Related playback tests own primary pending.

Push-to-talk primary `task_7bb5cb79` / judge `task_51a3b4e4`: timestamp/undo evidence together, contiguous canceled-repeat admission and coherent guarded promotion;actual SDK/undo/native gate contracts traced.112 independent tests/572 assertions pass. Related discriminator tests own primary pending. Wrapper-test REJECT is retained;fresh rework judge task_2b5beb9d has full originalbrief/rejection/writerresponse.

Accounting primary `task_2995e9e9` / judge `task_4b5c5997`: tracker owns provider-specific cumulative scopes/dedup/pricing/persisted increments; related extension source/tests freshly judged after changes. Explicit shipped GPT billing defects reproduced through real GPT transport with controlled socket: snapshots[12,15,15,13] chargedinfull;terminal18s omitted$.015 knowncharge. Both baselinefail/candidatepass.126 combined tests/1,157 assertions include currentGPTclose API,failedcloseunknown and switchedsession guard;unknownbackend/ASR remains sticky. New cost-test own primary pending.

**Wrapper-test rejection resolved, not erased:** primary candidatea4bdb033 REJECT(task_dd7fe5dc) leaked wrappergraph root after SIGKILL. Fresh rework009b8728/task_c11abfe2 accepted by fresh judge task_2b5beb9d after full originalcontext and probes. ControlledTMPDIR completesstorageownership;removeonlyTMPDIR fails.32 independent Python tests pass;kill-before-drain.001sec versus restoredorder blocked untilrescue. Rejected branch retained and never integrated. Final c489af81 now has ownprimary/rework/freshjudge coverage.

Delegation primary `task_05694cc7` / judge `task_3583b317`: ProvisionalSpeech owns retain/reserve/settle/loss transitions;bridge keeps replay/history/spokenfreshness and mainowner keeps admission/execution. Fresh combined GPTsession/playback seams inspected.44 delegated/history+32 playback tests pass;owner suite missingWASM blocked. Related delegation tests own primary pending.

Capture protocol candidate3c71d4a2 accepted by fresh judge `task_0f8a556e`;initial task_c412b125 terminated incomplete/noverdict retained. Scoped consumer removescollector/queue lifetime,uniform validation and closedepoch settling explicit. Independent fullentry probes preservevalidoldepoch but reject newepoch/malformedPCM formerlyaccepted.27Python+4Bun/helperbuild and baseline/candidate privategraph runs pass. PipeWirePulse not CI PulseAudio parity;nulltraffic not acousticorigin proof. New capture regression own primary pending.

Second shared parent checkpoint `db885fce` cleanly joined. Only assigned source delta is `tests/live-host-bridge.test.ts` from session-host candidate7f466cef/judge task_9ae7f05e, exact7232dfaa;ownprimary pending. Previously accepted area blobs unchanged. Parent notes warn shared defaulttemp retained-snapshot budget polluted by repeatedfixtures; use unique TMPDIR for combined checks,do not weaken retention ordelete others snapshots.

Latest audio/test batch: fresh judges task_849c1ccb(audio tests),task_8ab8f308(playback tests),task_af9fc144(GPTrecovery) accepted exact finalblobs.66/80/88 focusedpasses respectively;referenceNativeRing and perwriteHeldPipe clarify boundaries,all epoch/flush/stop evidence retained. GPT recovery removesredundantmutedstate;terminalfailure vs temporaryspeechguard separate. Actualterminalblankpane baseline/candidate remains unresolved,notrenderedacceptance. Related GPTplaybacktests own primary pending.

## Latest combined proof

At source1a327b0c after secondparent checkpoint, task_b3b5ed42 passed rootcheck,44-fileformat,380TS tests/22,390assertions,42Python tests. One nativeLinux build then devicefreeprotocol/backpressure/privategraphprotocol+source-removal/privategraphcapture allpass;3ClangASanUBSan Cregressions pass withzero waveformmismatch. UniqueTMPDIR isolatesfixture artifacts. Source-removal mayreroute;PipeWirePulse notCI PulseAudio/physical/device/provider/Mac proof. Earlier batchlaunch failed fishquoting beforechecks;notcounted. Acceptedhash/uniqueprimary audit remains exact andpartial inJSON.

Lifecycle-test task_61f07074/task_3e2610a0 and billing-test task_0ed9f187/task_c4ba592a final own-primary revisions accepted. Callback/drain ordering and failedwrite settlement now direct;pricing vs persistence own separate testlifetimes.27/109 independent tests pass. Inherited billingtest subcenttolerance/intermediatewatermark and missingdedicatedlatebill guard proof recorded,notclaimed solved.

Delegation-test own-primary task_79a24111, fresh judge task_9286e550 ACCEPT integrated: direct test-owned admission promises, fixture observes every submission independently of policy, stale speech vs settlement and independent loss ownership explicit. 26 focused tests/91 assertions; judge owner/integration rerun blocked at missing-WASM loader, not credited as pass.

Helper source own-primary task_34c585ed/fresh judge task_1c3f1e78 NO CHANGE NEEDED; coherent fd/directory/executable cleanup ownership retained. Related embedded-helper fixture ACCEPT: explicit TMPDIR ownership and extraction cleanup checks.21tests/112assertions. Linux inert Mach-O payload probe is not native execution/authenticity proof. Related test still needs own primary.

## Partial checkpoint 47b05ba9

49/140 baseline accepted; 59/140 primary launched. All 6 new native regressions have own-primary acceptance. Exact accepted-blob mismatches: 0; unique primary IDs 65/65. Still partial: no area-completion or final whole-repo gate claim. Full queue, paths, original/rework judges and exact hashes remain in JSON.

Recovery-test own-primary task_3186f4b0/freshjudge task_1c5671f2 ACCEPT integrated;37combinedtests/20251assertions,explicit clock/write/flush ownership,terminalblankpane still unvalidated. Host-bridge test task_98219b99/task_b019b845 REJECT: afterEach moved failed-host close past final retained-snapshot assertion. Structural gains valid but checkpoint weakened. Candidate not integrated;fresh rework next primary slot, then fresh judge with full rejection context.

Resampler task_202ecbee/freshjudge task_cfda53f2 NO CHANGE NEEDED source; ACCEPT independent exact-byte reference/literal tests.86tests/797assertions. Existing sine reference acknowledged;new tests strengthen not invent first independent evidence. NEW tests/openai-resample.test.ts added to extra ledger (7 total), own-primary/freshjudge still required.

Passive-history task_17da398e/task_189c73c2 ACCEPT integrated: pending audit next-user ownership separate from projection-wide legacy dedup,42tests342assertions,raw/private/branch semantics unchanged. Related test own primary pending. Lifecycle port task_426bbfc3/task_4cd11b16 NO CHANGE NEEDED: scoped bus handshake vs owner stop/navigation/work cancellation separate;13tests67assertions+8bus assertions,sourcewrapper only.

Third parent checkpoint1c1e65fb joined cleanly(no assigned source delta). At ec8d02c7, task_232790bf passed rootcheck,46-fileformat,432tests/22601assertions across24files with uniqueTMPDIR. Includes currenthistory projection,delegation/recovery tests,embeddedfixture and independentresampling contracts. No new physical/provider/Mac/fullgate claim;previous native batch still distinct evidence.

Provider diagnostics task_eccea8a1/task_8db4b91e ACCEPT all3maintainedpaths: classification+safe enrichment colocated,session retains correlation/cancellation/terminal/audio/tool lifetimes. Fresh WHOLE final openai-session acceptance replaces oldblob;related diagnostic test ownprimary pending.70tests705assertions. Unknown/duplicate suppression already existed;provider-internal nonterminal response failure still triggers shipped extension Live shutdown through onError. No incidental fix.

Host retention REJECT resolved: fresh rework task_8e8cf502/d19bdc41 then fresh whole-original-to-final judge task_bb9a363e ACCEPT blob3dc74be1 integrated. Failed-host close now before retained-byte assertion;typed port/wiredecoder/central cleanup improvements retained.19tests111assertions independently;neighbor asset loader blocked judge integration. Original rejected branch retained,never integrated.

Status task_89c0c507/task_5f68217e ACCEPT all3paths integrated. Explicit pure priority replaces nestedrenderconditional;presentationfacts no extra lifecycle. Fresh WHOLE final extension accepted53b126a8,retains startup/capture/stop/billing ownership.159tests1044assertions incl80/120column sourcePTT;64input statusstrings matchbaseline. Status not actual readiness/teardown proof. Related status-test ownprimary pending.
