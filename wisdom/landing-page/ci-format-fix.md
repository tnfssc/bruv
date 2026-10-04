# Public-site PR #28 CI formatting fix (2026-10-04)

Worktree: /home/tnfssc/.bruv/worktrees/t3code-49177b47-5442693331ce-task_1be14f3d
Branch: bruv/fix-public-site-formatting-gate-1be14f3d
Base: supplied site + develop merge. Parent owns cherry-pick and merge into
/home/tnfssc/.bruv/worktrees/bruv-public-site-logo.

The full CI log at /tmp/public-site-ci-failure.log failed first in root
format:check: the consulted Vesper theme contains comments but used .json.
Renamed it to .jsonc and updated vesper-hero.md; kept the comments/source.
Applied the repository Biome formatter only to site/ and wisdom/landing-page/.
Root lint then exposed one error in site/scripts/build.ts: the escape helper
shadowed a global. Renamed it to escapeHtml, with identical escaping logic.
No runtime, installer, workflow, or gate changes.

Checks used /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun
(and that directory first in PATH for package scripts), without mise trust changes.
Root and site frozen installs passed; neither lockfile changed.
Root format:check passed (776 files); root lint passed (1100 files), with
907 advisory warnings and 1586 infos left untouched. No remaining error blockers.
Focused site/scripts/build.test.ts passed: 9 tests / 123294 assertions.
site/scripts/startup.test.ts initially lacked playwright-core in this fresh
worktree; after frozen site install it passed in Chromium: 1 test / 6 assertions,
including failed asset loading and no-JS fallback. This also built the static site.
git diff --check passed. No expensive runtime build or full CLI test run;
no publishing, deployment, or merge.

Values unchanged: existing scope, single-source and focused real-path proof
principles cover this maintenance fix. Use JSONC extensions for commented sources,
not weakened repository checks.
