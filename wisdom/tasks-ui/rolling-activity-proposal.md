# Rolling activity, lasting conversation

Historical design snapshot, reconciled against `origin/develop` at `ac720844bac745e6cef45b1478703517e99b890b` on 2026-10-04. The tool-only slice already exists there; [implementation pickup](rolling-activity-implementation.md) and [disclosure follow-up](rolling-activity-disclosures-2026-10-04.md) record its evolution and proof limits.

**Proposal-only PR update.** This work changes docs, not runtime behavior, dependencies or releases. The original sketches below describe a broader target, not current product behavior or approval of rolling assistant prose. The reconciliation and remaining gates take precedence over the original future tense.

Read the [Pi API research and probe results](rolling-activity-research.md) for the source evidence. The layouts below are sketches, not screenshots of a shipped feature.

## Reconciliation with current develop

PR #23 is still open at head `6ab524c6`. Its proposal/research were copied into develop by `1875ae90`; later runtime work does not make this open docs PR an unimplemented feature branch. On 2026-10-04, GitHub returned no submitted reviews or inline review comments; its sole issue comment was CodeRabbit's skipped-review notice, not design approval. See the [review handoff](rolling-activity-pr23-review-2026-10-04.md).

Current source separates three facts that the original sketches sometimes conflated:

- **Visible segment is not a whole agent run.** [rolling-activity.ts](../../src/ui/rolling-activity.ts) keeps native assistant prose visible. Prose, users and non-job controls split activity into several groups within one run. Adjacent typed task notices can join their source group; notices after a lasting answer form a notification-only group. Canonical task ownership still points to the source call. Neither notice delivery nor group expansion adds a tool call.
- **Run end is not final-answer intent or task settlement.** Fullscreen TUI `agent_end` appends `bruv-activity-boundary` with call IDs to the existing journal when calls exist. The marker has no end reason, note intent, task status or continuation parent ID. It separates runs for replay; it cannot prove a successful answer, an explicit handoff, or background work being done.
- **Tool rolling is not prose rolling.** The current adapter has no activity/answer/note route for assistant text. All such prose remains lasting. A short update replacing a tool label in these sketches is still a proposed extension, not implemented behavior. Standalone saved-question cards also remain proposed; existing /questions controls and hidden answer routing stay authoritative.

Current headers intentionally have no group chevron. Opening a group reveals compact tool rows; each item's detail is separate. /activity and Ctrl+O exist in develop. The disclosure glyphs below are historical sketches, not requests to undo this later UX choice.

### Unanswered message-intent route

Do not route ordinary assistant text through execute's `label`, tool-result `details.handoff`, worker progress, or `display:false` question-answer context. Those are different boundaries with different owners. A tool handoff can terminate a run without any final assistant message.

Two routes remain candidates, not selected product decisions:

1. **Provider-specific projection.** The original Responses probe observed a phase encoded in `TextContent.textSignature` at text end, not at text start/delta. A supported phase could classify that text block after settlement, while unknown blocks remain lasting. It supplies no general important-note intent. Provider-specific support and user-visible streaming behavior need explicit approval; do not parse opaque signatures from other providers or claim cross-provider coverage.
2. **Typed intent at the actual assistant-text boundary.** A future normalized or bruv-owned signal must reach both live text rendering and the saved selected-branch message. Specify who emits it, whether it labels a text block or a whole message, how mixed text/tool messages work, and what reload/export sees. An in-memory callback or an English convention alone cannot meet that contract. No schema, emitter or persistence change is approved here.

Choose whether the next scope remains tool-only, adds the narrow provider-specific route, or defines a broader typed route. Until then keep unknown streaming and settled prose on the native readable path. Even a known commentary tag is not permission to hide an actionable question/warning without an agreed note policy.

### Durable yield and continuation boundary

The existing marker stores membership facts, not a second transcript or job ledger. Reconstruction uses selected-branch user/prose/control boundaries plus outer call IDs; a steering user within one run stays distinct. A run with no calls writes no marker. A crash before `agent_end` leaves no durable end marker, so legacy/incomplete stretches cannot recover an exact yield reason from current data.

[questions/runtime.ts](../../src/questions/runtime.ts) claims saved-answer delivery durably, then schedules hidden follow-up context into a new parent turn. [agent/extension.ts](../../src/agent/extension.ts) owns completion delivery and separate print/JSON/RPC continuation behavior. A presentation group must not acknowledge delivery, resume old execute code, or fabricate a link between two runs because they share a title.

Open design question: is call membership plus existing delivery authority enough for the desired UI, or must a future view distinguish normal yield, explicit handoff, abort/error and continuation cause after reopen? Only the latter needs additional durable facts. Define their owner and minimal existing-journal shape before changing anything; do not retrofit guessed reasons into old sessions.

### Host and scroll integration already present

[activity-projection.ts](../../src/ui/activity-projection.ts) and [sdk-task-rows.ts](../../src/ui/sdk-task-rows.ts) project retained direct siblings after canonical task ownership is computed. [rolling-activity.ts](../../src/ui/rolling-activity.ts) adapts fullscreen InteractiveMode's live events, rebuild and global expansion; the seam checks required method presence. Host preparation separately checks Pi 1.0.0. Do not propose reparenting or another global transcript hook as if this seam were absent.

Explicit toggles use `withAnchor` and a one-shot `ScrollView.updateLayout` wrapper. They apply `scrollTo(..., { disableFollow: true })` after measurement, retaining a visible header/reading component or revealing a picker selection. This is focused row/component anchoring, not universal semantic anchoring for every background height change or terminal mode. The old fake-terminal failure is motivation; it is not proof that today's implementation still has that defect.

Reuse this integration for any approved prose extension, then prove its new streaming/height effects in the compiled CLI. Regular mode, placed-root, web and noninteractive presenters remain outside this proposal's scope. The [later disclosure receipt](rolling-activity-disclosures-2026-10-04.md) records compiled tool-only checks; this review did not rerun them and does not transfer their acceptance to hypothetical prose behavior.

## What the user wants

Keep the conversation about what the person asked and what the agent answered. Do not leave a ladder of tool rows and routine narration between them.

While the agent works, show one rolling area. The first tool label appears. A later tool replaces it. A short assistant update can take its place, then the next tool replaces that. When the agent gives its answer, leave a small disclosure such as **“15 tools called”**. Open it to see the work, including the latest available details. Questions and important notes must not disappear into the disclosure.

This is a display change, not a request to throw away tool results or change model context. “Not persist each row” should mean not leave each row in the main rendered conversation. Keep the original branch history, tool identities, results, assistant text, and artifact references. The agent still needs them. The person may need them later.

## Recommendation in one screen

Default to a collapsed **activity group** for each stretch of agent work. It has a compact summary and, while active, one replaceable preview below it. Keep user messages, yielded assistant answers, saved questions, and useful unresolved notes in the main conversation.

During work:

    You: Fix the failing settings test.
    ▸ 4 tools called · working
      Run the settings tests

Then, in the same area:

    ▸ 4 tools called · working
      The fixture uses the old default. I’ll update it.

Then:

    ▸ 5 tools called · working
      Update the settings fixture

After the answer:

    You: Fix the failing settings test.
    ▸ 7 tools called
    Assistant: Fixed the fixture. The settings tests pass.

These are layout sketches, not exact glyph, color, or shortcut commitments. The live preview uses the existing tool label, not inferred meaning from source. A normal success summary needs no green tick and does not mean the requested feature is proven correct.

Keep one area per active stretch, not one area per tool and not one global mutable area that overwrites all old work. Settled groups remain inspectable. There is only one rolling preview for the foreground stretch, even when several calls are in flight.

## Why this fits bruv

At the original eb07b0d7 baseline, the compact UI solved a smaller problem: one short labeled row per call, canonical task rows, and fewer routine notices. It did not solve the long staircase left by many calls and assistant updates. Earlier work explicitly deferred grouping. The original proposal addressed that gap; current develop now groups tools but still retains all prose. This does not reinterpret earlier releases as broken.

Read with:

- [Values](../values.md): one owner, keep recovery safe, use the simplest useful design, honest UI, and proof of the real human flow.
- [Conversation noise discovery](conversation-noise-discovery.md): ordinary assistant text is not hidden thinking; an outer execute success is not nested job success.
- [Agreed compact actions](agreed-compact-actions.md) and [action labels](action-labels-and-quieter-notices.md): short explicit labels, quiet notices, preserved diagnostics and footer.
- [Foreground streamed actions](foreground-streamed-actions.md): partial labels, code-first streams, and collapsed versus expanded ownership.
- [Canonical task rows](canonical-task-rows-interface.md): launch identity, late updates, orphan notices, and truthful outcomes.
- [Placed-root compact transcript](placed-root-compact-transcript.md): separate presenter and expanded transcript obligations.
- [Resume renderer order](resume-renderer-order-2026-10-01.md): direct startup alone is not enough proof. In-app resume and reload rebuild the transcript too.
- [Task monitor](task-monitor.md): an existing place to inspect and stop jobs. Activity is not another scheduler or job controller.

No values change is needed. This applies existing values to a new display choice.

## Original baseline: what the code gave us

Original repository baseline for this research: `eb07b0d7`, with Pi packages pinned to **1.0.0**. This table predates the adapter now on develop; use the reconciliation above for current integration facts. Older Pi 0.99.1 wisdom is not evidence for these APIs.

| Observed in repository source | Design consequence |
| --- | --- |
| src/ui/execution-previews.ts renders compact execute labels and expanded source/output; it carries error and artifact-warning information. | Reuse that evidence. Do not summarize by parsing shell source or guessing task outcomes. |
| src/ui/sdk-task-rows.ts adapts real Pi tool/custom-message components, checks their expanded flags, pairs tasks with tool-call identity, and restores its wrappers. | Grouping crosses component boundaries. A change to one tool renderer alone cannot replace a whole stretch of assistant and tool components. |
| The task adapter uses result details, persisted custom messages, and a live task snapshot. It updates the original owner, hides duplicate collapsed notices, and preserves native image children. | Late task details must keep their original ownership. Do not replace this with text matching or delete image children. |
| src/ui/conversation-density.ts adapts assistant components and mouse coordinates after changing rendered height. It distinguishes text and thinking blocks. | Height and mouse hit-testing are part of the feature. Ordinary assistant prose needs a separate grouping rule; the thinking toggle is not that rule. |
| src/agent/extension.ts handles session start, installs the task adapter in TUI mode, and observes agent end. Print/JSON/RPC have separate continuation behavior. | A UI “answer yielded” boundary is not a job-completion boundary. Do not change those continuation rules for this feature. |
| src/ui/task-rows.ts carries typed task identity, source, status, and source-call linkage. Unknown, cancelled, failed, and needs-input differ. | Preserve those distinctions. A count of tools is not a count of tasks or successful operations. |
| src/remote/root-presenter.ts builds a separate transcript view, pairs tool calls/results by protocol identity, and honors display: false. | Local component hooks do not automatically give placed-root parity. Privacy filtering still applies. |
| src/tasks/agent-progress.ts observes assistant text, tool events, message end, and stop reason for worker progress. | These events help explain existing data, but that progress consumer is not the owner of the local conversation renderer. |

The inspected presentation shapes expose role/content, tool-call identity, results, stop reasons, streaming state, and custom-message types. **They do not establish a reliable, provider-independent “commentary / final / important note” tag for ordinary assistant text.** A tool-request stop reason is useful evidence, but the mere end of an assistant message is not necessarily the end of the work stretch. Do not claim API transcript channels just because the agent writing this proposal has them.

### Mouse support: verified seam, unfinished product

Pi 1.0.0 supplies component mouse handling, native tool click-to-expand, selection and an application-owned alternate-screen viewport. A real TuiAltScreen probe with synthetic mouse input expanded native tools and a small group; dragging text still selected it. So the user's idea has a real interaction foundation. Alternate screen alone is not the feature.

There is no public API that replaces the normal transcript with grouped history. Ctrl+O visits direct expandable children, while the task adapter pairs sibling tool components. Naive reparenting would break those assumptions. A public working-message or widget can show a rolling line but cannot remove the old staircase by itself.

The probe also exposed a concrete problem: opening a group at the bottom let follow-end scroll its header out of view. The proposal must solve that local toggle behavior before claiming usable expansion. These were fake-terminal component probes, not compiled CLI acceptance. Exact files and limits are in the linked research.

## Main conversation versus activity

The target needs a small explicit distinction between **activity**, **answer**, and **note**. These are presentation intent, not three new message stores or a new agent tool. Keep the original message and text unchanged. Define the smallest typed signal at the existing message boundary in a focused implementation spike; its exact schema is not approved here.

### User messages

Always keep them as main conversation entries. A user message provides a boundary for the activity immediately before it. Saved question answers keep their existing ownership; do not fabricate a duplicate user chat message or reveal hidden answer-routing context.

### Assistant answer

An **answer** is text offered to the person, not a claim that every job has finished. A handoff such as “The review is running; you can keep talking” stays. A later automatic continuation can yield another lasting answer. An explicit handoff() result already carries presentation meaning and should not vanish when a background event arrives.

While intent is unknown, stream the current assistant message readably as a provisional answer. Do not clip a possible long answer to three rows or wait for the final token before showing it. An answer becomes lasting in the same position, without duplication. At a yield, unknown text stays visible too. Message-end alone is not a yield, and agent-end is not proof that all jobs completed.

If the agent yields with no text, leave the summary and an honest state supported by the host, such as “Interrupted before an answer” or “No answer returned.” Never turn stdout into an invented answer or infer “Waiting for review” without an actual running review.

### Commentary

Explicit **activity** text takes the rolling slot. A later tool or activity message replaces it. Its complete text remains in expanded history. Thinking stays under the existing thinking control, with no new placeholder or lowered reasoning setting.

**Safe default: unknown settled assistant text remains lasting.** Do not hide prose merely because a tool followed it, the sentence is short, or it begins with “I’ll.” That could hide a caveat or a question. Until a supported intent path exists, tool grouping can be prototyped separately, but it is not the full rolling-prose experience proposed here.

Pi has no provider-independent commentary/final/note field today. The verified OpenAI Responses converter preserves commentary/final_answer inside textSignature, only at text-end. Other signatures are opaque. A deliberately scoped adapter could normalize that known format; do not treat arbitrary signatures or raw provider events as a portable UI contract. Both live and saved-message paths must use the same interpretation. Important notes still need a distinct intent, not a guess from phase alone.

### Meaningful note and question

A **note** changes what the person needs to know while work continues: “This migration deletes legacy rows” should stay even when another tool follows. An explicitly marked note remains outside the replaceable slot. Unknown prose is also retained under the safe default, so this caveat is not lost while note intent is unresolved.

Pending questions, permission requests, typed blockers, uncertain cancellation and missing-output warnings remain discoverable. Existing typed data can support some of these now. Saved questions currently have a ledger and picker, not an automatic standalone transcript card; a lasting card is proposed new read-only presentation of eligible ledger records. Do not turn a question into a second authority or expose display:false answer context.

When a question is answered, retain its history but remove active “needs input” only from the authoritative state. Answer saved, queued, delivered and used remain distinct. Expansion must not answer, grant, resume or consume delivery. Unknown custom messages stay visible unless their existing display policy hides them.

Show a typed note once where the same record identity is known. Do not infer from English that an ordinary answer has already explained a blocker and silently drop its card. Avoid clever importance scoring, prose classifiers, a note database, or a new event taxonomy.

## Counts and group boundaries

**Count actual top-level tool invocations visible in the selected branch.** Use protocol call identity, not labels. A start counts once; a result updates the same call. Streaming arguments, retries of delivery, task completion notices, assistant commentary, questions, and toggle clicks do not add tools.

One execute that launches three background shell jobs and two agents is **one tool called**, with five typed launches linked in detail. It is not six tools. This is not a promise of a complete nested-helper trace: helpers with no retained typed metadata cannot be reconstructed from JavaScript or stdout. Calls made inside a child agent belong to that child’s transcript, not the parent’s tool count. A parent inspect call is another parent tool. A genuine retry with a new call identity counts again, even if the label matches.

Count attempted calls, including failures, cancellations, and calls whose result is missing. For a streamed call, count once its tool-call identity and name are known; partial argument chunks do not increment it. History with a result but no recoverable call identity should show “Unpaired tool result” in detail, not invent a call. Legacy incomplete history may need “Tool count unavailable”; do not reconstruct numbers from prose.

Suggested settled labels:

- “1 tool called” / “15 tools called” for ordinary groups.
- “15 tools called · 1 failed” when typed failure evidence exists.
- “3 tools called · 2 jobs running” when work continues after the answer.
- “3 tools called · status unknown” after reopen without fresh job evidence.
- “Activity” for commentary-only work that is worth inspecting; do not leave “0 tools called” between an ordinary no-tool answer and its user message.

Failure counts in the summary refer to tool calls unless labeled as jobs. An execute may return normally while a nested job fails. Use “1 job failed,” not “1 tool failed,” for that case. Do not infer task totals from a capped preview. When evidence is incomplete, expose uncertainty instead of a precise-looking count.

A group starts with the first activity after a user message or an automatic continuation. It ends at a yield, an interrupt/stop boundary, a new user message, or a branch/session change. For the broader target, a lasting note or question could sit inside that stretch without resetting a work-total count. Current visible groups instead split at lasting prose/control boundaries; do not conflate their per-segment counts with a whole-run total. The summary occupies the activity’s original position in the conversation; the answer follows it. Keep the note at its actual conversation position, even if tools continue afterward. Expanded activity can refer to that note for chronology, but should not duplicate its full card.

Do not merge everything between two user messages forever. Background continuations can happen without another user message. Each yielded answer ends its own stretch. A continuation that does new tools gets a new group and, if useful, a small “Review follow-up” context label. A notice that only updates a known task does not create a new group.

These boundaries should be reconstructed from branch entries and existing lifecycle facts where possible. If old persisted data cannot recover a yield boundary, use a stated conservative legacy grouping rule rather than fabricate exact original timing. Whether a tiny durable boundary marker is needed is an open implementation question. Do not add an activity ledger before proving the existing journal lacks the needed fact.

## One preview, honest live state

The summary stays discoverable while its body changes. The body shows the latest **foreground step**, not whichever background event happens to arrive last.

- Starting a tool replaces the prior tool or commentary preview with its short label and existing running indicator.
- Output/result updates change that step’s current detail. They do not append new default transcript rows.
- A later assistant interim update replaces the tool preview. A later tool replaces that text.
- When a tool finishes but the model has not answered yet, keep its settled preview until the next event; retain “working” or “waiting for response” at group level. Tool done is not agent done.
- If two foreground calls start together, show the latest started label with “2 tools running.” Their updates are keyed to their own calls; a late result from the first must not replace the second’s label. All calls are available when expanded.
- If nothing has a label yet, show the current generic tool name or a neutral working indicator. Never expose half-streamed JS as a fallback label. Use the existing streamed-action policy for code-first input.
- If there is no output, show the outcome supported by the tool result. “No text output” belongs in detail, not an empty error card or an invented success claim.

The tool preview is bounded, not a second transcript. Recommend at most **three content rows** for tool labels/output, shrinking with the terminal. Most tool labels need one. Assistant text is different: because final intent may not be known yet, let the current message stream readably rather than clipping every possible final answer to three rows. There is still only one current body; a next step replaces it. A future explicit commentary intent could allow tighter clipping, but is not assumed here. Keep the footer’s model, context, cost, cache, and path fields as they are. This proposal does not repurpose them or add another dashboard.

A group settles when the agent yields, not when all launched jobs finish. Remove the rolling body, keep the summary, and put the answer in the main conversation. Do not collapse a detail view the person intentionally opened. An open group stays open as new details arrive and after settlement.

## Background and concurrent agents

Keep job state owned by the existing task system. The activity UI observes it. It does not alter wakeups, delivery, question ownership, timeouts, or stop semantics.

A launch belongs to its source tool-call group. Known later task updates amend the details and summary of that original group. They do not add to the tool count or resurrect its rolling preview. If the original group is above the viewport, a routine success need not pull the screen back there. Existing /ps remains the place to find running work.

When a completion wakes the assistant, subsequent assistant tools/commentary belong to a new foreground group. The original group may now say no jobs running. The continuation can finish with a new lasting answer. Do not move the old final answer to activity just because work resumed.

Several agents may finish out of order. Group by source-call/task identity, never matching title text. Two “Review tests” jobs remain separate in detail. The parent view shows launches and delivered evidence, not a merged firehose of every child tool and paragraph. Open the existing job inspector or child conversation for that work, where supported.

An actionable late event is different. A saved question, newly failed job needing the person, or uncertain stop must be discoverable now as a main note or question, even if its original group is old. Keep the detailed evidence at its original owner and avoid duplicate notes for repeated delivery of the same fact. If there is no source-call link, retain one honest orphan update in the visible conversation; do not silently attach it to the nearest group.

A disconnect or restart does not prove remote work stopped. Use current typed task state when available. Otherwise show unknown, not a revived spinner or a success tick. Source and placement details stay in expansion; remote text is never treated as permission or a human answer.

## Failures, questions, and interruption

### What must stay visible

Do not bury pending human decisions. Existing /questions access remains. A future standalone question projection should retain the actual question, choices when available, and which work waits as a lasting main item. This card is not already supplied by the current runtime. A question from a tool result must not become merely the latest rolling stdout.

An active tool failure shows its concise failure state in the preview and failure count in the summary. If the agent can continue and repairs it, the failed attempt remains visible in expanded history and in the summary count; the final answer can explain the recovery. Do not permanently pin every failed probe as a red warning.

When failure blocks progress or the agent yields without explaining it, leave one main note with a short reason and path to details. Suppress a duplicate card only when a typed link proves it is the same note; do not guess equivalence from an answer’s wording. “Couldn’t save full output” remains visible when an artifact is unavailable. “Stop requested; completion not confirmed” stays uncertain until evidence changes.

Actionability is not always a field in ordinary errors. Prefer typed needs-input/question/storage/cancellation evidence. Generic unrecovered error at a yield is visible by default. Do not claim the UI can infer whether every shell error matters to the person.

### Interrupt versus stop

An ordinary speech/input interruption is not a request to stop jobs. End the foreground rolling stretch honestly, retain any emitted assistant text as “Interrupted response” if no final answer was reached, and keep the count inspectable. Do not silently discard partially streamed text.

For an explicit stop request, show the request/result the existing stop operation reports. Pending cancellation is not “Stopped.” If work remains running or unknown, the summary and a useful note say so. Stopping Live and stopping jobs remain separate operations; this display proposal does not couple them.

A user message arriving while work runs stays visible immediately. Freeze the preceding preview/group as interrupted or yielded according to the host event, and give the new stretch its own activity area. Old job completions still update their launch group. They must not replace the new user’s preview. Exact steering versus new-turn semantics follow the host, not a UI guess.

## Open, close, and read the details

Opening “15 tools called” reveals **all work represented by that count**: the familiar compact per-call rows, complete available commentary, and current linked job states. It does not dump every source block and log at once. Each native tool row keeps its click-to-expand details; Ctrl+O remains the all-details route. Original captured result and latest observed job state should be distinguishable; do not rewrite old stdout to look like the new state was known then.

Reuse native expanded tool/image presentation where possible. Keep original call ordering even if results arrive out of order. Show the result under its call, with an honest pending/missing-result indication where needed. Do not introduce a second copy of the execution source or flatten all tools into one generated paragraph.

### Pointer

Recommended behavior using Pi’s verified mouse seam: click the summary row to toggle this group, including a settled group. The click target is the whole visible summary, not a one-cell triangle. Clicking body text does not collapse it. Text selection, copy, scrolling, and artifact/link actions must still work. Clicking an artifact is not a group-toggle gesture.

A running group can be opened. New events update it, but do not force it closed, jump selection, or constantly scroll the detail view. Clickable support must be verified in the actual compiled CLI and supported terminal modes, not just by calling a handler in a unit test.

### Keyboard

Pi's current Ctrl+O is global: it finds direct expandable children of the transcript. Keep its meaning as **show/hide all tool details**. Opening all details must also expose their containing groups. Bridge that enumeration rather than quietly dropping nested tools or changing Ctrl+O to “latest group only.”

No usable native per-group focus navigation was found. Recommend a small **/activity picker** for individual groups. List them by user-request excerpt or follow-up context, tool count and unresolved status; newest first. Up/Down selects, Enter opens/closes that group and returns to its summary, Escape leaves the view unchanged and returns to the editor. Mark open groups. Reuse existing picker controls; no always-visible focus bar or new panel framework.

This is a proposed new command, not one available today. A help hint should make it discoverable. Mouse-disabled users must be able to open an old group, read/copy evidence, close it, and return without copying IDs. Test how choosing an offscreen group brings its summary into view.

Expansion is a view choice. It does not re-execute tools, inspect a remote machine, resume jobs or grant permissions. Fetching an artifact uses its existing explicit action. Closing returns to the same summary and keeps conversation position.

## Scrolling, images, and small terminals

When the person is following the bottom, replace the live preview in place without leaving tool ladders in terminal scrollback. When they scroll up to read, do not yank them down on every tool output or background completion. Reuse the terminal’s existing follow/scroll behavior where it exists; the Pi report confirms row-offset scrolling, not semantic item anchoring.

Keep the clicked summary visible when its group opens. The probe showed that current bottom-follow does not do this automatically: the header scrolled away. Recommend suspending follow for the explicit toggle and restoring it when the person returns to the bottom. The spike must verify the required scroll API; a broad scroll-engine rewrite is not authorized.

Anchor to the viewed conversation item when a group above it changes height. Toggling a visible group keeps its summary near the same screen location. Collapse returns to that summary, not the end of the entire session. A resize rerenders at the new width and preserves the chosen group/open state where possible. No smooth-animation or virtual scrolling project is needed.

If the terminal mode cannot rewrite offscreen rows or maintain these anchors, state the limit. Do not promise retroactive removal from primary-buffer scrollback. The intended rolling behavior is for bruv’s controlled interactive viewport. Print, JSON, RPC, exported logs, and model history keep their existing event/data contracts.

Tool-produced images and artifacts remain attached to their call in detail. In collapsed activity, show a compact artifact cue such as “Captured screenshot · 1 image” rather than dumping a tall image into a three-row preview. Opening uses the native image component/protocol; the current task adapter explicitly preserves those children. Test that grouping does not leave stray rendered image cells or lose the image on collapse/reopen.

If an image is the requested result, it must remain easy to reach from the final answer or a lasting artifact note. Do not make the only deliverable disappear behind an unlabeled count. The assistant’s final-answer images remain main answer content. Artifact paths retain their real placement and availability; SSH/source files are not assumed to exist on the laptop. No automatic download or new artifact transport is in this scope.

At narrow width, prioritize a disclosure cue, count, and unresolved outcome before a long description. Example: “▸ 15 tools · 1 failed” beats a truncated long task name that hides failure. Wrap main answers/questions normally. The tool preview can clip with a clear affordance; pending assistant text remains readable. At a very short terminal, keep the editor and existing essential controls usable; do not promise a three-row activity body where it cannot fit. The picker/expanded view must have a way back. Sanitize tool control sequences as existing renderers do.

## Concrete walkthroughs

These examples show the target with explicit activity/answer/note intent. Without that signal, unknown settled prose stays visible, even if the next step is a tool. Expansion retains the underlying evidence unless it was never captured or is no longer available.

### 1. Ordinary edit and test

**Before, original baseline:** user request → “Read the file” row → “I found the issue” paragraph → “Patch the file” row → “Run tests” row → final answer.

**During:** one group grows from 1 to 3 tools. Its body alternates between the current label and the interim sentence. A passing test output does not add a row to the main conversation.

**After:** user request → “3 tools called” → “Fixed the parser. The parser tests pass.” Open the group for the read, patch, test output, and interim text. The test result proves only the tests actually run.

### 2. Answer with no tools

**Before:** “What does this error mean?”

**During:** assistant text streams readably in the activity position while its boundary is still pending. A long explanation is not hidden until completion.

**After:** the full explanation is the main answer. No empty disclosure and no “0 tools called.” If multiple interim messages preceded it, their optional “Activity” disclosure can hold those messages; do not count them as tools.

### 3. Fifteen small calls and two updates

**Before:** “Find where this setting comes from.”

**During:** “Read config defaults” → “Search environment overrides” → “The value is replaced during startup” → “Read startup order.” Only the latest preview is visible. The header says “15 tools called,” not “17 actions.”

**After:** the source locations and conclusion remain in the answer. “15 tools called” opens all fifteen calls plus both commentary messages, not a generated summary of just the last search.

### 4. Text and tool calls in one provider message

**Before:** “Check the migration.”

**During:** “I’ll compare both schemas” takes the preview, then the same message’s tool-call block replaces it with “Compare schemas.” Another provider emitting those as two messages gets the same screen.

**After:** only the yielded conclusion is the main answer. Do not freeze “I’ll compare both schemas” as a final just because a message component was briefly complete.

### 5. A tool fails, then the agent fixes its approach

**Before:** “Run the integration check.”

**During:** “Run integration check — exit 1,” then “The local fixture wasn’t started,” then “Start fixture,” then “Run integration check.” The active failure is visible; the next step replaces its preview.

**After:** “3 tools called · 1 job failed” if the nonzero shell result was a nested job, or “1 tool failed” if the execute itself failed. Answer: “The first run lacked the fixture. After starting it, the check passed.” Expansion keeps both runs. No permanent main warning says the task is still broken.

### 6. Failure that needs the person

**Before:** “Fetch the private dependency.”

**During:** the fetch fails with missing credentials. A saved permission/question flow stays visible outside activity. The group can say “1 tool called · needs input.” The question is not replaced by “Read package config.”

**After:** the blocker or question remains even if the agent yields without a prose explanation. Opening details shows the actual error. Answering does not imply a grant beyond the saved choice, and expanding does not retry the fetch.

### 7. One execute launches several jobs

**Before:** “Review the API and UI in parallel.”

**During:** “1 tool called · 2 jobs running,” preview “Start API and UI reviews.” Child logs do not compete for the parent preview.

**After first yield:** “1 tool called · 2 jobs running,” followed by “Both reviews are running. I’ll combine their findings.” That answer stays.

**Later:** API review finishes; the old summary now has one running job. The parent reads its result in a new group. UI review finishes while the parent is testing; its result updates the old group, not the testing preview. The combined conclusion becomes a new answer. Tools inside either child are not parent tool counts.

### 8. Late result after another user request

**Before:** request A launches a review and yields. User asks B: “Meanwhile, explain the deploy config.”

**During B:** the preview says “Read deploy config.” A’s completion updates A’s group without replacing B’s preview. If A now needs a human decision, its saved question appears with A’s context.

**After:** B’s answer remains under B. A’s follow-up answer appears as a separate continuation if the host dispatches it. The view does not silently move an answer across user messages to make grouping neat.

### 9. Empty output, partial label, and big output

**Before:** “Check that the file exists.”

**During:** code streams before the label; a neutral running indicator appears, not source. “Check file presence” replaces it when available. An empty stdout leaves a supported result state, not a blank transcript row.

**After:** the evidence is in detail. A different call with megabytes of output leaves the same short summary and existing clipped output/artifact reference. “15 tools called” does not promise uncapped full logs if the tool never retained them.

### 10. Interrupt, then explicitly stop

**Before:** a long check is running; the assistant has streamed half a sentence.

**During interrupt:** user says “Wait, only check the parser.” Keep that user message and mark the old partial response as interrupted. The old job is not declared stopped.

**During explicit stop:** a later “Stop that check” triggers the existing operation. If its result is pending, show “Stop requested; not confirmed,” outside replaceable activity. New work must not erase that uncertainty.

**After:** counts reflect attempted calls. Completed/cancelled/unknown jobs keep distinct states. No successful-looking final is synthesized from the absence of output.

### 11. Reopen, reload, and switch branch

**Before:** a session has several settled groups and a job that was running when the terminal closed.

**During reopen:** reconstruct groups from the selected branch. Show known finished results; use unknown for the old running state until refreshed. Direct --session startup, in-app /resume, and /reload must agree. Reload does not count old tools again.

**After branch switch:** sibling-branch tools and notes are absent. A late callback from the old branch cannot mutate the new branch’s preview. Replay renders captured history; it does not execute tools or start a spinner as if historical work were live. UI expansion need not survive a process restart in the first version; content and counts must.

### 12. Screenshot as the deliverable on a small screen

**Before:** “Show me the settings screen.”

**During:** “Capture settings screen · 1 image” fits in the preview. A narrow terminal retains an image/detail cue and the count, not raw image escape payload as text.

**After:** the answer exposes the screenshot or a clearly labeled artifact action. Expanding the group shows the native image and capture evidence. Collapse/reopen and resize do not orphan the image. If storage failed, the warning stays visible; do not show a working artifact action for a missing file.

### 13. A caveat followed by more work

**Before:** “Update the schema.”

**During:** assistant says “This migration deletes legacy rows,” then calls a tool. That is a meaningful note in human terms, but ordinary text may have no marker. It must not be described as solved by punctuation heuristics.

**Proposed outcome:** an explicitly marked caveat remains main conversation; routine next-step prose rolls. Without a supported intent signal, retain this unknown prose in the main conversation. The next tool does not erase it. User approval of rolling narration is not blanket approval to hide data-loss caveats.

### 14. Final answer before all work is done

**Before:** “Run a long build and tell me when it is started.”

**During:** “Start build” is the preview.

**After:** “1 tool called · 1 job running” and “The build is running.” This is a lasting answer, not a success claim. The eventual build failure is a useful follow-up note/answer; it does not make the earlier truthful launch answer retroactively commentary.

## Scope and ownership for later implementation

Recommend the **local CLI alternate-screen view first**. Keep regular/primary-screen mode's current sequential presentation; it cannot erase already-emitted scrollback. Print, JSON, RPC, exported logs and model context keep their current contracts. This proposal does not change the default terminal mode. State the scope in help; do not advertise rolling/click behavior where it does not exist.

Placed-root has a separate flattened-line presenter, bounded remote history, global expansion and no grouped click handler. Leave it unchanged in the first slice; adapting that presenter is a distinct follow-up. Web and Live are outside this proposal. Do not silently expand into remote protocols or claim parity from local screenshots.

The seam is one bruv-owned **conversation presentation projection**. It decides lasting entries, activity groups and the current preview from existing source messages. Individual native components still own tool/image detail; existing task/question systems still own state. Consolidate or evolve the current adapters rather than stack another unrelated global Container hook or create a second transcript/event ledger.

A public working-message/widget can host a rolling slot but cannot hide existing rows. Preserve pending-tool maps, sibling-based task ownership and native global expansion when wrapping source components. The integration seam needs a bounded spike, since Pi exposes no public replace-normal-transcript API. Any needed host adaptation stays focused and version-checked.

Do not change execution, agent models, task scheduling, permissions, question dispatch, source snapshots or releases to obtain a quiet view. A new optional presentation intent is a separate explicit design change, not permission to rewrite provider payloads.

## Recommended decisions and remaining gates

Recommend:

- One rolling foreground preview per work stretch; prior groups remain collapsed and inspectable.
- Count unique outer tool calls, not helper invocations or task notices.
- Click opens familiar per-call rows; native per-call detail and global Ctrl+O remain. /activity supplies per-group keyboard access.
- Local alternate-screen scope first; other surfaces keep their current view.
- Keep unknown prose visible. The full experience needs explicit activity/answer/note intent at a supported message boundary.
- At most three rows for tool previews; a possible final answer streams readably. No new settings matrix.
- Failed attempts remain in the count/history after recovery, but are not branded as an unresolved project failure.

Before extending beyond the existing tool-only slice, resolve these gates:

1. **Presentation intent:** choose the smallest typed route for activity/answer/note and show it on both live and saved messages. OpenAI-specific phase is useful evidence, not a cross-provider contract. If intent is not ready, do not claim rolling all assistant prose is safe.
2. **Durable boundaries:** retain the existing call-ID marker and selected-branch segmentation. Decide whether exact yield reason/continuation cause is needed; neither is encoded by that marker today. If needed, specify the minimal missing journal fact and an honest legacy rule, not a new ledger. Counts must not change merely because the session reopened.
3. **Host integration and scroll:** reuse the direct-sibling projection and explicit-toggle anchoring already in develop. Verify any new prose replacement/height behavior with retained task owners, Ctrl+O and /activity in a resized, scrolled-up compiled CLI, not only a fresh mock screen.

These are bounded design/spike questions, not implementation authorization. The user can review the target and trade-offs now. Do not block the proposal on glyphs, colors, durable expansion preferences or every old-history anomaly. Do block shipping claims on lost notes, hidden questions, false task state or inaccessible details.

## Acceptance plan after proposal approval

This document is not implementation proof. A later change should pass these focused checks and one real rendered flow review, not an exhaustive new state-machine suite.

### Projection checks

- One group for the ordinary edit/test stretch; main conversation keeps user and full yielded answer. Explicit activity prose and tool rows are present in detail, absent as separate collapsed entries; unknown prose and marked notes remain visible.
- Tool identity counts once across streaming/start/result and repeated delivery. One execute/many jobs, child tools, actual retry, missing result, and nested failure use honest counts/status.
- Concurrent call results do not replace the newer preview. Late completions update their source group; a new user message and automatic continuation get their own boundaries.
- Saved questions, unknown custom messages, actionable failures, storage warnings, and uncertain stop remain accessible and not replaceable. Explicit note policy is tested at the actual message path if added.
- Rebuild-before-install and install-before-rebuild agree. Selected-branch reconstruction does not expose sibling history or treat replay as live work.
- Expansion uses current details without dropping original result evidence, images, or artifact placement. Grouping does not change rejection/cancellation behavior of tools.

### Compiled CLI human proof

Use deterministic local inference/fixtures, with no paid provider or real remote host required. Capture actual screens from the built CLI, not only component snapshots. Inspect the frames.

1. Natural edit/test flow with several tools, interim prose, and a final answer. Look during each replacement and after settlement. Expand an old group, then collapse it.
2. Mouse toggle if claimed; keyboard-only discovery/open/close regardless. Select/copy output, open an artifact, and confirm an unrelated click is not a toggle.
3. Start parallel background work; yield; send another request; finish jobs out of order. Observe the current preview, old group status, question, and follow-up answer.
4. Fail once and recover; fail with a human blocker; interrupt and explicitly request stop. Check that pending cancellation is not shown as done.
5. Scroll up while activity continues, expand/collapse above the reading position, and return to the bottom. Resize to a narrow/short terminal. Confirm no unreadable control traps or hidden failure marker.
6. Close/reopen, in-app /resume, /reload, and switch branch. Compare counts, final answers, uncertain work, and detail. No extra calls or sibling content appear.
7. Capture and reopen an image/artifact; verify the native rendering survives collapse/resize and a missing artifact warns honestly.

Reuse the existing terminal probe infrastructure where it fits. Record unsupported terminal behavior and any legacy-history limitation rather than imply universal click or scroll support. Web and placed-root keep their existing behavior in this first slice. Test them when a later change claims parity.

## Original handoff and review (2026-10-02)

This is a docs-only proposal for review, not an approved implementation. No runtime files changed. The [research](rolling-activity-research.md) records exact source paths, Pi 1.0.0 behavior and bounded component probes. Its possible alternatives are research notes; the recommendations above are the reconciled design.

Draft worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_4abbe161. Branch: bruv/draft-rolling-activity-transcript-propos-4abbe161. Draft commit: 2cfd3166. Research worktree/branch are in the research receipt; aa639102 was integrated here as 70d2d5ec. Proposal PR: https://github.com/tnfssc/bruv/pull/23 against develop. It is open for design review; do not merge or implement without the user’s next decision. Base: eb07b0d7, after published v0.15.28.

The original parent reviewed the source and examples, reconciled click/keyboard facts, recommended a safe default for unknown prose, and kept initial scope local. One real local session checkpoint had 86 outer execute calls, 19 canonical task IDs, 19 custom notices and 8 assistant text messages. Those are different measures, not a reason to present an invented combined “tools” count. This is an illustrative sample, not a benchmark or general usage claim.

Wisdom added: this proposal and its research. Values unchanged after cross-review: existing honest-UI, one-owner, simple-state and real-path proof values cover the lessons. Keep the caveat, late-job and replay examples in the approval discussion; a clean happy-path sketch alone is not enough.
