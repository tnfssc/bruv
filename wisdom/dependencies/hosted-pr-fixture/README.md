# TEST ONLY: hosted Dependabot PR fixture

This is an isolated test repository template, not the die product. Its deliberately
old exact resolve.exports@2.0.2 pin exercises a real registry upgrade to 2.0.3.
Never copy its manifest or lockfile over the product's. No production dependency
is downgraded. Passing fixture CI proves hosted PR creation and CI delivery, not
product compatibility or a product merge-ready update.

Copy this directory (including .github, excluding node_modules) into a NEW empty
persistent directory and publish it as a separate private repository. Run the
commands in the parent session only, after coordinating the GitHub write:

~~~bash
SOURCE=/home/tnfssc/.die/worktrees/die-a86675007a5e-task_10879f72/wisdom/dependencies/hosted-pr-fixture
FIXTURE="$HOME/.die/worktrees/die-dependency-pr-fixture-20260930"
REPO="tnfssc/die-dependency-pr-fixture-20260930"
test ! -e "$FIXTURE" || exit 1
mkdir -p "$FIXTURE"
(cd "$SOURCE" && tar --exclude=node_modules -cf - .) | (cd "$FIXTURE" && tar -xf -)
cd "$FIXTURE"
git init -b develop
git add .
git commit -m "test: seed isolated hosted dependency PR fixture"
gh repo create "$REPO" --private --source . --remote origin --push
gh repo view "$REPO" --json url,defaultBranchRef
gh run list --repo "$REPO" --limit 10
gh pr list --repo "$REPO" --base develop --json number,url,title,author,headRefName
~~~

The config push should start Dependabot just as it did in the product repository.
If it does not, use Insights → Dependency graph → Dependabot → Check for updates.
Do not invent a REST endpoint; the previously tried updates/jobs endpoint is 404.
Native Dependabot creates the PR, so its pull_request event starts CI without a
PAT. A custom workflow creating PRs using GITHUB_TOKEN would suppress ordinary
PR-triggered CI; do not replace this flow with that and claim equivalent proof.

Review the actual hosted result, replacing N with its PR number:

~~~bash
gh pr view N --repo "$REPO" --json url,title,body,author,baseRefName,headRefOid,mergeable,mergeStateStatus,files,statusCheckRollup
gh pr diff N --repo "$REPO"
gh pr checks N --repo "$REPO" --watch
gh run list --repo "$REPO" --event pull_request --limit 10
~~~

Acceptance: author dependabot[bot], base develop, title explicitly test(deps),
body has a reviewable real version update, exactly package.json and bun.lock
changed, both pins advance 2.0.2 → 2.0.3, no unrelated lock churn, and passing
Fixture CI attached to that exact PR head. Record the Dependabot run, PR, and CI
URLs. If any step fails, preserve its logs and report the blocker. Do not merge
or delete the fixture automatically. The product still needs its first real
eligible update PR reviewed against its own full Linux/macOS CI.
