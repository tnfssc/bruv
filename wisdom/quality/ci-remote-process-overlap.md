# Remote selected CI: process overlap proof (2026-09-30)

Follow-up to the parent's hosted [fast-path proof](ci-hosted-fast-path-proof.md), read from the parent checkout; that uncommitted note was not modified here. Hosted source PR was 60s end-to-end / 35s selected checks, with the final three processes 19.5s + 4.3s + 5.1s. This note is **local evidence only**, not a new hosted/end-to-end claim.

## Execution contract

The selector's commands and source population are unchanged. Only a sole `remote-source` selection whose final argv exactly matches the audited remote explicit, reverse `--changed=BASE`, and `pi-host --test-name-pattern '^source CLI'` commands can overlap. Mixed remote+waveform (including overlapping live tests), narrow human-rendering, docs, full, or unfamiliar command shapes remain serial.

Frozen install, prepare:assets, format, lint, check (which also prepares assets), and selector policy tests finish successfully **before** any worker starts. Existing Bun argv, test patterns, deadlines, and opt-in exclusions stay unchanged: three separate Bun processes, no `--concurrent` or global test-concurrency setting, no build/dist. A failed prerequisite stops execution. After batch launch all three processes finish and all logs are replayed even when one fails; a nonzero exit, signal, or spawn error cannot produce success. Logs are saved under `artifacts/ci/groups/01.log` etc. with per-group duration/status and batch summary; CLI reports overall duration/status.

Each command gets its own mkdtemp TMPDIR and TMUX_TMPDIR, under a fresh run root. SIGINT/SIGTERM terminates process groups, retains their IDs even after a leader exits, escalates after a cancellation-only 2s grace, then removes temporary state. This is not a test deadline. tmux daemonizes outside those groups: cleanup stops only servers whose sockets are inside this run's isolated TMUX_TMPDIRs. The source PTY helper no longer starts its CLI in a separate session, so group cancellation reaches it. Existing browser lifecycle work and YAML are untouched.

## Resource audit

- Explicit remote tests mutate process.env, HOME and mocked process/global APIs in their own Bun process; repository, remote-owner, grants/state/locks/artifacts and SSH fixtures use mkdtemp homes/repos. Reverse consumers have independent process state; their socket fixtures use paths under mkdtemp, and native-routing's HTTP server uses port 0. No fixed shared listener was found among the selected population.
- Source pi-host cases create separate temp homes and run source CLI only. Their filtered-out adaptation/compiled tests are not run. Root source/dependency files are read, not edited, by these cases.
- live-spoken-tui uses a PID-named tmux socket and an isolated home; the runner additionally isolates its socket directory and cleans daemonized servers. The Python source PTY uses tempfile.mkdtemp (honors group TMPDIR), its own HOME/grants and no shared port.
- live-spoken-tui still executes its existing standalone prepare-assets assertion. It is preserved, not silently skipped: successful serial preparation means preparePiHost's before==after and writeIfChanged's content equality branches do **not** rewrite root assets/dependency adapters during workers. Source workers consume already prepared assets; no worker builds web/CLI artifacts.
- Global env changes/mocks/cwd are process-local, not shared between groups. No assumption is made about waveform or other mixed-class resource isolation: those plans keep their unchanged serial union.

## Repeated clean-source measurement

Bun 1.4.2 (744846f84), Linux local host, SHELL=/bin/bash. A git-archive source copy at `/home/tnfssc/.die/ci-remote-parallel-probe` was initialized and committed with the runner; a separate source-only comment commit modified src/remote/client.ts, matching the hosted probe's changed input. Fresh frozen dependencies were installed (1.347s initially); no dist or runtime-assets were copied. Every timed run then executed **all nine commands**, including frozen install, preparation and check, with no prepared-deps flag. The warm repeated frozen install is much faster than hosted install; serial and parallel comparisons use the same conditions.

After every run: exit 0, no dist, clean tracked checkout. Explicit logs show **35 policy + 123 remote/process + 80 reverse + 2 source pi-host passes, zero failures** in every run. Thus the measured reverse population was real, not an empty changed-test selection. Repeated serial and parallel runs reused the same copied checkout, with isolated fresh temp directories each time. All command arrays, SHAs, logs and summaries remain in that probe directory, result-N.json / run-N-MODE.log / artifacts/ci/N-MODE/.

| Snapshot / iterations | Serial selected seconds | Parallel selected seconds | Net saving seconds |
|---|---:|---:|---:|
| Initial, 0 / 1 | 30.423 | 22.511 | 7.912 |
| Initial, 2 / 3 | 29.088 | 21.567 | 7.521 |
| Initial, 4 / 5 | 29.986 | 21.794 | 8.192 |
| Cancellation/log refinement, 6 / 7 | 29.023 | 21.655 | 7.368 |
| Cancellation/log refinement, 8 / 9 | 29.002 | 21.779 | 7.223 |
| tmux isolation/cleanup, 10 / 11 | 29.045 | 21.703 | 7.342 |
| Same serial baseline, repeat 12 | 29.045 | 22.678 | 6.367 |

Latest source-copy base/head: 9c69afdaa97c2a424d01bd55821d480e9ff7979d / ebf941bd2d3761a717f73d129d3189fcecbeeddd. In iteration 10 the three serial workers were **17.191 / 3.464 / 3.975s** (24.630s total); concurrent iterations 11 and 12 were **17.210 / 3.647 / 4.471s** and **17.283 / 3.619 / 4.484s** respectively. That is ~7.35–7.42s saved in the worker section; higher prerequisite time accounts for iteration 12's smaller net saving. The final retain-already-exited-group-ID correction changes cancellation only and has its own focused regression; it does not change normal-path batch scheduling.

**Measured result:** 6.4–8.2s net local selected-check savings (usually ~7.3–7.9s). This supports genuine overlap benefit, not a guaranteed 8–10s hosted reduction. The hosted baseline's 9.4s noncritical worker sum is a ceiling estimate, not evidence of the second run. Parent must perform that hosted measurement after integration; no push, dispatch or release done here.

## Regression and integration

Formatting/lint and bun run check pass. Focused runner/selector/remote-policy/workflow tests: 45 pass, 0 fail. Runner checks unchanged argv and mixed union, exact batch guard, serial prerequisites, all three workers launched, both output streams saved/replayed, one failed worker failing the whole batch while siblings finish, unique temp roots and cleanup, prerequisite/spawn failure, and SIGTERM cleanup after an already-exited leader leaves a surviving TERM-ignoring descendant plus a tmux daemon. The final focused cancellation revision passed all four runner tests (38 expectations). No full-suite/release validation was added to this task.

Values unchanged: this applies existing measurement, isolation and handoff principles; no new general rule needed. Parent-owned hosted proof remains untouched. Integration is a single runner/helper/tests/wisdom commit; hosted follow-up stays with parent.
