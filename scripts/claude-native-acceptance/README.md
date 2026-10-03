# Native connector acceptance

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
PROOF_OUTPUT=.cache/claude-integrated-$(date +%s) \
/usr/bin/node scripts/claude-native-acceptance/run.mjs
```

For this handoff, those binaries are respectively:
- /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_06e50aca/dist/bruv-claude-compat
- /home/tnfssc/Code/bruv/dist/bruv

Optional: T3_UPSTREAM, BROWSER_PATH, FIXTURE_PORT (default 18783),
BRUV_CONNECTOR_ARGS_JSON (default []), and PROOF_OUTPUT. The official T3 default
is /home/tnfssc/Code/bruv/.cache/acp-t3-upstream-experience/platform/t3.
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

The integrated driver requires:
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
/usr/bin/node --test tests/claude-native-acceptance-model.test.mjs
BRUV_RUNTIME_BINARY=/absolute/path/to/dist/bruv \
PROOF_OUTPUT=.cache/claude-runtime-smoke-$(date +%s) \
/usr/bin/node scripts/claude-native-acceptance/runtime-smoke.mjs
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
