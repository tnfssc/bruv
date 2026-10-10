# Native connector acceptance

The official launcher now calls the actual exported harness functions and selects
its driver through replay config, not launcher-source slicing. See
[launcher boundary fix and v0.16.20 six-suite proof](../../wisdom/claude-compat/official-proof-launcher-boundary.md).

## Pinned release CI contract: unchanged official 2644

The pinned release CI target is **v0.0.46-nightly.20261004.2644**, not older 2623.
Use the [official-2644 proof](../../wisdom/claude-compat/proof/official-2644/README.md)
for immutable source/archive/executable pins and validated strict replay contract.
The historical failures below do not override its bounded passing gates; the
upstream Effect queue race itself remains unfixed. No local T3 patch is required.

Release CI downloads only this verified test dependency, then runs:

~~~sh
# Absolute paths to the ACTUAL final matched pair; no tap/synthetic substitute.
export BRUV_CONNECTOR_EXECUTABLE="$PWD/dist/release/bruv-claude-compat-linux-x64"
export BRUV_RUNTIME_BINARY="$PWD/dist/release/bruv-linux-x64"
export T3_UPSTREAM=/absolute/fresh/official-2644-cache
export BROWSER_PATH=/absolute/chromium-headless-shell
export PROOF_OUTPUT="$PWD/.cache/native-release-2644-fresh"
node scripts/release/run-native-release-gate.mjs
~~~

Requires Linux x64 and node on PATH with node:sqlite (22.13+; proof used 25.9.0).
The runner composes the **existing validated scripts**, sequentially: strict
command-idle; same-root actual local child + reply/idle; human approvals and
saved questions; app delegation; default steering/Stop/reopen continuation;
command-idle again. It rejects unpinned binaries before launch, rehashes between
suites, clears branch-selection flags and requires every passing result. Proof
roots must be new; failed-suite screenshots/results remain available to CI.
The default suite alone is not this release contract. Packaging and these bounded
gates do not replace full parity/device/provider/cross-platform acceptance.

Known upstream stale approvals still require explicit **Decline** after Stop;
unsupported version/update banners stay truthful. Live is same-host opt-in audio,
not browser microphone transport. No real auth/version is invented.

This is a test harness, not a Claude implementation. It reuses the committed
`wisdom/claude-compat/proof/native-ui-fixture/replay.mjs` bootstrap, pairing,
first-run flow, official artifact path and browser. Integration mode substitutes
only a transparent process tap around the actual connector and real UI actions.
The old synthetic fixture is NOT an acceptance fallback.

## Run

From the repository root (POSIX shell):

```sh
BRUV_CONNECTOR_EXECUTABLE=/absolute/path/to/dist/bruv-claude-compat \
BRUV_RUNTIME_BINARY=/absolute/path/to/dist/bruv \
T3_UPSTREAM=/absolute/isolated-upstream-layout \
BROWSER_PATH=/absolute/chrome-headless-shell \
PROOF_OUTPUT=.cache/claude-integrated-$(date +%s) \
node scripts/claude-native-acceptance/run.mjs
```

`T3_UPSTREAM` and `BROWSER_PATH` are required explicit paths. The upstream layout
must contain `platform/t3` and `runtime/node_modules/playwright/index.mjs`.
Optional: FIXTURE_PORT (default 18783), BRUV_CONNECTOR_ARGS_JSON (default []),
and PROOF_OUTPUT.
PROOF_OUTPUT must be new, not a directory containing an earlier PASS.
The tap forwards all native args/bytes unchanged; do not strip unsupported T3
flags or rewrite the connector's version to make readiness appear successful.

The launcher creates a loopback OpenAI-completions test endpoint and scoped
models.json. Its only identity is **bruv-acceptance/local-deterministic-v1**.
T3 customModels contains that exact slug, the explicit display name
"Local deterministic acceptance (not Claude)", and empty option descriptors.
The model endpoint rejects other model IDs. No default Claude alias is used.
BRUV_CLAUDE_COMPAT_HOME and BRUV_CLAUDE_COMPAT_BRUV_PATH bind the real connector
and normal child runtime to the fixture. No auth.json or parent environment is
inherited. The local endpoint's fixture-only string is not a real credential.

## Checks and evidence

### Goal and foreground control regression

The separate goal scenario uses the actual connector and native composer with a
deterministic loopback model. It gates an unfinished automatic turn while issuing
status, resources, mode, questions and Live inspection commands. It then exercises
pause, reload, native Stop, resume, completion, clear, a 23-token response budget and frozen
accounting after completion. The budget model requests a real side effect that
must never execute after the response exhausts the budget.

```sh
ACCEPT_GOAL_CONTROLS=1 \
T3_UPSTREAM=/absolute/isolated-upstream-layout \
BROWSER_PATH=/absolute/chrome-headless-shell \
BRUV_CONNECTOR_EXECUTABLE="$PWD/dist/bruv-claude-compat" \
BRUV_RUNTIME_BINARY="$PWD/dist/bruv" \
PROOF_OUTPUT=.cache/native-goal-controls-new \
node scripts/claude-native-acceptance/run.mjs
```

This focused scenario may target an installed unchanged T3 release without
claiming the historical 2644 release gate. For a flat installation, create a
separate temporary layout with `platform` pointing at its existing directory
(containing `t3` and `client`) and `runtime/node_modules/playwright` pointing at an
already installed Playwright package. It does not write to the original T3 tree,
user app state or real provider configuration. The runner hashes the original T3
executable before and after the replay and records its actual version.

The current Claude adapter renders active and complete goal indicators but has no
paused or budget status projection. The fixture checks those states against Bruv's
durable goal and visible command notices, and uses the real `/goal resume` command.
Native steering can omit a user UUID: in that case the fixture checks the emitted
control reply and preserved foreground state, without inventing host correlation.
T3 2702 rejects promoting `/goal` commands to steering before forwarding input
to the connector. The active-control checks therefore use `/bruv goal status` and
`/bruv goal pause`; idle start/resume use `/goal` and clear uses the actual native
button. The test checks second-response streaming bytes and an active native goal
indicator. T3's Claude adapter projects text from completed assistant snapshots,
so the proof does not claim display of incomplete second-response text.
`goal-controls-observations.json` records state and command evidence with hashed
identifiers. A failing indicator, lifecycle or accounting assertion fails the run.

On 2026-10-10, this focused scenario passed against unchanged
**v0.0.46-nightly.20261005.2702** with the final actual launcher/runtime pair
(SHA-256 prefixes `55b58718cdfb8f87` / `f4a95bf5a3f6d9b0`). It verified nine active
controls, continuous native goal pursuit, pause/reload/native Stop recovery,
real tool-backed completion, both native Clear actions, budget exhaustion before
a tool side effect, exhausted-resume rejection, increased-budget completion and
frozen completed usage. The proof is retained locally at
`.tmp/native-2702-goal-final-1791617393948`; its invocation/result files contain
full artifact hashes. No real provider credentials, user app state or T3 files
were used or changed. This is focused controls evidence, not a rerun of the
broader task/history release gate above; the host limits described here remain.

The default integrated driver requires:
- actual execute tool output;
- a managed shell controlled by fixture gate files, not synthetic native events;
- priority=now steer admitted while that tool is active;
- real background admission, early assistant return, and actual completion wake;
- Stop generation and native interrupt; surviving managed work is separately
  cancelled through actual jobs.stop and inspected, not mislabeled as stopped;
- reload, thread reopen and continued same-session use;
- matching native task_started/task_notification IDs and truthful task statuses;
- identical official T3 hash before/after.

Snapshots are real T3 frames and body text. Wire export contains only seam
fields, tool names, argv **flag names**, and narrowly allowlisted launch errors;
no prompts, configs, account fields, UUIDs or tokens. Raw private wire/server
logs and scoped home/project/model/runtime state are removed. The launcher
terminates only fixture workers whose /proc command lines match its worker and
state paths. Failure produces evidence but never a PASS result.

## Local model fixture checks (not connector acceptance)

```sh
node --test tests/claude-compat/claude-native-acceptance-model.test.mjs
BRUV_RUNTIME_BINARY=/absolute/path/to/dist/bruv \
PROOF_OUTPUT=.cache/claude-runtime-smoke-$(date +%s) \
node scripts/claude-native-acceptance/runtime-smoke.mjs
```

The RPC smoke runs real Bruv execute, managed shell admission and a completion
notification/model wake without credentials. Its result explicitly says
notConnectorAcceptance=true. Endpoint unit-test tool results are only unit
inputs, not implementation evidence.

## Current boundary

Production composition now binds the actual settings/permission/tools/session/MCP
launch vocabulary. The launcher configures the same explicit scoped native-history
CLAUDE_CONFIG_DIR/homePath on the unchanged T3 parent and connector; default real
Claude history state is refused. Exact customModels provider/id remains unchanged.

The composed connector actually reached readiness (zero model calls), execute,
managed shell steering, early return, one completion wake, generation Stop and
reload/reopen through official unmodified T3. **Integrated acceptance still fails**
at CANCEL_CONFIRMED_REAL: Stop closes the native query, clean EOF teardown terminates
its owned shell, and the resumed runtime cannot inspect/cancel that old manager's
job as a live current job. No native task state was invented. Parent still adds
its independent real manager lifecycle binder and performs final acceptance.

The compiled real normal-child probe separately launches the paired normal Bruv
binary with an explicit normal model/thinking profile and executes a genuine child
tool. This is not native rendered task-lifecycle acceptance. Real Pi permission
hook/updated-input/denial, saved root ledger human answer/new-turn and injected MCP
call/teardown tests pass, but rendered approval/question UI remains a separate gate.
ACCEPT_PERMISSION/ACCEPT_SAVED_QUESTION intentionally remain disabled until actual
native rendered actions/assertions are implemented; do not enable canned answers.

Proof and exact checks: [production composition](../../wisdom/claude-compat/composition.md),
[observed FAILED replay](../../wisdom/claude-compat/proof/composition/observed/).

## Actual T3 history acceptance

With pinned official T3 (default SHA-256
`2cc42990ee8ad2ff30bbd43cdcf67686c9ca5aaff5e3ed36b5be40962cc53795`),
local Playwright, the actual compiled connector, and paired normal Bruv,
run (use supported Bun 1.4.2, not a global install):

```sh
/path/to/bun-1.4.2 scripts/build/build-claude-compat.ts --outfile=.cache/history-connector
TMPDIR=/var/tmp \
BRUV_CONNECTOR_EXECUTABLE="$PWD/.cache/history-connector" \
BRUV_RUNTIME_BINARY=/absolute/path/to/paired/bruv \
T3_UPSTREAM=/absolute/path/to/pinned-t3-layout \
BROWSER_PATH=/absolute/path/to/local/chromium \
FIXTURE_PORT=18943 PROOF_OUTPUT="$PWD/.cache/history-proof-unique" \
node scripts/claude-native-acceptance/history-run.mjs
node --test tests/claude-compat/claude-native-history-model.test.mjs
```

The upstream layout is the existing official artifact at `platform/t3`
and local Playwright at `runtime/node_modules/playwright`. Optional
`T3_EXPECTED_SHA256` changes the explicit pin for a separately verified artifact;
the run always compares its checksum before and after UI exercise. Use a unique
port/proof directory. A short, disk-backed TMPDIR avoids the observed Chromium
ENOSPC crash on a crowded /tmp and Unix socket path limits on long worktree paths.
All per-run runtime/browser state is scoped below a fresh directory and removed.

This is not the synthetic native UI fixture. T3, its own SDK fork/rollback APIs,
the compiled connector, actual execute/shell/questions APIs, and model loop all
run unchanged. A local OpenAI-compatible fake model is the only inference source;
no credentials, devices, provider account, upstream patch or global install.
Parent and connector share the same isolated CLAUDE_CONFIG_DIR/SDK home.

Assertions cover a completed ID-paired tool exchange, native UI fork through a
completed assistant checkpoint, no stored-tool execution during fork, a fresh
canonical owner, actual empty child jobs/questions inspection, byte-identical
original branch, parent-linked rollback/reopen context and durable source mapping.
The fork draft URL is not the persisted child URL; the harness records the latter
by selecting the persisted sidebar thread after the first child response, and
waits for history hydration before continuing.
Native update toasts are dismissed via their UI close button before rollback.
Background summary requests are answered separately, never mistaken for another
user action or synthetic native event.

Evidence includes real wire/data/model projections, action statuses, paired tool
IDs and authority outputs, scoped-path-redacted screenshots/text, invocation
checksums, model checks and cleanup. Marker text alone is not sufficient to pass.
Endpoint/verifier unit inputs are explicitly not native acceptance evidence.

## Same-root return after actual local child

`run-subagent.mjs` now requires normal input and a distinct actual next model reply
after Open parent from the real child transcript, in the same root URL/native session.
It waits for an idle composer; only then may independent cancellation/Stop roots start.
It also requires real consumed-prompt UUID results and autonomous task-notification origin.
Do not skip those gates while waiting for the runtime correlation patch.

Use the exact invocation/checkpoint in
[local acceptance wisdom](../../wisdom/claude-compat/local-subagent-acceptance.md#same-root-child-return-follow-up--2026-10-04).
Node 25.9.0 was used for read-only node:sqlite diagnostics. Evidence before cleanup includes
marker-only wire correlation, committed source messages and relevant T3 persisted run/child
status; no auth/payload rows or pairing tokens. New tests: `claude-native-subagent-return.test.mjs`.
Pre-patch two same-root UI runs succeeded but the stricter ownership gate failed. Intermittent
busy UI is not claimed reproduced or fixed. Parent must rerun after task_0720fd7d without a
new-root/reload/Stop workaround.

## Focused rendered human controls

Use the same actual binaries and unchanged pinned official T3, with a unique port
and proof directory:

```sh
ACCEPT_HUMAN_CONTROLS=1 FIXTURE_PORT=19848 \
BRUV_CONNECTOR_EXECUTABLE="$PWD/dist/bruv-claude-compat" \
BRUV_RUNTIME_BINARY="$PWD/dist/bruv" \
PROOF_OUTPUT=.cache/native-human-controls-$(date +%s) \
node scripts/claude-native-acceptance/run.mjs
```

This focused branch uses Supervised native execute approval. It checks no side
effect before consent, actual allow/deny, Stop of pending consent, and the durable
saved-question ledger. Official T3 live questions do not have a dismiss button;
Selecting "Keep pending (do not answer)" is an explicit connector human action
and never becomes a saved answer. Official T3 auto-submits single-choice options. Stop/reload/reopen preserves owner, ID
and version. After answering a recovered question the driver explicitly invokes
/bruv questions resume, approves its real execute to resolve the saved answer,
and checks exactly one continuation even after another reopen.

Known official T3 defect: a cancelled execute approval card persists after Stop,
even on reload. The proof retains that visible frame; the driver explicitly
Declines the stale card to proceed and checks no stopped side effect. This is not
an assertion that T3 automatically clears it. No T3 source/artifact is changed.
Task/Live/delegation/history acceptance remains the separate default/composed gate.

The human driver now requires a UUID-correlated command result and a genuinely
idle native composer before reloading or resuming a saved answer. It also checks
/bruv status and resolved-question open without Stop/reopen recovery. Deliberate
Stop of pending consent/questions and real reload recovery remain separate tests.
A command lifecycle completion is not sufficient: official T3 treats these
frames as admission acknowledgements, not terminal turns. Earlier strict runs
failed on zero-model human command settlement; see the retained command-idle proof.
Those historical failures are separate from the focused 2702 controls evidence
above and the pinned composed release gate.
No model counts/provider calls are invented to make the view settle. The shared
harness waits for an enabled New thread or actual Start without a project control
instead of racing native bootstrap hydration.

### Explicit native history reader

Set `BRUV_CLAUDE_SDK_PATH` to the checksum-verified SDK 0.3.276 `sdk.mjs`. The release setup downloads that test-only archive and exports its path. The composed gate checks the input before launching any suites; no developer-home cache is used. `T3_UPSTREAM`, `BROWSER_PATH`, and paired binary paths are explicit too. The SDK is not added to product dependencies.

## Thin-launcher release packaging

The product compiles one `bruv` executable per target. `bruv-claude-compat` is a
tiny POSIX exec launcher for its sibling `bruv claude-compat`, not a separate
compiled connector. Native proof must pass both actual paths; do not replace
the launcher with a developer Bun command. Release-suffixed names and installed
canonical names must both resolve their matching sibling. Linux/macOS launchers
use `/bin/sh`; Android uses `/system/bin/sh` and the Android API 28+ executable
uses `/system/bin/linker64`, not glibc.

Packaging compares connector `--bruv-version` to normal `bruv --version`.
Connector `--version` reports only `Bruv connector` (no dotted semver), so T3
treats the CLI version as unknown rather than a latest-Claude update candidate.
SDK init keeps `claude_code_version: 2.1.280` and real product `bruv.version`.
Version-gated built-in Claude models are filtered and a separate too-old model
advisory can remain; custom Bruv models stay available. Only the older updater’s exact
canonical `--version` probe in its private `.bruv-update-*` staging directory
retains the truthful legacy product label; installed CLI probes use the
label-only display identity. The release launcher gate checks
shipped script checksums, shebangs, sibling resolution, exec process identity and argument/exit-status
forwarding using a temporary sibling and the host POSIX shell. It does not claim
native Android/macOS execution or native T3 acceptance. The existing composed
strict suites, Linux actual-pair checks, Mac actual-pair/updater/helper checks,
and all publication dependencies remain required.
