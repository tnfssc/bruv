# Daily dependency PRs — custom workflow (2026-09-30)

The user superseded the Dependabot design below: use our daily + manual GitHub Actions workflow, attempt all root updates including aligned Pi, and let breaking changes visibly fail for human repair. Do not automate SDK hash changes or migrations. The active owner is `.github/workflows/dependency-updates.yml`; root Dependabot config is removed.

Implementation worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_e16383d5
Branch: die/custom-daily-dependency-pr-workflow-e16383d5
Script worker: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_e16383d5-a86675007a5e-task_4473c92c, branch die/dependency-updater-script-and-tests-4473c92c.
Review worker: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_e16383d5-a86675007a5e-task_b76dff8d, branch die/review-daily-dependency-automation-b76dff8d.

## Current contract

- Daily 06:00 UTC and workflow_dispatch; checkout develop, not arbitrary input refs.
- Explicit `bun update --latest <root names>` updates exact pins and major releases, including every root Pi package. Assert Pi versions aligned. Preserve @types/bun, Bun/Node/pnpm pins and vendor source pins. No source guard rewrites.
- Commit candidate before shared Linux CI (frozen install, format/lint/typecheck/build, web and deterministic tests, smoke), then generate notices. No-change still runs checks, creates no PR. Any failure blocks publication; manual migration is expected for incompatible Pi.
- Read-only validation job; separate write-token job only transports a validated Git bundle and calls git/gh, never runs dependencies. Pinned actions, no PAT or new secrets. One owned branch automation/daily-dependencies and one open PR against develop. Do not edit this bot branch by hand; take recovery patch to a separate branch.
- GITHUB_TOKEN suppresses normal PR-triggered CI. Body links exact validated commit SHA and updater run. It does NOT claim macOS/ordinary PR CI passed, bypass branch protection, auto-merge, or release. Required PR checks may need a human-authorized run.
- Artifacts kept 7 days: candidate patch, summary, successful commit bundle/body, last 1 MiB per CI/update/notices log. Logs on GitHub have full output. Failed runs leave prior successful PR untouched, not relabeled as current success.
- If develop advances during checks, publication fails and needs rerun. If PR creation is disabled, validated branch/artifacts remain recoverable; enable setting and rerun.

## Parent-owned hosted operation

Enable repository Settings → Actions → General → Workflow permissions → **Allow GitHub Actions to create and approve pull requests** (the workflow only creates/edits, never approves). Organization policy must permit it and contents/pull-requests write for the publish job. No secret setup. Scheduled workflows must exist on the repository default branch; keep that copy and develop implementation in sync.

Production dispatch after publication:

```sh
gh workflow run dependency-updates.yml --repo tnfssc/die --ref develop
gh run list --repo tnfssc/die --workflow dependency-updates.yml --limit 5
gh run watch RUN_ID --repo tnfssc/die --exit-status
gh run download RUN_ID --repo tnfssc/die --name dependency-candidate --dir artifacts/dependency-run-RUN_ID
gh pr list --repo tnfssc/die --base develop --head automation/daily-dependencies
```

### Controlled changed-success fixture (not product proof)

Use existing private tnfssc/die-dependency-pr-fixture-20260930. Replace its old tiny Dependabot fixture tree with a **full snapshot of this implementation**, preserving the fixture repository's .git and production history/tags needed by CI (v0.7.1), remove its old Dependabot config, keep default/develop branch consistent. Parent owns these GitHub writes. Do not publish production downgrades.

Parent setup recipe (run from this implementation checkout; use a new durable clone so existing fixture work is untouched):

```sh
fixture="$HOME/.die/worktrees/die-custom-dependency-fixture-20260930"
gh repo clone tnfssc/die-dependency-pr-fixture-20260930 "$fixture"
git -C "$fixture" switch develop
git -C "$fixture" rm -r --ignore-unmatch .
git archive HEAD | tar -x -C "$fixture"
git -C "$fixture" fetch https://github.com/tnfssc/die.git tag v0.7.1
(cd "$fixture" && bun -e 'const p=await Bun.file("package.json").json(); p.dependencies["resolve.exports"]="2.0.2"; await Bun.write("package.json", JSON.stringify(p,null,2)+"\n")' && bun install && git add -A && git commit -m 'test(deps): isolated custom updater baseline')
git -C "$fixture" push origin develop refs/tags/v0.7.1
# If default branch is not develop, publish the workflow there too (schedule/dispatch discovery).
```

In the private fixture checkout only, set resolve.exports to 2.0.2 and run `bun install`, then commit/push that fixture baseline to develop. This deliberately old independent dependency is already proven by the previous fixture. Keep all other production pins unchanged. Use the exact same workflow and CI script; fixture mode merely limits updater selection to resolve.exports. The script denies fixture mode except manual dispatch in that exact repo.

```sh
gh workflow run dependency-updates.yml --repo tnfssc/die-dependency-pr-fixture-20260930 --ref develop -f fixture=true
gh run list --repo tnfssc/die-dependency-pr-fixture-20260930 --workflow dependency-updates.yml --limit 5
gh run watch RUN_ID --repo tnfssc/die-dependency-pr-fixture-20260930 --exit-status
gh pr list --repo tnfssc/die-dependency-pr-fixture-20260930 --base develop --head automation/daily-dependencies
gh pr view PR_NUMBER --repo tnfssc/die-dependency-pr-fixture-20260930 --json url,body,headRefOid,files,mergeable,statusCheckRollup
gh pr diff PR_NUMBER --repo tnfssc/die-dependency-pr-fixture-20260930
```

Review actual hosted PR title/body (TEST ONLY), two-file diff, version summary, base develop, exact head SHA matching updater body, full successful validation/publish jobs and run links. Record proof in hosted-pr-acceptance.md. A fixture PR does not prove a merge-ready product upgrade. Native Dependabot queued jobs are no longer part of acceptance.

## Local implementation evidence

- Independent review found staged-file leakage at candidate commit; fixed by resetting the index before staging only package.json/bun.lock, rejecting any other changed path in publish, checking the candidate's sole parent equals BASE, and checking both staged/unstaged drift after validation.
- Focused updater/workflow tests: 9 pass / 52 assertions. Actionlint v1.7.7 and git diff --check pass. Repository format check passes. Frozen root install and third-party notices pass (128 packages, 552399 bytes).
- Disposable real-registry fixture probe upgraded exact resolve.exports 2.0.2 → 2.0.3, generated the version table, passed frozen install and a conditional-export behavior check. Separate local Git bundle probe preserved exact candidate SHA/parent across validation/publish repositories. Neither is hosted PR evidence.
- Full shared Linux CI was launched on this implementation tree using Bun 1.4.2, Node 24.21.0, pnpm 11.27.1 (vendor independently selects its pinned 11.10.0). At initial handoff, build and web checks passed; deterministic tests were still running (session job task_7050c5c9), with logs under this worktree’s artifacts/ci/. Do not call the full gate passed until its final result. Initial attempts encountered missing PATH tooling; resolved with explicit executable paths and disposable pnpm install, not project configuration changes.

Values reassessed: existing values 1/2 require real hosted output and honest evidence; 3 requires one owner; 7 favors straightforward updates/failures; 9 keeps human review of dependency semantics. No general values edit needed.

---

## Historical superseded Dependabot plan (not current instructions)

# Daily root dependency PRs

Use native Dependabot, not a custom GITHUB_TOKEN PR creator. GitHub now supports the text-based Bun lockfile (Bun >=1.1.39): [supported ecosystems](https://docs.github.com/en/code-security/dependabot/ecosystems-supported-by-dependabot/supported-ecosystems-and-repositories#bun). This avoids token-created PRs silently missing pull_request CI and adds no actions, PAT, or new secrets.

## Operation / setup

- Parent reviews and pushes this commit; do not expect local tests to prove hosted execution. Merge the configuration into the repository **default branch**: GitHub reads .github/dependabot.yml there, even though updates target **develop**. Ensure develop exists and Actions/Dependabot are allowed by repository/org policy.
- Daily checks run around 06:00 UTC (GitHub may delay scheduling). One grouped version-update PR covers root Bun dependencies, including majors; the open-PR limit is one. Dependabot refreshes that PR as updates arrive. It does not merge, publish, update vendored T3, or change Bun/Node/pnpm pins.
- Manual check: repository **Insights → Dependency graph → Dependabot**, open the Bun update job, then **Check for updates**. Job logs there explain errors. Existing PRs also support the `@dependabot rebase` command in comments. No workflow_dispatch entry is needed.
- PRs made by Dependabot trigger existing pull_request CI with read-only permissions. Current Linux CI performs frozen install, format/lint/typecheck, fresh build, web/deterministic tests and smoke; macOS runs device-free Live checks. Actions are already SHA-pinned. No Dependabot secrets or PAT are required. Keep required CI checks/review protections on develop; do not enable auto-merge for this job.
- Hosted acceptance: trigger the manual check, inspect the job log and resulting PR base/changed files, then confirm Linux and macOS CI run on its head. A no-updates run legitimately creates no PR. Failure is visible in Dependabot logs/PR checks, not a reason to auto-merge.
- This config provides **version updates** against develop, which is also the repository default branch. Dependabot security updates are enabled separately in repository settings.

## Checked SDK boundary

The four @earendil-works/pi-* packages are deliberately ignored, even though the exact 0.99.1 upgrade succeeded in v0.15.12. Older blocker notes are historical; see [verified migration](pi-0.99.1-sol-upgrade.md). Their exact versions and the SessionManager source SHA-256 guard in scripts/prepare-assets.ts must move together under a human-reviewed migration with real adapter/TUI/history regressions checked. Do not remove the ignore merely to silence outdated-dependency reports. Review transitive lockfile changes too; source guards and CI still apply. Vendor/toolchain upgrades remain separate reviewed changes.

## Durable handoff

Implementation branch: die/finish-daily-dependency-pr-automation-3609ae8f.
Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_3609ae8f.
Earlier killed worker's e8fd5c4b worktree had no uncommitted implementation; its older Pi-blocker commit is superseded, not reused.
Local setup: use installed Bun 1.4.2 (mise trust if using mise shims), bun install --frozen-lockfile, then bun test tests/dependency-updates.test.ts. Tests cover schedule/scope/group/base, SDK exclusions and existing CI triggers/permissions/action pins. Hosted PR creation remains a parent verification step.

Values reviewed; existing dependency-behavior and durable-handoff guidance applies. No new general value needed.

Local proof: Bun 1.4.2 frozen install passed; dependency-updates + release-workflows tests passed (19 tests, 342 assertions). Repository format check and lint exited 0 (lint has existing warnings/infos); focused new-test lint is clean; git diff --check passed. No build/runtime code changed, so full fresh build was not rerun. No push, hosted run, merge, or publication performed.

## Hosted proof (2026-09-30)

Integrated b14fb8137c7249a2fac6029a5853ecd2ec4ec1e1 into develop and pushed. GitHub confirms develop is the default branch. The config push automatically triggered [Dependabot run 36668150301](https://github.com/tnfssc/die/actions/runs/36668150301), which succeeded. Logs show registry checks, no eligible dependency updates, and the Pi wildcard excluded aligned and transitive Pi packages. Some versions were filtered by Dependabot cooldown. No PR was created: this proves the hosted no-change path, not PR creation or PR-head CI. Do not manufacture a production downgrade to force a PR. Verify those on the first real update.

[CI run 36668144473](https://github.com/tnfssc/die/actions/runs/36668144473) passed Linux and macOS on that exact config commit. No PAT or added secret was needed. The attempted REST dependabot/updates/jobs endpoint returned 404; use the documented dependency graph UI for manual checks, not that endpoint. Values remain unchanged; existing honest proof and simplest-working-path guidance applies.

## Hosted creation follow-through (2026-09-30, pending parent writes)

Implementation branch: die/prove-hosted-dependency-pr-end-to-end-10879f72.
Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_10879f72.
Read-only research worker: branch die/registry-and-dependabot-audit-1090bffb,
worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_10879f72-a86675007a5e-task_1090bffb.

A fresh public npm registry audit at approximately 04:28 UTC checked all thirteen
root direct dependencies, including all stable numeric versions, not only the
latest dist-tag. Each highest stable version equals the installed manifest pin:
four Pi packages 0.99.1; @google/genai 2.24.0; es-module-lexer 3.0.2;
resolve.exports 2.0.3; ws 8.22.0; zod 4.6.5; @biomejs/biome 2.5.14;
@types/bun 1.4.2; @types/ws 8.18.2; typescript 7.0.2. No prerelease or
transitive-only widening is proposed to manufacture a direct dependency PR.

Closer reading of run 36668150301 places all three cooldown messages under
“Checking if @types/ws 8.18.2 needs updating”; the filtered latest is 8.18.1,
followed by “No update needed for @types/ws 8.18.2”. The registry dates 8.18.2 to
2026-09-29T08:07:45.655Z. Thus cooldown is not hiding a newer direct version:
production already has the filtered version. No explicit cooldown exists in our
config; the logs do not establish its effective duration. Disabling cooldown
would not create an honest newer dependency update and is not needed here.

Keep the Pi exclusion: it intentionally means automatic routine updates do NOT
cover every dependency. All four direct Pi packages and aligned Pi transitives
need the separate checked migration process; the source guard is untouched. No
new Pi release is currently missed by the exclusion. If the user wants automation
to propose Pi migrations, that is separate work, not removing this safety boundary.

The next operational step is the [isolated hosted fixture](hosted-pr-fixture/README.md).
That template is ready for the parent to copy into a separate private repository,
then push once to create a native Dependabot job. It deliberately starts the test
package at resolve.exports 2.0.2 (production remains 2.0.3). Its daily grouped Bun
config targets develop; test(deps) PR titles and README label the result TEST ONLY.
No custom token-based PR writer or extra production workflow is necessary.
Native Dependabot PRs trigger CI without GITHUB_TOKEN PR-event suppression.
The README includes exact create, inspect, and watch commands and acceptance
criteria. No GitHub writes were performed by this implementation worker.

Local validation: root frozen install and existing dependency-updates tests pass
(3 tests / 28 assertions). The fixture frozen install/tests pass at both 2.0.2 and
2.0.3 (2 tests / 3 assertions each); the upgrade probe changes exactly package.json
and bun.lock (3 insertions / 3 deletions). Fixture tests cover manifest/installed
pin consistency and actual conditional-export behavior. Fixture CI also enforces
the two-file PR scope and frozen lockfile. Focused Biome check, repository format
check, and git diff --check pass. Production runtime code/config/pins are unchanged;
no full product rebuild was needed for the template.

Pending evidence: parent must publish the isolated fixture and record its actual
Dependabot run URL, PR URL/body/diff review, exact head SHA and passing CI URL.
A fixture PR is not a product merge-ready PR. The product still needs first-real-
update review against its own Linux/macOS CI. Do not report the original no-change
run, or this unpushed local template, as proof of hosted PR creation.

Values reviewed again: existing honest proof, checked dependency behavior, and
durable handoff guidance applies. No new general value was needed.
