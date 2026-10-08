# Retire remaining completed-run outputs

Follow-up to [artifact retirement](artifact-retirement.md), based on
**df6a5a3759b0b7a26cd75a5e70645a7ebcf012fa**. This is a new task, not edits in
the completed worktree: branch **bruv/retire-remaining-completed-run-output-2ee19a50**,
worktree **/home/tnfssc/.bruv/worktrees/t3-53f4b259-5442693331ce-task_2ee19a50**.
No push, PR or integration into the previous task is requested.

## Decisions

Remove **245 tracked files / 2,832,250 bytes** of completed output, not another
archive or inventory. Exact paths are the deletions in this commit.

| Area | Removed files | Bytes | Decision |
| --- | ---: | ---: | --- |
| remote-workspaces/evidence | 133 | 1,024,744 | Finished test logs and plain/ANSI terminal frames. Keep human-rendering README, scoped-fake-provider.ts and sessions-and-tasks.json. |
| experiments/t3/ui-only-history-minimal | 17 | 277,791 | All revision-* build/check/UI logs and API responses. Keep review, source patch and prepared PR handoff. |
| experiments/t3/ui-only-history-pr-link | 5 | 6,575 | Four current-main logs and rebase-provenance.txt command dump. Keep publication metadata, body and actionable comparison URL: no PR was submitted. |
| quality/evidence/ci-history-2026-10-05 | 6 | 602,969 | Finished run/job/signature/lane inventories, summary and owned-log classification. Keep capture.json provenance and eight runnable read-only collectors/extractors. |
| tasks-ui/evidence | 84 | 920,171 | Completed build/test logs, before/after reports, frames, disk-footer CPU profiles/raw JSON and verification bundles. Keep long-thread REPORT.md, runnable gated-repro.patch and selector-lifecycle/pinned-evidence.json. |

Direct path, filename and directory-name searches covered source, scripts,
tests, workflows and wisdom; consumers outside the bundles were historical
reports, not runtime inputs. Constructed consumers matter: CI scripts used their
own directory plus runs/jobs/logs filenames, so all eight now use the common
ignored **artifacts/ci-history/** directory (run from repository root).
Remote PTY writers use explicit BRUV_REMOTE_PTY_ARTIFACTS; terminal performance
writers already default to artifacts, and disk probes take explicit output paths.
No writer default depended on the removed tasks/remote/history files.
Ignore rules prevent retired output shapes being recommitted without hiding the
kept provider source, source patches, provenance or pinned timing input.

Unique conclusions remain in feature reports: compiled remote Docker/fake-provider
proof and its macOS/model-quality limits; exact tested T3 source heads and
history-only UI scope distinct from official-release/full acceptance; CI's 587-run
snapshot with counting units, failure families and repair follow-up; disk-footer
correctness/timing limits and long-thread viewport/scaling findings. Historical
links now lead here rather than dangling files or an unpublished hosted SHA.

## Recovery

Use local Git, not a new copy in wisdom. All retired bytes are at the base revision
above, at their original paths. For one file:

~~~sh
git show df6a5a3759b0b7a26cd75a5e70645a7ebcf012fa:wisdom/experiments/t3/ui-only-history-minimal/revision-ui.log
~~~

To inspect a bundle, use git ls-tree -r --name-only with that revision and the
area path from the table (each is under wisdom/). Redirect recovered bytes to
ignored artifacts/ when needed; do not restore completed bundles into wisdom.
Historical source/proof revisions and worker paths remain in the feature notes.
Old ignored local state was not removed; repository history is not rewritten.

## Kept and remaining candidates

Selector pinned evidence (**271,739 bytes**) remains the explicitly retained source
timing record: action/method spans, hashes, fingerprints and frame samples for
an extraction whose performance limitations remain open. It is not a disposable
build log. Do not remove it without deciding how future baseline comparison will
work. Older/newer prepared T3 PR handoffs remain pending human submission; their
small source/provenance inputs were not treated as completed-run debris.
The fake-provider fixture and gated repro are runnable research inputs.

Unfinished structural-readability inventories remain **837/839 accepted, two
pending**. Runnable prototype source, maintained fixtures and provider-guide
images are untouched. No broader media/source retirement is claimed.

## Checks and values

- 19 focused Bun tests / 65 assertions: disk-footer, session-costs, performance
  report and options. No rebuild, Docker, paid-provider or full CI claim.
- One offline Python test runs all eight CI tools with fake gh data; verifies
  captures, job/log collection, summaries, signatures and contexts in artifacts.
- No new broken local links. One pre-existing absent terminal-stall-surface-audit.md
  link in the disk-footer report remains outside this retirement.
- All 245 removed outputs match ignore rules; retained bundle inputs are not
  ignored. SHA-256 comparison confirms 1,812 kept inputs unchanged (ignore-rule
  edits excluded), including unfinished inventories, source, fixtures and images.
  git diff --check passes.

Values unchanged: values 9/10 and Keep learning already require consumer-aware
retirement, durable conclusions/inputs, ignored outputs, Git recovery, and a fresh
task after completion. This is application of that guidance, not a new principle.
