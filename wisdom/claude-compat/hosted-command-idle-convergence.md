# Hosted v0.16.3 command idle convergence

Workflow **37198016485**, parent **f518e67a**, failed only the last native
command suite. Builds, unit/mac/updater lanes and the first five native suites
passed. This is a harness correction, not a product lifecycle or Effect fix.

## What the actual failure proves

[Original failed result](proof/official-2644/hosted-v0163-command-final/result.json)
is retained unchanged, separately from passing official proofs. The complete
hosted download, including private throwaway logs, remains at
/home/tnfssc/Code/bruv/artifacts/v0163-hosted-native-failure; the workflow log
is artifacts/v0163-release-failed.log. Committed files are only the original
selected wire/DB/UI projections, not private logs or a rewritten passing result.

- [Wire](proof/official-2644/hosted-v0163-command-final/wire-projection.ndjson):
  the first user frame hashes to **ebcc2e90765fee68**; assistant, successful
  human-origin result and subsequent command/session lifecycle frames correlate
  to that same input. There is no second command because the assertion aborted
  the exercise before submitting it.
- [Provider/DB projection](proof/official-2644/hosted-v0163-command-final/final-provider-evidence.json):
  one query, prompt **id-5**, result sequence 7 echoes **id-5**. Native run
  ordinal 1 and its root are **completed at 11:22:36.414Z**, provider turn
  completed at **11:22:36.375Z**. Persisted events 39–41 record completed
  turn-item/run/node updates. No subagent rows or task journal entries.
- The old line-24 immediate isVisible() saw Working after Stop hidden and
  Submit visible. The [subsequent text](proof/official-2644/hosted-v0163-command-final/failure.txt)
  has **no Working**, and the screenshot (historical capture)
  already shows **Done**, a submit control, and command output **running: false**.
  The single command output does not contain the text Working and there is no
  unrelated active thread in these captures.

Thus the recorded assertion-to-capture transition is transient. The artifact
cannot identify the exact matched DOM node or its disappearance latency; do not
claim it does. It does not show a persistently stuck queue, and a successful
result alone would not establish idle.

## Upstream states and bounded harness change

Pinned upstream source **737993303d36e10674c54b95e5bd3826682c99c7**:

- [Sidebar.logic.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/web/src/components/Sidebar.logic.ts#L977-L1000)
  derives Working from summary runtime preparing/queued/starting/running/waiting.
- [ComposerPrimaryActions.tsx](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/web/src/components/chat/ComposerPrimaryActions.tsx#L250-L263)
  selects Stop via canInterrupt and Submit via composer isRunning/content state;
  ChatComposer receives isRunning from the active thread's phase. These are not
  one atomic sidebar/composer observation.

The active release driver now uses Playwright's condition waits for **Stop
hidden + Submit visible + global exact Working hidden**, then rechecks all
three. Every wait draws from **one existing 30,000ms idle deadline**. No sleep,
new timeout budget, narrower Working selector, ignored stuck state, or product
change. Correlated wire-result checks and both same-query commands are unchanged.

The regression tests in tests/claude-native-command-idle.test.mjs demonstrate
the old immediate false failure, convergence, shared deadline exhaustion, and
rejection of persistent Working/Stop/Submit mismatches. A real Chromium fixture
also confirms the immediate assertion fails before a render removes Working,
while persistent Working times out with the unchanged 30s default; its
script/result are retained in artifacts/v0163-idle-convergence-browser-regression.

## Validation and scope

All native commands use bash, source-built original .mjs harnesses, unchanged
external official 2644 from .cache/v0160-clean-native-setup/env, SDK **0.3.276**,
and the held parent v0.16.3 compiled normal/connector pair. No rebuild for native
acceptance, patched upstream, global install, push or release.

- Unchanged old strict command proof passes locally in
  artifacts/v0163-hosted-idle-investigation-original (separate from hosted failure).
- Focused native fixture/release-composition suite: **48 passed**.
- Typecheck, repository format and lint passed (artifacts/v0163-idle-convergence-{check,format,lint}.log).
  Lint retains the repository's existing warnings; no lint errors.
- Composed native gate: **all six passed**, artifacts/v0163-idle-convergence-native/gate.json.
  Command and command-final each record one native query with two prompts and
  two correlated successful results on the same thread/provider session, plus
  both idle snapshots. No second-command rejection or hidden stuck state.
- Held parent connector SHA256: 2884f3d5084231dbde8672358e7f6237b901f5f60aaf3f7fc720597488ec8510;
  normal runtime SHA256: f1cddf31cc339f23c0f2796ddaa64c1a3ffb0e684dd25224233c45c33b6c41d9.
- Full root tests: **1,955 passed, 30 skipped, 0 failed** across 276 files
  (artifacts/v0163-idle-convergence-tests-isolated.log). The first run retained in
  artifacts/v0163-idle-convergence-tests.log had 10 shell-output failures caused
  by untrusted worktree mise.toml warnings, not command idle. Rerun uses only
  scoped MISE_IGNORED_CONFIG_PATHS=$PWD (no global config changes).

The current composed release gate has **six suites**: command, local-child,
human, app-delegation, default-controls, command-final. The original historical
2644 evidence table has five suites; these are not interchangeable counts.
The known Effect waiter regression remains unfixed and must not be blamed for
this failure without a corresponding stuck lifecycle trace. This proves only
bounded native acceptance, not Live/devices/paid providers/disconnect coverage.

Values are unchanged: this applies existing “say what proof shows,” bounded
work, and original-evidence retention values; it adds only feature-local wisdom.

Historical images were retired; [recovery details](../quality/protocol-artifact-retirement.md) preserve the original revision.
