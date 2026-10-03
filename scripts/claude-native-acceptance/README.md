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

The actual new connector was tried with unmodified official T3. Readiness is
blocked by **--settings is not yet bound in the Bruv connector**. T3's probe
also supplies --setting-sources and a permission policy. The official rendered
view truthfully shows Needs attention / Unsupported, not Authenticated; the
local model received zero requests in this integrated attempt.

After the parent binds the actual probe/runtime/MCP/session semantics, rerun
the same command. Later task/reload actions are implemented but not observed
through this connector yet. Normal subagent/profile inheritance is not tested
(the acceptance uses a managed shell). Permission and saved-question scenario
requests are present in the test model, but ACCEPT_PERMISSION=1 and
ACCEPT_SAVED_QUESTION=1 fail explicitly until real parent bindings and rendered
answer/approval controls are available. Add assertions against actual question
admission/answer/storage and real can_use_tool responses then; never synthesize
native events. Full restart, SDK fork, child history and broader product parity
remain separate parent gates.
