# Current-repo on-demand handoff discovery

Run `python3 wisdom/experiments/remote-repo-probe/run.py` from this branch. The disposable fixture uses Git only; no WAN, Mac, real Linux server, die runtime, provider, skills or tooling sync. It simulates a Mac coordinator and isolated Linux task folder. The actual preinstalled/authenticated Linux die direction remains a prerequisite, not tested here. Nothing in this probe establishes transport throughput or behavior on a large repo.

Observed on one run: bundle 546 bytes, selected tracked diff 134 bytes, result diff 149 bytes; one HEAD OID, one snapshot OID, one omitted-untracked filename. Sizes are fixture payload artifacts, **not network bytes**, include Git's bundle history, and vary between runs. The clone's checked-out files and Git object store use additional disk not quantified here. No bulk upfront environment copy is required by this *fixture*; bundle still includes reachable Git history and could be large. Test asserts exact base, tracked edit selection, omission of untracked secret contents, isolated task edit, fresh return, refusals on selected/unselected local uncommitted change and advanced HEAD. The result remains an artifact on refusal, not auto-merged. See README for coverage limits.

UX decisions still open:
- How does the user select dirty tracked paths, see their diff, and explicitly opt in any untracked file? Default omit; never silently include secrets. How to handle ignored files and required Mac-only skills/tools when Mac is offline?
- When should a task wait for an unavailable repo/capability versus accept an immutable snapshot and continue independently? Identify base OID, selected changes, omitted inputs, snapshot OID, and origin clearly at acceptance.
- Should return be a branch/bundle for review, patch, or both? On advanced local HEAD/conflict show durable result and choices (review/cherry-pick/rebase in isolated workspace), not overwrite. What owns retries and atomic apply across concurrent local edits?
- Are local history, submodules, LFS and repository trust acceptable to transfer on demand? Which files/paths and hooks are authorized? How are bytes/storage and sensitivity presented before launch?

This is local recipe evidence, not a new project value. Existing [values](../values.md) on safety, truth and simplest workable approach plus [experience contract](task-experience-contract.md) cover the general lessons. No values.md change.

## Parent review in progress

Parent reran initial probe successfully; integrated locally as 2593299, not yet pushed. Review calls for staged-only selected/unselected cases and byte/index preservation on refusal. Exact-state wording must distinguish combined tracked diff from index staging layout and atomic capture. Follow-up task_7c0a5dee in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c0a5dee, branch die/test-staged-state-and-repo-refusal-bound-7c0a5dee. Parent must review, rerun and push after fixes.

## Reviewed staged-state check

Integrated follow-up as 9e7aa16. Parent reran Python probe and diff check successfully. Return gate now includes an index-entry fingerprint as well as HEAD and tracked diff; index-only staging changes refuse. Selected staged-only/mixed transfer, unselected staged refusal, ignored/untracked omission and invalid-patch refusal have checks. Each refusal compares HEAD, index entries and fixture worktree bytes before/after. This is still sequential disposable Git evidence, not atomic capture/apply or an arbitrary repo safety guarantee. Reachable history in a bundle is not secret-filtered. Review checkpoint above is closed. No values change: existing safety and truthful-state rules apply.
