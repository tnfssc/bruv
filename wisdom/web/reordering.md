# Workspace and tab order

Drag workspace titles vertically and tabs horizontally within their workspace. Touch uses a short hold so normal swipes can still scroll. Alt+Shift+arrow keys move a focused title. Escape, pointer cancellation and dropping outside the list cancel. Drag releases must not select, rename or close anything.

Order belongs to the server; navigation belongs to each browser. A move names one item and the item it should precede (null means the end). Do not send a whole stale order over newer shared changes. Moving must not recreate a PTY, select another terminal or transfer voice.

SortableJS owns drag thresholds, touch and autoscroll. The app owns mutations and revision-aware rollback: a failed move must not overwrite a newer shared snapshot. Keep grabbed DOM stable until release; apply shared deletions and clean up sessions immediately. Moving a focused editor with insertBefore blurs it, so preserve its node, draft, caret and focus without treating that move as cancellation.

The real-page browser gate covers mouse, CDP touch, keyboard, cancellation, shared edits and failure races. The compiled CLI check preserves PIDs, an unsent draft and fake-device voice during moves. This does not establish physical phone or audio-device acceptance. Keep Sortable's MIT notice in the embedded dependency notices.
