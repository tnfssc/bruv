# Illustrated T3 setup README (2026-10-04)

- Branch: `bruv/write-bruv-with-t3-code-readme-fd16c50c`.
- Worktree: `/home/tnfssc/.bruv/worktrees/t3code-2967b1c3-5442693331ce-task_fd16c50c`.

## Documentation intent

[User guide](../docs/t3-code/README.md) turns the current connector setup
contract into a short install-to-chat flow: paired installer/version checks,
ordinary Bruv auth, independent normal T3 startup, separate Bruv-named Claude
protocol instance, absolute binary/isolated SDK home fields, exact configured
custom and auxiliary model IDs, then a small real chat. Root README links it
early and replaces the stale parent-home alignment recommendation.

The guide distinguishes shared CLI auth home from SDK transcript home, forbids
parent/global home changes and Claude login/updater, and states official 2644
fork and stale-approval limits without promising an upstream fixed release.

The main agent owns genuine UI capture. Four relative image references are
placed by their setup steps; this task creates no screenshots. Sample form
fields and readiness are not evidence of provider access.

Technical ownership and proof remain in [external setup](external-t3-setup.md),
[UI-only admission](ui-only-admission.md) and
[connector version/defaults](connector-version-defaults.md); no duplicate
implementation record or code changes.

## Review and handoff

Documentation checks: exact installer command, four requested relative image
references, root/technical guide links, required setup fields and limits, and
`git diff --check`. Image files are intentionally left for the main agent to
capture/integrate; no UI or paid-provider acceptance is claimed by this edit.

Values reviewed; unchanged. Existing values on human ownership, honest rendered
evidence and durable handoff already cover this documentation task. No new
repeated lesson warrants another value.

## Main integration and screenshots

Integrated in /home/tnfssc/.t3/worktrees/bruv/t3code-2967b1c3 on
`t3code/document-bruv-t3code-setup-screenshots`. Four PNG captures are in
`wisdom/docs/t3-code/images/`. Captured the unchanged official Linux T3
`v0.0.46-nightly.20261004.2644` with installed Bruv 0.16.5 in an isolated
loopback session. 01 shows Claude protocol selection. 02 shows sample Alice
paths in Config, at a narrow viewport so the full paths stay visible. 03 shows
the exact model Add row. 04 shows the chosen instance/model in the real picker.
Images are direct browser captures, with dialog/section crops, not UI mockups.

Capture used temporary throwaway state at /tmp/bruv-setup-capture, not the
user's T3 or Bruv auth. Placeholder-only model readiness pointed to loopback
port 9; no paid model requests were sent. Health is not access proof. Browser
access tools were off, so shell Playwright captured the native UI. Use a clean
HOME and an allowlisted environment for future capture servers; inherited
T3 variables can enable Tailscale Serve even on a loopback test command.

Readme follows the observed Add provider > Claude > Next > Identity > Next >
Config UI and the exact CLAUDE_CONFIG_DIR path field label. It also links the
new readable bruv web terminal guide. Values unchanged: existing honest proof
and simple human flows cover this work.
