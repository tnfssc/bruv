# Remote UI v0.15.8

User found remote question UI machine-oriented after v0.15.7. Interactive /remote work integrated from 417bc59; final cancellation fix ee77ab6 preserves local intent and distinguishes delivery from terminal state. Independent review task_0aadf5c9 identified cancellation race; fixed with regressions. Parent frozen rebuild task_1198464d passed 1281 tests/17 skips/0 failures, 29413 assertions, including both DIE_REMOTE_E2E and DIE_REMOTE_PTY_E2E. Logs /tmp/die-ui-final-{check,build,tests,format,lint}.log. Real web assets reused, no placeholder user binary.

Value 8 strengthened at 5645014: human controls and actual rendered acceptance required, commands retained for automation. Agent config discovery at wisdom/configuration/agent-config-discovery.md stays PARKED. No config implementation authorized. User questions untouched. No local install done.

Preparing v0.15.8; parent must await hosted workflow success and verify stable release, 12 assets and SOURCE.txt before publication claim. Worktree/evidence in wisdom/remote-workspaces/human-ux-acceptance-2026-09-27.md.

Pushed 37a90ea; release run https://github.com/tnfssc/die/actions/runs/36338936978. Watch /tmp/die-v0158-release-watch.log. Await gates and asset verification.

Published v0.15.8: workflow 36338936978 succeeded. Verified stable non-draft release, all 12 expected assets and SOURCE.txt commit 37a90ea5c7aece11ffb069fc5a681aca8f797174. https://github.com/tnfssc/die/releases/tag/v0.15.8 . No local installation performed. Value 8 update ships in this release; configuration investigation stays parked.
