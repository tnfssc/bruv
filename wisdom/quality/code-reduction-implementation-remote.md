# Remote feature-preserving cleanup

Base d80d7058a2f5481f067586fd7042fe2746cff4ae. Worktree /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_d625f667; branch bruv/cleanup-remote-dead-implementation-and-s-d625f667. Original worker task_d625f667 prepared the edits, then spent about 16 minutes receiving a model response without tool progress. Parent stopped it (confirmed exit 143) and finished review/checks/commit. No edits were lost.

## Done

- remote-01: removed unused LocalCapabilities. Kept shared types and the confined repo reader. Unique authorization, input/output limits, revocation and duplicate semantics now exercise the actual durable stores; file security checks remain.
- remote-02: one SSH control implementation, with two fixed trusted entrypoints. Typed root adapter and validHost/validPath exports remain. Host-key checks, quoting, forwarding restrictions, response bounds, timeout/escalation and unknown outcomes remain.
- remote-03: require the actual configured question service. Root facets no longer create a fallback queue or send a duplicate follow-up. Fixtures supply real configured delivery; stale versions, tokens, branch ownership and answer replay remain tested.
- remote-04: removed unreachable detail-mode branches and nonexistent RootRecord.messages fallback. Expanded view stays; tests replay real events, including privacy/hidden replies/reopen.
- remote-05: share equivalent private JSON file+directory fsync/rename writes. Callers retain mkdir/cache limits. Immutable capability writes and async client writes remain separate.
- remote-06: statically call the compiled prepared-repository launcher instead of a typed-away optional integration probe. Pinned approval/source validation and injected launcher tests remain.
- remote-07: share result-page download/verification, retaining per-client limits/error labels, identity/workflow/locks/receipts. Child decoder now rejects noncanonical base64 just as root already did; no valid transfer feature removed.

No feature/archive cuts. Legacy human remote menus/commands, parent capabilities, root placement, snapshots and all permission/cancellation/recovery contracts remain.

## Parent checks

Parent reviewed transport diff, shared downloader/writer, root dispatch/presenter and focused test changes. Fresh command in this worktree: bun test tests/remote-*.test.ts tests/root-runtime.test.ts, with opt-in external E2E gates unset. **251 passed, 3 opt-in E2E skipped, 0 failed; 2,366 assertions across 35 files.** Logs: artifacts/code-reduction/remote-tests.log. No paid/provider/SSH/Docker acceptance was launched by that command.

bun run check, changed-file Biome format and lint, and git diff --check passed. Logs: artifacts/code-reduction/{typecheck,format,lint}.log. Existing/style warnings are not zero-warning proof. Direct Bun 1.4.2 PATH used; initial parent command was rejected by Fish syntax before execution, then rerun correctly through Bash. No product failure attributed to that shell error.

Parent still must integrate and run the rebuilt combined CLI/TUI and remote acceptance. No device or paid provider proof. Source/download limits were preserved, not expanded into a new general storage framework.
