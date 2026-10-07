# External T3 setup (paired Bruv connector)

Use the actual native bruv-claude-compat executable with separately installed,
unmodified T3. Ordinary bruv remains the terminal agent and delegated-child
runtime. No T3 runtime/assets are fetched, bundled or installed by Bruv.
Packaging alone is not native parity acceptance.

## Start official T3 normally; check history-fix availability

Install official T3 desktop or web separately from
[upstream releases](https://github.com/pingdotgg/t3code/releases); verify the
published checksums. Open the desktop application normally, or run `t3`
for web. **No custom T3 command arguments or parent startup environment are
part of Bruv setup.** `bruv web` only prints this guidance: no downloads,
subprocess, settings writes or migration.

Full UI-only native history assumes the **upstream provider-scoped SDK history
fix**: T3 must run its filesystem history/fork and child-history lookup with the
selected provider's homePath/environment. Confirm that fix is actually available
in your installed T3 build; no release containing it is established here.
Official **v0.0.46-nightly.20261004.2644** (source
`737993303d36e10674c54b95e5bd3826682c99c7`) does not include it.
[Earlier 2644 proof](proof/official-2644/README.md) used parent-home alignment and
is **not full UI-only proof**. Old 2623 also reproduced an upstream Effect race.
Different/newer hosts still require native acceptance; version alone is not a
capability check and Bruv does not block basic chat by a guessed T3 version.

On pre-fix hosts, basic chat/UI history may work. Native fork can fail in T3's
SDK filesystem call **before the connector starts**. Bruv cannot catch that
failure or guarantee graceful upstream handling; T3 may show only a generic
turn failure. Do not change T3's parent environment, global environment, HOME,
or ordinary Claude state to work around it. No silent fallback or synthetic fork.

The connector now advertises an explicit supported protocol profile:
`--version` returns `2.1.280 (Bruv compatibility; bruv <product version>)`;
`--bruv-version` returns exact `bruv-claude-compat <product version>`.
SDK init's `claude_code_version` is the protocol version; `bruv.version` is
Bruv's real version. Normal `bruv --version` is unchanged. This supersedes the
past decision not to advertise a compatibility version. It is not an Anthropic
auth/account/model claim. T3's update button is supported when it invokes the
configured Bruv connector's `update` command: it updates Bruv, not Claude. A
latest-version update notice is separate from the unsupported range warning;
local readiness still does not prove provider access or full parity.

Observed on unchanged official 2644: the **Unsupported version** warning is
absent and chat with an exact custom model succeeds. T3 still shows a latest
Claude update notification and a built-in Sonnet 5.5 minimum-version advisory
(2.1.284). These are not Bruv custom-model/auth requirements. The connector
update now updates Bruv only; do not claim it removes all host banners. See
[bounded version/defaults proof](proof/version-defaults/README.md).

## Add a separate instance; leave real Claude untouched

In Settings > Providers add a **Claude** instance named
**Bruv (native protocol, not Claude)** on the server/environment machine:

| Setting | Example absolute value |
| --- | --- |
| Binary path | /home/alice/.local/bin/bruv-claude-compat |
| History homePath / CLAUDE_CONFIG_DIR path | /home/alice/.bruv/claude-compat-sdk |
| Optional override: BRUV_CLAUDE_COMPAT_HOME | /home/alice/.bruv/agent |
| Optional override: BRUV_CLAUDE_COMPAT_BRUV_PATH | /home/alice/.local/bin/bruv |

Minimal setup is **binary path + SDK history home + exact custom model**. The two
BRUV environment values default to the ordinary user's Bruv auth home and normal
installed executable (or its sibling); no username is hardcoded. Keep provider
homePath explicit: upstream parent-side history/fork calls need it too.

Leave launch arguments empty; T3 owns native launch/probe flags. Environment
assignments are NOT launch arguments. Use absolute binary/history UI paths, not ~ or literal $HOME. The connector
expands only ~ and ~/ in the two optional BRUV overrides (including paths with
spaces), not shell variables or ~otheruser.
bruv web prints paths from the current executable/home; remote instances require
paths on the remote machine.

**Corrected upstream contract:** provider homePath scopes the connector child and
T3-owned SDK history operations; the provider environment is instance-local.
Do not set a server-level CLAUDE_CONFIG_DIR, change HOME, or point this history
home at ~/.claude. No Claude login/logout, histories import/migration, deletion,
secret copying or global settings changes are part of setup.

## Connector-owned local admission and failures

Native stream mode (including T3's no-persistence health probe) requires the
explicit absolute history homePath above. The connector verifies an existing
writable directory/ancestor without creating history, refuses ordinary ~/.claude
and symlinks into it, and returns an actionable setup error for missing/invalid
home. This reduces false local readiness; it cannot verify T3 parent scope or
whether upstream history code is fixed. Stateless auxiliary JSON mode does not
require a native home.

Choose an exact provider/id in T3 for **both chat and auxiliary/title generation**.
When the host omits the model (including an empty model that the SDK does not
forward), only an explicitly configured default in the selected Bruv home's
settings is accepted. The connector no longer picks the first authenticated
model. Unknown/alias/empty explicit model, missing selected/default model, and
missing local auth fail before native-history/session allocation or injected MCP
connection, model requests and tool execution. Configure auth using ordinary Bruv
in the explicitly selected home, never T3 Claude login. Provider access remains
unverified until a real request succeeds; available models/readiness are local
facts only. Startup failures exit nonzero with actionable stderr diagnostics;
protocol control errors remain errors, not fabricated successful results. T3 may
render only a generic failure rather than relay that diagnostic.

## State and credential choice

Default for existing Bruv users: reuse homedir()/.bruv/agent without setting
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

For separate auth/settings/agent resources, explicitly override
BRUV_CLAUDE_COMPAT_HOME=/home/alice/.bruv/claude-compat. Configure that directory
with normal Bruv controls:

~~~sh
BRUV_CODING_AGENT_DIR=/home/alice/.bruv/claude-compat bruv
~~~

This intentionally requires separate authentication, without automatic secret
copying. SDK home stays ~/.bruv/claude-compat-sdk in either mode. Children use the
normal Bruv executable (optional BRUV_CLAUDE_COMPAT_BRUV_PATH override), not another engine. Profile/resource inheritance
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

**Migration:** new install/update checks use `--bruv-version`. The thin launcher
includes a narrow bridge for the old 0.16.3 updater: only its staged canonical
`--version` probe inside `.bruv-update-*` returns the old product label derived
from the staged normal binary. After installation, `--version` advertises protocol
compatibility. Frozen 0.16.3 migration, checksum and rollback tests passed. Do not
configure T3 to run from an updater staging directory. This replaces the earlier
manual-reinstall-only plan; no checksum or replacement checks are bypassed.

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
for rollback/recovery and same-version repair.

### T3's Claude update button on the Bruv connector

With the paired install configured as above, `bruv-claude-compat update` and
`bruv claude-compat update` use **the same normal `bruv update` path**. The
button can therefore update both Bruv siblings with the normal official-asset,
SHA256, version, repair and rollback checks. No PATH Claude updater is spawned,
no Claude/T3 is installed, and no T3 settings change is needed. Fresh paired
installs carry this behavior in their own files; no machine-specific shim is
required. Both entries accept only no arguments, `--check`, or `--help`/`-h`,
just like the normal updater. Mixed stream flags and other arguments fail.

**A real Bruv update may still leave T3 saying unchanged/outdated.** T3 compares
our protocol compatibility version against latest Anthropic Claude, not the
Bruv product version. Updating Bruv does not promise to change that protocol
identity or dismiss the prompt. Check `bruv --version` and connector
`--bruv-version` for the real installed product versions and read the updater
result; do not keep retrying just to clear the notice. Stop active Bruv/T3
sessions before updating; **restart T3 after the update**. If the button cannot
run while sessions are stopped, use the connector command in a terminal.
Source Bun invocations refuse self-update; split/custom layouts require a
manual matched-pair reinstall. Never replace the connector with real Claude
just to silence a Bruv provider's prompt.

External
T3 updates independently using t3 update or its original installer after reviewing
the version. Newer T3 requires unchanged-host native acceptance again.

Existing release CI uses a checksum-verified official 2644 Linux CLI and earlier
bounded native scripts. Those historical gates used parent-home alignment and
**do not certify this UI-only contract**, including native fork. A final release
requires the parent to verify a T3 build containing the provider-scoped history
fix and test normal-launch provider-instance setup with the final paired binaries.
Packaging smoke and older bounded gates cannot substitute for that acceptance.
This change does not publish, upgrade T3, or promise a fixed upstream release.

## Known limitations and safe defaults

- Stop prevents a pending execute approval's side effect, but upstream leaves its
  cancelled card visible, even after reload. **Explicitly Decline the stale card**
  before continuing; do not approve it or claim automatic cleanup.
- The explicit 2.1.280 compatibility profile addresses the supported-range check.
  T3 may still offer a latest-Claude update even after the connector's paired
  Bruv updater succeeds. The button updates Bruv, not Claude; see above.
  Real Bruv version remains separately inspectable; no Anthropic auth claim.
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
