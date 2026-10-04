# Remaining cleanup survey

The user asked what else can go after the reference-folder move and bundled
T3 retirement. This is read-only research, not approval for more deletions.
Current combined cleanup passes full Linux CI and remains uncommitted.

Root candidates: PARENT_TASK_PLACEMENT_HANDOFF.md,
PARENT_TASK_PLACEMENT_STATUS.md and ROOT_TYPED_CONTRACT.md are historical
worker contracts/handoffs. Their consumers are other prose, not executable
code or current CI. Preserve useful decisions/proof with the existing
wisdom/remote-workspaces and wisdom/task-placement notes rather than leaving
old worker instructions at the root. evidence/goal-transport-marker-audit.txt
is one tracked offline provider capture, referenced only by a dated wisdom
audit. It belongs with goal wisdom if retained; it is not a current gate.

Runtime survey: task_b67d53ce. Tooling/evidence survey: task_90ca9f49. Both
read the parent workspace and must not edit or run tests. Read their results
and verify the suggested candidates before recommending actual deletion.
Do not mistake the active native-task bridge for old bundled T3 code.

Parent workspace: /home/tnfssc/.t3/worktrees/bruv/t3code-34db5acd.
Branch: t3code/move-audits-docs-expts. Values unchanged so far: this uses
existing ownership and deliberate-retirement lessons.

Runtime survey task_b67d53ce found no clearly dead implementation in the paths
it checked. src/t3/web/launcher.ts is the active web guidance command; native
task code is used by src/agent/extension.ts and src/tasks/job-service.ts.
The Claude-compatible connector is also active. None is a dead-code deletion
candidate. The worker suggested relocating src/t3/README.md if its boundary
note is better placed in wisdom, but this is doc tidiness, not runtime savings.
Tooling survey task_90ca9f49 is still pending. Values unchanged.

Tooling survey task_90ca9f49 completed. It confirms the root handoff/contract
files and single evidence capture have prose consumers only. Preserve their
useful proof in wisdom and update those consumers before removing root copies.

The one additional retirement candidate is
`scripts/task-placement-final-video.py`. It replays frozen historical video
evidence, documented by final-integrated-video.md and final-video-replay.md.
It is not a current product gate. Removing it loses exact regeneration of that
old replay, not runtime behavior. Keep the videos/receipts and mark those old
replay instructions retired if the user chooses this cut. Do not confuse it
with current clean capture tooling or remove active fixture/e2e tests.

No more deletion was authorized or done. These findings are a small cleanup
list, not proof of a large dead-code pile. Values unchanged: the existing
feature ownership, honest proof and intentional-retirement lessons still fit.

## Approved cleanup completed (2026-10-04)

The user approved these cuts. Removed the three root handoffs and
scripts/task-placement-final-video.py. Removed evidence/ after moving its
only file byte-for-byte to wisdom/goals/goal-transport-marker-audit.txt.
No video, capture directory or receipt was deleted.

Useful root contract decisions, accepted proof and limits are folded into
[the placement implementation record](../remote-workspaces/task-placement-implementation.md#retired-root-handoffs-2026-10-04).
That record points to exact original files in Git at
d898214f71b4131c1bca807824f4fe69420b6992. Old worker status logs were not copied
into another stack of handoffs. Prose consumers now use the folded record.
The two replay notes clearly label their old commands retired. The current
clean-capture tooling and its shared renderer remain.

Checks: all five old paths are absent; the capture bytes match the original;
all 11 links in changed tracked notes resolve, including the new summary
anchor. Architecture and real offline SDK goal-marker tests pass: 5 tests,
29 assertions. Diff whitespace check passes. The earlier combined cleanup
was committed in d898214f and already passed full Linux CI. This follow-up
changes only reference records and an unused historical renderer; no need
to repeat the whole gate. This follow-up remains uncommitted. No release.

Values unchanged: this applies existing feature ownership, compact handoff
and intentional-retirement lessons. No new general rule emerged.
