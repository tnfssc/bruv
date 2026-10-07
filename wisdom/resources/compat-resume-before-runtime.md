# Connector storage must install disk history first

## Released failure

PR48 merged as 6a14a8d9. The user installed Bruv 0.16.16 and retried thread
03c9ab30-fdd6-4c41-ad2c-fc294a093466. At 2026-10-07T22:34:45Z the kernel killed
Bruv PID 3570145 in t3code.service. Anonymous RSS was 13,849,728 kB, about
13.2 GiB. This was another OOM, not a provider rejection.

The provider requested resume 25b99c09-fb9c-49da-86fb-0c22a6fc0827 through the
installed bruv-claude-compat launcher. Its binding names the same 11,884,666,735-byte
Pi journal diagnosed in [the first failure](readability-thread-oom-2026-10-07.md).
The SDK-facing derived transcript is only 2,355,920 bytes.

## Missed path

productionRuntime calls nativeStorage before createClaudeCompatRuntime.
nativeStorage opened the Pi journal with the unpatched SDK SessionManager.open.
Only createClaudeCompatRuntime installed the disk reader, after that eager read.
The captured replay installed it itself before opening the snapshot. Runtime
composition tests also reuse process-global SDK state. Both masked the order bug.

Install the disk reader in nativeStorage before any SessionManager open/create.
Keep runtime installation for direct runtime callers; it is idempotent. The fresh
process regression forbids the eager opener and old checkpoint-body reads. It
checks usable model context and exact original bytes. The capture now builds a
private connector binding and calls nativeStorage before runtime composition.
No model/provider request is allowed. No live jobs or credentials are copied.

## Work checkpoint

Parent is doing this work, without agents, in
/home/tnfssc/.bruv/worktrees/bruv-compat-resume-resource-fix, branch
fix/compat-resume-resource-growth. Started from develop 5e9b0593 after release.
The brief agent investigation was cancelled at the user's request before results.
No old delivered worktree is being changed. Original journals are untouched.

The new fresh-process test passes with the early installation and fails at the
eager opener when those lines are removed. The negative control never touches
the real journal. The small captured replay also passes through connector storage,
startup and model context. Logs: /tmp/bruv-compat-resume-negative.log and
/tmp/bruv-compat-resume-first-tests.log.

Guarded replay through storage/startup/context passed at 503.0 MiB in 35.6 s,
with the same 512 MiB cap. Private report: artifacts/resource-harness/captured-IOkY10.
An initial gate caught a wrong replay option name; it now uses history and
historyParentUuid exactly like productionRuntime. The corrected full gate runs
as task_fe7ca831. Logs: /tmp/bruv-compat-resume-final-captured.log and
/tmp/bruv-compat-resume-final-ci.log.

A separate public-protocol check uses artifacts/public-connector-resume.ts,
a private home, a CoW copy of both journals, the real paired connector, and only
a control initialize request. It samples the binary's /proc RSS every 100 ms,
kills above 512 MiB or 90 s, and rejects any provider request. The released
connector fails before initialization at 526.5 MiB in 0.735 s, safely killed by
the probe. Report: artifacts/public-resume-saQyew/report.json. The newly built
pair is being checked as task_741fd6d1. The artifact script has incident-specific
paths/IDs and is not a portable CI test or user data to upload.

Next inspect files, commit and open a new PR. This is an in-progress fix, not
a release or live provider continuation. Existing bounded-resource guidance was
strengthened: replay must start at the actual entry point in a fresh process.


## Native human controls and billing

The first early-install-only public probe still failed the memory budget. Its
startup called getEntries from an extension hook after the bounded open. Billing
totals discovered the metadata index but still loaded every original. They now
select only assistant/tool usage, summaries, fast markers and voice costs across
all branches before reading bodies. Question lists, ownership and continuation
checks also use metadata/branch IDs; an empty ledger does not need a branch scan.
The first-child and diagnostic-only ownership rules are unchanged.

The replay now includes the native human-control request callback. A fresh cold
probe forbids both getEntries and getBranch, then checks footer rendering, an
empty question ledger, and saved ask/get/answer ownership. The old source replay
without native human controls did not cover that path. Root derived transcript
indexing also streams identity/hash records; explicit imported-fork validation
keeps its complete validation view. This alone did not fix the startup failure.

Earlier full gate: 2,290 pass, 23 paid/device tests skipped. Joined billing and
question tests are running, as is the public paired initialization and full
test/resource suite. No temporary debug logging or no-minify build change is
left in source. Private debug binaries and reports stay under artifacts.

Known scope: the public probe makes a native control initialize request, not a
real provider continuation. It copies the two incident journals but no real
credentials, live job store or question ledger. Original histories are unchanged.

## User requested direct thread rescue

Pause the broader fix chase. The public cold resume still exceeds 512 MiB; it
is not accepted or released. The all-tests concurrent invocation was a mistake
(shared-state tests timed out) and was stopped. Earlier ordinary full CI passed,
but that was before the billing/question additions. No follow-up code is committed
or pushed yet.

At the user's explicit rescue request, build a separate active-branch recovery
journal under ~/.bruv/agent/recovered-sessions/25b99c09-20261007. Preserve every
active non-task row, newest checkpoint per task owner/job, and question anchors.
Rewrite only parent links in the new copy to bridge superseded checkpoints.
Keep original branch history and original bytes in their original file. Copy
the question ledger unchanged. Source size/mtime must remain unchanged. Then
verify installed connector initialization against an isolated recovery copy
before atomically changing the native resume binding. No provider prompt or
live task launch. Rescue script: artifacts/rescue-thread.ts; build task_00f6e089.

Rescue completed: 634,201 active entries became 1,046 retained entries, 179 task
keys. Removed 633,155 superseded task snapshots only from the recovery branch.
Original size remains 11,884,666,735 bytes; recovery is 4,399,130 bytes. Installed
0.16.16 public connector initializes the isolated recovery copy in 0.619 s at
126.0 MiB RSS with zero provider calls. Native binding atomically switched to
the recovery copy; exact old binding, new binding, acceptance and README are in
the recovery directory. No actual prompt sent. User can continue the same T3
thread. Do not switch back to the giant source during normal use.

Production follow-up remains uncommitted in this new worktree. No fix PR/push.
Cold public startup on the giant journal is still red; do not claim it fixed.
Latest failed probe /tmp/bruv-compat-resume-joined-public.log. Regression/typecheck
pass; full ordinary CI needs rerun after the newest changes. All owned probe
jobs have finished; the mistaken concurrent suite was stopped.

## Publication scope

User authorized PR, merge and release after the thread rescue. Ship the verified
early disk installation and metadata-only billing/question readers as a patch,
not as proof that the giant original now resumes. Keep the recovery binding.
The unfinished 11.9 GB public cold-start budget failure is an explicit known
limitation in the PR and release notes. No model continuation is claimed.
The normal Linux CI gate (not --concurrent) is running as task_09b5c2b7.
After hosted checks pass on the exact PR SHA, merge and dispatch release.yml
on develop. Record publication/run facts outside this worktree after merge.
