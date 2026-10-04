# Rolling activity research — proposal only

Historical research snapshot with a source-only refresh on 2026-10-04. The original Pi probes below are not compiled acceptance. Approved tool-only runtime evolution and separately recorded proof/limits: [implementation pickup](rolling-activity-implementation.md) and [disclosure follow-up](rolling-activity-disclosures-2026-10-04.md).

The [reconciled proposal](rolling-activity-proposal.md) owns the recommended design. Choices below are research inputs, not implementation approval.

## Source refresh: develop ac720844 (2026-10-04)

Pinned source: `ac720844bac745e6cef45b1478703517e99b890b`. PR #23 head was `6ab524c610bccd973f0c981b96f0c902605c405f`. Its two docs are already on develop, with historical-status headers. Local merge conflicts were add/add in those files only; preserve develop's headers rather than erase the later implementation record.

| Inspected source | Concrete fact / design limit |
| --- | --- |
| [rolling-activity.ts](../../src/ui/rolling-activity.ts), `activityMembership`, `ActivityController.sync` | Selected-branch outer call IDs own membership. User/prose/non-job-control boundaries split groups. Typed notices adjacent to their source can join; later notices form notification-only groups. Group count, run count and task count are not interchangeable. |
| Same file, `registerRollingActivity` | Fullscreen TUI `agent_end` writes `bruv-activity-boundary` via `appendEntry` when assistant tool calls exist. Data is only `callIds`: no end reason, successful-final intent, continuation parent or job-settlement proof. No-call runs write no marker; missing end events cannot manufacture one. |
| Same file, `installRollingActivity`, `withAnchor`, `deferAnchor` | Wraps actual InteractiveMode methods, preserves native siblings and restores wrappers. Explicit toggles anchor after layout and disable follow. This is not generic semantic anchoring or primary-buffer scrollback rewriting. |
| [activity-projection.ts](../../src/ui/activity-projection.ts), [sdk-task-rows.ts](../../src/ui/sdk-task-rows.ts) | WeakMap presentation state applies after canonical task-row facts. Native tool/detail/image components stay direct siblings. No new transcript ledger or task authority. |
| [cli.ts](../../src/cli.ts), [pi-host-adaptation.ts](../../scripts/pi-host-adaptation.ts) | CLI installs the adapter; host preparation rejects unsupported Pi versions. Public widget APIs alone still cannot replace transcript rows. |
| [typescript/extension.ts](../../src/typescript/extension.ts) | Successful handoff returns `terminate: true` and `details.handoff`. This is a tool control/result path, not an assistant activity/answer/note route. |
| [questions/runtime.ts](../../src/questions/runtime.ts), [agent/extension.ts](../../src/agent/extension.ts) | Saved answer claims/delivery and task completion continuation keep their own owners. Hidden `question-answer` context triggers a follow-up turn, not an old-stack resume. UI markers do not acknowledge it. |
| [rolling-activity.test.ts](../../tests/rolling-activity.test.ts) | Existing tests cover journal continuation, steering users, live/saved prose/control boundaries and late callback provenance. Read as source evidence here; they were not rerun for this docs update. |

The existing runtime intentionally retains **all assistant prose**. No inspected bruv adapter normalizes provider signatures to activity/answer/note. The original Responses fixture's signature timing is useful evidence for one candidate route, not a selected contract or live-provider test. Live text-block vs message granularity, mixed text/tools, emitter ownership and saved intent remain open.

The original suggestion that a lasting note need not split a group was an alternative for a work-total summary. Current groups preserve chronology by splitting at lasting text/control boundaries. The proposal now distinguishes these units rather than promising one count across an entire run. The original scroll probe's disappearing header was fixed by later focused anchoring work according to source/receipts; it should not be repeated as an observed current defect.

[Disclosure follow-up](rolling-activity-disclosures-2026-10-04.md) and [runtime acceptance receipt](rolling-runtime-acceptance-2026-10-04.md) record later compiled checks for the tool-only slice. This review only read them. It did not build the CLI, run those harnesses, install dependencies, use a live provider or remote server, or claim acceptance of prose rolling. See [PR review handoff](rolling-activity-pr23-review-2026-10-04.md) for docs checks and unanswered decisions.

## Original receipt (2026-10-02)

- Worktree: `/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_c7942be3`
- Branch: `bruv/research-pi-rolling-transcript-feasibili-c7942be3`
- Source baseline: `eb07b0d72f4460895074c1d7a15cdb93c6c8173d`.
- Read first: `wisdom/values.md`, tasks-ui discovery/action-labels/agreed-compact-actions/placed-root-compact-transcript/readable-task-names notes, Pi 1.0 upgrade/host audit. Existing values cover honest labels, one authority, durable ownership and bounded proof; no values change needed.
- No product/dependency/settings/session changes. Commit contains this document only. Parent owns proposal integration and PR.

**Finding:** rolling presentation and clickable grouped history are feasible. Alternate screen alone does not provide this product behavior; Pi already supplies component activation. Transcript ownership and semantic classification are the gaps. Keep stored history and task/question delivery untouched.

## Facts at the original eb07b0d7 baseline

### Exact Pi APIs and interaction

`package.json` and `bun.lock` pin `@earendil-works/pi-ai`, `pi-coding-agent`, `pi-server`, `pi-tui` to **1.0.0**; resolved `pi-agent-core` is also 1.0.0. Below, dependency paths are relative to `node_modules/@earendil-works/`. This worktree has no installed dependencies; read-only probes imported the matching installation at `/home/tnfssc/Code/bruv/node_modules`. That host is already bruv-prepared, not pristine upstream: `scripts/pi-host-adaptation.ts:62–106` changes compact editor reservation; `src/pi-host.ts` checks preparation. No install/prepare ran here.

- **Clicking is real:** `pi-tui/dist/tui.d.ts:1–78` exposes normalized `TuiMouseEvent`, optional `Component.handleMouse`, handled/capture/focus/render results and retargeting. `Container.render/handleMouse` caches child heights and forwards local coordinates (`dist/tui.js:107–139`); `dist/components/mouse-region.js` wraps a component without changing rendering.
- **Activation vs selection:** `pi-tui/dist/tui-alt-screen.js:178–191,631–759,1085–1165` enters alternate screen, enables button-event/SGR mouse tracking, dispatches to components, then falls back to selection. An unmoved press/release synthesizes a click; drag selects instead. Component capture can bypass selection. A group should handle clicks, not swallow all presses/drags. Mouse can be disabled; real terminal/modifier acceptance remains necessary.
- **Native tool detail click already works:** `pi-coding-agent/dist/modes/interactive/components/tool-execution.js:107–114,213–222,240–276` wraps settled call/result content and toggles `setExpanded` on left click; image components remain native. `CustomMessageComponent` exposes `setExpanded` but is not automatically a clickable tool region.
- **Keyboard is global:** `pi-coding-agent/dist/core/keybindings.js:52` defaults `app.tools.expand` to Ctrl+O. `InteractiveMode.setToolsExpanded` (`dist/modes/interactive/interactive-mode.js:3661–3679`) visits **direct children** of chat/resources with `setExpanded`. No existing focused-group keyboard navigation was found. Nested groups must participate explicitly or preserve this enumeration.
- **Scrolling is application-owned:** `pi-tui/dist/tui-alt-screen.js:548–604` / `dist/keybindings.js:91–140` provide PageUp/PageDown, Home/End and other viewport actions; wheel/scrollbars and selection/copy exist. `pi-coding-agent/dist/modes/interactive/chat-viewport.js` places a follow-end primary `ScrollView` above the fixed editor/widget/footer dock. `pi-tui/dist/components/scroll-view.js:101–175` uses row offsets and clamps after height changes, not semantic message anchors.

### Streaming, finality and notes

- `pi-coding-agent/dist/core/extensions/types.d.ts:795–809`: `message_update` carries normalized `AssistantMessageEvent`; `message_end` ends **one message**, not necessarily the work. Native component creation/update is in `interactive-mode.js:2772–2900`.
- `pi-ai/dist/types.d.ts:261–269,372–395,549–616` separates text/thinking/toolCall. There is **no generic text channel/importance/note field**. `text_start/delta/end` are lifecycle, not commentary/final labels. Live partials are shared mutable objects, not event-time snapshots. stopReason/settle boundaries are not semantic note metadata.
- **Responses has a provider-specific phase:** `pi-ai/dist/api/openai-responses-shared.js:12–35,185–202,326–364,597–605` preserves phase inside JSON `textSignature`, e.g. `{"v":1,"id":"msg0","phase":"commentary"}` or `final_answer`. It becomes available at **text_end**, not start/delta. Its decoder is private; other providers/signatures are opaque. Generic AssistantMessage has no phase field. Raw `provider_stream_event` (`extensions/types.d.ts:685–691,1163`) can reveal phase earlier, but requires deliberate provider-specific correlation; bruv transcript adapters currently do not do that.
- `pi-coding-agent/dist/core/messages.d.ts` gives custom messages `customType/display/details`, not a universal importance convention. Bruv has typed task notices, handoff/error/output-save metadata. `src/ui/quiet-tool-ui.ts` removes hidden-thinking placeholders and one collapse-status notice, **not prose**. `src/ui/conversation-density.ts:204–269,362–481` coalesces thinking/spacing and remaps mouse geometry while retaining source messages; it does not classify final answers.

### Counting and durable ownership

- `src/typescript/extension.ts:58–90,103–159,180–213`: one model execute has one toolCallId and optional label, but can call several helpers, launch a batch, or call no helper. `_onUpdate` is unused. Launch events are not a ledger of every helper call: background shells and all subagents get task rows/sourceCallId; ordinary completed foreground shells do not all get rows. Details hold backgroundJobs/taskRows, not complete nested-helper history. Pi supports `nestedCalls`/parentToolCallId (`pi-ai/dist/types.d.ts:397–426`, extension tool events), but bruv execute does **not** currently populate that ledger. Count unique outer toolCallIds, not stream events, printed jobs or parsed JS.
- `src/agent/extension.ts:224–249,349–398,889–896` persists die-task-row, delivers task-complete/task-attention context and restores branch rows (replayed running becomes unknown). `src/ui/task-rows.ts` owns typed status/identity formatting. `src/ui/sdk-task-rows.ts:51–120` merges result/notice/snapshot metadata and gives one owner by sourceCallId; expanded mode uses original details. It scans **siblings/direct tool components**. Naively moving tools into groups loses ownership or duplicates rows. Launches survive an outer execute failure; outer ✓ does not prove nested shell/product success.
- Questions are authority, not punctuation: `src/questions/service.ts:72–83,162–205,323–405` owns `.questions.json`, branch ownership, versions, blocking and answer/delivery states. `src/questions/extension.ts:58–99,125–166,196–305` supplies counts/picker/detail/answer/resume notifications. Asking via execute is not already a standalone lasting question transcript row.
- `src/questions/runtime.ts:61–104,112–141` sends saved answers as **display:false** question-answer context into a new eligible parent turn with durable claims/uncertainty; it never resumes an old execute stack/native child. A lasting question view must read eligible ledger records and retain IDs/status/ownership. Expansion must not answer/resume/consume delivery.

### Replay and surface boundaries

- Native `InteractiveMode.renderSessionItems/renderSessionEntries/rebuildChatFromMessages` (`interactive-mode.js:3168–3266,3390–3392`) rebuilds components from branch entries and pairs results by toolCallId. `/reload` rebuilds before session_start (`5294–5365`); branch/session/compaction paths also rebuild. Reset activity on those boundaries and derive grouping from saved entries. Global expansion initially defaults false; click state is component-local, not durable per-group preference.
- `src/cli.ts:221–226` installs quiet/density adapters; task adapter installs per session. There is **no public replace/group-normal-transcript API**. Public `setWorkingMessage/setWorkingVisible/setWidget/setStatus` (`extensions/types.d.ts:81–105`) can supply a replaceable slot, **but do not suppress existing transcript commentary/tools**. Full behavior needs a guarded bruv presentation seam.
- **Placed-root differs:** `src/remote/root-presenter.ts:310–362,482–486,572–604` uses TuiMainScreen, flattened RootTranscript lines, global Ctrl+O and no group handleMouse. Messages are bounded to 200; server snapshots win and client gaps cannot invent events (`src/remote/root-client.ts:261–285`). Native fullscreen clicking does not automatically reach it. Its existing presenter is the parity seam; terminal-mode migration is a separate decision. No web/live parity claim here.

## Throwaway probes — bounded evidence

Tool runtime: Bun **1.4.2**, absolute Pi imports above; fake terminal, real TuiAltScreen and native ToolExecutionComponents, fixture renderers. No product files or terminal/session settings changed. These are not actual bruv execute output or compiled PTY acceptance.

1. Synthetic SGR left press/release expanded a settled native tool to fixture details. Alternate-screen and button-mouse enable sequences were observed.
2. Minimal local group rendered `2 tools called ▸`; click revealed two retained native tools. At 60×8, collapsed frame was user/group/final. Expanding while following end moved scrollTop to **3**, hiding the header. Scroll-to-top exposed it; click collapsed again. Dragging final prose kept the group collapsed; hasActiveSelection was true; clipboard callback received `Final an`. No product focus/resize/replay proof.
3. Actual processResponsesStream with synthetic commentary/final_answer items: text_start/delta signatures null, text_end signatures carried phases; raw callback saw output_item.added. Initial fixture omitted response.completed and was correctly rejected; adding that terminal event passed. This proves converter timing, not universal semantics.

## Original research alternatives (not approval; some seams now implemented)

- Retain full session history. One bruv-owned **presentation projection** should own lasting rows, tool groups and current activity. Evolve/consolidate existing adapters; do not add another task/event subsystem or unrelated global hook. Public working-message/widget APIs can host activity; suppression/grouping still requires native live-and-replay integration.
- Suggested unit: a user work segment ending at a lasting final/question/note boundary. `15 tools called` counts outer unique toolCallIds. One execute launching three helpers counts **one**, with three typed task rows retained. Decide pending-count wording. Reuse original components/details, including images, errors, save warnings and handoff text; do not regenerate evidence from summaries.
- Preserve task ownership scans and native pending-tool maps. A presentation wrapper over retained source components is preferable to naive reparenting; exact host integration needs a focused spike. If reparenting, adapt sibling ownership and global expansion together. Group setExpanded can reuse Ctrl+O; per-group keyboard selection is new work.
- Explicit Responses commentary can be transient and final_answer lasting for the verified signature format. Unclassified streaming prose can temporarily occupy activity, but **unknown settled prose should remain lasting by default**. Text before a tool is only a heuristic: it can contain a question/warning. A generic important-note convention or provider-normalized phase is an unresolved API/product decision, not existing metadata to enable.
- Lasting questions should be read-only eligible ledger projections, not hidden answer JSON. Preserve adverse/uncertain/save-warning information even collapsed. Background completion may update its canonical task row after final without stealing foreground activity; scope the slot to the foreground owner, not every child event.
- Reset activity on settle/abort/error/session switch/reload; deterministically rebuild groups. Start with nonpersisted expansion. Decide clicked-header anchoring versus bottom-follow: the probe shows current row scrolling cannot promise both. Regular-mode scrollback cannot retroactively erase emitted narration as fullscreen can.

### Practical acceptance cases for eventual implementation

- Interim statement → execute labels → final: newest activity only; lasting final/group; expanded original evidence.
- One execute launches a batch then throws: count one, all launched task IDs/owners survive, completion after final without duplicate rows.
- Ask/save answer/reload: durable question status, hidden routing stays hidden, no duplicate turn/tools, no stale running activity.
- Mouse/Ctrl+O expansion while scrolled away, drag-selection, narrow resize and images: correct coordinates/header usability/native evidence. Test placed-root parity separately if promised.

No full suite, compiled terminal acceptance, live provider or remote-server execution was performed. Parent owns primary proposal/PR and all implementation.