# External T3 setup (paired Bruv connector)

This is packaging preparation, **not native parity acceptance**. Integrate this
branch only after unchanged-upstream acceptance. Composition may currently reject
settings/control flags; never strip T3 flags or patch T3 to force readiness.
Ordinary bruv remains the terminal agent and child runtime. bruv-claude-compat is
only the native Claude-compatible stdio entry.

## Install and start T3 yourself

Reviewed official [README](https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/README.md)
and [Claude provider setup](https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/docs/user/providers-claude.md):
revision fed41fa88bb27cb4325cb208d571393850bc63c2, release
v0.0.46-nightly.20261003.2623. Actual official t3 --help was inspected.
bruv web prints guidance only: no download, subprocess, settings writes or migration.

The official README offers https://t3.codes/install.sh and one-off npx t3@latest;
review and run these yourself, never a guessed package such as t3code. For the
reviewed version, obtain its CLI archive from [official releases](https://github.com/pingdotgg/t3code/releases/tag/v0.0.46-nightly.20261003.2623)
and verify SHA256SUMS. Run t3 --version and t3 --help on the environment machine.

Example for alice on Linux/macOS; replace ALL paths with actual absolute paths:

~~~sh
CLAUDE_CONFIG_DIR=/home/alice/.bruv/claude-compat-sdk \
  t3 --host 127.0.0.1 --base-dir /home/alice/.bruv/web
~~~

t3 starts the server and opens the browser. --no-browser disables opening;
t3 serve is the documented headless pairing command. Bind loopback by default.
Services/desktop backends must receive this environment too; a shell export
cannot alter an already running server.

## Add a separate instance; leave real Claude untouched

In Settings > Providers add a **Claude** instance named
**Bruv (native protocol, not Claude)** on the server/environment machine:

| Setting | Example absolute value |
| --- | --- |
| Binary path | /home/alice/.local/bin/bruv-claude-compat |
| CLAUDE_CONFIG_DIR path | /home/alice/.bruv/claude-compat-sdk |
| Environment: BRUV_CLAUDE_COMPAT_HOME | /home/alice/.bruv/agent |
| Environment: BRUV_CLAUDE_COMPAT_BRUV_PATH | /home/alice/.local/bin/bruv |

Leave launch arguments empty; T3 owns native launch/probe flags. Environment
assignments are NOT launch arguments. Do not put ~ or literal $HOME in UI paths.
bruv web prints paths from the current executable/home; remote instances require
paths on the remote machine.

**SDK alignment:** parent SDK list/resume/fork consults the SERVER process
environment. A provider-child CLAUDE_CONFIG_DIR alone is insufficient. Set BOTH
the server variable and instance directory to the same absolute isolated path
before creating threads. Launch desktop/service backends with that variable too.
Do not change HOME or point connector SDK storage at ~/.claude. Do not run Claude
login/logout, import/migrate histories, delete state or edit the real Claude instance.

## State and credential choice

Recommended for existing Bruv users: explicitly reuse ~/.bruv/agent with
BRUV_CLAUDE_COMPAT_HOME. This uses existing auth.json, models.json, settings.json
and agent resources rather than creating another secret store. Ordinary Bruv
continues owning provider authentication/settings. No secrets are copied into T3
settings, launch arguments, prompts or screenshots. Sharing is deliberate: shared
profile/settings edits affect both frontends. Existing CLI sessions/configuration
stay untouched, with no migration/deletion. Native SDK transcript/provenance state
belongs separately under ~/.bruv/claude-compat-sdk/projects; T3 owns
~/.bruv/web/userdata. Native acceptance must verify concurrent history ownership.

Subagent profiles are separately shared at ~/.bruv/subagents.json regardless of
the connector auth home. Host-managed remote/Live/task ownership is unchanged;
a separate agent directory does not promise isolation of every host resource.

For separate auth/settings/agent resources, omit BRUV_CLAUDE_COMPAT_HOME: the connector's
current default is ~/.bruv/claude-compat. Configure it with normal Bruv controls:

~~~sh
BRUV_CODING_AGENT_DIR=/home/alice/.bruv/claude-compat bruv
~~~

This intentionally requires separate authentication, without automatic secret
copying. SDK home stays ~/.bruv/claude-compat-sdk in either mode. Children use the
explicit normal Bruv executable, not another engine. Profile/resource inheritance
remains a native acceptance gate, not a packaging assertion.

## Genuine models and honest labels

Add custom models using exact **provider/id** from the configured Bruv registry
(for example openai/gpt-4.1 ONLY if that exact entry is configured). Select that
same genuine ID for chat AND auxiliary/title/branch/text generation settings.
Never leave built-in sonnet/opus aliases selected or silently remap them. Display
names are not model IDs. Verify native initialization and real provider usage.
Custom models may have fewer controls; unsupported settings/effort/permissions
must fail explicitly, never pretend success.

**Claude** is T3's SDK/protocol slot, NOT Claude Code, an Anthropic account or
subscription, or verified authentication. Health can indicate at most locally
configured readiness until provider access is proven. Do not use T3's Claude
install/login/update prompts for this instance. Rendered identity and health are
native acceptance gates.

## Build, install and manually update the pair

~~~sh
bun install --frozen-lockfile
bun run build                 # BOTH dist/bruv and dist/bruv-claude-compat; no T3 build
bun run install:local         # explicit opt-in; default ~/.local/bin; does not install T3
bun run smoke -- --reuse-build # packaging smoke, not parity proof
~~~

Local install stages/verifies both versions before replacement. Stop active
sessions first: replacing two executables is not a filesystem transaction.
Release targets ship matched binaries, individual .sha256 files, LICENSE,
THIRD_PARTY_NOTICES.md, generated THIRD_PARTY_LICENSES.txt and SOURCE.txt.
Both builds retain Pi/runtime asset preparation and accept the macOS native-helper
input; integrated Mac helper smoke remains a release gate. Linux Live still
requires its separate helper. Historical patched-web sources/proofs remain for
provenance, not startup; no T3 runtime/archive is required by final builds.

bruv update continues updating ONLY ordinary Bruv. Reinstall the matched pair
manually to update the connector; never masquerade as a Claude updater. External
T3 updates independently using t3 update or its original installer after reviewing
the version. Newer T3 requires unchanged-host native acceptance again.

Release CI explicitly downloads the pinned, checksum-verified official Linux T3
CLI for its external native gate; this test dependency is never a shipped asset.
The native acceptance runner covers only a subset of full product parity and
fails when bindings are missing. Parent acceptance still owns full SDK restart,
resume/fork, MCP permissions/questions, subagent/monitor identity, Stop/steering,
idle completion and Live/control rendering. Do not publish based on packaging smoke.
