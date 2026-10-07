# Connector version probe — integration, 2026-10-07

User approved the semver-free connector --version response. Normal bruv
--version, connector --bruv-version and init protocol version stay unchanged.
External T3 cannot change; fresh standalone paired installs must carry this.
This new task does not edit the completed update-routing worktree.

Parent integration worktree: /home/tnfssc/.bruv/worktrees/bruv-connector-version-probe-integration
Branch: bruv/connector-version-probe-integration.
Implementation child task_ef0b72b0:
/home/tnfssc/.bruv/worktrees/t3-1c4479b8-5442693331ce-task_ef0b72b0
Branch: bruv/stop-bruv-connector-triggering-claude-up-ef0b72b0.
Base: 89b381e7 (includes paired update routing and its proof).

Research is at
/home/tnfssc/.bruv/worktrees/t3-1c4479b8-5442693331ce-task_63490595,
commits b03989a6 and cc5230e7. Exact host tag
v0.0.46-nightly.20261005.2702 -> cfa4f765ec05950a032b6c1cf9cdfff0c2391545.
Unknown CLI version skips latest lookup and is not an update candidate.
Built-in version-gated Claude models can be filtered and a model warning can
remain; exact custom Bruv models are added separately. Keep this tradeoff in
the guide. Do not claim every warning disappears.

Preserve the thin launcher's narrow legacy updater staging bridge. Its old
staged --version product label is intentional and is not a T3 probe identity.
No T3 settings, real installed binaries, provider auth, or release changes.

Worker setup cannot find Bun in shell PATH. Use absolute Bun 1.4.2 and explicit
Bun:/usr/bin:/bin PATH. Parent's fresh Pi1.0.3 dependencies are used through an
untracked local symlink; prepared assets are copied locally. Do not commit them.

Next: integrate child commit, run correct-dependency build/typecheck/focused
and compiled tests, check actual T3 source paths and any safe isolated UI proof
that exists. No real user environment update or provider call is authorized.
Values unchanged: existing identity, exact-host proof and ownership cover this.

## Unchanged host control

Private old-version control task_e149a502 passed. It used the installed Bruv
pair copied into an owned temporary directory, never mutated in place. The
unchanged T3 2702 binary hash stayed
da741779029c88c84d26c22354c5b4ddaa0e81fc99d8a1b0a3b2f7a56232c6c0.
Settings show Update Available: Claude v2.1.292 and the Update action with the
old 2.1.280 CLI identity. A custom local model rendered a real native reply
through Bruv. One request went only to the loopback fake model. No paid call.
This control prevents claiming success just because host update checks were off.
The control result inherited the new-profile label from the initial script;
oldVersionControl:true and connectorVersion record the actual tested input.
The runner now labels control and new runs separately and avoids inheriting an
old claim about a separately tested SDK/account check.

## New identity UI and read-only review

Worker candidate UI task_6be9e4d2 passed against the same unchanged T3 binary.
The actual compiled wrapper responds Bruv connector. The Bruv latest-update
popup and provider Update button are absent after the host's lookup window.
One genuine native custom-model reply succeeds through the actual Bruv/Pi
runtime and a loopback fake model. Normal helper and wrapper are a real matched
pair copied into temporary fixture HOME/bin, with neither BRUV override and no
server-level CLAUDE_CONFIG_DIR. Update checks remain explicitly enabled.
No real auth or paid model request is used. T3 binary hash stays identical to
control. Both snapshots remain under proof/connector-version-probe.

The built-in-model message remains: unknown installed version is too old for
Claude Opus 4.7, asking for v2.1.111. Do not claim that message disappears or
that the native model catalog is unaffected. The normal latest-update toast is
specifically absent; an unrelated nightly mobile-app notice may still show.

Read-only review task_e0271f95 found no blocking defect in the worker diff.
It checked the exact label and empty stderr, actual product outputs, unchanged
init constant, release/smoke/verify-update checks and legacy staging bridge.
No T3 changes or fake version were found. The diff stayed stable during review.

Next: receive the worker commit, integrate it, rebuild and run focused gates.
If integrated runtime bytes differ, repeat the new UI probe on that exact build.
Do not use a candidate-only test as evidence for changed shipped bytes.

## Final integration

Worker commit 30f8046c was integrated as 74b973a5. Its focused review had no
blocking findings. The parent rebuilt with correct Pi1.0.3 dependencies:
TypeScript/preparation and the normal paired build passed. Parent focused
identity/install/update/release checks passed 157 tests / 1,193 assertions.
Actual integrated compiled connector smoke passed 3 tests / 154 assertions,
including unchanged init protocol/product fields and genuine normal child work.
The paired standalone smoke also passed.

Final UI task_bfba5c07 ran on the newly integrated pair, not only the earlier
worker candidate. On unchanged T3 2702 the latest-update popup and Update
button are absent; custom local chat succeeds. T3's model-too-old advisory
remains. The T3 executable hash is unchanged from the old control. Inspect
proof/connector-version-probe/integrated-new/result.json and screenshots.
The normal runtime and wrapper hashes after build are recorded separately in
integrated-artifacts.json; no later build changed those files. The runner now
also records the normal runtime hash on future reproductions. The old control
and candidate captures stay labeled; their earlier metadata did not include
that normal-runtime hash.

The worker ran the full suite: 2,224 pass, 27 skip, 6 fail, all in the terminal
performance fixture path. Missing manager.getSessionId in the globally installed
accounting adapter is reproduced on the unchanged base, and that test file alone
passes 7/7. This is not full-suite green or proof that all baseline failure counts
match. The worker's note preserves the broader baseline count/order/trust caveat.
No unrelated accounting/fixture change is bundled here. See label-only-cli-identity.md
and its failure artifacts. Parent did not repeat the expensive full suite.

Research, source, updated release/install gates, focused/UI proof and reasons
are together in this new worktree. Existing values cover truthful identity,
shipped-path proof and separate ownership; values unchanged. No T3 settings,
real installed executable, provider auth, push, PR or release was changed.
The old completed task branch stays untouched. This local source still needs
publication/release or an explicit source install before other systems get it.
