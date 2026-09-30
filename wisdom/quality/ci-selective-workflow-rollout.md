# Selective CI workflow wiring and rollout

## Scope and policy

This wiring is designed for routine **feedback**, not a claim of <60s full validation.
The initial selector allowlist/commands live in `scripts/ci-selective.ts` (integrated
separately). No dependency-graph expansion or blanket Markdown exemption is added here.
Read the design, external research and timing audit in this directory before rollout.

- PRs and every develop push create CI, without top-level path filters.
- **Selected feedback (not full validation)** checks out clean source, installs only
  Bun 1.4.2, plans, then runs `--run` in the same job for docs/selected plans.
  The selector owns frozen dependency installation and source test preparation.
  No Node, pnpm, tmux, web build, cache restore, artifact transport, or macOS job runs
  on the routine eligible CI path. Docs still invoke the selector runner; they do
  not claim executable coverage.
- Unknown, high-risk, empty/unresolvable-base changes run the existing full Linux
  CI gate and device-free macOS Live gate. Their commands, tool provisioning and
  download-only caches remain unchanged. Both must succeed.
- Nightly (03:17 UTC, GitHub default branch) and CI workflow_dispatch always run
  those full gates, independent of a diff. Separate event concurrency prevents a
  routine push cancelling nightly reconciliation. Dispatch on develop when that
  is not the default branch.
- **CI policy** is always scheduled, including when its dependencies fail or skip.
  It requires successful feedback plus either both full jobs successful, or an
  explicit docs/selected plan with both inapplicable full jobs skipped. A failed
  selected command fails feedback and policy. Missing, malformed, failed, cancelled
  or unexpectedly skipped required results fail policy. Policy is not an artifact
  attestation and does not turn selected feedback into full-validation proof.

The existing full CI and full release checks are retained, not narrowed: Linux
format/lint/typecheck/build/offline transport/web/backend/projection/root test/smoke
checks, macOS source Live checks, and the release native sanitizer/helper, final
browser boot+reload, actual Mac binary/updater, notices/provenance/checksum gates.
The full release lane remains separate; CI's nightly reconciliation does not
publish or produce release assets. Opt-in real-service acceptance remains opt-in.

## Diff semantics

PR checkout is GitHub's tested merge commit, not the contributor head. Use its
actual first parent as the comparison base, after requiring exactly two parents,
matching the event merge SHA and PR head second parent, and reproducing the tested
merge tree with `git merge-tree --write-tree`. This avoids selecting only a head
commit while running a different tree, and avoids stale PR payload target SHAs.
Invalid/missing topology or a different/conflicted tree gives the selector an empty
base and requires full CI. Tests create a real target-advanced merge and a forged
wrong-tree merge to verify this behavior.

Develop pushes compare from a successful trusted CI push ancestor to the exact
checked-out tested HEAD, not event.before. Thus failed/cancelled source changes
remain in the next push's diff even when that push edits only docs. Missing or
uncertain baselines plan full, with no before/HEAD^ fallback. Full git history is
fetched and lookup is bounded to one API page; see
[the cumulative baseline contract](../ci/selective-push-baseline.md).
No contributor title, branch name or filename is interpolated into shell. Event
SHAs are passed as quoted environment values. PR token permissions are read-only,
checkout does not persist credentials, and no pull_request_target runs.

## CI versus release

CI alone validates ordinary PRs and develop pushes. Selected-only feedback is
not full confidence for executable changes; the parent is tightening ordinary
executable-change policy separately, without expanding allowlists.
High-risk changes still run full Linux build, root and web tests plus macOS Live
validation; full CI takes minutes, not the measured narrow-source 46 seconds.
Nightly/manual full reconciliation remains required. Full CI retains the former
release-only source checks too: backend/client typechecks, device/event logging,
web cache regressions and terminal recovery. Final release binary/browser/Mac/
updater gates remain release-specific, not claimed as per-push coverage.

Release packages binaries only on manual dispatch from develop or stable tag
pushes. Routine develop commits never run release packaging. There is no develop
dry-run producer, exact-SHA lookup or cross-run asset reuse. Every actual release
runs fresh full validation (backend/model/contracts/projection/cache/terminal,
root tests and build), native helper, final browser, Mac and old-updater gates.
Manual preparation still creates the next-version commit on latest develop;
prepared SHA/tag and tag/version consistency bind validation to publication.
Only the final gated publish job has publication authority. No replacement
workflow or shared-artifact protocol is needed.

## Rollout (human-owned; no automatic push/dispatch/release)

1. Integrate selector and workflow changes atomically; never deploy workflows with
   the selector absent. Run selector fixture tests, workflow regressions, all
   existing workflow tests, formatter/linter, and actionlint. Review the union of
   full CI/release gate inventories and the selector's audited allowlist together.
2. Explicitly approve the policy change: audited selected source classes provide
   affected source feedback, not all-tests/all-platform premerge validation. If
   policy requires full executable validation before every merge, retain/require
   full CI (or a separate merge-candidate full gate) rather than treating nightly
   as a replacement. This patch does not introduce merge-queue support.
3. Update branch protection from obsolete Linux/macOS check names to **CI policy**
   only after observing that it is present on docs, selected and full PR events.
   Requiring conditional Full validation jobs would accept skipped statuses or
   block narrow PRs; use policy to enforce applicability. External automations must
   distinguish selected feedback from full proof. Release is not a routine push gate.
4. Before advertising <60s, measure hosted docs and each enabled source class on
   clean runners, cold and warm dependencies, including job startup and the final
   policy job. Record runner-start-to-policy-result and event-to-result p50/p95,
   queue time and selector hit rate. Separate the <60s
   feedback target from full fallback/release latency. The extra aggregate runner
   can dominate short docs checks; do not omit correctness to hit a timing number.
5. Human-trigger representative PR/develop tests: docs, each source class,
   multi-commit push with an earlier high-risk change, rename/delete/unknown file,
   unavailable/zero base, target branch advancement, dependency/native/workflow
   edits, selected test failure, cancelled/skipped dependencies and full gate
   failure. Confirm event/condition behavior and exact checked-out SHA in summaries.
6. Human-trigger a nightly/manual full reconciliation and compare selected mappings
   against full failures before expanding scope. Inspect final release gates on
   a controlled manual/tag test separately. Develop pushes must create CI only,
   never Release packaging. No release was dispatched by this implementation.
7. Roll back selective eligibility by making the selector conservatively emit full
   for affected classes (or force full in CI planning); keep CI policy present.
   Investigate any missed failure with full-CI reproduction before reenabling.

## Local validation

`bun test tests/ci-selective-workflow.test.ts` exercises actual checked-in shell
and conditions, including policy failure/cancellation/skip matrices, full-only
reconciliation, source-only setup, merge-tree/base semantics, and release gates.
`actionlint .github/workflows/ci.yml .github/workflows/release.yml` validates both
workflows (validated locally with actionlint 1.7.12). No pushes, dispatches or releases
are necessary to run these tests. Hosted timing and event checks remain mandatory;
local millisecond fixture tests are not a hosted speed measurement.
