# Bruv connector entrypoint and launch packaging

Current production target: unchanged official **v0.0.46-nightly.20261004.2644**,
not older 2623. See [active external setup](external-t3-setup.md) and
[official 2644 proof](proof/official-2644/README.md). The dated research/provenance
below is retained, not an active pin recommendation; the upstream Effect race
remains unfixed despite 2644 passing bounded gates.

2026-10-03; task_06e50aca. Implements a separately compiled, honestly branded
entrypoint. This is not final native T3 acceptance or permission to release/unbundle.
Read with [binary contract](binary-contract.md), [implementation plan](implementation-plan.md),
[parity gates](feature-parity-plan.md), and [checkpoint](implementation-checkpoint.md).

## Build and install shape

From a dependency-installed checkout containing the production runtime/frontend:

~~~sh
bun scripts/build-claude-compat.ts
# Optional: --outfile=PATH --target=bun-linux-x64 --live-helper=PATH
~~~

Default output: dist/bruv-claude-compat. The script runs the existing prepare-assets
(Pi host adaptation and normal runtime assets), not the web build. It rejects normal
bruv/bruv.exe output names and symlink outputs. It does not change package.json,
scripts/build.ts, src/cli.ts, dist/bruv, T3, release/install scripts, or web removal.
Native Live-helper packaging uses the existing plugin when explicitly provided;
this does not prove device/voice parity or cross-platform execution.

The connector is a compiled executable, not a shell wrapper and not a renamed
Claude binary. Ship it alongside the unchanged normal Bruv executable. The normal
binary remains the engine's executor/ordinary-child entrypoint: the connector's
restricted host flag grammar must not be used to launch CLI workers. By default
executablePath is sibling bruv; BRUV_CLAUDE_COMPAT_BRUV_PATH can choose an explicit
normal binary. Source launches need that override if Bun's directory has no bruv.
The production factory checks that helper exists; no Node/Bun install is needed to
run the compiled connector itself. Parent still owns actual install/release packaging.

Runtime bootstrap materializes the normal embedded Pi assets under connector state,
sets Bruv product metadata before dynamic Pi loading, registers Bun OAuth handlers,
and checks the pinned prepared Pi host. It does not install TUI startup hooks.

## Launch surface and state

~~~sh
/path/bruv-claude-compat --version
/path/bruv-claude-compat --help
/path/bruv-claude-compat --input-format stream-json --output-format stream-json \
  --model provider/exact-id --verbose --include-partial-messages \
  --permission-mode bypassPermissions --allow-dangerously-skip-permissions
/path/bruv-claude-compat -p --output-format json --json-schema '{"type":"object"}' \
  --model provider/exact-id --tools '' --disable-slash-commands \
  --strict-mcp-config --permission-mode dontAsk
~~~

Stream stdin/stdout are persistent NDJSON. No positional prompt, model work,
subscription lookup or fabricated account is needed for initialize. Readiness is
local configuration, not provider API access. Version is bruv-claude-compat plus
Bruv's own semver. T3 may interpret that semver using its Claude catalog: known
host warning/identity issue, not a reason to spoof a Claude version/model.

Auxiliary stdin is plain text (or one positional prompt); the real runtime performs
one isolated in-memory, tool-free model request and validates JSON against the
requested schema. Only its result envelope is written; verbose still permits one
envelope as the native consumer allows. Invalid schema/model output fails nonzero
with stderr diagnostics, never a success-shaped JSON placeholder.

Default state is ~/.bruv/claude-compat, override BRUV_CLAUDE_COMPAT_HOME. Models,
auth, settings and engine journals live there; BRUV_CODING_AGENT_DIR is explicitly
set before Pi/extensions initialize. Embedded assets live under its runtime/version.
No credential copying, old ~/.bruv/agent movement, or genuine ~/.claude history
reads/writes are performed. Configure connector credentials explicitly; the complete
root/child credential allowlist is still the isolation adapter's integration gate.
Do not deliberately point connector state at an existing normal or genuine-Claude
state directory. CLAUDE_CONFIG_DIR is not a history binding in this entrypoint.

--no-session-persistence passes an in-memory SessionManager to the runtime.
--append-system-prompt is repeated context, not a replacement Bruv identity.
--include-partial-messages controls projection of stream_event frames.
EOF and SIGTERM/SIGINT close the owning transport and await runtime.close exactly
once; teardown does not publish another turn after peer Stop. Signals exit 143/130.
Auxiliary plain-input EOF instead finishes the prompt, as expected. Session/Stop
semantics and descendant ownership remain the existing runtime's responsibility.

## Deliberate current rejections, not compatibility claims

arguments.ts recognizes the native T3 launch vocabulary, but assertLaunchBindings
fails before runtime startup for behavior without a bound implementation:

- session-id, resume, resume-session-at;
- permission-prompt-tool, restrictive/default permission modes, substantive
  allowedTools/disallowedTools; only explicitly opted-in bypass is live in stream mode;
- substantive injected MCP servers (empty mcpServers plus strict flag is accepted);
- tools selection in stream mode, stream disable-slash-commands;
- nonempty settings, all setting-sources selections, add-dir;
- effort, thinking, thinking-display, max-thinking-tokens.

Unknown flags and malformed formats/JSON fail. No successful ignore. Tool-free
auxiliary accepts tools='', dontAsk and disable-slash-commands because that runtime
actually disables tools and extension commands. Empty settings/tool allowance
lists contain no additional behavior. The current entrypoint does NOT pass the
complete T3 health argv: settings disabling hooks, setting sources and empty stream
tool selection still require real binding. The initialization probe below validates
the production engine's zero-model local init, not the full native T3 health call.

## Exact remaining parent binder work

1. Integrate runtime.ts/frontend.ts from task_1c3b7533 normally. This branch never
   owns/commits their temporary copies. productionRuntime in cli.ts uses actual
   createClaudeCompatRuntime exports and its model/emit/append/auxiliary/sessionManager/
   permissionMode/executablePath options. RuntimeFactory(options,args) is the launch
   injection/composition seam; no duplicate session/engine is introduced.
2. Bind task_7718ccb2's actual InjectedMcpSession and createPermissionPolicy from
   mcp.ts/permissions.ts at trusted tool registration/execution, plus its environment
   isolation work. Parse named config via parseInjectedMcpConfig, implement scopes,
   route SDK permission callbacks through this SAME ClaudeCompatTransport.request,
   register MCP control handlers, and close the injected MCP session with the owning
   runtime. Initialize health must not discover/call MCP or models. Support native
   hook/setting/tool selection semantics explicitly before removing their rejections.
3. Bind history.ts NativeHistory/importNativeHistory/nativeHistoryToPi from
   task_294a9ed0 into the canonical Pi manager and derived output. Native session UUID,
   resume and rewind flags must select real manager/cursor state; SDK filesystem fork
   and isolated CLAUDE_CONFIG_DIR need actual storage/environment binding. Remove
   session flag rejections only after native resume/fork tests prove the mapping.
4. Bind task_4f0c9326's actual task-projection.ts event/artifact lifecycle and
   task_c3d9990b's human-controls.ts/commands.ts at runtime/frontend/SessionHost ports.
   Human controls and permission requests need the bound transport request callback,
   not another framing/session layer. Merge their control handlers before run().
5. Effort/thinking/add-dir/settings need exact supported Bruv runtime semantics or
   stay explicit errors. Expose only truthful provider/id values; the fixed T3 model
   catalog/health badge/update UX remains the parent product-resolution gate.
6. Ship the paired normal/connector binaries without altering ordinary CLI roles or
   state. Run unmodified native T3 through full health, real MCP permissions, saved
   questions, resume/fork, worker/monitor steering/Stop and idle completion. Run normal
   CLI regression checks. Release, web removal, client audio and all parity decisions
   remain parent-owned and are not satisfied by these focused probes.

## Executed evidence and reproduction

Focused tests:

~~~sh
bun test tests/claude-compat-launch.test.ts tests/claude-compat-transport.test.ts
BRUV_CLAUDE_COMPAT_TEST_BINARY=$PWD/dist/bruv-claude-compat \
BRUV_CLAUDE_COMPAT_TEST_BRUV=/absolute/path/to/normal/bruv \
  bun test tests/claude-compat-compiled.test.ts
~~~

The compiled test is opt-in, skipped without BOTH paths. It uses a clean child env,
temporary HOME/state, synthetic fixture/fixture-model and loopback-only fake key;
no real credential/provider/subscription is involved. It validates own version,
production initialize with account={} and access_verified=false and ZERO model
calls; actual stream_event/assistant/result, SIGTERM teardown, plain schema
structured_output, unknown/unbound flag failures, and no normal agent/Claude state
creation. It accepts exactly three local fake-provider requests: completed stream and auxiliary,
plus an active root canceled on EOF before a successful result.

The local compile/probe used explicitly temporary runtime-owner source inclusion,
not an integrated parent build. Hash/provenance and checks are in
[launch probe record](proof/launch-packaging/local-probe.json). Those two source
copies and local dependency symlink are removed before commit. Parent must rebuild
from its bound committed composition; this binary is development evidence, not a
release artifact.

Wisdom values unchanged: explicit ownership, honest proof boundaries, preserving
state and one-way human authority already cover this work. No new general value
was needed.
