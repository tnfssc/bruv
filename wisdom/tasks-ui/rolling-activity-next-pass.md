# Tool group UX follow-up

User wants the CLI activity header padded like nearby transcript content, a distinct theme color and no group chevron. Header click reveals tool rows only; each inner detail is opened separately. Background task notifications should be presented inside activity groups, not as standalone transcript entries. Multiple groups within one human turn are expected; inspect T3 chat grouping as precedent.

Keep model context/history and job/question ownership unchanged. Group actual notification provenance, not prose text guesses. Keep real assistant answers and human questions visible. Failure/cancellation summaries and inner details must remain accessible. Preserve selected-branch replay, /reload, scrolling anchors and long-thread performance. Match T3's useful hierarchy without importing a new UI framework.

Owner task_993dc486, branch bruv/refine-cli-tool-groups-and-integrate-bac-993dc486, worktree /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_993dc486. It owns CLI display and real-terminal acceptance, separate from the compact connector work. Basebb0dba74 already contains one-runtime packaging; parent still has small wrapper/doc integration edits and combined CI in progress.

Acceptance: actual compiled terminal frames/clicks, header vs inner expansion, grouped late notifications, more than one group separated by prose, visible saved questions and stable scroll/reopen. No paid models, global installs or release by child. Parent integrates pieces and checks final combined behavior. Values currently unchanged: this is existing display/authority separation and actual-UI proof.
