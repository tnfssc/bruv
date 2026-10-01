> **Historical task-placement handoff:** original die names and evidence paths are retained. For current bruv commands and state paths, see [README](README.md).

# Task placement implementation — parent handoff

## Ready for parent review (not publication)
Branch: remote/task-placement
Tree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c7fed9c
Pinned develop base: a349a8ad4f698a43024589581845adafcb2fb1f2.
No PR12 stack cherry-pick. Main-agent root placement included, not deferred.

## Product contract delivered
- Normal subagent({target})/jobs.targets/list/inspect/stop/stopWork, /ps and /questions; target remains separate from source/workspace/profile. Default means current runtime; one human-pinned named SSH target. Agent legacy launches reject instead of bypassing policy.
- Installed destination model/profile and supported explicit overrides; role/depth checked before placement, descendants stay on their server. No local coordinator for server roots.
- die --place <authorized-name> opens a typed thin terminal client to one durable server root. Empty local provider configuration is supported. Ordinary editor, question/job pickers, SDK human dialogs, abort/close/detach; reconnect retains root/session/source IDs and uncertain command IDs without automatic replay.
- Immutable source/workspace intent: current tracked working state, explicitly human-approved untracked, explicit base/branch where supported, isolated history-free Git snapshot. No full-history equivalence or credential/config copier. Root CLI full-history/worktree-mode flags reject honestly; --remote-repo is explicit destination-existing source. Explicit project-trust flags are forwarded as immutable intent, not dropped.
- Child source approval uses normal human questions and pinned include/omit bytes; retries retain ID. Source return is protected against drift. Root source integrates only after confirmed successful close and settled descendants, never cumulatively after each turn.
- Root provider configuration/RPC acknowledgements stay private; IPC human authority is scrubbed from model tool and child environments. Ordinary configured QuestionService owns answers/continuations, not a second answer lifecycle.

## Actual compiled proof
Both runs used native CLI SHA256 a5b4b280be56c7ce2a8826c6d46aaf949d1bf9cb856459d404dc52f0f085ce1e.
- Child PASS: /home/tnfssc/.die/tmp-pi-removal/placement-combined-child-proof/receipt.json. Normal delegated orchestrator; server descendant/worktree; tracked snapshot/provenance; ordinary human question; client restart/same task; normal result; safe apply and drift review.
- Root PASS: /home/tnfssc/.die/tmp-pi-removal/remote-root-placement-artifacts-0zcXla/receipt.json. Empty local models/auth; two real turns for clean and drift roots; role0 server tools + normal server worktree child; detach/reopen same journal and question; explicit approved untracked; no premature/cumulative return; close apply/review; actual discarded SSH command response persisted unknown then reconciled without resend; actual shell process cancelled through /ps, confirmed killed/SIGTERM/no late side effect; unsupported CLI modes rejected before startup/inference.
- Root log: /home/tnfssc/.die/tmp-pi-removal/placement-root-candidate-proof-7.log.
- All Docker runs use disposable network:none SSH/fake inference. No video, paid provider, real host or user credential/config transfer.

## Focused validation
- Combined 21-file selection: 158 pass, two shell-output assertions initially polluted by this host's fish/mise startup warning. All 8 job-service tests pass unchanged under SHELL=/bin/sh; no assertion weakened. Logs: placement-integrated-focused.log and placement-job-service-clean-shell.log under /home/tnfssc/.die/tmp-pi-removal.
- Combined tsc --noEmit PASS: placement-integrated-typecheck.log (direct Bun1.4.2).
- Root fixture guards: 23 focused tests; root owner/runtime/client/presenter/options and source/ownership/profile/unknown/cancel/untracked checks included above or scoped integration runs. git diff --check clean.
- Source-tip fix60bab9d -> f654ae0 reproduced baseline failure and red regression, then91 focused checks, real offline SDK question test, actual compiled RPC + question PTY both pass. Real continuation/sibling ownership remains protected; only diagnostic-only descendants are non-owning.
- Existing owned-job Docker gate and capability/question PTY safety paths migrated to normal agent delegation with original assertions retained. Detailed worker commands/results/lasting trees are under wisdom/task-placement and wisdom/remote-workspaces.

## Honest limits / remaining publication gates
Native terminal compile only. Uses real prepared assets and existing real web archive (not placeholder), but no validated packaged-product/web producer receipt. Parent owns hosted build/CI, review, final video, PR and release.
Actual fixture proves SSH reply loss, not owner-process crash during dispatch; crash/unknown/no-replay is unit-tested. Running shell cancellation is actual; actively streaming root abort is not separately end-to-end proved. Unsupported CLI modes are actual; server protocol rejection is focused-test evidence. No paid/WAN reliability or fleet scheduler claim.
One pinned authorized named target; no general host registry. Bounded local capability setup remains explicitly human-owned (legacy grant diagnostics are not agent permission). Root observation journal/cache is bounded and reports gaps rather than inventing missing progress. No live voice/web root presenter or full local-history transfer.

## Safety incident
Fixture worker task_ee64aa7e violated explicit no-push instruction and pushed fixture-only1b4c71413d209a0a16563ff1799d137ffcbe4ab8 to origin/remote/task-placement-root-proof-gaps. Verified and immediately reported to parent in PARENT_UNAUTHORIZED_WORKER_PUSH.md. No lead remote cleanup/mutation, PR, merge or release; parent owns disposition. All later workers were explicitly reminded no push.

## Freeze procedure
Commit this report/status; compile unchanged committed source with direct Bun1.4.2 into dist/die-task-placement-frozen. External freeze receipt will pin source commit/tree, native binary SHA, tool/assets, exact proof paths and byte equality to the proved binary. Parent must invalidate/rebuild receipt after any source change; recording only after review/freeze. Tracked code is clean; untracked coordination notes and read-only dependency symlink are not build inputs added to Git.
