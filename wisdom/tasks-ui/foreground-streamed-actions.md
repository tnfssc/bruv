# Foreground streamed action UI

## Durable owner and scope

Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_77080c99-a86675007a5e-task_5d10e9d2
Branch: die/foreground-streamed-action-and-sdk-ui-5d10e9d2
Base: rebased draft 7627cdc on origin/develop bada7e5.

Read the FULL authoritative checkpoint at /home/tnfssc/.die/worktrees/die-a86675007a5e-task_6b26afdc/wisdom/tasks-ui/ui-discussion-checkpoint.md, values.md, conversation-noise-discovery.md and relevant action-label notes. Later one-line approvals supersede earlier underneath-error/warning layouts and draft plain-label success. Parent owns integration and final native proof; nothing pushed, published, uploaded or installed.

## Code

- execution-previews.ts foreground functions only: one spinner-only row at call start, incremental sanitized label, same animated spinner while code streams and during execution/partial output. SDK per-tool context.state owns animation and call/result slot suppression. Final result stops animation; agent_end/session_shutdown clean up unfinished animations. No raw source in collapsed rows, including code-first partial arguments. Missing settled labels use Action rather than exposing source.
- Success is ✓ label; failure is ✗ label — concise actual error. Stderr/direct SDK exceptions supply error wording, never ordinary stdout. Native source frames/stack rows are not the summary. Structured exit/timeout/cancellation remain available. No collapsed truncation/image/job count notices. Save failure is ✓ label — ⚠ couldn’t save full output. Normal handoff prose remains visible.
- extension.ts puts label before code in the serialized execute schema, without a new prompt instruction, and wires SDK invalidation/partial events. Pi 0.99.1 accepts returned isError:true (proved through actual runToolCall); execute now returns failure details rather than throwing away them. This retains structured evidence and permits sibling taskRows metadata to persist on outer errors. Failed handoff execution does not set terminate.
- quiet-tool-ui.ts adapts native mutable AssistantMessageComponent.updateContent and InteractiveMode.showStatus. Only hidden thinking's Text-backed MouseRegion is removed, with its empty spacer; shown Markdown thinking stays native and Ctrl-T still works. Only collapsed tool-output status is hidden. A preceding still-current expanded transient status is removed when collapsing so it cannot lie about the mode; the expanded notice itself is otherwise unchanged. CLI installs/restores this local adapter alongside existing density wiring.
- No shared node_modules edits. No footer, completionPreview/task notices, other UI, or expanded execute source/output rendering edits. Verified the entire execution-previews.ts suffix from interface CompletionDetails is byte-identical to the base.

## Proof

Final focused suite: 87 passed, 0 failed, 464 assertions across foreground-execution-sdk.test.ts, execution-previews.test.ts, conversation-density.test.ts and typescript-execution.test.ts. bun run check and git diff --check passed.

SDK tests instantiate the actual ToolExecutionComponent registered by registerExecuteTool, parse incomplete JSON with the SDK parser, and drive updateArgs/setArgsComplete/markExecutionStarted/updateResult/setExpanded. They cover animation invalidation and cleanup, code-first arguments, partial-result transition, one settled row, full expanded source/output, actual concise errors, save warning, Kitty image transport, native thinking updates/toggle, real output-expansion method, and actual SDK runToolCall error persistence. These are real SDK renderer/tool events, not a paid-provider/native terminal acceptance claim.

Commands used Bun /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun with its directory prepended to PATH, SHELL=/bin/sh and TMPDIR=/home/tnfssc/.die/tmp-pi-removal. Dependency cache is a local read-only node_modules link to /home/tnfssc/Code/die/node_modules. Absolute Bun/explicit PATH avoids the shell's unrelated untrusted-mise warning. No dependency mutation or mise trust change.

Initially the process suite failed because dist/die did not exist (not a product failure). For focused process coverage only, used a disposable source-runner dist/die with an absolute Bun shebang importing runTypeScriptFromStdin and formatThrownValue, matching CLI's internal-execute branch. All 22 process tests then passed; the disposable wrapper was removed. No full CLI/native acceptance was claimed. New SDK tests are self-contained and need no dist binary; parent can rerun the process suite against its actual final binary.

## Parent integration seam

Background sibling owns taskRows capture/import and canonical task-row suppression. Preserve those additions when merging extension.ts; the foreground renderer alone does not suppress arbitrary backgroundJobs text/counts into canonical tasks. Typed launches must use the sibling canonical adapter to replace the foreground launch row, not duplicate it. Foreground lifecycle callbacks and local quiet-tool adapter should coexist with that adapter. Persisted failure details now survive SDK execution, including sibling taskRows; do not revert to throw-on-exit when resolving conflicts. No ordinary handoff, assistant prose, or image transport is suppressed.

Values stayed unchanged: existing honest-UI, clear ownership, bounded proof and shared-work values already cover this work. This is a feature-local SDK seam, not a new general policy.
