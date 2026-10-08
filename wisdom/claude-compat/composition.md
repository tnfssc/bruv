# Production composition — 2026-10-03

Composition of the integrated modules at 339b7bbc. No normal CLI, external T3
source/version/account identity, release/web build, root package scripts, agent
extension, or task-binding module was changed.

## Bound production paths

- CLI captures injected argument config, then scrubs all T3/BRUV_T3/root controls
  and legacy web task emission before bootstrap or extension import. Provider
  configuration/auth is retained. Callback requests from restored saved questions
  wait for the same owning transport port; cancellation releases that wait.
- Native health settings now accept disableAllHooks, user/project/local source
  selection, permissions allow/deny/defaultMode and the supported disable-discovery
  env values. Native files/claude.ai/IDE MCP are never discovered. Source selection
  selects the connector's Bruv global/project settings (local shares the engine's
  project scope); it never imports a Claude account or Claude settings file.
  Hooks disabled means no filesystem/user extensions, not disabled internal
  permission/task/history hooks. Unknown settings effects fail before boot.
- Tool availability is independent of preapproval. Default is actual Bruv execute
  plus injected MCP; an explicit empty list is tool-free. Native builtin names
  map to actual Pi tools, never Bash-to-execute. Bash(*) authorizes only real bash;
  unsupported command-pattern syntax rejects. Default/acceptEdits/dontAsk/plan/
  dangerous opt-in and set_permission_mode use the existing Pi tool_call hook.
  Denial blocks actual code and is projected in permission_denials. Human updated
  input reaches the real tool hook; permission approval is never a question answer.
- Injected HTTP/stdio MCP connects/discovers once and registers its actual tools
  with Pi. Selection is reapplied after the Bruv extension's execute-only CLI
  default (otherwise registered MCP tools were genuinely unavailable). Only safe
  server names/status reach init, never URLs, headers, commands or env descriptors.
  MCP call admission stays in the existing helper; no duplicate task IDs or retry
  authority are added. Close awaits MCP and the real engine/task-manager teardown,
  even if another cleanup fails.
- Native app-owned classification is restricted to the injected credential-bearing
  t3-code HTTP server. Its credential-scoped backend remains the authority for
  run/provider/capability/depth admission and returned task IDs. delegate_task
  fails closed until explicit normal worker configuration exists. No Bruv job is
  minted for an app task. Other native context tools go to that real server.
- /bruv and /bruv: commands execute real goal/mode/questions/status/resources
  handlers. Native assistant/result frames show the actual human operation result,
  not model-generated prose or a stderr-only notification. Non-namespaced normal
  CLI text retains its existing Pi path. TUI dialogs/audio/resume-return remain
  unavailable, not invented. The saved-question factory is attached to the actual
  persistent root ledger; only a correlated human AskUserQuestion answer is saved
  and delivered into a new parent turn.
- Native session UUID is separate from canonical Pi identity. Private durable
  native-sessions/<uuid>.json indexes point to canonical Pi JSONL and bind cwd/home.
  Empty sessions persist the genuine Pi header before any model response. A wrapper
  of the actual manager appendMessage result records source entry IDs in append
  order, with matching wire UUIDs; repeated prose is not a key. Canonical system
  prompts/config descriptors are not projected. Resume uses the same Pi session;
  checkpoints branch by real source IDs after complete-context validation. SDK forks
  without a canonical index import into a fresh Pi history-only owner; imported
  mapping reopens durably, without jobs/questions/agent ownership records.
- Adaptive/enabled thinking maps to actual Pi high reasoning (nonreasoning models
  remain off); effort selects supported Pi levels. Summarized/omitted display uses
  actual Anthropic/OpenAI Responses reasoning payload settings, and omission hides
  thinking in native frames. Unsupported reasoning APIs reject summaries rather
  than synthesizing them. Exact token-budget, fastMode/ultracode/autoCompactWindow
  and unknown Claude settings effects reject. add-dir validates real accessible
  paths; Bruv arbitrary execute is **not** a filesystem sandbox or a read-only tool.
- Auxiliary JSON uses the same exact configured provider/id, an in-memory tool-free
  Pi session, actual model output and schema validation. Native custom models with
  legacy omitted type metadata must count as chat; excluding them reproduced a
  genuine configured-but-unavailable local provider during the T3 health probe.

Native stream startup, including no-persistence health, validates an explicit
absolute CLAUDE_CONFIG_DIR (T3 provider homePath), existing writable ancestor,
and refusal of ordinary Claude state (including symlinks) without writing history.
Auxiliary JSON mode remains stateless and does not require that home. Local exact
model/default selection and auth are checked before nativeStorage or MCP connects;
there is no first-authenticated-model fallback. initialize/admission recheck auth.
These checks prove local configuration only, never upstream scope or model access.

UI-only setup now assumes T3's corrected provider-scoped SDK history contract;
[setup](external-t3-setup.md) explicitly requires its availability. The older
unchanged 2644 acceptance launcher aligned the parent environment and is not
UI-only proof. On pre-fix T3, SDK fork can fail before Bruv starts; the connector
cannot catch it or guarantee upstream error presentation. No parent-env workaround
is recommended. Unsupported-version warnings remain a separate unresolved issue.

## Actual paired normal child dispatch

Passing executablePath into the agent extension alone was insufficient: its
JobService still builds normal CLI --session/--mode arguments with process.execPath.
The real compiled test failed with connector Unknown connector option: --session.
The dedicated connector now binds ONLY owned local agent launches, matched by the
actual parent canonical/ephemeral session file, to the paired normal Bruv executable.
It wraps the existing TaskManager spawn/activate command seam, keeps the same
manager/lifecycle/IDs/profile logic, and releases the binding on runtime close.
Normal CLI never installs this binding; shell commands are not rewritten.

The compiled real-child test selects fixture/child-model via explicit normal
model/thinking profile, launches the paired actual normal Bruv binary, executes
an actual child execute tool, verifies normal/depth=1 and scrubbed controls in its
canonical child history, and obtains the real completed result. This is NOT a
prompt-only subagent claim and NOT rendered native task-lifecycle acceptance.

## Configuring app-owned normal delegation

Connector-owned subagents.json needs explicit normal.model (exact provider/id)
and normal.thinking. Connector-owned native-app-worker.json additionally specifies:

    {"type":"normal","target":{"providerInstanceId":"<actual T3 worker instance>",
      "model":"<same exact provider/id>","options":[]},
      "runtimeMode":"approval-required","interactionMode":"default"}

Use actual option descriptors advertised by orchestrator_capabilities, not invented
Claude aliases. This explicitly selects the configured non-orchestrator worker
instance/model/options rather than inheriting the root/orchestrator. The actual
submitted target/runtime/interaction settings are shown to permission admission;
human-updated input cannot silently replace this configured profile. Missing or
invalid config fails honestly. The server, not this connector, owns native child
admission, task state, credentials and capability enforcement. Actual app-delegation
provider/worker acceptance is still required; no fixture pass upgrades that gate.

## Checks

Prepared installed pinned dependencies/assets, then Bun 1.4.2:

- tsc --noEmit: pass.
- Dedicated scripts/build-claude-compat.ts: pass; no root/web build changes.
- 108 tests / 570 assertions / 12 compatibility files: pass, including real Pi
  execution permission gates/updated input/denial, real saved ledger answer/new
  turn, real SDK stdio MCP call/PID teardown, ordered source IDs, checkpoints and
  empty-session resume, transport callback startup/scrub, and compiled native
  stream/tool-free auxiliary/EOF plus real paired normal child execution.
- BRUV_REQUIRE_CLAUDE_SDK=1 with the pinned SDK 0.3.276 package: all 9 SDK/history
  tests actually ran (not skipped): forks/checkpoints, config-home mismatch and
  aligned override, canonical cwd, imported source mappings and safe reopen.
- Seven ordinary production prompt-preview/cooperative-handoff regressions / 75
  assertions: pass (two files; no normal CLI source changes).
- Biome formatting and git diff --check: pass. Targeted lint reports no errors,
  with existing-style advisory warnings/infos (not a warning-free lint claim).

Reproduce focused/compiled checks with:

    export PATH=/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin:$PATH
    bunx tsc --noEmit
    bun scripts/build-claude-compat.ts
    SHELL=/bin/bash BRUV_CLAUDE_COMPAT_TEST_BINARY=$PWD/dist/bruv-claude-compat \
      BRUV_CLAUDE_COMPAT_TEST_BRUV=/home/tnfssc/Code/bruv/dist/bruv \
      BRUV_REQUIRE_CLAUDE_SDK=1 \
      BRUV_CLAUDE_SDK_PATH=/home/tnfssc/Code/bruv/.cache/claude-compat-boundary/package/sdk.mjs \
      bun test tests/claude-compat-*.test.ts tests/claude-compat/

## Real unmodified T3 observations / remaining gates

The integrated acceptance harness was actually executed, not replaced by synthetic
native events. Readiness now succeeds with zero model calls; the configured exact
bruv-acceptance/local-deterministic-v1 custom model reaches the actual main launch.
Real rendered execute, managed shell/steer, early return, single completion wake
and generation Stop were reached. The honest Bruv 0.15.28 unsupported-version
warning remains visible; no version spoof was used.

**Integrated acceptance remains failed**, at post-Stop CANCEL_CONFIRMED_REAL.
The real local endpoint reported Cancellation did not produce terminal inspection:
Stop's native query process closes; clean EOF teardown terminates its owned shell,
then the new resumed runtime cannot inspect/cancel that old manager's job as a
live current job. No historical ID was fabricated or restored as live ownership.
The separate real manager lifecycle task binder is still parent-owned and unbound
here. Native task_started/task_notification parity is not claimed.

Parent must add task_0b6b6a99's binder and rerun the exact existing run.mjs harness.
Also still required: rendered native permission approval/denial and saved-question
cancel/reopen/answer/resolve, real app-owned delegation configured-provider proof,
actual T3 history-worker rollback/fork behavior, complete continued-session job
inspection after reload/reopen and broader
final normal CLI acceptance. The SDK filesystem tests prove the library boundary,
not actual T3 rollback. Local permission/ledger tests do not prove rendered human UI.

Observed harness fixes: the parent/connector share an explicit scoped native
history home rather than writing the default Claude directory. Safe wire projection must handle string user
content instead of calling .filter on it; otherwise failure export silently vanished.
The tap now allowlists a few additional descriptor-free launch-error categories.
No prompts/config/token-bearing argv values are exported. Raw scoped runtime/model
state is removed by the harness. Proof is in proof/composition/observed.

Values unchanged: existing one-owner, truthful observation, durable source identity,
real human controls and no-secret-descriptor principles cover this work. The new
recipe and exact remaining acceptance boundaries belong here, not another value.

The driver reached actual reload/reopen after Stop before the cancellation failure;
The historical reloaded-view screenshot was retired; the protocol conclusion remains (see [artifact retirement](../quality/protocol-artifact-retirement.md)). Full continuing job/lifecycle parity did not pass.

Actual native replay command (PROOF_OUTPUT must be new):

    BRUV_CONNECTOR_EXECUTABLE=$PWD/dist/bruv-claude-compat \
      BRUV_RUNTIME_BINARY=/home/tnfssc/Code/bruv/dist/bruv \
      PROOF_OUTPUT=$PWD/.cache/composition-proof-final FIXTURE_PORT=18797 \
      /usr/bin/node scripts/claude-native-acceptance/run.mjs

## Native app-worker resume — 2026-10-04

[App-worker policy](app-worker.md) now uses ordinary CLI profiles, a distinct native normal instance/role/depth and exact model/reasoning. [Actual focused proof](proof/native-app-worker/README.md) records real native child UI/status/result ACK/cancellation and a still-failing root-settlement/automatic-continuation run. Do not upgrade this to full composed acceptance. Source/compiled regression checks pass; parent TaskBinding/Live/Stop/cancellation fixtures were preserved. No packaging/unbundle/release/T3 edits.
