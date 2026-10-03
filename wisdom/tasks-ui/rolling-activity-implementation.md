# Rolling tool activity implementation pickup

Approved PR #23 implementation slice, 2026-10-03. Runtime and focused tests are in this commit; publication and combined CI belong to the parent. The prior proposal/research were copied from task_9f8bbb2c without editing that worktree or waiting for it.

## What changed

- Local Pi 1.0.0 alternate-screen InteractiveMode gets collapsed tool groups. One header counts unique native outer toolCallIds; latest outer label is the live replaceable preview. Helper/task IDs, result deliveries and expansion never add calls.
- Keep native tools as direct chat siblings. Existing pending-tool maps, task owners, renderers, images, result evidence and detail clicks still own their work. The small activity-projection seam is applied after the existing SDK task-row renderer computes its canonical owner facts, including live launches before any result exists.
- Header click opens/closes a group. Native detail clicks stay native. /activity uses Pi's keyboard picker (Esc returns); Ctrl+O still enumerates native tools and also opens/closes groups. Scroll changes anchor the reading component; a removed detail anchors back to its group header. Picker selection intentionally reveals that header. Explicit interaction disables bottom-follow until the normal viewport control returns to the end.
- Completed runs append a state-only bruv-activity-boundary custom entry to the **existing Pi journal**, containing unique outer call IDs. Reopen and selected-branch navigation derive membership only from getBranch(). User boundaries remain distinct even for steering within a run; automatic continuations have their own run boundary. No transcript/source content is deleted or rewritten, and no task/question authority or second ledger is introduced.
- Unclassified assistant prose and unknown custom messages remain native and visible. This deliberately does **not** classify provider phases or hide prose on English/tool-order heuristics. Questions and notes retain their existing visible paths and /questions ledger controls; display:false routing remains hidden.
- Failures, handoff, output-save warnings and canonical typed task rows remain visible when collapsed. Late completion updates the original owner without increasing the count. Missing/partial results are marked incomplete, not successful.
- Regular-mode, placed-root, web and noninteractive transcript presenters are not adapted. The installed CLI adapter acts only on fullscreen InteractiveMode instances; regular runs do not write activity boundaries.

## Proof and limits

Focused gate: bun run check; bun test tests/rolling-activity.test.ts tests/task-rows.test.ts tests/conversation-density.test.ts. Coverage includes native mouse/detail dispatch, actual Pi Ctrl+O traversal, picker cancel/open, install-before/rebuild-before order, real disk-journal reopen and branch selection, automatic continuation, unique identities, steering users, source-less results not inventing counts, live task ownership, late completion, reading anchors, narrow resize and real native Kitty image components through repeated collapse/expand.

The ordinary full build probe stopped at the web producer because pnpm was absent from the probe PATH. No build guard or producer receipt was bypassed. No compiled terminal claim, all-suite claim, paid-provider claim, placed-root/web parity claim, release or push is made here. Parent owns the combined CI/build and independent compiled-terminal acceptance from task_59099cce's scripts/activity-terminal-acceptance.py. That harness was read for its interface, not duplicated or edited.

Intent limit: this is the safe-default **tool rolling** path, not provider-independent rolling assistant prose. All assistant prose remains lasting. Provider phase support and standalone question cards are not implemented. Native thinking controls are unchanged.

Legacy limit: old journals without our boundaries can group calls between user entries, but cannot reconstruct unrecorded historical yield/continuation boundaries. Native Pi already omits unpaired result-only replay components; this change does not invent calls or repair those histories. Expansion is presentation state, not journal state; a rebuilt transcript follows the current native global expansion setting, not saved per-group expansion. A hard process exit before a run-end marker leaves an incomplete stretch, rather than a fabricated settlement.

## Parent pickup

Cherry-pick this commit, then run the combined gate and the independent harness against the resulting built CLI. Inspect live replacement, mouse header/detail, /activity cancel/open, Ctrl+O, scrolled-away updates, /resume, /reload, reopen and branch navigation. Unknown prose remaining visible is intentional, not a harness failure. Check the adverse/late task frames as well as the clean flow. No changes are needed in task_9f8bbb2c or its worktree.

Pi-version seam: src/ui/rolling-activity.ts wraps only handleEvent, renderSessionItems and setToolsExpanded, plus each scoped chat's render and tool mouse methods. It leaves the children array intact. The scoped chat render dynamically resolves Container.prototype.render when inherited, so session_start's later task-owner install still adapts already-built replay components. Freezing the inherited function before that install breaks /resume/reload: keep the rebuild-order test.

Values reviewed and unchanged. Existing one-owner, honest-UI, safe-replay and real-path proof values cover this lesson; it belongs in feature pickup wisdom rather than a new general rule.
