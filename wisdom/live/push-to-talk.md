# Live push-to-talk: user intent

User wants hold Space to speak and release to stop sending audio. They do not
want nearby colleague conversations sent to the agent. Keeping the mic capture
running locally is fine. They want an option to switch this behavior.

Proposed flow: capture stays open; only audio captured while held can enter the
provider send queue. Outside the hold, discard audio instead of retaining it for
later. Release closes the speaking turn, not the Live session or playback.
Show clear muted/talking state. Continuous conversation stays a selectable mode.
No production implementation yet. PR35 is merged; this is a separate feature.

Small code check: Pi TUI keys.js parses Kitty press/repeat/release events.
That does not prove the active terminal reports release or that extension input
gets those events. Verify negotiation and input routing before promising literal
hold-to-talk everywhere. Do not infer release from a quiet repeat timer; that can
leave sending open or cut speech. Unsupported terminals need an honest explicit
control, not hidden always-on capture. Typing-space conflicts also need real UX.

Use current capture/session lifecycle. Do not stop/reopen mic on each hold.
The user authorized local open capture, not transmission or buffering of speech
outside a hold. Failed/stopped Live must discard queued speech as usual.
Values unchanged: existing explicit intent, lifecycle ownership and honest proof
cover this. This note is a feature request, not a general new value.

## New-thread handoff

User clarified PR35 was merged. They want this feature in a new thread.
Old PR watcher is off. Scheduled tasks and queued messages are empty.
Attempted t3_thread_launch with a develop-based worktree, then create_threads.
Both returned: App delegation requires an explicit root orchestrator; normal
workers cannot delegate. t3_thread_list found no Live push-to-talk thread.
No new thread or worktree was created. Do not claim otherwise or bypass the role
check. User can open a new thread in the app and start on latest develop.
Feature brief above is the handoff; no feature implementation has started.

Document publishing checkout: /home/tnfssc/.bruv/worktrees/bruv-live-push-to-talk-handoff-20261005
Branch: docs/live-push-to-talk-handoff, based on origin/develop314826a2.
Only this note is being published to develop at the user's request.
