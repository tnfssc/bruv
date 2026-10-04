# Rolling activity research — proposal only

Historical design/research snapshot. Approved runtime slice and current proof/limits: [implementation pickup](rolling-activity-implementation.md).

The [reconciled proposal](rolling-activity-proposal.md) owns the recommended design. Choices below are research inputs, not implementation approval.

## Receipt

- Worktree: `/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_c7942be3`
- Branch: `bruv/research-pi-rolling-transcript-feasibili-c7942be3`
- Source baseline: `eb07b0d72f4460895074c1d7a15cdb93c6c8173d`.
- Read first: `wisdom/values.md`, tasks-ui discovery/action-labels/agreed-compact-actions/placed-root-compact-transcript/readable-task-names notes, Pi 1.0 upgrade/host audit. Existing values cover honest labels, one authority, durable ownership and bounded proof; no values change needed.
- No product/dependency/settings/session changes. Commit contains this document only. Parent owns proposal integration and PR.

**Finding:** rolling presentation and clickable grouped history are feasible. Alternate screen alone does not provide this product behavior; Pi already supplies component activation. Transcript ownership and semantic classification are the gaps. Keep stored history and task/question delivery untouched.

## Current facts (not proposed capabilities)

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

## Proposed choices / minimal seams (not implemented)

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