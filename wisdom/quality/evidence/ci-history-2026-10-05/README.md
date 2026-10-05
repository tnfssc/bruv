# CI history evidence — 2026-10-05

Read-only capture of tnfssc/bruv Actions. Main report: [CI/release audit](../../ci-release-failure-audit-2026-10-05.md).

## Kept evidence

- capture.json: capture time, endpoint total, coverage caveat.
- run-inventory.json: all 587 run IDs, latest outcomes, dates, SHA, trigger and URL.
- summary.json: workflow/event totals, recovered reruns, failed jobs/steps. CI policy is downstream, not an extra root cause.
- failed-job-inventory.json: failed job IDs and failed steps, including earlier attempts and failed stages inside cancelled runs. Not the same counting unit as 133 failed latest runs.
- test-signatures.json: exact failed test names, deduplicated within each run. A repeated name is not automatically one repeated cause.
- owned-log-classification.json: CI/Daily/old Live Lab log classification, snippets and confidence. Release is separate.
- ci-lane-coverage.json: green CI runs without a successful full Linux lane.

Raw runs.json, jobs/<runid>.json and gzip logs/<jobid>.log.gz stay here locally but are ignored. GitHub may eventually expire logs. No tokens or credential files were copied. Job logs are not added to git.

## Capture again

Use an authenticated gh CLI with read access. These scripts only read GitHub API data; they do not dispatch, rerun or cancel workflows. Use a new dated folder/copy if retaining this snapshot matters. A fresh capture changes the raw run set; stored numbers in the report will not update themselves.

1. python3 collect.py — page all repository runs, then jobs for failed-like outcomes.
2. python3 collect-logs.py — earlier failed attempts of recovered runs, then all non-policy failed job logs already in jobs/. Uses gh api --allow-escape-sequences to keep terminal log bytes. Successful retries remove old download-error files.
3. python3 collect-release-jobs.py and python3 collect-ci-success-jobs.py — release/cancellation and successful CI lane metadata. Scripts skip existing job files. Retry a timed-out read before considering capture complete; do not treat network failure as test failure.
4. python3 summarize.py and python3 test-signatures.py — mechanical counts, not root-cause judgments.
5. python3 release-extract.py — quick release log error lines. These include expected/benign error text too. Read context before judging cause.

The capture had 587 runs, below GitHub's search cap. collect.py uses the first total to choose pages; concurrent new runs can shift pages. For a future much larger history, verify API completeness and split date ranges if needed. Do not call a sample the whole history.

Some successful runs are docs/selected feedback; a green workflow is not always full executable validation. Release historically also includes develop dry runs. Keep those scopes distinct.
