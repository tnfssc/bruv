# Interactive question inbox work

User rejected the current questions UX: technically works, but no useful interactivity or autocomplete. Prior surface reviews did not establish a good answering experience. Fix interaction, not only labels.

Worker task_b140d54e, worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_b140d54e, branch die/make-questions-genuinely-interactive-b140d54e, base 6a4d8b6. Build keyboard inbox and choice/free-text answering with existing TUI primitives, readable autocomplete, safe cancel and exact owner/version checks. Keep RPC command paths. Do not mutate the seven real pending remote-design questions during tests. Parent must review actual PTY frames and regression tests before integrating/pushing. This takes priority over remote discovery.

Existing values already say user surfaces are core behavior. The gap is applying that value: a command being available and parseable is not proof a person can comfortably use it. No values change yet.

Implementation 88492bc is ready but not yet integrated. Acceptance worker task_1911ca67 in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_1911ca67, branch die/end-to-end-interactive-questions-accepta-1911ca67, will cherry-pick it and test actual persisted /questions via disposable PTY. Read-only reviewer task_fe96aa12 checks interaction and ownership. Parent should integrate only after full-flow evidence, not just picker fixture.

Review task_fe96aa12 found one UX issue to check before integration: cancelling or submitting empty free text jumps back to the whole inbox instead of the selected question choices. Prefer returning to choices so the user can retry without reopening. Review found no confirmed ownership/autocomplete/RPC blocker; actual free-text and stale-version paths still need acceptance coverage. Parent should reconcile this with task_1911ca67 results.

Actual-flow acceptance completed as 58df048 (after 88492bc): persisted choice/free-text, cancel, completion and stale snapshot tests pass. Existing questions-tui.test.ts still fails composer submission after flood. Finish worker task_0e7e895d in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_0e7e895d, branch die/finish-questions-navigation-and-terminal-0e7e895d, will cherry-pick both, fix editor back navigation and investigate baseline vs regression with full tests. No shipping claim until parent integrates and validates.
