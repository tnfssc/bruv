# Remote human UI follow-up

User tried released question flow and found no autocomplete or menus. Command/RPC correctness was not enough. Treat this as unfinished human UX, not a cosmetic request.

Task task_b42aa24e owns complete /remote menu/question/completion and real CLI PTY acceptance. Worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_b42aa24e, branch die/make-remote-questions-and-commands-human-b42aa24e, base 0733fce. Reuse local /questions picker/editor. Check local flow for regression too. No user data edits. Parent owns review, integration and publication. User asked to put the recurring lesson in values. Value 8 now explicitly requires human controls and real end-to-end rendered acceptance, while preserving commands for automation. Stop claiming a complete human experience from command/RPC acceptance alone.

## Cancel confirmation follow-up (narrow review)

The task picker can sit open while the connection or cached task changes. After confirmation, reread the pinned task and connection; refuse changed owner, offline sync error, or terminal task without dispatch. The client checks pinned host/owner/epoch against both connection and fresh hello under its local lock before sending. A changed connection never receives an old task cancel.

Do not clear `cancelRequested` merely to make a refused cancel look clean: it stops automatic repository integration after human intent. `cancelDelivery` records locally requested, uncertain POST (saved before sending), or acknowledged request. An acknowledgement is **not** proof of terminal cancellation: only synchronized task state is. Retry uncertain delivery on the same pinned owner; repeated cancel is idempotent on the owner. Previously uncertain delivery stays uncertain even if a subsequent preflight fails. A confirmed request does not get resent; sync still obtains terminal truth.

Evidence: deterministic confirmation-open changed-owner/offline tests; client changed connection, failed hello, lost response, retry and terminal-truth tests. Focused remote-client/extension/menu: 32 passed, 131 assertions. TypeScript `tsc --noEmit` passed with shared existing dependencies; parent owns full suite. No install or release.
