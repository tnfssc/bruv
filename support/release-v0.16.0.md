# v0.16.0

## External T3 integration

Bruv no longer bundles T3 Code. Run `bruv web` for setup steps; the command does not download or start a server. Use the tested official T3 nightly **v0.0.46-nightly.20261004.2644** with the new **bruv-claude-compat** executable in a separate Claude-provider slot. It runs Bruv, not Claude. See [setup](https://github.com/tnfssc/bruv/blob/v0.16.0/wisdom/claude-compat/external-t3-setup.md).

- Native steering keeps current tools running. T3 Stop ends the connector and its owned work.
- Bruv-owned subagents report real status and child history. Explicit T3-owned delegation uses scoped native child threads, without duplicate Bruv jobs.
- Saved questions, permissions, history reopen, fork and rollback preserve their ownership boundaries.
- The normal Bruv CLI remains available. Fullscreen tool history can roll up; assistant prose stays visible. This is not the full proposal #23.
- Includes the fast-mode and long-thread rendering fixes from v0.15.30.

## Install and update

Install **both binaries for the same version and platform**, side by side. New Bruv updates verify and replace the pair, with rollback on failure. Stop running Bruv/T3 sessions before updating. Upgrading with an older updater installs only Bruv: restart it and run `bruv update` again to obtain the matching connector, or install the pair manually. Custom split layouts need manual installation.

Keep T3 server and provider `CLAUDE_CONFIG_DIR` aligned to a separate Bruv SDK directory. Do not point it at real Claude state. Reuse existing Bruv auth only through the explicit setup setting; T3 readiness is not Anthropic authentication.

## Known limits

This is not full CLI UI parity. Local child status/history does not grant independent child steering or all child controls. Live audio requires opt-in and consent on the connector host; there is no browser-microphone transport or equivalent Live toolbar. Physical audio devices, paid providers, complete browser disconnect recovery, and native external-T3 execution on every cross-built platform are not claimed tested.

T3 may retain a cancelled approval card after Stop; choose **Decline** to clear it. Claude-version/update warnings remain visible: do not use Claude updater controls to replace Bruv. Official nightly 2644 passed focused native gates, but its unchanged Effect dependency still has a reproduced queue race; this release pin is not a claim that the upstream bug is fixed.
