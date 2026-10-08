# CI native lane result

Implemented independently of root-stall task_56cf062d; no push/merge/release.
Assigned runtime verified from session model_change: openai-codex/gpt-6.1-sol.
Read the complete task_5263d1ac investigation, values and relevant CI guidance.

## Change

- Added one required native-linux sibling of ordinary Linux and macOS, sharing
  the full-plan condition and feedback dependency.
- Moved both Linux sanitizer/private Pulse steps unchanged (parsed equality and
  all 3,301 original step bytes checked against HEAD). WebRTC checksum, sources, compiler flags,
  helper, routes, protocol and fixture lifecycle are unchanged. Meson stays -j2.
- Ordinary Linux still invokes the untouched shared gate: root/resource/build/
  transport/smoke. Native provisioning uses the shared installer’s native-only
  mode and deb-only cache; no duplicate Node/Bun/root dependency install.
- CI policy needs native-linux and consumes NATIVE. Full needs three successes;
  docs needs three skipped lanes. Failed/cancelled/skipped/missing native full
  outcomes fail, as do planning failures. Release workflows/gates unchanged.

## Proof and limits

Focused structural tests: 61 pass, 55 filtered, 0 fail, 362 assertions.
Bash syntax, TypeScript noEmit and final formatting passed. Lint exited zero
with existing workflow-literal warnings. Initial format check found two local
format differences; corrected. No workflow shell/cleanup traps, native fixtures,
hello replay, devices, full CI, sudo, auth/provider/SSH/recovery or hash bypass ran.
Only inspected read-only structural tests and the policy shell were selected.
Retained JS-owned fixture with cleared HOME/config/SDK/cache/tmp:
/tmp/bruv-ci-native-lane-BHwKy1/ (contracts.log, baseline.log, formatting/lint/
typecheck logs). Test processes used exact-PID 45s deadlines, no timeout occurred.
Package-mode probe ran only the installer header before the missing-package loop:
ordinary = tmux/ffmpeg; native-only = the original ten native packages; combined
mode unchanged. Exact-PID 5s deadline; no provisioning was executed.

Historical normal baseline: workflow 328–346s, root 136–155s, native fixture
70–71s with ~49s compilation. Expected ~70–120s saving minus new-job setup/queue
and ordinary tooling; NOT achieved timing. The separate 26-minute root stall
remains unaddressed here. Parent owns independent judgment, hosted measurements
(including overlap, counts, native failure policy, docs and runner seconds),
then focused CI follow-up PR publication.

## Integration hunks

- tests/release-workflows.test.ts: one new structural test immediately after
  “CI and release cache downloads only…” (single +37/-0 hunk at old line 144);
  no subprocess helpers, lifecycle,
  source admission, release ownership or publication assertions changed.
- tests/live-native-workflows.test.ts: Linux lane identifier and protocol lookup
  now native-linux; preserved all assertions and added an explicit unchanged -j2
  check. Hello helper and lifecycle untouched (stall owner may change them).
- tests/ci-selective-workflow.test.ts: required dependencies/full lanes and
  NATIVE field in the existing policy tuples/negative alternatives only.
- Wisdom: parallel-native-linux.md added; linux-fixture-tooling.md now reflects
  the split. Values unchanged; existing honest-proof/safe-fixture rules cover it.
