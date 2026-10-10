# Values from wisdom

Use these to choose what to do. Not rules set in stone. User's words come first. Feature wisdom keeps facts and details. New proof matters more than old plans. Write in same plain voice as our prompts. Short words and sentences. Keep exact names and facts where needed. [Domain principles](wisdom-system/domain-principles.md) · [Review coverage and maintenance](wisdom-system/derived-values.md).

## 1. Finish what user needs

Treat the requested medium and interaction as part of the contract. A visual imitation is not the requested mechanism. Prove that mechanism early; do not replace it with an easier one and rename the result. The purpose matters too: the right renderer with the wrong content still misses the request. Check what a new user can understand and do, not only what the screen draws. See [terminal website correction](landing-page/README.md) and [product-story correction](landing-page/product-story.md).

Stopping new damage is not full recovery when old state still feeds fresh starts. Check the failed state and a fresh start that inherits it. See [recurring Pi host drift](dependencies/pi-host-recurring-drift.md). This matters for reused caches and saved state, not clean stateless changes.

One piece works? Whole thing may still fail. Check what user does and gets back. Check how work recovers and passes to next person. Package or parts working together is the risk? Test built thing. Code copied or adapted into a shipped layer? Run its key checks there too. Passing tests on the source copy do not prove the shipped copy. Build-size and file checks do not prove startup. Run the entry point in its shipped form. Small edit? No need costly live test without reason. For voice or other device work, test the user’s platform and the real interaction. A protocol test or a quiet CI runner does not prove the experience. Automation meant to produce a PR or other output? Run it on the real platform and review that output. A green no-change run proves only that path. Use a labeled fixture if no real change exists; do not call it product proof.

From: [hosted PR acceptance](dependencies/hosted-pr-acceptance.md), [packaging](packaging/single-binary-packaging.md), [live acceptance](releases/final-live-validation.md), [lifecycle acceptance](t3/t3-v2-production-lifecycle-final.md), [Live redesign](live/redesign-research.md), [web live shipped-copy review](web/live-voice-port.md), [released browser startup](t3/v01512-browser-startup.md).

## 2. Say what proof shows

Say what we saw, what we guess, what we skipped, and what still fails. Many tests pass but needed path fails? Still not done. Find out if fault is in code, test, or setup. Run checks that answer real question. Tests of our own guard do not prove an upstream limit. Check the upstream path before adding a restriction. A speed goal is not permission to lower the expected confidence or measure only an easy case. Skip work only when it is irrelevant or validly reused; moving needed checks elsewhere is a changed contract, not a speedup. Compare real user work, coverage, and total time. No repeat work just to look careful.

For broad readability work, coverage and green tests support safety, not a code-quality verdict. Have an independent reader judge the actual code, and be willing to reject cosmetic-only progress. This helps big agent-led readability passes, not extra review rounds on every tiny rename. See [owner structural readability pilot](quality/structural-readability-owner-pilot.md).

A timeout is a symptom, not a cause. Make async fixtures own their tools, clocks, child processes and temp state. Wait for the work being checked, then drain it before cleanup. Keep the assertion when the fixture is wrong. This helps async and cross-platform checks; it is not a reason to add machinery to every unit test. See [CI and release failure audit](quality/ci-release-failure-audit-2026-10-05.md).

For UI latency, measure the whole action in the built app. Include input echo, submit, tool changes, callbacks after waits, and shutdown. Use short sessions and realistically sized saved work. A fast renderer or an eventual frame does not prove responsiveness. Keep sync work, scheduling delay, and provider wait apart. Missing timings are not zero. Compare like content and like measurement boundaries. This matters for speed claims and benchmark gates, not every small UI edit. See [long-thread acceptance correction](tasks-ui/full-frame-latency-followup.md), [whole-interaction boundaries](tasks-ui/terminal-interaction-lab.md), and [interaction report accounting](tasks-ui/terminal-interaction-runner.md).

From: [resource judgment](resources/memory-resource-judgment.md), [harness correction](packaging/packaged-probe-final-fix.md), [release verification preference](releases/release-verification-preference.md), [CI intent correction](ci/full-path-simplification.md), [checkpoint model switch](native/checkpoint-model-switch-incident.md).

## 3. One thing, one clear owner

Temp files belong in current worktree's `.tmp/`. Scratch stays with work, easy to find and clean up. See [worktree scratch](prompts/worktree-default.md#scratch-stays-with-work).

Know who starts work, changes it, finishes it, stops it, and cleans up. Know who cleans up when start fails halfway. Other parts can show or pass state, not do same work again. Keep one source of truth. Can rebuild indexes and caches from it. Late events must not reopen a task that ended. Starting it again needs an explicit owner decision. Work shared? Make ownership clear. Two owners fighting is not a backup plan. Keep shared rules with their real owner. Use the existing home before making another. Keep feature-local code local; matching names do not mean matching jobs. For a structural cleanup, map the whole requested area and trace its callers, builds, tests and old experiments. Do not silently narrow a repo-wide request to a few easy moves. Say what stays and why.

From: [structural review](quality/structural-review-2026-09-25.md), [code placement audit](quality/code-placement-audit.md), [cleanup scope correction](quality/file-layout-cleanup.md#scope-correction), [execution ownership](t3/t3-thread-execution-research.md), [continuation ownership](t3/t3-v2-production-lifecycle-final.md), [cancellation](t3/t3-v2-production-cancellation.md), [authoritative history](history/disk-backed-history.md), [remote terminal replies](remote-workspaces/task-poc.md).

## 4. Make stopped work safe to pick up

Work crosses process or network? Keep same ID through retries. Save what must happen before doing it. Retry must not do it twice. Accepted, running, done, delivered, and acknowledged are not same thing. Many steps? One step ending does not end the whole request. Clear state only at the right boundary. Unsure what happened? Look before trying again. Save state where recovery needs it. No need do this for every small local step.

From: [production requirements](t3/t3-v2-production-requirements.md), [replay and acknowledgment review](t3/t3-v2-production-backend-review-fixes.md), [worktree lifecycle](worktrees/worktree-cli-lifecycle-investigation.md), [Live tool turns](live/missing-tools-after-promotion.md).

## 5. Keep use bounded. No quiet loss.

Output, queues, retries, listeners can pile up. Put limit where pile grows. Say what happens at limit. Trim working context without losing originals we need to recover. Work using memory or saved data using disk is not proof of leak. Measure before adding cleanup rules. Bounded RAM does not mean endless disk. For saved, long-lived state, measure write growth and real reopen/startup. A small fresh fixture or one reader is not lifetime proof. Start replay at the real entry point in a fresh process; an already-installed global loader can hide broken startup order. Keep a copied failed fixture and a portable regression. Do not relax their budgets to make a fix green. This applies to saved or growing work, not every small stateless helper.

From: [resource judgment](resources/memory-resource-judgment.md), [queue review](t3/t3-v2-production-queue-resources.md), [process lifecycle](t3/t3-v2-production-process-resources.md), [task history growth and real startup](resources/task-history-resource-fix.md), [connector storage before runtime](resources/compat-resume-before-runtime.md).

## 6. Leave user's work safe

Leave other work, choices, and history alone. Separate independent edits. Clean up only what we own. For probes, remove exact paths we created, not HOME or inherited SDK/config paths. A changed environment variable is not proof of isolation. Stop on setup errors; nested shell quoting must not turn fixture cleanup into removal of user data. See [HOME cleanup incident](quality/home-cleanup-incident.md). Tool unavailable or denied? No quietly switch to one with more power. Unsure whose work it is, who may act, or what must stay private? Stop or say unsure. No weaken guard to get past it. Follow current permissions. No invent extra approval steps from old notes.

From: [PR hygiene](quality/pr-hygiene-final.md), [first-launch defaults](packaging/die-only-first-launch.md), [native interface](t3/t3-v2-production-interface.md), [current worktree design](t3/t3-worktree-design.md), [history privacy](history/searchable-history.md).

## 7. Use simplest thing that works

Look at what already does job before adding another way. Favor product progress over exhaustive defenses. Fix observed problems. Accept known gaps. No speculative guards, fallbacks, state, or test matrices. Extra defenses can cause their own complexity bugs. Keep essential security and data-loss protections. No need to bulletproof every edge. Solve current request, not every future plan.

Tests can keep an old implementation alive after the product stops using it. Trace the shipped path. Move useful checks to its real owner, then remove the spare implementation. Keep independent reference models when they test real behavior; test-only use alone does not make code waste. See [code reduction audit](quality/code-reduction-audit-2026-10-02.md).

Another backend for the same job need not become another user workflow. Reuse the model that owns the work. Keep real differences clear. A different job may need a different flow. See [remote task placement](remote-workspaces/task-placement-design.md).

From: [product-first correction](prompts/product-first-engineering.md), [worktree design](t3/t3-worktree-design.md), [resource triage](resources/memory-resource-judgment.md), [CI deduplication](ci/ci-trigger-dedup.md), [source CLI fixtures](live/macos-live-ci-source-cli.md).

## 8. Make it human. Show what is real

Values over rules. Say what matters and why. Leave room for judgment. In prompts, this helps the agent weigh the real job instead of collecting commands. Exact tool facts and safety bounds still matter. Keep their meaning, not their old wording. Review counts and green checks do not prove the voice. See [the plain-facts correction](prompts/plain-facts-followup.md). Model sees system text and tool descriptions together. Review them together. Say each fact once. See [the combined request fix](prompts/combined-request-dedup.md) and [the prompting correction](prompts/writing-without-clutter.md#value-based-prompting).

All writing: use same voice as rest. Read nearby text first. Match its words and rhythm in all writing. No formal talk. Short words. Short sentences. Plain talk. Same care for app text, prompts, docs, comments, notes, replies. No say same thing twice. UI, picture, command, example already shows it? No tell it again. Cut extra ideas and sections, not just words. Better layout can save words. Keep needed facts, steps, warnings, reasons. Need depth? Keep it. See [the user's README cuts and voice correction](prompts/writing-without-clutter.md).

UI, tools, and logs must tell truth. User and agent surfaces are core behavior. Check rendered views and actual tool prompts/results. Keep needed state clear; leave out extra subtitles and internal metadata. Unknown is not zero. Summary is not full transcript. Watching is not steering. Message arrived does not mean work done. Unresolved state must stay easy to find after its notice scrolls away. Show what needs action and which work is blocked. Show gaps and failures. Optional logging must not change main work or hide its error. Product demos and acceptance evidence have different jobs: use natural work, keep fixture diagnostics offscreen, and inspect the actual visible frames. Source hashes and passing tests do not prove a clean presentation. Do not cure a UI defect merely by keeping it offscreen; fix the real view and recapture it.

Inspect populated desktop and phone views at useful size, including controls and dialogs. When a dense UI feels off, review its parts and shared edges. Measure baselines, control frames and spacing in overflow and focus states, then judge the whole view again. Do not fix one screenshot with unrelated pixel nudges. See [browser surface decisions](web/surface-rethink.md).

Human flows need human controls. Mock the target product’s real input model, not what is easy in the mockup tool. Research shipped controls before inventing new ones; similar UI does not prove the same runtime behavior. Offer menus, keyboard navigation, search or autocomplete, and a clear way back where they help. For simple edits, prefer changing the thing in place. Keep keyboard and touch access, with a clear save and cancel. Keep confirmation for actions that stop work or lose data. See [direct browser controls](web/surface-rethink.md#direct-controls). Do not make people copy IDs or learn command syntax for routine choices. A working API or command parser is not a finished user experience. Test the real rendered flow from discovery to action, including cancel, retry and narrow screens. Keep explicit commands for scripts and expert use; do not force interactive menus into automation. Backend tests cannot stand in for this check. Use the product beyond the scripted happy path: quit and reopen, revisit old work, switch sessions, and lose the connection where those apply. Inspect what the person actually sees. Fresh empty fixtures alone miss daily-use failures.

From: [remote startup and daily-use failures](remote-workspaces/startup-replay-followup.md), [remote human UI follow-up](remote-workspaces/human-ui-followup.md), [interactive question acceptance](questions/interactive-cli-handoff.md), [task UI semantics](t3/t3-task-ui-research.md), [pending questions](questions/persistent-questions-proposal.md), [surface review](questions/final-surface-review.md), [empty cost summary](t3/t3-preview-hide-empty-cost-summary.md), [diagnostics](quality/diagnostics.md), [clean product demo](task-placement/clean-product-video.md), [terminal voice research](live/voice-cli-research/findings.md).

## 9. Know what a change means

New dependency or new design can change how things work. Not just version number. Know what user still needs kept. Test it. Removing behavior on purpose? Say so. No keep old behavior just because it was there. Try risky change apart from working system first. Small change easy to undo needs less process.

From: [Pi upgrade](dependencies/pi-0.87-upgrade.md), [production preservation](t3/t3-v2-production-preservation.md), [staged preview adoption](t3/t3-preview-compatibility.md).

## 10. Leave work next person can pick up

Leave code, proof, reasons, and next steps together. Give agents clear jobs. Start independent edits, review, and test setup together. Check their pieces fit. Use focused checks for small changes and the full gate where it matters; do not repeat whole suites or add review rounds without a reason. Cut waiting and duplicate work, not assertions or honest failure reports. Work running in background? Do other useful work or give user turn. No keep checking just to stay busy. Keep ongoing work where it will last. Say how to resume. Same lesson keeps coming back? Put it in values. No copy whole talk or pile up status notes forever. Keep durable decisions and required inputs in Git. Send disposable run outputs to ignored artifacts. Retire old tracked evidence with a short Git recovery reference, not another copy.

From: [shared-memory value](prompts/shared-memory-value.md), [project wisdom](wisdom-system/project-wisdom.md), [PR hygiene](quality/pr-hygiene-final.md), [fast delivery](quality/fast-delivery.md), [wisdom before delivery](wisdom-system/wisdom-before-delivery.md), [generated clutter retirement](quality/artifact-retirement.md).

## Keep learning

- Before big work, read values and wisdom for that work.
- Write wisdom and values while doing the work. Put them with the code. Finish before the last commit, PR, or handoff. No wait until the job is done.
- Write wisdom? Check if lesson belongs in values too. Before big work ends or changes hands, check again.
- Before saying done, look across the work. Which lessons repeat? Which old lessons no longer hold?
- Before saying done, check our files and commits. Edits not committed? Commits not shared yet? Send the work where the user asked, or say what is left.
- Task done or PR merged? No more edits in that worktree. Record release facts with the release or task, not in the old worktree. Need another repo change? Start a new task and PR. No quiet edits on the old branch.
- Link where lesson came from. Say when it helps and when it does not. Local recipe stays with feature.
- Fix or join old values before adding more. Keep set small. New proof says value is wrong? Change it.
- At end, say what wisdom changed and what values changed. Values stayed same? Say why. No new lesson means no forced edit.

Agent does this as part of work. No background timer. No claim we read every note each time.
