# Actual native app-worker integration evidence

**Overall full app-worker acceptance is not passing.** These are actual unchanged-T3 browser/compiled-runtime runs, not the synthetic native fixture or unit-test UI proof.

* Base source: 156e2450; official T3 revision fed41fa88bb27cb4325cb208d571393850bc63c2 / v0.0.46-nightly.20261003.2623. Unchanged binary hash is recorded in each result.json.
* observed-slice is resumed attempt17. Browser reached real supplied capabilities/delegate_task, real running native children, completed child thread/model/high reasoning UI, automatic root result/status ACK, second child and real cancellation. Native SQLite shows app_owned, completed+acknowledged and interrupted+disposed, exact normal selection and real lineage. Its original result.json remains passed:false: the then-checker incorrectly expected cancellation delivery to be acknowledged rather than disposed. audit.json is an audit of recorded evidence, **not** a replacement pass stamp.
* The old attempt17 fixture text APP_CANCEL_CONFIRMED_REAL was premature: its immediate task_status still said running. Actual final native storage proves subsequent interrupted/disposed. The reusable current model now re-reads real status until interrupted before emitting that text. Do not treat the old marker as terminal proof.
* early-unsettled is attempt18. Child genuinely completed, but T3 kept the root Working and never requested the automatic task_status/ACK continuation, despite a root connector success result. No fake wake was inserted.
* waiting-blocked is attempt19. The corrected driver holds the child until T3 renders Waiting on subagent; this root instead stayed Working. It failed honestly. current-harness-blocked is attempt21: it did reach late completion, real automatic ACK and the completed native child UI, but after returning to the parent T3 still showed it active; no rendered Submit message button became available for the next child. This also fails honestly. Parent/runtime owner must resolve this active-query/native-result settlement gap before calling the full integration accepted; whether the defect is connector event sequencing or upstream interpretation is not established here.

The native scope digests in wire-projection.ndjson are hashes, not credentials. Raw wire, bearer tokens, SDK configuration, database files and private runtime were not exported. Distinct root/normal native credentials, child role=normal/depth=1, actual high Responses reasoning requests, real native and local delegation denials, parent-task scope denial, and empty root/child Bruv job registries are independently recorded. No duplicate connector task_started/task_notification frames exist for these app-owned tasks. Actual model endpoint late cancelled reply is not a child completion; native terminal storage/protocol is authoritative.

## Reproduce

Use supported Bun1.4.2 and your built actual connector+normal pair. No real credentials or paid providers are needed. Keep TMPDIR shallow on a filesystem with space: shared /tmp filled during one run; deep worktree scratch paths exceed Chromium Unix-socket limits. Example (change paths/port/output):

```sh
mkdir -p /home/tnfssc/.cache/ba
TMPDIR=/home/tnfssc/.cache/ba \
BRUV_CONNECTOR_EXECUTABLE="$PWD/dist/bruv-claude-compat" \
BRUV_RUNTIME_BINARY="$PWD/dist/bruv" \
ACCEPT_APP_DELEGATION=1 FIXTURE_PORT=18941 \
PROOF_OUTPUT="$PWD/.cache/native-app-worker-new" \
node scripts/claude-native-acceptance/run.mjs
```

The runner pins connector bytes, uses a disposable HOME/agentDir/CLI profile source, starts separate loopback root/normal provider fixtures, passes an explicit environment allowlist, and removes private state. Enter activates the rendered child-to-parent header button because the honest version-warning overlay blocks pointer clicks. No force-click, synthetic native packet, T3 patch, global install, release or packaging change.

## Separate code checks

Bun1.4.2: 134 pass / 6 optional SDK-history skips / 0 fail across all Claude-compat source, task/Live/composition/MCP and actual paired-binary suites (722 assertions). The first run's3 failures were ambient untrusted mise startup text contaminating real shell output; rerun with MISE_IGNORED_CONFIG_PATHS="$PWD/mise.toml" passed. TypeScript --noEmit passed. Local-model tests cover supported summary API/high effort and true terminal cancellation polling separately; they are not browser proof.

Final local-model checks:3 dedicated tests plus7 existing default model tests pass. These do not establish native root settlement. Source typecheck passes.

Final broad check repeated later:133 pass/6 skips/1 failure in unchanged task-binding test "actual SDK execute bridge binds two shells and a real Pi worker without label inference": expected final worker answer but terminal summary was only agent_start/turn_start stdout. Earlier identical broad run passed134; cause not established here and task-binding implementation was not changed. This is an observed regression-check limitation, not a claimed all-green final run.

A focused follow-up passed the previously failing worker-summary test, but a different existing shell lifecycle test exceeded its5-second test budget (13.2s); no cause established and no binder change made. Owned model checks remained10 pass.

Final independently scoped checks (Bun1.4.2, actual compiled connector+normal pair; test budget20s):18 pass/0 fail/110 assertions for app-worker policy, MCP and compiled suites. Local model checks10 pass. Typecheck passed. Full native UI acceptance remains failed as documented.
