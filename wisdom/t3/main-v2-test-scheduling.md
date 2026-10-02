# Main v2: the two observed root-test scheduling failures

## Scope and provenance

- Base: 3116877d57c06177881333c0abe0062bbe545175 (integrated locally, not pushed).
- Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_9aa40600.
- Branch: bruv/fix-observed-native-replay-and-tui-sched-9aa40600.
- Input evidence: parent /home/tnfssc/Code/bruv/artifacts/code-reduction-implementation/main-integrated-root-corrected.log: **1718 pass / 20 skip / 2 fail**. Only the native concurrent-replay test and real TUI /ps test were changed. No production change was warranted.

## Native replay: arrival order is not durable call identity

The line-459 failure compared arrays filled by adapter.launch arrival. The original order was:

1. bruv-v1:hPLjrloCja5jQtjVJnwfmK6leB45MD4vDyQfnciQprI
2. bruv-v1:F7aCrOIOqbynOyHa9lJjxyLDhM-8F5JNc8IQy6WgTHg

Replay contained those same IDs in reverse order. These are exactly the derived IDs for bridge calls 1 and 2 of durable-execute-tool-call, respectively.

Relevant production behavior:

- serveJobBridge in src/typescript/job-bridge.ts attaches the execute invocation and the actual wire request ID as callIndex **before** dispatching concurrent handlers.
- JobService fingerprints ["execute-call-v1", executeInvocationId, String(callIndex), String(promptIndex)].
- T3LaunchIdentityLedger.reserve reads the legacy ledger asynchronously (including the missing-file case). Independent filesystem completions can reach the adapter in either order. New IDs derive from the fingerprint, not arrival; legacy pending IDs remain readable.

The old test also assigned task IDs using the index in the first arrival array and sorted recovered result IDs. That proved set membership, not the per-call replay contract.

The repaired test uses actual signal request identities, records IDs by ordinal, and uses a promise gate to force original adapter arrival **[2, 1]** and replay arrival **[1, 2]**. For each wire response ID it asserts the exact derived request identity, unchanged replay identity, and the corresponding task and child-thread IDs. It still requires distinct intents, both ambiguous-launch errors, two unique responses, and no sidecar. No sorting substitutes for correlation.

## Real TUI: listing a spawned process does not prove output readiness

The line-159 failure frame already showed Inspect task_84801eac with a PID, but **No output available yet.** Both jobs had been listed. The test assumed that a fixed 200 ms after Enter guaranteed ALPHA stdout.

Relevant production behavior:

- TaskManager publishes a spawned running task with outputEnd: 0; stdout capture updates it asynchronously.
- TaskMonitorPanel subscribes to updates, schedules renders, and has a one-second refresh clock. Its inspect view explicitly renders the empty-output message when outputEnd === 0.

The test now waits for Inspect task_ **and ALPHA-live output in that view**, and for BETA-live in the **selected live preview**, not merely in the listed command. Subsequent view transitions and cancellation also use existing bounded frame polling instead of fixed delays. Navigation remains **/ps → Enter → i → Down → x → y → Escape**, through the normal CLI/TUI.

All old TUI assertions remain. Additional assertions correlate ALPHA's inspect ID with the survivor, require a distinct BETA confirmation target, keep both jobs present before confirmation, and require only the confirmed ID to disappear from running jobs. ALPHA must not receive a cancelled notification. The original 20-second test timeout remains. Existing helpers poll at most 100 times with 50 ms intervals; missing readiness throws or fails the retained final-frame assertions. There are no longer arbitrary sleeps or new polling framework.

## Checks and runtime

- Installed tools on PATH: Bun **1.4.2**, Node **24.21.0**, pnpm **11.27.1**.
- Root dependencies installed with bun install --frozen-lockfile.
- TMPDIR=/home/tnfssc/.cache/v2t: short, disk-backed btrfs path. /tmp here is tmpfs and was not used for test homes.
- Explicit SHELL=/bin/bash avoids fish startup's untrusted-worktree mise diagnostic contaminating unrelated shell-output assertions. The first focused run passed both repaired tests but failed two other native-routing shell assertions solely because that diagnostic was prepended. No assertion or trust setting was changed to hide it.
- pnpm 11 initially tried to auto-install before exec, generating untracked pnpm files and rejecting unapproved dependency build scripts. Those generated files were removed; scoped formatting uses pnpm --config.verify-deps-before-run=false exec biome format against installed tools, without approving dependency scripts.
- This worktree had no dist/bruv. Copied the parent's genuine compiled /home/tnfssc/Code/bruv/dist/bruv, rather than rebuilding. Copy and parent SHA-256: c0270823abd54087e9ad80de8b61671e2832f3eee4c5bbad85d695267f14163a. Parent reports production CLI unchanged by repin except embedded web; these tests exercise CLI job/TUI behavior, not that web payload.

Final checks:

- bun test tests/t3/native-routing.test.ts --test-name-pattern "identical concurrent" --rerun-each=25: **25 pass, 0 fail**, 500 assertions (392 ms). Every run forces opposite adapter arrival orders.
- bun test tests/t3/native-routing.test.ts tests/task-monitor-tui.test.ts, **five final sequential runs**: **17 pass, 0 fail per run**, 115 assertions; durations 8.11 / 8.27 / 7.93 / 7.93 / 8.02 s. Includes the genuine compiled CLI /ps and /resume TUI tests. An earlier five-run batch also passed before tightening the selected BETA preview and exact survivor assertions.
- Root bun run check: **pass** (prepare-assets plus tsc --noEmit; no CLI/web build).
- Scoped pnpm --config.verify-deps-before-run=false exec biome format tests/t3/native-routing.test.ts tests/task-monitor-tui.test.ts: **pass**. git diff --check: **pass**.
- Negative replay experiment: a disposable copy of the test adapter swapped task and thread IDs while leaving request identities intact. The per-wire-response assertion failed for response 1 (expected native-task-1 / child-thread-1; received native-task-2 / child-thread-2). This is the mismatch that a sorted result set would miss.
- Negative TUI experiment: a disposable test copy emitted ALPHA-held instead of ALPHA-live. It failed with **Missing Inspect task_, ALPHA-live in frame** after **11.65 s**, including bounded startup and readiness polling, before the unchanged 20-second timeout. The last frame contained ALPHA-held output, so readiness did not silently pass. Disposable test copies were removed; production and committed fixtures were untouched.

Local logs/scripts: artifacts/code-reduction-implementation/v2-test-scheduling-* in this worktree (ignored artifacts, not part of the commit). Parent root evidence remains at its original path.

## Limits

No full-suite run, duplicate CLI/web build, live backend test, push, or release. These checks isolate the two observed failures; they do not restate the other already-green gates as newly verified. The root log alone lacked per-request replay correlation; the production identity derivation plus forced opposite-order checks supply that missing evidence. The compiled CLI copy's embedded web provenance does not verify web behavior.
