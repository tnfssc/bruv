# External T3 setup (paired Bruv connector)

Use the actual native bruv-claude-compat executable with separately installed,
unmodified T3. Ordinary bruv remains the terminal agent and delegated-child
runtime. No T3 runtime/assets are fetched, bundled or installed by Bruv.
Packaging alone is not native parity acceptance.

## Install and start the tested T3 yourself

The supported tested target is **v0.0.46-nightly.20261004.2644**, official source
**737993303d36e10674c54b95e5bd3826682c99c7**. See the pinned official
[README](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/README.md),
[Claude provider setup](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/docs/user/providers-claude.md)
and [release](https://github.com/pingdotgg/t3code/releases/tag/v0.0.46-nightly.20261004.2644).
**Old 2623 is not an acceptable pinned target**: it reproduced an upstream Effect
queue race. 2644 passes bounded unchanged-host gates, but that dependency race
remains unfixed. No mandatory local T3 patch is recommended.

Download the official archive for your host and verify its published SHA256SUMS.
The unchanged **Linux x64** artifact used in acceptance is:

| Pin | Value |
| --- | --- |
| Archive | t3-0.0.46-nightly.20261004.2644-linux-x64.tar.gz |
| Archive SHA-256 | 5f9e29cf2712c87736556c99ea580606b399897cb846c2401a434a0d05c4eeca |
| Extracted t3 SHA-256 | 53fbd1c78ab3a01ea91913f65dc17b9d7824f00a81564e06992a73e183054e48 |

[Exact source/archive/executable proof](proof/official-2644/README.md) is the
provenance record; other platforms' native parity is not established by the Linux
proof. Keep the extracted directory intact (CLI, client and native dependencies).
Use the absolute path to its real t3 binary, or put that directory on PATH.
Run t3 --version (expected t3 v0.0.46-nightly.20261004.2644) and t3 --help.
Do not launch a research tap, synthetic fixture, Bruv as the T3 server, or an
unpinned npx t3@latest. Newer versions require unchanged-host acceptance again.
bruv web prints guidance only: no downloads, subprocess, settings writes or migration.

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
must fail explicitly, never pretend success. Do not strip T3 flags or patch the
host to force readiness.

**Claude** is T3's SDK/protocol slot, NOT Claude Code, an Anthropic account or
subscription, or verified authentication. Health can indicate at most locally
configured readiness until provider access is proven. Do not use T3's Claude
install/login/update prompts for this instance. Rendered identity and health are
native acceptance gates.

## Build, install and update the pair

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

bruv update now updates ordinary Bruv and its sibling connector together; use
bruv update --check for a read-only check. A compatible normal-only install gains
the connector. Split/custom layouts need manual paired reinstall. Stop active
Bruv/T3 sessions first and restart afterward. See [paired update](paired-update.md)
for rollback/recovery and same-version repair. Never masquerade as a Claude updater. External
T3 updates independently using t3 update or its original installer after reviewing
the version. Newer T3 requires unchanged-host native acceptance again.

Release CI explicitly downloads the pinned, checksum-verified official Linux T3
CLI for its external native gate; this test dependency is never a shipped asset.
The release gate composes the existing validated 2644 scripts, sequentially:
strict zero-model human command + idle; actual local child + same-root reply/idle;
permissions and saved questions (used-once resume); app-owned delegation completion
and cancellation; default steering/Stop/resume controls; then command/idle again.
Every suite must report passing unchanged-official evidence from the final paired
release binaries. The executable is rehashed between suites. Missing bindings or
failed gates fail publication; packaging smoke cannot substitute for them.

## Known limitations and safe defaults

- Stop prevents a pending execute approval's side effect, but upstream leaves its
  cancelled card visible, even after reload. **Explicitly Decline the stale card**
  before continuing; do not approve it or claim automatic cleanup.
- T3 may show unsupported connector-version/update banners. The connector reports
  its real Bruv identity/version; never spoof Claude auth/version to hide warnings.
  Local readiness is not verified provider access.
- Live is **off by default**. Optional same-host audio requires the provider
  instance environment `BRUV_CLAUDE_COMPAT_LOCAL_AUDIO_HOST=<exact connector hostname>`
  (get it on that host with `hostname`), plus explicit human consent per device
  action. It opens devices on the connector machine, **not the browser**. Never
  enable it on a remote/headless host expecting browser microphone transport.
  Linux needs its separate audio helper; macOS paired releases include the helper.
  Configure provider secrets securely in ordinary Bruv, never in a T3 message.
- Bounded deterministic gates do not prove devices/Live, paid providers, full tab
  disconnect or full cross-platform parity. The upstream Effect race remains
  unfixed despite the observed 2644 passes. Parent owns final build/full CI and
  remaining full-parity acceptance.
