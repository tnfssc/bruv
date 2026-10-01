# UI discussion checkpoint

User now wants to talk through everything the UI shows before more changes. Parent requested cancellation of its quiet-rendering implementation worker task6b26afdc; preserve all partial edits and existing artifacts. Tree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_6b26afdc, branch die/remove-routine-execution-lifecycle-chatt-6b26afdc, base published v0.15.20 (5485b09). No new UI publication authorized by this discussion.

Latest clear correction: routine executing/executed and duplicate running/completed conversation rows are unwanted. Previous short-action-label work is relevant, but exact visibility/layout for each element is now being agreed with the human. Do not guess remaining choices. Keep errors, uncertainty and human decisions honest; internal display:false answers must stay hidden. Full expert details and actual task state need not be removed from explicit inspection.

Next parent turn: discuss inventory one item at a time, save confirmed choices, then resume implementation from preserved tree only after agreement. Values unchanged during discussion; no new lesson before choices.

Cancellation confirmed: task6b26afdc killed, exit143. Last progress (not final): actual local compiled PTY18 assertions passed; label only in-flight/settled, error/truncation/handoff/task outcomes/detail still visible. Root action-caption cleanup/recheck was in progress and remains unverified. Inspection found local draft commitcc7f181 (Keep normal conversation action rows quiet and singular). Source tree is clean; only parent notes/dependency link/probe cache are untracked. Keep draft/artifacts; no push or release. It is not a human-approved UI design. First design question is pending ordinary user reply: show one useful action label or no action row, just assistant text/results? No answer inferred from job output.

## Confirmed: running action row

Shipped local row example: … executing · Read README. User: drop executing, change the icon, the dot is unneeded. Confirmed: no executing word, no middle-dot separator, replace the ellipsis icon. Exact replacement icon is still pending; do not infer it. Review stays one element at a time; no resumed coding or publication yet.

## Confirmed: streamed action lifecycle

User accepts transcript spinner from tool-call start, partial label growing as it streams, stable full label while code arrives and tool runs, then a checkmark plus label on successful completion. Explicitly rejects the alternative plain-label success state. No executing/executed words, separator dot, or duplicate completion row. Failure remains cross+label with useful error; assistant prose follows below. Spinner means action in progress, including preparation, not proof execution has begun.

User wants execute schema to put label before code so the model can emit a useful label first. Check current schema and request serialization; ordering guides generation but does not guarantee provider/model key order. User clarified: change schema field order only; do not add a prompt instruction asking the model to emit label first. UI must not leak raw partial code if code arrives first; it can keep spinner until label arrives. Still discussing design, not resuming broad implementation automatically. Prior local draftcc7f181 used plain labels; it is NOT the newly agreed spinner/checkmark design.

## Confirmed: successful tool output

User agrees ordinary successful text output stays collapsed behind the single ✓ action-label row. Existing Ctrl-O reveals code and output. This choice does not decide image rendering or failure detail length. Continue one item at a time; implementation remains paused.

## Confirmed: failed actions

User agrees failed action shows ✗ plus action label, with a useful error underneath automatically (example: Permission denied). No execute failed boilerplate or separator dot. Full details remain behind Ctrl-O. Error summarization/length beyond this example is not yet decided.

## Confirmed: truncated successful output

User agrees truncation notice is not on the collapsed successful action row. Keep ✓ plus action label. Show truncation honestly when output is expanded. This does not hide failure or output-save errors.

## Confirmed: output-save errors

User agrees output-save failure remains visible underneath the action row: ✓ Read large file, then ⚠ Couldn’t save full output. Keep action outcome separate from output persistence failure; full output may be unavailable.

## Confirmed: image-count text

User agrees remove image-count text (for example 1 image) from the collapsed action row. Keep ✓ plus action label. The image itself stays available; no image transport/rendering change is implied.

## Confirmed: background-job counts

User agrees remove background-job count from collapsed launch action row. ✓ Start tests means launch succeeded, not that tests passed. Actual ongoing task state remains in task list and task notices, which still need discussion.

## Confirmed: hidden thinking placeholder

User wants to remove the thinking triple-dot placeholder when thinking is hidden. Render no transcript placeholder for hidden thinking. This does not change visible thinking mode or the separately agreed tool-action spinner. Background-task completion proposal (drop finished, retain checkmark+task title) was asked but NOT answered; keep it pending. Implementation remains paused for this line-by-line discussion.

## Confirmed: successful background-task completion

User now agrees successful task completion notice is ✓ plus human task title, without finished. It means the task ended successfully, not parent review/acceptance of its work. Existing fallback identity remains when no title exists. Hidden-thinking placeholder removal above remains independently confirmed.

## Revised and confirmed: one background-task row

User caught duplicate success: ✓ Start tests at launch, then another checkmarked completion later. This supersedes the earlier separate checked launch-row choice. For background work use ONE task row with static ↗ plus task label while active (example ↗ Run tests). No background spinner and no separate launch-success row. When actual task finishes, update that SAME row to ✓ Run tests; if failed, ✗ Run tests with useful error underneath. User explicitly approved static ↗. Foreground action spinner remains a separate confirmed choice. Launch failure should resolve on the same row with error, not fabricate a successful task. Mapping launch to actual task(s), batches and reopened sessions still needs design/implementation review; do not infer new grouping or backend state from text. Implementation remains paused.

## Confirmed: cancelled tasks

User agrees cancelled task row uses ⊘ plus task label, with Cancelled underneath. Cancellation is distinct from failure; update the existing task row, not a second completion row. This represents confirmed cancellation, not a merely pending stop request.

## Revision requested: vertical space

User says vertical space is valuable and asks to reconsider ALL earlier choices that changed a single item from one line to two. Prior underneath-error, output-save warning, failed-task reason, and Cancelled second-line layouts are reopened, not final. Timed out underneath was proposed but never accepted. Aim for compact single-line summaries; full diagnostics can remain expanded. Do not silently reintroduce routine executing/executed chatter or duplicate task rows. Review revised examples one at a time with user before implementation.

## Revised and confirmed: compact cancellation

User agrees single-line ⊘ Run tests — cancelled. This replaces the previously approved two-line cancellation layout. Keep confirmed cancellation distinct from pending stop. Other reopened error/warning/timeout layouts still await individual review.

## Revised and confirmed: compact failed action

User agrees single-line ✗ Read README — permission denied, with full error details on expansion. This replaces the earlier automatic second-line error layout for actions. Other reopened layouts remain pending.

## Revised and confirmed: compact failed background process

User rejected invented test counts: task UI cannot reliably infer 2 tests failed. Agreed example: ✗ Run tests — exit 1, based on actual structured process exit code; actual output remains available on expansion. Never invent counts or parse arbitrary prose into outcome claims. Exit code applies only when recorded (not every agent task has a process exit code); absent-code wording is not settled by this example. This replaces failed-task second-line prose.

## Confirmed: compact timeout

User agrees single-line ✗ Run tests — timed out, only for an actual recorded timeout. No second reason row. Update existing task row; full details remain expanded.

## Confirmed: compact output-save warning and discussion batches

User agrees single-line ✓ Read large file — ⚠ couldn’t save full output. Action success stays distinct from output persistence failure. This replaces prior second-line warning. User now wants FIVE UI items at a time rather than one. Continue discussion, not coding.

## Confirmed: next five task notices

User approves: failed task without exit code → ✗ Review guide — failed; unknown task → ? Review guide — status unknown; hide routine quiet5m and review10m transcript notices (agent checkpoint delivery/timing stays intact); human-action notice → ? Review guide — needs your input, use title when actually available. Update existing task rows where applicable; never turn uncertainty into success/failure.

Discussion format correction: FIVE simple Previous/Proposed pairs. No code fences, explanatory headings, surrounding jargon, or repeated rationale. User approved this batch; keep implementation paused until design discussion done.

## Confirmed: capped task summary wording

User approves: ✗ 2 omitted tasks failed → ✗ 2 more tasks failed; ✗ 2 omitted tasks cancelled → ⊘ 2 more tasks cancelled; ? 2 omitted tasks unresolved → ? 2 more tasks unresolved; hide 3 more checks; ? Task completion · unknown task update → ? Task update — status unknown. Counts must come from actual structured aggregates. Do not erase failed/cancelled/unresolved omitted outcomes or infer success.

## Scope correction: actual visible UI first

User challenged whether recent rare capped-summary lines really appear. Parent acknowledged those came from conditional code, not verified actual UI captures. User agreed to return to actual on-screen elements and clearly label conditional cases. Do not present theoretical branch strings as common observed UI. Last batch wording approval does not expand this into exhaustive edge-case redesign. Keep five Previous/Proposed pairs, no fences or explanatory jargon; verify current UI from captures where possible.

## Confirmed: tool-output notice; footer stays unchanged

User approves hiding Tool output: collapsed notice. User explicitly says keep ALL other four reviewed footer fields exactly as today: cost ($0.000), context usage (ctx16.2%), cache estimate (cache est60m), and model name/thinking level. In particular, reject parent proposal to hide cache estimate. No footer redesign. Do not infer hiding expanded-state notice from approval of collapsed-state example; review that separately if needed.

## Deferred: expanded tool details

User says not to worry about expanded tool details for now. Last five proposed changes (Tool output: expanded notice, Execute · TypeScript heading, completion/failure wrapper text, stdout/stderr labels) are NOT approved and must not be implemented. Leave expanded view as-is. Focus remaining review on normal collapsed UI. Previously approved removal of Tool output: collapsed notice stands.
