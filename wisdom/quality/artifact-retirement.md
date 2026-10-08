# Remove generated clutter

The user said the layout pass left random junk behind. Moving files was not
retiring them. This pass removes obsolete tracked outputs, keeps useful decisions
and real executable inputs, and stops current tools from writing more tracked junk.
Git history keeps old evidence; do not rewrite it or delete ignored user state.

The five largest wisdom areas held about 89 MB before this pass. That is not all
junk. Claude native fixture modules and official release-gate inputs are real
consumers. Screenshot embeds alone do not make run output a runtime dependency.

A read-only audit missed current landing writers. Direct inspection found
animation.ts, capture-demo-source.ts, install-ui.test.ts and validate.ts writing
into wisdom/landing-page/validation. The earlier site test actually changed
tracked screenshots. These outputs should use ignored artifacts/landing-page.
Keep the byte-pinned site/captures/settings inputs; they have fidelity tests.

## Integrated work

Base revision: baf2fcd5c9976ee19a8cbc0ae8839875d714cc38.

- Landing outputs: task_3f234713, worktree
  /home/tnfssc/.bruv/worktrees/t3-53f4b259-5442693331ce-task_3f234713,
  branch bruv/remove-generated-landing-captures-3f234713.
- Protocol proof outputs: task_75635c63, worktree
  /home/tnfssc/.bruv/worktrees/t3-53f4b259-5442693331ce-task_75635c63,
  branch bruv/remove-obsolete-protocol-screenshots-and-75635c63.
- Closed experiments/ledgers: task_41bf0ded, worktree
  /home/tnfssc/.bruv/worktrees/t3-53f4b259-5442693331ce-task_41bf0ded,
  branch bruv/retire-obsolete-experiment-receipts-and--41bf0ded.

All three lanes are integrated. The final pass removes 480 tracked files,
77,773,367 bytes (77.8 MB). Old bytes remain in Git history, not another archive.
This reduces checkout clutter, not repository history size.

The three move inventories created by the earlier layout pass are also retired.
They were one-time integration data, not ongoing inputs. Their recovery revision
is the base above; the layout notes now point to Git rather than more copies.

Final media inventory also retired two old upstream-browser-followup screenshots
(662,930 bytes), with no maintained source/tool/test/workflow consumer. The four
T3 provider-setup guide illustrations stay: they are documentation inputs, not
a disposable run capture bundle.

## Checks and limits

Site build and 44 site tests pass after integration. The focused release and
server checks pass, as do 22 native acceptance/finalization fixture tests.
`git diff --check` passes. No paid capture or hosted acceptance was run.
The earlier full layout gate had one Markdown timeout that passed alone; this
artifact-only follow-up does not claim a new full-suite pass.

Keep the unfinished structural-readability inventories, executable proof inputs,
settings capture fixtures and four provider-setup guide images. They still have
a job. Values now say to keep durable decisions and required inputs in Git,
write disposable outputs to ignored artifacts, and use Git recovery references
when retiring evidence. All changes are local; no push or PR was requested.
