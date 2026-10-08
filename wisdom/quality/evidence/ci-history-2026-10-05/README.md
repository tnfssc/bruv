# CI history capture — 2026-10-05

Read-only audit of tnfssc/bruv Actions: **587 retained runs**, captured
2026-10-05T18:19:55Z. The endpoint total matched the unique run count;
concurrent new runs could shift pagination. [capture.json](capture.json) keeps
that provenance. [CI/release audit](../../ci-release-failure-audit-2026-10-05.md)
and [log research](../../ci-history-log-research-2026-10-05.md) keep the conclusions,
counting units, run examples, confidence and follow-up limits.

The six completed inventories/classifications are retired, not test baselines.
Recover exact IDs, SHA/attempts and snippets from Git at
**df6a5a3759b0b7a26cd75a5e70645a7ebcf012fa**, this directory.
[Retirement decisions](../../completed-run-retirement.md).
Raw local API metadata/logs were ignored and were not deleted by this cleanup.
GitHub may eventually expire logs; Git retains the tracked classification.

## Capture again

Run from the repository root with an authenticated read-only gh CLI. All eight
scripts now read/write **artifacts/ci-history/**, not this wisdom directory.
Use a clean output directory for a new snapshot: collectors skip existing jobs.
Do not merge old and new captures or expect the historical reports to update.
No workflow dispatch, rerun, cancellation or credentials are captured.

~~~sh
scripts=wisdom/quality/evidence/ci-history-2026-10-05
python3 "$scripts/collect.py"
python3 "$scripts/collect-logs.py"
python3 "$scripts/collect-release-jobs.py"
python3 "$scripts/collect-ci-success-jobs.py"
python3 "$scripts/summarize.py"
python3 "$scripts/test-signatures.py"
python3 "$scripts/extract-owned-failure-contexts.py" > artifacts/ci-history/owned-contexts.json
python3 "$scripts/release-extract.py"
~~~

These are mechanical extraction tools, not fresh root-cause classifications.
collect.py pages using the first endpoint total; verify completeness and split
date ranges for history above GitHub's search cap. Retry timed-out reads before
calling a capture complete. Successful retries remove old log-download errors.
Do not treat a network error as a test failure, green docs/selected CI as a full
Linux lane, or develop release dry runs as shipped release failures.
