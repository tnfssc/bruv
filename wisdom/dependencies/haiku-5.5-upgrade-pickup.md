# Haiku 5.5 upgrade: combined proof

User could not see Haiku 5.5. Pi 1.0.3 was pinned. All four Pi dependencies
now pin 1.1.0. The published catalog supplies anthropic/claude-haiku-5-5.
No local alias or guessed model was added.

## Changes and reasons

- 409086c9 upgrades the catalog, rebases reviewed patches and exact host
  hashes, migrates new API fixtures, and checks availability and selection.
  See [source review](pi-1.1.0-haiku-5.5.md).
- 49550807 gives only two compiled updater tests 30-second budgets. Two
  combined runs hit their default five-second budget; both passed alone.
  Compiler exit and compiled product assertions remain unchanged.
  See [fixture deadline proof](../ci/update-compiled-fixture-deadlines.md).
- User supplied sibling recovery commits c3ffd4f7 then 101ce082. Their 1.1.0
  integration is c117e3b2, 5ad644b2, a1d9e803, in that order. Strict hashes
  stay intact. Recovery uses a fresh frozen isolated cache, checks local
  ownership, validates source, and replaces local host files atomically.
  The fixture comes from the integrity-checked published 1.1.0 package.
  See [integration proof](pi-1.1.0-recovery-integration.md).

The initial setup inherited a polluted 1.0.3 shared-cache inode, per sibling
investigation. Do not broaden accepted hashes. Recovery now repairs inherited
bad state without changing shared cache. Real 1.1.0 recovery proof uses a
labeled synthetic stale file; it does not claim observed 1.1.0 cache damage.

## Final proof

On combined HEAD a1d9e803, bash scripts/ci.sh linux exited 0:
- Frozen install, format, lint, typecheck, CI/stress history resource budgets,
  paired build, and offline OpenAI transport passed.
- Full root suite: 2,306 passed, 30 opt-in skips, zero failures;
  115,942 assertions across 319 files.
- Paired standalone smoke passed. This is not native parity acceptance.
- Fresh temporary HOME and a nonfunctional Anthropic key, with built
  dist/bruv --offline --list-models haiku, lists claude-haiku-5-5,
  1M context and 128K output. Catalog discovery is not provider access proof.
- Focused read-only migration review found no concrete bugs.

Step logs live in ignored artifacts/ci/. Full final log was
/tmp/bruv-haiku-final-linux-gate.log. Key facts are saved here; temp logs
are not required to resume. First full runs had 3 then 2 fixture timeouts;
the scoped test fix above addressed those observed failures. No product
assertion or suite-wide deadline changed.

## Workspaces and delivery

Parent: /home/tnfssc/.t3/worktrees/bruv/t3-98a10da6,
branch t3/update-haiku-deps.

Worker paths under /home/tnfssc/.bruv/worktrees/:
- t3-98a10da6-5442693331ce-task_c23e6117: catalog upgrade,
  branch bruv/update-pi-catalog-for-haiku-5.5-c23e6117.
- t3-98a10da6-5442693331ce-task_1a61a947: updater test budgets,
  branch bruv/fix-observed-compiled-updater-fixture-ti-1a61a947.
- t3-98a10da6-5442693331ce-task_0cdc00f7: recovery integration,
  branch bruv/integrate-pi-recovery-with-1.1-upgrade-0cdc00f7.
All code and worker wisdom were committed and integrated.

Not run: macOS gate, live Anthropic request/account entitlement, or rendered
interactive terminal acceptance. No local install, release, push or PR.
The user's installed binary still needs an install/release to gain this model.

Wisdom now covers upgrade, test deadlines, and recovery integration. Values
retain the sibling lesson: stopping future damage is not recovery while
inherited bad state still feeds fresh starts. No extra general value needed.

## PR #54 conflict follow-up

User asked to address conflicts after PR publication. Merged origin/develop
37f34948, which contains the same sibling recovery commits already adapted
here. Four add/add conflicts were fixture README, recovery tests, historical
reproduction text, and drift recovery wisdom. Kept this branch's reviewed
1.1.0 versions and nested-directory ownership tests. Removed the reintroduced
1.0.3 fixture. Runtime code, pins, patches and hashes are unchanged from the
fully validated branch. No develop change was dropped beyond superseded
1.0.3 fixture content already carried by the 1.1.0 integration.

Post-resolution check and guarded asset prep pass. Host/recovery/Haiku tests:
32 passed, zero failures, 1,484 assertions. The prior full Linux proof still
applies to unchanged runtime code; no need to repeat the entire gate.
Values unchanged in this follow-up: same recovery lesson applies.
Next: commit merge, push PR branch, confirm GitHub no longer reports conflicts.

User then requested newest develop sync, new-issue review, merge if green,
and a new release after merge. Latest base is 486bcc7f (PR #55 prompt
simplification). It merges without new conflicts. Existing recovery conflicts
were resolved in 4c83d23c. Full combined Linux validation will run again.
After green local and hosted checks, merge #54 and dispatch Release workflow
on develop. It owns version preparation, platform gates and publication.
No repo edits in this worktree after PR merge. Record later release facts in
the release or task, not here. Values unchanged by sync/release request.

Latest-base gate on e5a1725c passed (full scripts/ci.sh linux), including
paired smoke. Root suite summary:
 2307 pass
 30 skip
 0 fail
 115968 expect() calls
Ran 2337 tests across 319 files. [103.83s]
Read-only review task_820fe180 found no new bugs and confirmed no base changes
lost. Prior PR feedback had no code findings (CodeRabbit review was skipped).
Pushing conflict-resolution commits and this proof to PR #54. Wait for hosted
Linux/macOS checks on the new head, then recheck base/head before merging.
Release follow-through uses the managed workflow, not old-worktree edits.
