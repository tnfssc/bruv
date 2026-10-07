# T3 provider update prompt — 2026-10-07

User sees an update recommendation for Bruv. Clicking Update fails.

This checkout uses external T3. There is no bundled T3 patch to change here.
Installed T3 reports 0.0.46-nightly.20261005.2702. Its environment preference
enableProviderUpdateChecks is true. No settings were changed in this check.

The installed connector reports:
- --version: 2.1.280 (Bruv compatibility; bruv 0.16.13)
- --bruv-version: bruv-claude-compat 0.16.13

Upstream pingdotgg/t3code main was read on this date. ClaudeDriver.ts sets the
update package to @anthropic-ai/claude-code and native arguments to ["update"].
providerMaintenance.ts falls back to that native command for a custom executable
outside node_modules. It compares the parsed protocol version with the Claude
package version. This explains a wrong recommendation and an unsupported
connector update command. We did not click Update or reproduce a live mutation.
The installed nightly's exact source has not been matched to upstream main.

Do not bump the protocol identity just to hide this prompt. Forwarding update
cannot fix the Claude version comparison, but can make the requested update
action useful. The implementation below reuses normal bruv update.

The available environment tool has only a global enableProviderUpdateChecks
switch. Turning it off suppresses provider version advisories for all providers;
it is not the T3 desktop app updater. Ask before broadening a Bruv-only request.
A Bruv-only fix belongs in external T3's provider maintenance identity/opt-out.

Research child task_34a5a428 finished without edits. It confirmed existing
external-t3-setup.md and proof/version-defaults/README.md already recorded the
latest-Claude notice after the unsupported-range warning was fixed. Those notes
do not reproduce this click failure. The exact runtime error still needs care.
Next: get the user's choice about the global switch. No code/settings changed.
Values stay the same: existing identity and honest-proof lessons cover this.

## User constraint and implementation — 2026-10-07

User can change Bruv only. External T3 cannot change. Fresh installs on other
systems must work without changing a machine-wide T3 preference.

Keep the protocol version honest. Removing semver hides the latest lookup but
T3 can then call the version unknown or too old for its built-in models. That is
not a clean fix. Keep any such change out until there is real host proof.

Implement the other requested path: connector update reaches the existing
normal paired Bruv updater. No second updater, PATH fallback, Claude install,
or T3 settings writes. T3 may still report outdated/unchanged after a successful
Bruv update, since its comparison still belongs to Claude. Say that limit.

Implementation child task_53f15fa1:
- Worktree: /home/tnfssc/.bruv/worktrees/t3-1c4479b8-5442693331ce-task_53f15fa1
- Branch: bruv/route-connector-update-to-bruv-paired-up-53f15fa1
- Setup failed: shell could not find Bun. Worker has absolute Bun 1.4.2 path and
  shared dependency/asset paths for local checks. No real install is allowed.

Research child task_45b0e4f7 checks other honest per-instance options. Parent
will review and integrate source, tests and wisdom. Nothing is shipped yet.

Bounded installed reproduction: both bruv-claude-compat update --help and
bruv claude-compat update --help fail with [bruv-claude-compat] Unexpected
positional argument. These calls do not run an update or fetch a release. This
proves the connector rejects update syntax, not the user's exact T3 error.

## Portable research result

Research task_45b0e4f7 read upstream source at
365aa87982a4d81cc8e0c085e8d1a40ca7daecdc. It found no instance-local env switch
for T3's registry checks. The server-level enableProviderUpdateChecks setting
is the only inspected switch. DISABLE_AUTOUPDATER in the child env does not
control T3's own check.

Null semver suppresses the latest lookup, but ClaudeModelCatalog.ts hides
version-gated models and can emit an unknown/too-old model warning. Keep the
supported protocol identity; do not trade one wrong banner for another.

For ordinary standalone paths T3 invokes the configured connector with update.
For package-manager-classified paths it may choose an Anthropic package-manager
update instead. The official matched-pair install in ~/.local/bin avoids that
classification. This fix cannot control an updater T3 chooses without calling
Bruv. Root dispatch uses the normal compiled executable, not the wrapper, as
process.execPath. Reuse that path rather than invoking a second updater inside
a standalone connector with the wrong self-update target.

T3's providerMaintenanceRunner.ts reports unchanged if the compatibility version
still compares behind latest Claude, even when Bruv's own pair update succeeds.
These are source conclusions, not a reproduced desktop Update click.

## Integration checkpoint

The user rejected machine-specific/global changes. Implemented the useful
Update path as db67f86b. See connector-update.md for exact source and compiled
proof, fresh-dependency gates, installer-path caveat and worker workspace.
No T3 settings were changed. No release or real install update was performed.
The misleading notice is still an external-host limit, not silently fixed.
