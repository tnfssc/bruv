# Rolling activity, lasting conversation

**Proposal only.** No runtime change, dependency change, release, or PR creation. The first implementation scope would be the local interactive CLI. This document asks for a design decision before that work starts.

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

The current compact UI already solves a smaller problem: one short labeled row per call, canonical task rows, and fewer routine notices. It does not solve the long staircase left by many calls and assistant updates. Earlier work explicitly deferred grouping. This proposal makes that next decision; it does not reinterpret those earlier releases as broken.

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

## What the code gives us, and what it does not

Repository baseline for this research: the manifest pins the Pi packages to **1.0.0**. Older wisdom references to Pi 0.99.1 are historical, not current API proof.

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

### Mouse support: evidence, not a promise

The repository already imports mouse event types and forwards handleMouse on adapted components. The task adapter comments say Pi records child heights for mouse dispatch. That is evidence of mouse-aware rendering in this integration. It is **not yet proof** that a new summary can be clicked in every shipped terminal mode, that alternate-screen scrollback behaves as needed, or that there is a public grouping API.

A parallel research worker is checking the exact Pi APIs, buffer mode, data, and render owner. Parent must reconcile that report here before an implementation proposal promises click support. Alternate-buffer support alone does not establish clickable transcript rows. Keyboard access is required either way; terminal mouse support is a convenience, not the only path.

## Main conversation versus activity

Use a small set of content rules. Do not invent a prose classifier, sentiment detector, or a long taxonomy of events.

### User messages

Always keep them as main conversation entries. A user message also provides a natural boundary for the activity immediately before it. Saved question answers keep their existing ownership; do not fabricate a duplicate user chat message if the question system does not store one.

### Assistant answer

For the first design, an **answer** means assistant text at a yield to the person, not a claim that every job is finished. A handoff such as “I’ve started the review; you can keep talking” is still a lasting answer. A later automatic continuation can yield another answer.

While a plain assistant text stream arrives, show it in the rolling area until its intent is known. Let it stream readably as a provisional answer; do not force the person to wait for the last token to read a long response. If it is the last visible assistant text when the agent yields, promote that same content to the main conversation and clear the preview. Do not render it twice. If another tool follows, that text becomes commentary in detail and the tool replaces its body. This can change the area’s height, but does not leave a second conversation entry.

If the assistant says “I’ll inspect the settings” and then invokes another tool in the same stretch, that text stays in activity. If one provider emits text and calls in one message and another emits separate messages, the visible result should be the same. A message-end event alone must not prematurely freeze the first paragraph as an answer.

An explicit handoff() result already has presentation meaning. Preserve its yielded text instead of letting the next background event erase it. Exact host event sequencing still needs the API report.

If the agent yields with no assistant text, leave the summary and an honest short status if needed: “Stopped before an answer,” “Waiting for review,” or “No answer returned.” Never invent a user-facing answer from a tool’s stdout.

### Commentary

Commentary is routine assistant prose within ongoing work, later followed by another step before the yield: “I found the old setting,” “Now I’ll run the tests,” or “The first path was wrong.” It takes the rolling slot, and the next foreground activity replaces it. The original text remains in expanded history.

Do not identify it by length, punctuation, or words like “I’ll.” A long interim analysis may still be activity; a one-line final answer may still be the answer. Thinking remains under the existing thinking control, with no new placeholder or lowered reasoning setting.

### Meaningful note

A meaningful note changes what the person needs to know or do while work continues: a saved question, a permission request, an unrecovered blocker, an uncertain cancellation, or a failure to save output that would otherwise look available. Keep these visible outside the replaceable slot.

Existing typed question/task/error/artifact data can supply some of these notes now. Ordinary assistant prose does not have a proven “keep this note” field in the inspected paths. We should not guess that “Warning:” makes a durable note. If product needs the agent to mark a note before the next step, prefer a small explicit presentation intent in the existing message path, **subject to API research and separate approval**, not a new note store or tool invented in this proposal.

Until such intent exists, text at an actual yield stays visible, and unknown custom messages stay visible by default. This is a real limitation for an important ordinary-text caveat followed immediately by a tool. Resolve it before claiming that every important agent note survives automatically. Do not hide generic unrecognized content merely to make the screen clean.

A note is not another final answer. Show the important fact once, with a link to its evidence. If a pending question becomes answered, keep its question history but remove the active “needs input” status. Work is not automatically resumed by a display toggle.

## Counts and group boundaries

**Count actual top-level tool invocations visible in the selected branch.** Use protocol call identity, not labels. A start counts once; a result updates the same call. Streaming arguments, retries of delivery, task completion notices, assistant commentary, questions, and toggle clicks do not add tools.

One execute that starts three shell jobs and two agents is **one tool called**, with five linked jobs in its detail. It is not six tools. Calls made inside a child agent belong to that child’s transcript, not the parent’s tool count. A parent inspect call is another parent tool. A genuine retry with a new call identity counts again, even if the label matches.

Count attempted calls, including failures, cancellations, and calls whose result is missing. For a streamed call, count once its tool-call identity and name are known; partial argument chunks do not increment it. History with a result but no recoverable call identity should show “Unpaired tool result” in detail, not invent a call. Legacy incomplete history may need “Tool count unavailable”; do not reconstruct numbers from prose.

Suggested settled labels:

- “1 tool called” / “15 tools called” for ordinary groups.
- “15 tools called · 1 failed” when typed failure evidence exists.
- “3 tools called · 2 jobs running” when work continues after the answer.
- “3 tools called · status unknown” after reopen without fresh job evidence.
- “Activity” for commentary-only work that is worth inspecting; do not leave “0 tools called” between an ordinary no-tool answer and its user message.

Failure counts in the summary refer to tool calls unless labeled as jobs. An execute may return normally while a nested job fails. Use “1 job failed,” not “1 tool failed,” for that case. Do not infer task totals from a capped preview. When evidence is incomplete, expose uncertainty instead of a precise-looking count.

A group starts with the first activity after a user message or an automatic continuation. It ends at a yield, an interrupt/stop boundary, a new user message, or a branch/session change. A lasting note or question can sit inside that stretch without splitting it into a new count. The summary occupies the activity’s original position in the conversation; the answer follows it. Keep the note at its actual conversation position, even if tools continue afterward. Expanded activity can refer to that note for chronology, but should not duplicate its full card.

Do not merge everything between two user messages forever. Background continuations can happen without another user message. Each yielded answer ends its own stretch. A continuation that does new tools gets a new group and, if useful, a small “Review follow-up” context label. A notice that only updates a known task does not create a new group.

These boundaries should be reconstructed from branch entries and existing lifecycle facts where possible. If old persisted data cannot recover a yield boundary, use a stated conservative legacy grouping rule rather than fabricate exact original timing. Whether a tiny durable boundary marker is needed is an open implementation question. Do not add an activity ledger before proving the existing journal lacks the needed fact.

## One preview, honest live state

The summary stays discoverable while its body changes. The body shows the latest **foreground step**, not whichever background event happens to arrive last.

- Starting a tool replaces the prior tool or commentary preview with its short label and existing running indicator.
- Output/result updates change that step’s current detail. They do not append new default transcript rows.
- A later assistant interim update replaces the tool preview. A later tool replaces that text.
- When a tool finishes but the model has not answered yet, show its settled preview briefly; retain “working” or “waiting for response” at group level. Tool done is not agent done.
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

Do not bury pending human decisions. Saved questions remain main conversation items and accessible through /questions. Display the actual question, choices when available, and which work waits. A question from a tool result is not merely the latest rolling stdout.

An active tool failure shows its concise failure state in the preview and failure count in the summary. If the agent can continue and repairs it, the failed attempt remains visible in expanded history and in the summary count; the final answer can explain the recovery. Do not permanently pin every failed probe as a red warning.

When failure blocks progress or the agent yields without explaining it, leave one main note with a short reason and path to details. The answer may itself provide that explanation; avoid a redundant note if the answer clearly carries the same typed blocker. “Couldn’t save full output” remains visible when an artifact is unavailable. “Stop requested; completion not confirmed” stays uncertain until evidence changes.

Actionability is not always a field in ordinary errors. Prefer typed needs-input/question/storage/cancellation evidence. Generic unrecovered error at a yield is visible by default. Do not claim the UI can infer whether every shell error matters to the person.

### Interrupt versus stop

An ordinary speech/input interruption is not a request to stop jobs. End the foreground rolling stretch honestly, retain any emitted assistant text as “Interrupted response” if no final answer was reached, and keep the count inspectable. Do not silently discard partially streamed text.

For an explicit stop request, show the request/result the existing stop operation reports. Pending cancellation is not “Stopped.” If work remains running or unknown, the summary and a useful note say so. Stopping Live and stopping jobs remain separate operations; this display proposal does not couple them.

A user message arriving while work runs stays visible immediately. Freeze the preceding preview/group as interrupted or yielded according to the host event, and give the new stretch its own activity area. Old job completions still update their launch group. They must not replace the new user’s preview. Exact steering versus new-turn semantics follow the host, not a UI guess.

## Open, close, and read the details

Opening “15 tools called” means opening **all work represented by that count**, not just the latest label. Show chronological calls, complete available assistant commentary, existing source/output/error presentation, and current linked job states. Original captured result and latest observed job state should be distinguishable; do not rewrite old stdout to look like the new state was known then.

Reuse native expanded tool/image presentation where possible. Keep original call ordering even if results arrive out of order. Show the result under its call, with an honest pending/missing-result indication where needed. Do not introduce a second copy of the execution source or flatten all tools into one generated paragraph.

### Pointer

Desired behavior, subject to Pi proof: click the summary row to toggle this group, including a settled group. The click target is the whole visible summary, not a one-cell triangle. Clicking body text does not collapse it. Text selection, copy, scrolling, and artifact/link actions must still work. Clicking an artifact is not a group-toggle gesture.

A running group can be opened. New events update it, but do not force it closed, jump selection, or constantly scroll the detail view. Clickable support must be verified in the actual compiled CLI and supported terminal modes, not just by calling a handler in a unit test.

### Keyboard

Keep existing Ctrl+O access to tool detail; do not silently take its binding away or change it into “most recent group only.” Parent must confirm the exact upstream global-expansion behavior before deciding how it maps to grouped details.

For per-group keyboard access, recommend a small **/activity picker** if Pi does not already offer usable transcript focus/navigation. List groups by user-request excerpt or follow-up label, tool count, and unresolved status. Up/Down selects, Enter opens or closes the selected group’s detail, Escape returns to the editor. Use the existing picker conventions, not an always-visible focus bar or a new panel framework. No copying IDs for a routine toggle.

Prefer existing native transcript focus and Enter/Space if API research proves that flow is usable. Do not ship both navigation systems by default. The precise route is deliberately open, but **keyboard discovery and access to an old settled group are acceptance requirements**, not optional polish. A help hint should say how to open details without claiming a mouse works when it does not.

Expansion is a view choice. It does not re-execute tools, inspect a remote machine, resume jobs, or grant permissions. Fetching an artifact may use its existing explicit action. Closing returns to the same summary and keeps conversation position.

## Scrolling, images, and small terminals

When the person is following the bottom, replace the live preview in place without leaving tool ladders in terminal scrollback. When they scroll up to read, do not yank them down on every tool output or background completion. Reuse the terminal’s existing follow/scroll behavior where it exists; exact capabilities need the Pi report.

Anchor to the viewed conversation item when a group above it changes height. Toggling a visible group keeps its summary near the same screen location. Collapse returns to that summary, not the end of the entire session. A resize rerenders at the new width and preserves the chosen group/open state where possible. No smooth-animation or virtual scrolling project is needed.

If the terminal mode cannot rewrite offscreen rows or maintain these anchors, state the limit. Do not promise retroactive removal from primary-buffer scrollback. The intended rolling behavior is for bruv’s controlled interactive viewport. Print, JSON, RPC, exported logs, and model history keep their existing event/data contracts.

Tool-produced images and artifacts remain attached to their call in detail. In collapsed activity, show a compact artifact cue such as “Captured screenshot · 1 image” rather than dumping a tall image into a three-row preview. Opening uses the native image component/protocol; the current task adapter explicitly preserves those children. Test that grouping does not leave stray rendered image cells or lose the image on collapse/reopen.

If an image is the requested result, it must remain easy to reach from the final answer or a lasting artifact note. Do not make the only deliverable disappear behind an unlabeled count. The assistant’s final-answer images remain main answer content. Artifact paths retain their real placement and availability; SSH/source files are not assumed to exist on the laptop. No automatic download or new artifact transport is in this scope.

At narrow width, prioritize a disclosure cue, count, and unresolved outcome before a long description. Example: “▸ 15 tools · failed” beats a truncated long task name that hides failure. Wrap main answers/questions normally. The tool preview can clip with a clear affordance; pending assistant text remains readable. At a very short terminal, keep the editor and existing essential controls usable; do not promise a three-row activity body where it cannot fit. The picker/expanded view must have a way back. Sanitize tool control sequences as existing renderers do.

## Concrete walkthroughs

Each example describes the default view; expanding always keeps the underlying evidence unless it was never captured or is no longer available.

### 1. Ordinary edit and test

**Before, today:** user request → “Read the file” row → “I found the issue” paragraph → “Patch the file” row → “Run tests” row → final answer.

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

**Proposed outcome:** an explicitly marked caveat remains main conversation; routine next-step prose rolls. If no supported marker is approved, the spec must state the limitation and choose a safe interim treatment. Parent should settle this before implementation; user approval of rolling narration is not blanket approval to hide data-loss caveats.

### 14. Final answer before all work is done

**Before:** “Run a long build and tell me when it is started.”

**During:** “Start build” is the preview.

**After:** “1 tool called · 1 job running” and “The build is running.” This is a lasting answer, not a success claim. The eventual build failure is a useful follow-up note/answer; it does not make the earlier truthful launch answer retroactively commentary.

## Scope and ownership for later implementation

Initial scope: local interactive CLI conversation projection, disclosure controls, and the minimum lifecycle facts needed to reconstruct it. Keep raw session retention and model context unchanged. Do not change tool schemas, agent models, job scheduling, question dispatch, source snapshots, or release settings as a side effect.

The main design seam is the **conversation render owner**, because a group spans assistant, tool, and custom-message components. Existing execute renderers should still own individual detail. Existing task/question systems own evidence and state. Prefer a derived branch-local projection over another persisted event stream. The exact supported owner/hook is pending API research; prototype it before committing to a Container-wide patch.

Placed-root is a separate presenter with local controls and remote history. Web has its own transcript rendering. Neither receives parity for free. A CLI-only first slice is acceptable if called out plainly; decide whether placed-root is part of that first slice, or a documented follow-up, before implementation. Do not silently change remote protocol, expand into web, or claim cross-surface parity from local screenshots. Preserve all existing privacy filtering on every surface touched.

## Decisions still needed

1. **Pi capability and ownership:** exact public hooks, buffer mode, mouse dispatch, group insertion/replacement, and per-group keyboard access. Integrate the parallel worker’s evidence with file/version references. Repository mouse wrappers are a clue, not final acceptance.
2. **Yield reconstruction:** can the selected branch journal reliably distinguish automatic continuation boundaries and a handoff from ordinary message end? If not, choose the smallest durable marker or honest legacy rule. Do not build a new ledger just for exact historic counts.
3. **Important ordinary-text notes:** is there a usable presentation intent today? If not, approve a minimal marker or a safe interim policy. Do not ship an unproven semantic classifier.
4. **Keyboard route:** native transcript focus if proven; otherwise the small /activity picker. Keep Ctrl+O semantics understood and documented.
5. **Placed-root first slice:** include parity now, or clearly limit the first implementation to local CLI. Web remains a separate choice.
6. **Preview bound:** three tool-content rows is the recommended starting point; pending assistant text streams readably. Confirm a long final answer does not jump or disappear on promotion, and test narrow/short terminals rather than adding a settings matrix.
7. **Recovered failures:** recommended summary retains attempted failure counts even after repair; the answer explains success. Check whether this reads as useful evidence or persistent alarm in real use.

Do not block the proposal on glyph/color bikeshedding, restart persistence of expansion choices, or every old-history anomaly. Block implementation claims on lost notes, hidden human questions, false task state, and unusable detail access.

## Acceptance plan after proposal approval

This document is not implementation proof. A later change should pass these focused checks and one real rendered flow review, not an exhaustive new state-machine suite.

### Projection checks

- One group for the ordinary edit/test stretch; main conversation keeps user and full yielded answer. Commentary and tool rows are present in detail, absent as separate collapsed entries.
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

Reuse the existing terminal probe infrastructure where it fits. Record unsupported terminal behavior and any legacy-history limitation rather than imply universal click or scroll support. Only run web/placed-root acceptance if those surfaces are explicitly included.

## Handoff

Parent owns reconciliation with the Pi/API research, final recommendation, and any eventual proposal PR. This worker owns only this document. No runtime changes are authorized by it. After those open decisions are answered, return the reconciled proposal to the user for approval before implementation. Keep the concrete awkward examples in that discussion: a clean happy-path mockup alone is not enough.
