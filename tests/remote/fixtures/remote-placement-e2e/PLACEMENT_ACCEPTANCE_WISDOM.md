# Placement acceptance feature wisdom / handoff

## Ownership receipt

- Worker tree: /home/tnfssc/.bruv/worktrees/bruv-a86675007a5e-task_7c7fed9c-a86675007a5e-task_09184036
- Worker branch: remote/task-placement-proof
- Worker base: d1df1475d946936a84c5ce5fa398815a32fcf5c0
- New files only: scripts/remote/remote-placement-e2e.ts, tests/remote/remote-placement-e2e-fixture.test.ts and tests/remote/fixtures/remote-placement-e2e/*.
- No production, existing runners/assertions, parent status, real credentials/config or video were changed/used.

## Observed before integration

Docker 29.6.2 (rootless), /usr/bin/ssh and /usr/bin/tmux are available. Bun 1.4.2 is used directly. The local cached SSH fixture base observed here is sha256:fcdfb61636ab08c6d03963acf07b90747dfdba02bd79182a99740ff483dc090f (tag bruv-remote-e2e-2434886-5027:latest); this is not a portable prerequisite and must not be pulled. Select your own cached image explicitly.

First infrastructure attempt used an internal bridge plus loopback publishing. Rootless Docker returned 2222/tcp:null and no public port; failure artifact directory: /home/tnfssc/.bruv/tmp-pi-removal/remote-placement-artifacts-ZXueX3. We did not enable unrestricted networking to force a pass. Instead network:none plus a small standard OpenSSH ProxyCommand byte relay was used. That real SSH/fake-inference probe passed, with text receipt/logs at /home/tnfssc/.bruv/tmp-pi-removal/remote-placement-artifacts-PzMR7A. No native CLI/placement assertion was run by the probe. A repeated final probe also passed at /home/tnfssc/.bruv/tmp-pi-removal/remote-placement-artifacts-kfih9B.

Focused fixture tests and standalone strict TypeScript checking pass with existing readonly dependency tools from the parent tree. No dependency install/auto-install, project trust modification, placeholder assets or binary build was performed. There is no final combined dist/bruv in this worker tree. Full acceptance remains UNRUN until the parent combines production and compiles the actual source.

## Important fixture design details

- Use the README commands with direct Bun and TMPDIR. --probe is deliberately not acceptance. Actual run needs BRUV_BIN and never skips a missing binary/base.
- Destination profile is proved with distinct orchestrator/normal model IDs. Parent profile is deliberately wrong for children; any unintended parent execution/model inheritance fails.
- Child worktree is proved by a real .git file and a distinct server cwd, not by a metadata label. The orphan input snapshot is proved with a single server commit versus two source commits, plus tracked dirty file contents and missing unapproved untracked contents.
- Human answer content appears in the choice list/tool code before the human answers. The fake provider must only react to a delivered user answer, and the resumed server tool additionally checks the actual saved ledger answer. Never loosen this to a substring of the whole message history.
- Real jobs.inspect output is paginated because a bounded first page may contain the tool start, not the final message. The fixture assembles output but sends only its tail back to inference to avoid blowing the model context.
- Query ordinary questions.list via parent execute to inspect the public projection rather than assuming a bridged question must be written to a local ledger file. Keyboard /questions menu and /questions answer perform the two actual human approvals.
- Read integration assumptions in README. Receipt-path or ordinary question serialization differences may need a focused adapter change after combining workers; maintain owner/version, identity, role/profile, no duplicate completion, clean return and drift-review assertions.

## Remaining proof limits

The runner is an acceptance scaffold, not a claim that new production already passes. It covers restart at a persisted unanswered question and no duplicate completion on sync/restart, not loss of a just-accepted SSH launch response. Explicit base selection, approved untracked transfer, cancellation and adversarial human version/epoch/tool-answer checks remain production-focused tests / existing recovery-runner territory. No web/packaged product or real provider/host proof is claimed.
