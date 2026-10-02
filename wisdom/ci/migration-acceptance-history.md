# Migration acceptance needs full Git history

The Linux full-validation job runs `tests/t3-migration-acceptance.test.ts`. Its shipped-patch assertions intentionally read the historical canonical patch with `git show 92f1f2bc543ef148a5d254c20c95e6ba8b9aa4be:integrations/t3/upstream/bruv.patch`. A depth-1 checkout does not contain that historical blob, so the test fails before exercising migration behavior. Do not skip the test or replace its historical input: it verifies the shipped patch.

CI run 37016177565 failed this way in `.cache/ci-37016177565-linux.log`; CI 37014485451 had the same Linux shared-gate failure after release 0.15.25. The release run 37014484547 passed because its checkout already uses `fetch-depth: 0`. Align the Linux test job to that checkout depth. The workflow regression in `tests/release-workflows.test.ts` asserts this prerequisite stays in place; the test's historical source and checksum remain unchanged.

Proof: a local `git clone --depth=1 --no-local` of this checkout reproduced the failure (`path exists on disk, but not in ...`); a full clone retrieved the exact blob with `git show`. The task checkout itself also has that blob. The workflow now requests full history for the Linux gate, matching release. Hosted CI must be rerun by the parent after push; local reproduction does not itself prove a hosted run.

Parent integrated3e6fadd as37cd554. Parent Bun1.4.2 is available: workflow and
migration suites passed22tests/403assertions; format and diff checks passed.
Release success and normal CI success are separate claims. Check both before
saying all validation is green. Values unchanged: existing whole-path/honest
proof guidance already covers this distinction. Hosted CI result still pending.
