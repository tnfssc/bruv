# Compatibility / T3 structural readability

83 initial files; all start pending. Each requires its own fresh primary worker and independent actual-code judge. Area source edits belong to durable file-worker worktrees only. No source accepted yet. Ledger: `compatibility-t3.json`.

Area checkout: /home/tnfssc/.bruv/worktrees/t3-6b8c09c6-5442693331ce-task_dc14408d; branch `bruv/whole-repo-structural-readability-compat-dc14408d`; initial commit `59413c532e6422983f611915e509e8421aa2f363`. Max three primary/rework workers and three judges concurrently. Related changes will be integrated coherently and final changed blobs rejudged; new helpers require primary coverage. No worker pickup notes are imported.

Proof limits: no tests yet; native/provider/device/SSH acceptance requires real environments and is not inferred from fixtures. Parent owns full gate and PR #45.

## First accepted boundary

`src/t3/tasks/native-task.ts`: independent judge `task_2c886e04` found no change needed at blob `9152be57bb326b4f919518efe6d13be4b10c363b`. Strict contracts, exceptional launch replay and caller-owned lifetime are already visible. Primary proof: 36 focused tests, 154 assertions. Important qualification: adapter does not replay cancellation ambiguity, but MCP transport may resend after 404. No source patch or worker pickup note imported. Other files remain pending/in flight; this is not area completion.

## Accepted runtime ownership patch

Integrated exact candidate `cb1bcfc8` runtime + regression test, not worker note. Judge `task_9a477342` ACCEPT: history queue/parent/sticky failure now share lifetime owner, runtime drains at lifecycle boundaries; shared message-body conversion leaves child frame policy at caller. Base/candidate serialized-history comparison preserved replay property order. Writer: 27 runtime tests plus 5 companion pass/7 SDK skips, typecheck/format/lint. Judge test rerun blocked by module resolution; no live/full gate. Runtime test still needs its own fresh primary focus.

Batch checkpoint: parent integration `6a285569` contained only common progress notes since initialization; no useful source merge needed. Disk 156 GiB available. Area batch proof job `task_554a7ded` generates area-owned runtime assets and runs runtime/history/task-binding/prompt-ownership, typecheck and focused format/lint. Result pending; never inferred from worker results.

## Accepted MCP ownership patch

Integrated exact candidate `17c4c9e3` MCP client + late-old-404 regression, not worker note. Judge `task_645854a5` ACCEPT: complete POST exchange now one owner and reconnect no longer maintains a second shared promise; caller cancellation stays separate from owned handshake. Sessions still drain/delete; transport 404 retry is not adapter ambiguity replay. Stable keys are derived, not freshly persisted. Writer 47 tests/180 assertions + typecheck/format/lint; judge 10 notification tests + 11 direct probe assertions, full focused reproduction blocked by zod resolution. Related test primary coverage still pending. Integrated runtime batch `task_554a7ded` passed: 6 outer tests, 7 SDK skips, typecheck/format/lint (4 inherited warnings,14 infos).

## Pickup checkpoint

Current code accepted: runtime + MCP source patches and native-task/preflight/launch-identity/permissions unchanged. MCP integrated batch `task_059796b2`: 47 pass,180 assertions; typecheck/format/lint passed (2 existing warnings/10 infos). Argument unchanged candidate was independently REJECTED for unread `verbose`/`strictMcp` carried state; fresh rework `task_565d6984` must preserve protocol flags, validation and stream/aux behavior. CLI `task_adf93322` is concurrently active, so inspect both related patch sets before joining. Runtime test whole-file no-change review and production-bridge whole-file test refactor review are pending, distinct from prior related-patch acceptance. Acceptance-model worker remains active after reproducing request sequence attribution overlap; no acceptance inferred. Ledger preserves all worktrees and rounds. No global/other-area notes changed.

Bridge test whole-file acceptance: primary `task_c1e2e00b`, judge `task_f50293ec` ACCEPT at `53c4bb22298c15e81dd6123b3d5508b86100c6ef`. Direct header observation replaces nested proxy; timeout/cancel/auth cases expose only their own lifetime. Prior late-404 regression preserved. Whole runtime test separately accepted unchanged by `task_340d96b8`. New argument test candidate is in extras ledger; needs fresh primary after patch acceptance.

CLI teardown accepted: candidate `150667b5`, judge `task_71218826`; one finally owns await/diagnosis, then exit selection, cancellation still starts immediately. Explicit baseline-reproduced fix removes duplicate cleanup diagnostics while keeping nonzero exit and separate operation errors. Launch test added SIGINT/teardown coverage; primary focus still pending. Arguments rework ultimately touched arguments.ts + new separate test, so no file overlap with CLI candidate; integration behavior proof still required.

Arguments rework accepted by fresh `task_e06dc5c8`: unused verbose/strictMcp fields removed, flags retain exact acceptance/validation and always-on semantics. New separate argument test introduces extra-file primary obligation. Prior rejection retained, not laundered. CLI and arguments have no same-file overlap but combined contract review/checks follow.

Acceptance model joined exact `484fff19` source+test: judge `task_84bcbfb5` ACCEPT after 42 Node tests and 2 Bun tests and independent attribution repro. Scenario correlation no longer burdens ordinary selection; generated cancellation and saved-question programs expose authority/order. Explicit request-local sequence bug fix preserved malformed-JSON no-allocation semantics. These are loopback/injected program fixtures, not real provider/connector acceptance. Related test primary pending.

Commands accepted by `task_dfe81e3e`: input authority/normalization separated from effect dispatch; extension context plus ordered notification completion own a coherent lifetime. Exact source probes verified whitespace, human native-open route, real context, delivery ordering/errors; candidate deps blocked judge suite. Related commands test primary pending.

Frontend run lifetime joined candidate `898826ed`: judge `task_78d1ce83` ACCEPT exact source557693c/new test3b61902. Per-run accounting/errors replace together, persistent delivery tail/error remains outside; settlement alone ends run. Independent14 tests67 assertions; no provider proof. New frontend test requires fresh primary, recorded separately. Launch test candidate queued for whole-file judgment, not yet integrated.

Batch boundary: integrated frontend proof `task_aa404554` passed16 top-level/69 assertions, typecheck/format/lint (one retained warning). Combined CLI/arguments judge `task_0e9b905b` ACCEPT final contracts with57 independent top-level passes and additional lifetime/admission probes. New argument test now has its own primary `task_a3a6c083` + whole-file judge `task_4c141287` NO CHANGE NEEDED, completing that extra-file obligation. Parent head remains `6a285569` (notes only); no common source to merge. Disk145GiB available. Area temporary node_modules symlink is for readonly dependencies and must be removed before final clean-tree audit.

History candidate `71aaf5c4` joined: judge `task_9b56d280` ACCEPT branch selection before translation and internal message/provenance pairing, preserving public arrays, replay JSON property order and import authority. Related history test includes active branch mixed content/provenance and stored-property-order checks; still needs primary. Worker reports15 including real SDK filesystem cases; independent judge could not load Pi deps. Area combined test proof follows with exact skip scope reported.

Transport candidate `b3c9b428` joined: judge `task_70aa7bb7` ACCEPT bounded framing isolated from run lifetime;17 independent transport tests52 assertions plus4 permissions. CLI EOF explicitly closes while transport-only EOF drains gracefully—preserved distinction. Related test primary pending. Integrated history proof8 pass/7 SDK skips is separate from worker configured-SDK proof.

Launch test fresh primary `task_2cea9559` + judge `task_739abadc` ACCEPT finalc882e0b. Harness exposes NDJSON operations, promises own internal readiness, separate environment/permission lifetimes, close count now proves completion. Writer early-return mutation caught all3 candidate cancellation cases unlike baseline; judge inspected but did not independently execute mutation. This new blob supersedes prior related CLI test acceptance. Transport integrated proof54 tests240 assertions/typecheck/clean format+lint passed.

Command test whole-file patch accepted `task_41daae2e` at44f9c527: actual ledger integration alone owns disk lifetime; unrelated cases use direct registrations; never-dispatched event registry removed; notification order/completion preserved. Replaces prior related test hash. Binding storage candidate currently judged, including new binding test tracked in extras.

Injected MCP accepted `task_5e2a8606`: startup admission/init/discovery/ready/park and resume reacquisition now visible without hidden discover boolean. Failed init remains registered for cleanup; updated-input guard and one-call/no-retry/fatal release intact. Related MCP test proves re-admission without rediscovery and still needs primary focus.

Binding and history-test accepted batch: `task_dfcc2819` accepts storage branches + new binding test (independent7/49); persisted-leaf check alone cannot prove no in-memory branch, source ordering supplies proof. New binding test still needs primary. `task_139e64e4` accepts whole history test finala7c329 with explicit SDK environments; exact helper independently checked real0.3.276 and hostile inherited vars, full suite not rerun. Redundant child assertion truly subsumed by parent absence. App-worker `task_65c3222d` accepted unchanged; distinct configuration/permission/active-run authority already readable.

Whole transport test accepted `task_d5030f7e` at43115a9a: actual readiness gates, paired held writes and explicit output ownership. Judge independently reproduced old fixture returned a different stream from supplied output; new identity assertion fixes only fixture.17 tests53 assertions independently pass, no production behavior change.

Task binding accepted `task_575ede26`: coherent causal registration/Agent once-only delivery owners expose replay/start/progress/child/terminal/result/persist/roster sequence, same durable schema. New test records history-before-exposure and reattachment. Terminal UUID check alone limited; existing terminal-count tests and unchanged suppression cover broader duplicates. Binding whole-test primary pending; projection separately judged.

Projection candidate accepted `task_157d0ec7`: pure protocol frame construction, explicit checkpoint returns, preserved revision/resume/terminal suppression and start-before-progress. Independent15 tests87 assertions. Related projection test primary pending; combined task-binding/projection actual-code review follows because candidates launched independently.

MCP whole-test accepted `task_89cb5d88` final7e2b7fb: peer construction separate dispatch, faithful shared error envelope, explicit slow handler gates. Finished means handler completion, NOT stale HTTP delivery acknowledgement; no wire-delivery overclaim. New binding test now independently accepted unchanged `task_1c7cf1d4`; all3 new test files currently have fresh primary+whole-file judge.
