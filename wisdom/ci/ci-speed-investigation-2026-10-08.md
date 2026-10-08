# CI speed and stalled shutdown

PR45 base: 8d6f27efbf229f9a1a50246eaf4e01e763e9efed.
Owner: /home/tnfssc/.bruv/worktrees/ci-speed-owner-20261008,
branch bruv/ci-speed-owner-20261008. No merge or release permission.

## What we measured

Successful runs 37773223537 and 37801969829 took about 5.5 minutes.
The shared Linux gate took 169–194 seconds. Root tests took 136–155
seconds. Native fixtures added about 70 seconds before the shared gate.
Install and build were subsecond. Do not optimize those first.

Run 37821497256 reached root tests at 18:06:51 UTC. It reported eight
five-second subprocess-fixture timeouts, then went silent at 18:09:14.
It was cancelled at 18:35:20, near the job limit. Logs do not identify
who cancelled it. All 352 files and 3102 outcomes were printed, but no
root summary or final smoke ran. Printed outcomes are not completed CI.

The cause remains unknown. Focused tests passed. An injected blocked
child timed out and Bun exited in 5.037 seconds without hanging.
Nested child budgets exceed some enclosing test budgets, but that alone
did not reproduce the stall. Do not call a retry or longer timeout a fix.
One debug rerun of the unchanged Linux job was accepted on October 8.
The PR watch owns its result; do not retry repeatedly to get green.

## Bound the wasted wait

The shared Linux workflow step gets six minutes, about twice its measured
healthy duration. Keep the job's 30-minute budget so a step failure has
room to upload logs. Keep each test deadline and every check unchanged.
Incomplete checks must still fail CI policy. This bounds failure time;
it neither fixes the unknown shutdown bug nor speeds up a healthy run.

Focused contract: 1 pass, 5 assertions. Evidence:
/home/tnfssc/.bruv/agent/watchers/ci-gate-bound-WQs21s.
Actual hosted timeout delivery and artifact upload are not locally proved.

## Shorten the normal path

Task task_41f94e33 produced 4bd93e2f: one parallel required native Linux
lane. It preserves the native steps and separates their package install.
Expected saving is 70–120 seconds minus overhead, not measured success.
Keep root parallelism at three until the stall is understood. Parent
must review the integrated result and measure overlap, full outcomes,
wall time and runner seconds on hosted CI. Publish as a focused follow-up
PR; it may stack on PR45. Do not silently change release gates.

## Evidence and continuation

Full cancelled log:
/home/tnfssc/.bruv/agent/watchers/pr45-ci-37821497256-linux.log.
Read-only timing audit, stall trace and focused-probe reports are retained
at /home/tnfssc/.bruv/agent/watchers/ci-speed-audits-BuoKVD. They name the exact scripts and probe artifacts.
All four workers' actual session model records show GPT Sol.

Source worker trees are under /home/tnfssc/.bruv/worktrees/:
- t3-1dc1185b-5442693331ce-task_5263d1ac: timing audit.
- t3-1dc1185b-5442693331ce-task_72737d27: stall trace.
- t3-1dc1185b-5442693331ce-task_56cf062d: bounded probes; no repair.
- t3-1dc1185b-5442693331ce-task_41f94e33: native-lane implementation.

Do not run CI shell cleanup traps locally, use real HOME/config/SDK,
access live provider/device/SSH credentials, or do user-data recovery.
Inspect effects first. Use retained owned environments and exact owned
process deadlines. Existing values cover measured proof, safe ownership
and cutting wait without cutting checks; no new value is needed.

## Integrated local checks

Integrated native lane as 397019fe after the deadline commit 98e6b0e4.
The moved gate conflicted; kept one ordinary Linux gate with its six-minute
deadline and log upload. Native checks remain only in their sibling lane.
Moved the worker report into wisdom/ci/ci-native-lane-result.md.

Focused integrated contracts: 62 pass, 55 filtered, 367 assertions. They
cover native failure/cancel/skip rejection, docs/full plans, preserved
native steps and the failure bound. Formatting passed. Evidence:
/home/tnfssc/.bruv/agent/watchers/ci-speed-integrated-42epcc.
No full local gate or native hardware/workflow script was executed.
Independent code review and hosted timing are still pending.
