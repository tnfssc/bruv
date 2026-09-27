# Normal-session remote work

Remote controls live in the ordinary CLI conversation. Main Live still has **execute only**. Only human `/remote connect` changes the SSH alias. Strict host-key checking stays enabled; SSH agent, X11 and credential delegation are disabled.

## Flow

In the normal interactive CLI, `/remote` opens a searchable inbox (type to filter, arrows, Enter; Esc backs without changes). Pending questions open selectable choices or a custom answer editor; tasks show readable prompt/state and a cached transcript, with explicit sync, reconciliation and confirmed cancellation where available. Offline controls are labeled unavailable; saved uncertain answers are not offered as new unanswered questions. Command completion supplies task/question labels with stable IDs. Explicit commands remain available.

- `/remote connect fixture-owner /usr/local/bin/die`: choose an already configured SSH alias (our acceptance fixture is disposable Docker Linux). Server normal model/profile is reported. Discovery does not copy credentials or verify provider access.
- `/remote launch <absolute-remote-repo> <prompt>` uses an existing remote checkout.
- `/remote launch-repo <prompt>` snapshots current-repo tracked staged/unstaged work, without changing the local index/work or sending local history. Untracked paths require human approval; default/refusal omits them. `/remote launch-repo-json` accepts an object with prompt, optional include path array, taskId, model and thinking. Known credential/config paths are rejected; this is not content secret scanning.
- Active work refreshes automatically in bounded batches. Closing the client detaches, not cancels. Reopening catches up from the saved cursor. Progress, questions, capability needs, completion, safe return/review and text-artifact availability appear in the conversation.
- `/remote answer <text>` targets the sole pending question; otherwise use `/remote answer <taskId> <questionId> <text>`. Native owner/version and a persisted reply ID are pinned. Uncertain is not delivered; a lost reply never authorizes a replacement answer.
- `/remote grant [taskId] repo.read tool:git-status tool:git-diff skill:review` explicitly authorizes named read-only capabilities in the current local repo. No home, arbitrary shell or credential grant. Skills read `.agents/skills/<name>/SKILL.md`, not arbitrary skill execution. `/remote revoke <taskId> <grantId>` revokes locally before contacting the owner.
- In remote execute, `remote.requestCapability({kind,input,requestId?})` records a missing grant and genuinely waits while blocked/offline. Try existing remote capabilities first.
- `/remote cancel [taskId]` requests scoped native job cancellation and foreground abort. Only confirmed native settlement plus owner exit is cancelled; partial/unconfirmed cancellation is unknown.
- `/remote status`, `/remote sync [taskId]`, `/remote transcript [taskId] [offset]` and `/remote retry [taskId]` remain recovery/offline controls. A single active task is selected automatically. Retry retains the same ID; unknown owner outcomes are not relaunched elsewhere.

Agent execute exposes status, launch, launchRepository, sync, transcript, cancel and requestCapability. It cannot connect, grant, approve untracked transfer or answer human questions. Launch model/thinking overrides are explicit and pinned; otherwise the remote normal profile is used.

## Return and offline records

Successful snapshot tasks fetch a digest-verified patch. Automatic return requires unchanged local HEAD/index/tracked fingerprint, regular tracked-file content edits and a clean apply check. Existing staged index stays staged. Local drift, creations/deletions/mode changes and untracked additions retain a review patch instead. Ordinary remote untracked bytes are included in that patch. Receipts prevent blind reapply after interruption. This is conservative apply, not an atomic transaction with an editor or hostile-writer sandbox.

RPC conversation/tool events are saved with their cursor. Execute stdout/stderr spill files, the task-owned journal and scoped native job text are separately cached with hashes and local paths. Native job buffers are copied before owner exit. Retention gaps, changed files, limits and failed copies remain explicit: never call an incomplete cache complete. Repository return and text sync report failures independently.

## Bounds and scope

Eight active owner tasks; 100 retained owner/client task slots; 128 MiB snapshot/checkouts and client cache; 32 MiB event journal; 512 KiB event rows; 256 KiB transfer pages. Text artifacts: 10 MiB/file, 128 MiB/catalog, 256 files. Capabilities: 16 KiB reply, 32 pending, 1024 retained requests/task and 64 grant records. Ordinary runtime/capability waits have explicit deadlines; pending human questions retain their owner. Limits refuse with errors, not quiet truncation or guessed success.

Sparse checkout, skip-worktree/assume-unchanged, unmerged index, tracked symlinks/gitlinks and configured clean/smudge filters are not automatically handed off. Trusted repo roots and SSH owner are assumed. State/cache are OS-user-wide, stated on connect.

Validation here is Linux Docker/SSH with an explicitly deterministic fake provider and native CLI/unit tests. **No Mac, real-provider deployment, publication, installation or release claim.** Parent owns release gates.
