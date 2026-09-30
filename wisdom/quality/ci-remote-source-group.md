# Remote source feedback group

2026-09-30. Implementation: scripts/ci-remote-source.ts; no workflow or selector edits.
Read ci-broad-fast-path, ci-selective-external-research, ci-selective-review and values.

## What this proves (and does not)

Remote is an actual subsystem class, not just human-rendering: 24 exact source
files, 17 remote behavior suites, source CLI remote-control JSON entry, offline
rendered PTY inbox/grant/confirmation/revocation, and the existing source spoken
TUI fixture. This covers durable capabilities, owner/client state, repository
snapshot/return, artifact transfer, delivery, session switching, bounded SSH
transport (a local fake ssh executable, no SSH server), menu and rendering.

Bun --changed runs over an explicit 15-file source-safe reverse population for
agent/extension, tasks/job-service and typescript/job-bridge consumers. The
explicit remote/process suites ALWAYS run, including filesystem/PTY fixtures;
Bun static imports cannot discover process launches or arbitrary file reads.
An inventory regression scans direct test imports using Bun.Transpiler and
requires an explicit source/full owner. This is an alarm, not a new build graph
or proof of all possible runtime imports. Unknown/shared source edits still go
full. Reverse-population tests are not themselves new fast edit classes.

Full-tier ownership is exported, not quietly filtered away. pi-host and
job-bridge remain WHOLE suites because they use compiled output; so does
live-main-integration (its automatic dist preference is unsuitable here).
Compiled remote PTY, Docker/SSH normal CLI/native question/jobs/recovery and their
fixtures remain full-tier. No compiled tests were renamed, deleted or made to
pass against stale dist. Existing opt-in paid/live scenarios retain their
original opt-in policy: goals-live reports one such skip in source feedback;
phase2-native-live remains full acceptance. Source feedback is NOT artifact,
complete premerge, native-platform, web, paid-model or release validation.
An enforced full actual merge-candidate gate must retain those responsibilities;
nightly alone is not an equivalent premerge proof.

An attempted 26-file reverse union including fake-provider SDK and T3 server
suites did not finish by cancellation after 173s. This does NOT establish which
individual test caused the long run. Those whole suites remain explicitly
full-tier pending separate process/resource auditing. No concurrency flags,
shorter deadlines or silently omitted cases are used to manufacture a budget.

## Ownership / classification contract

classifyRemoteChange({path,status,oldPath?}) returns source, reference or full.
Only exact inventoried A/M paths qualify. A known addition is covered by the
head-tree audit; a genuinely new unowned remote source/test is full until its
consumer audit updates the manifest. D/R/C/T/U, either rename endpoint, unknown
fixtures, lock/dependencies/toolchain/build/workflow/selector changes and shared
CLI/agent/tasks changes are full. Parent normalizes renames to delete+add, inspects
regular executable/nonexecutable modes in BOTH applicable trees, validates the
exact merge-candidate checkout and unions changes fail-closed. This function is
path ownership only; it does not resolve revisions or validate trees.

Reference expansion is an exact named inventory, not an extension/directory
wildcard: existing top-level human remote-workspaces/dependencies research,
configuration/agent-config-discovery, and remote README/CAPABILITY-INTEGRATION/
repository notes. Audited src/scripts/tests/.github for literal path/build/test
consumers: no runtime/build consumers of these documents. src/wisdom/extension
only supplies the project-wisdom instruction; it does not embed the reference
contents. values and prompts are NOT in this inventory. Nested hosted-PR and
remote-e2e fixture README files, releases, unknown/new Markdown and deleted docs
remain full. This evidence applies to the audited tree, not arbitrary future
runtime file-reading code. Reaudit when ownership changes; no blanket .md skip.

## Parent integration (no YAML change made here)

1. Import classifyRemoteChange, remoteSourceCommands and remoteReferenceDocs.
   For selector Change {status,paths}, only paths.length === 1 is adaptable;
   map source to a new remote-source class and reference to docs. Try existing
   audited classes for other paths; ANY unowned decision still forces full.
   Replace broad dependency/configuration/remote-doc globs with exact ownership
   membership rather than treating arbitrary Markdown as harmless.
2. Keep the selector's revision/head-checkout/mode/fail-closed runner contracts.
   Remote is stateful, so do NOT apply the tiny pure-leaf scanner as if these
   were pure modules; preserve tree/mode checks and unknown/shared fallbacks.
3. Run frozen root install and normal format/lint/root typecheck. Always run
   tests/ci-remote-source.test.ts alongside selector-policy tests. Then execute
   remoteSourceCommands(resolvedBaseSHA, actualBunPath).map(c => c.argv) in order:
   fresh prepare-assets, explicit remote+process tests, audited reverse tests
   with --changed=<base>. Deduplicate prepare-assets if already run. Use repo
   cwd, real Bun 1.4.2 on PATH, SHELL=/bin/bash and a unique writable TMPDIR under
   /home. tmux and python3 are necessary for the selected source renderer tests.
   Do not run the build-first package test script; no web/assets archive restore,
   Node/pnpm/Docker provisioning or dist is necessary for this class.
4. Label the result affected SOURCE FEEDBACK and report selected test counts,
   skips and full-tier ownership. The parent is responsible for preserving the
   full actual merge-candidate/artifact gate; classification exit 0 is not proof.

## Checks and mutation evidence

Policy suite: 7 pass, 721 assertions, ~1.1s alone (~2.6s while another local job
ran). Tests cover known/unknown additions, deletions, rename/copy/type changes,
fixtures, unsafe/unknown docs, command construction and real Git Bun --changed
transitive selection. A non-import filesystem fixture mutation fails its
explicit owning test. Three isolated source-tree mutations are killed by real
consumers: sensitiveRepoPath always false -> capability-runtime denial failures;
remove conflicting-intent retry refusal -> client failure; remove extra JSON
request-field refusal -> real source CLI remote-control failure. Sandbox has
source/tests/dependencies/assets only, never dist. Mutations do not touch the
tracked working tree. Policy tests alarm on new direct unowned consumers.

## Local measurements, not a hosted p95 promise

Bun 1.4.2 (744846f84), installed binary
/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun; bash; TMPDIR under
/home/tnfssc/die-ci-source-tmp with unique run subdirectories. Checkout d14a830;
reverse base 3fe7b2ce6d971d10115dee98a4dc248a27059cc9 (before last remote menu
change). No dist existed before/after. No build, archive download or web entered.

| Local cost | Cold generated assets | Warm generated assets |
|---|---:|---:|
| frozen install, already installed | 0.043s | 0.009s |
| prepare fresh Pi assets/host adapter | 0.021s | 0.017s |
| explicit remote/source process group | 17.903s | 19.369s |
| Bun changed reverse group | 4.649s | 5.402s |
| format + lint owned 43 TS files | 0.235s | 0.202s |
| root typecheck (FAILED, see below) | 1.352s | 1.328s |
| measured process total | 24.204s | 26.329s |

Initial clean node_modules frozen install was separately 1.267s with the local
package download cache; this is not a network-cold install measurement. Cold
assets means runtime-assets deleted/regenerated, not OS cache flush. The policy
suite/checkout/host provisioning are additional costs. This is two local runs,
not hosted runner-start-to-result p95 or an end-to-end green CI claim.

Explicit group: 123 pass / 19 files / 1647 assertions. Reverse at this base:
141 pass, 1 existing paid/live skip / 14 affected files / 754 assertions; one of
15 population files is not affected. Root typecheck fails in the PREEXISTING
tracked tests/ci-selective-workflow.test.ts:260 fetch cast (missing Bun fetch
preconnect). None of our files produce tsc errors. Parent must fix that owner;
we have not bypassed the error or called the complete check green.

## Candidate rate versus proved scope

Prior research at cac5578 reported 20/100 remote-source candidate commits,
versus 5/100 total tiny-selector candidates. Retrospective exact current
manifest path/status classification across the latest 100 non-merge commits at
cac5578 also yields 20 source-eligible commits, plus 10 reference-only commits
when unioned with the existing ci/quality/live reference policy. This is NOT
30 fully proved historical merges. A permissive remote-source/test + any-.md
count gives 21 executable candidates; the compiled-only offline PTY commit is
excluded by the implemented full policy. Releases/values remain real blockers.
Historical paths can be inventoried now without proving their old source trees,
old consumers or old runtime times. What is actually tested is this source tree
and the above behaviors; hosted p95 and parent integration remain to be proved.

Values unchanged: existing truth-of-proof, ownership, bounded execution and
simplest-working-design values already cover this lesson. This note records
specific evidence and limits, not another general value.

## Parent integration policy

Integrated helper commit9486685 as6482461. Parent wires source/reference decisions into the existing selector, uses resolved cumulative base for Bun --changed, unions mixed classes, keeps status/revision/mode/unknown fallbacks, and runs source-tier policy tests with installed dependencies. Docs-only runs remain dependency-free selector tests. Fresh Pi assets are prepared once by the common runner (typecheck preparation is idempotent). Source-only pi-host variants remain an additional parent-selected boundary.

The worker recommended an enforced full premerge gate. Current product decision instead exposes an honestly named selected-feedback tier and CI policy; it does not claim complete premerge/artifact proof. No branch protection was changed (repo had none). Unknown/high-risk changes, scheduled/manual CI and actual releases still run full validation. This deliberate separation is needed for routine fast feedback; a green selected lane must not be described as all tests passing.

The worker typecheck gap was an old base fixture and is fixed in parent. Hosted proof is pending.
