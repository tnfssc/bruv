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
