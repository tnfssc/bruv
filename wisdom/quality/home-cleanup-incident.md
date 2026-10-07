# HOME cleanup incident — task paused

The whole-repo readability task is incomplete. Do not restart agents or integrate more source until the user gives direction.

## What we saw

- Judge task_817e6a43 launched shell task_410f17fe at 2026-10-07T15:06:31Z while checking tests/cooperative-handoff.test.ts at 8510667a3684cedaa0f8d99fdfba467a4b614587.
- Its setup mixed nested shell quoting, temporary HOME/SDK exports, and EXIT cleanup using HOME as its removal target. The judge reported misparsing and removal against real HOME. Cleanup named HOME itself, so possible loss is not limited to .config.
- The command record says killed at 15:07:26Z. The judge reported a removal error naming /home/tnfssc/.config.
- Parent checked metadata read-only: /home/tnfssc/.config is a real directory containing only fish; mtime 15:07:05Z. No before-list or verified full loss list. No harmless-execution or restoration claim.
- Execution area stopped six remaining children and recorded the incident at f6382b57. Parent stopped the five other active area agents; all reported killed, exit143. Parent job list showed no running jobs. A /proc cwd scan found no processes in the six stopped area worktree trees; this does not prove every possible orphan elsewhere is gone.

## Evidence and pickup

Judge log: /home/tnfssc/.bruv/agent/native-sessions/2026-10-07T15-02-24-475Z_01a116e3-19db-7702-a31a-38766afbebeb.jsonl. Its adjacent .jobs.jsonl records the command stop. Do not replay the cleanup command.

Execution ledger: wisdom/quality/structural-readability-areas/execution-tasks-questions.json at f6382b57 on bruv/whole-repo-structural-readability-execut-69c1198d. Unjudged/cooperative-handoff candidates were withheld. Keep worktrees and logs; do not run cleanup.

Integration: /home/tnfssc/.bruv/worktrees/t3-6b8c09c6-5442693331ce-task_e5546eb4, branch bruv/structural-readability-repo-wide. Source checkpoint 96ee39cf was clean and local, not pushed. Only site and tooling have final area coverage. Partial batches and the accepted native regression wrapper are joined. No final whole-tree gate or quality acceptance. PR45 still holds the earlier owner pilot, not this full run. No further source merge, recovery, or PR update attempted.

Human question q_2cfc9b5e-cb8b-4f46-a342-6433beb1ba47 asks whether to inspect existing backup/snapshot sources read-only or leave recovery to the user. Neither answer permits code work to restart by itself.

## Lesson

A test HOME is not a cleanup boundary. Remove exact paths created for the probe, not HOME or inherited SDK/config directories. Nested quoting can move work outside the intended environment. Stop on setup errors; never compensate with broader removal. This matters for probes and fixtures, not as a reason to add lifecycle frameworks to ordinary product code.
