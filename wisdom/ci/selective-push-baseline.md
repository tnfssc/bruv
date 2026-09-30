# Cumulative selective push baseline

Develop push planning in CI and Release uses the same helper,
`scripts/find-ci-baseline.ts`, and the last successful trusted CI push run at
an ancestor of the exact checked-out tested HEAD. It never uses event.before.
A failed or cancelled source push followed by a docs-only push must compare back
to the earlier successful run, retaining the unchecked source in the diff.
Successful selective runs can advance the baseline because each compares back
to a successful baseline itself. Current-head runs are excluded, including
concurrent CI success seen by Release: they are not a prior comparison baseline.

Trust requires the exact repository and head repository, resolved CI workflow
ID and path, push event, develop branch, completed status and success conclusion.
SHAs must be full lowercase hex commit IDs available locally, strict ancestors
of the expected checked-out HEAD. Foreign workflows/repos, divergent history,
invalid objects, missing history and API errors never authorize narrow checks.
No baseline is represented by empty stdout and the existing selector plans full;
there is deliberately no fallback to the push payload before SHA.

Lookup uses two API requests: CI workflow identity and one page of up to 100
successful push runs. The total network/git budget is 15 seconds; individual git
calls cap at one second. Normal ancestry checks are local and cheap. There is no
pagination, retry loop, dependency install, or artifact lookup. A successful run
outside the page costs full validation rather than an unbounded lookup. This is
modest planning overhead, not a hosted sub-minute latency claim: runner startup
and dependency/setup time still require measurements. Only the CI feedback and
Release develop-plan jobs gain actions:read (other existing release reuse reads
are unchanged); tokens stay in env and never appear in logs.

PR merge-parent validation, nightly/manual full CI, stable release gates and
branch protection are unchanged. No push, dispatch or release is required to
validate this code. Helper regressions use real temporary git histories and mock
API responses, including failed/cancelled source then docs, trusted successes,
foreign/nonancestor runs and unknown/API failure. Workflow regressions verify the
shared helper and unchanged PR semantics.
