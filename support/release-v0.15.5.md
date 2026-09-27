# v0.15.5

## Questions you can actually answer

- Open `/questions` for a searchable keyboard inbox. Pick a choice or write a custom answer without copying question IDs.
- Command completion shows readable question labels. Escape backs out without saving; leaving the text editor returns to the question’s choices.
- Answers check the question’s owner and version. Diagnostic journal entries no longer make valid questions look like they belong to another branch; real fork protection remains.

## Remote workflow experiments

The source tree includes a Docker/SSH CLI lab and interactive HTML walkthrough. Experiments cover detached agents, incremental offline text history, native questions, isolated repo snapshots, conservative automatic result return, and an on-demand repo file read.

These use deterministic fake providers and disposable Linux fixtures. They are **not a production remote mode**. Real Mac sleep/reconnect, provider credentials, owner restart recovery, general tool access, and concurrent crash-safe repo integration remain unproven. Large file transfer is separate; remote untracked file contents are not returned automatically. Git history bundles may contain sensitive history and require explicit opt-in.

## Validation

Local production suite: 1,216 passed, 17 skipped. Focused CLI PTY tests use disposable sessions; existing saved questions are untouched. Remote fixture results are scoped in `wisdom/remote-workspaces/`. Release binaries are subject to the hosted release workflow’s build and platform gates.
