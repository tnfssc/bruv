# Task-projection resource workload

## When this helps

Use `scripts/resource-harness/workload.ts` to investigate the thread 03c9ab30
failure pattern: a native journal dominated by repeated
`bruv-native-task-projection` snapshots, >100k history entries, and OOM on resume.
Reported incident figures (11.9 GB journal, resume killed around 13.6 GiB RSS) are
motivation, **not reproduced measurements** from this small test.

Read [disk-backed history](../history/disk-backed-history.md) before interpreting
RSS: bounded old-message caching is not bounded total app memory. In particular,
`SessionManager.getBranch()` returns materialized entries, and task binding restores
its cursor map by walking that branch. The workload must use that production path,
not an alternate bounded scanner which would mask the problem under investigation.

## Work done / evidence

The child owns real persistent Pi journals and uses real native task binding and
native child-history writes. Only job events are synthetic. It appends new child
messages before each observed update and flushes binding batches so each event
produces its real checkpoint. Resume runs in a separate process against originals.
The protocol remains the requested stdout JSONL samples plus completion; detailed
semantics and limits are in [the workload README](../../scripts/resource-harness/workload.README.md).

Small integration tests inspect the real JSONL ledger. With two tasks, four rounds,
and three child entries per round, current binding writes ten checkpoints containing
70 total child-ID references; each child's latest cursor has 13 IDs. Resume appends
two checkpoints at revision 6, without duplicating derived child rows. Tests verify
root bytes are preserved as an exact prefix and child/native originals have unchanged
SHA-256 hashes. A zero-child-entry workload separately checks event/checkpoint counts
and batched metrics. Inputs/reuse/mismatched resume counts are bounded and reject
without overwriting originals. Tests run fresh child processes with 10-second limits.

The amplification count is deterministic; RSS/time are secondary and machine-dependent.
Do not use a passing small test as proof this survives incident scale. No production
fix is made here. Large workloads still need supervisor-enforced RSS/wall/disk budgets.

## Checks

- `bun test tests/resource-harness-workload.test.ts tests/claude-compat-task-binding.test.ts`: 4 pass, 0 fail (719 assertions, including isolated connector tests).
- `bunx tsc --noEmit`: passes.
- `bunx biome check scripts/resource-harness/workload.ts tests/resource-harness-workload.test.ts`: passes.
- Manual two-process write/resume with two tasks, three rounds and two entries per round: succeeds.

## Limits / next step

This is not full AgentSession/model resume, OS worker spawning, transport rendering,
or provider inference. Replayed fake running jobs exercise persisted cursor restore;
they are not evidence that tasks resurrect after native restart. Root journal metrics
exclude original children and derived native sidechains (kept on disk for inspection).
Supervisor, CLI, aggregate reports and resource-budget policy belong to the parent task.

Values remain unchanged: this applies existing values 2 (say what proof shows),
9 (know what a change means), and 10 (leave work others can pick up), not a new general principle.
