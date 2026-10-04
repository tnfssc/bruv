# Official nightly revalidation — 2026-10-04

**Unchanged official 2644 passes the bounded gates that 2623 blocked.** Do not treat the historical 2623 queue diagnosis as proof that a local T3 patch is currently required.

[Exact reproducible proof](proof/official-2644/README.md) pins source, release checksums, executable, SDK, real b1649b54 compiled connector and normal worker. Initial and last zero-model command idle gates pass; actual local worker same-root continuation (reply **and idle**) passes; human permissions/saved-question used-once continuation and native app-owned worker completion/cancellation pass. No T3 source/executable edits, instrumented acceptance binary, install/global changes, paid inference, real credentials or devices.

Effect 4.0.0-rc.115 and its existing patch are unchanged; Claude Agent SDK remains 0.3.276. The shipped waiter still lacks the recheck demonstrated in task561a43a1. These official passes establish an observed release workaround, **not** a general dependency race fix or causal attribution to upstream's "runs no longer get stuck" commit.

Harness-only UI contract changes: a Finished notification card now coexists with the live Completed subagent card; select them by status, not just title. App-owned children use titled completion cards and native Lineage/sidebar parent navigation. Actual local child tool results now render in this replay.

Separate gaps remain: cancelled approval cards persist after Stop (explicit native Decline needed); unsupported connector-version/update banners; Live/devices/paid providers/full tab disconnect not covered. This is not full product acceptance or a new architecture recommendation.

The later v0.16.3 hosted final-command failure is documented separately in [command idle convergence](hosted-command-idle-convergence.md), including unchanged historical failure evidence. It was a transient assertion-to-capture mismatch, not proof of a newly stuck Effect queue. The current composed release gate has six suites (including default-controls); the initial historical proof above has five.
