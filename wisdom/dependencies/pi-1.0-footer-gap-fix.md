# Pi 1.0 compact fullscreen footer reservation fix

Date: 2026-10-02. Worktree:
`/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_56d2a750`.
Branch: `bruv/fix-fullscreen-compact-editor-footer-gap-56d2a750`.
Base: `b608e45b7e9854130833f4602e336286fa7f1a5e`.
Worker owns code/tests/commit; parent owns review, integration, push and PR.
No version bump, global install, push or PR creation in this worker.

## Cause and seam

Pi's fullscreen chat viewport reserved at least three editor rows. CompactEditor
removes two native border rows, so an idle/short prompt rendered one row but
reserved three. Two-row wrapped input left one wasted row; three-row input did not.
Regular mode stacks actual rendered output and never used this dock reservation.

The maintained host adaptation now uses Pi's layout-node descriptor to find only
the editor slot, then makes its minSize a live getter. A sole CompactEditor child
explicitly opts in with the bruvCompactEditor marker: minimum one row. Native
editors, dialogs, and other replacement components retain Pi's minimum three.
Natural rendered height still measures wrapping, multiline and autocomplete.
Reading the active child on each layout matters: Pi reuses the dock while swapping
native dialogs and restoring the editor. A startup-only minimum would miss this.
No transcript ScrollView, layout grow/shrink policy, footer or renderer is replaced.

New guarded host file: dist/modes/interactive/chat-viewport.js. Exact Pi version,
original/adapted SHA-256, unique replacement anchors, result hash, idempotence and
validate-all-before-write remain required. The runtime gate also rejects an
unprepared viewport, including partial preparation.
Original hash: 77ff3d8a3f20950a95cc3b758ab04ee7cffdaba5a490a2390626e781ae30f70a.
Adapted hash: d8935ff445ff638165a4f11dba32eddea46191377894a8b644ee1511ef36e48f.

## Proof

- Frozen root dependency install and a fresh full CLI/web build pass. Build runs
  existing T3 graph/type/chunk/portable/archive checks; no old external web archive
  or verification bypass is used. Toolchain: Bun 1.4.2, Node 24.21.0, T3-selected
  pnpm 11.10.0 via an owned temporary Corepack wrapper.
- Focused built gate: **54 pass / 0 fail / 545 assertions**, eight files. Command:
  `bun test tests/fullscreen-editor.test.ts tests/fullscreen-editor-tui.test.ts tests/editor.test.ts tests/pi-host.test.ts tests/startup.test.ts tests/startup-tui.test.ts tests/conversation-density.test.ts tests/execution-previews-tui.test.ts`.
- Actual offline isolated tmux frames at 120x40 assert adjacency for default
  fullscreen and explicit regular: idle, short, two-/three-row wrapping, three-line
  paste, clearing/restoration, native /settings open/cancel. Fullscreen idle is
  prompt **row 39**, footer **row 40**; multiline is rows **37–39**, footer **40**.
  Empty quiet regular fixture is prompt row 2, footer 3 (header/startup content
  differs from the audit); its adjacency is unchanged. No provider turn is sent.
- Layout tests use the real Pi viewport/CompactEditor and 100 transcript rows.
  They verify follow-end, scrolling to start/end without moving the dock, editor
  growth/shrink, native border output, native minimum three, compact restoration.
  A temporary owned-dependency mutation restoring minSize=3 makes all three layout
  regressions fail. Adapted bytes were restored before the final passing gate.
- Root typecheck, whole-root format check (531 files), targeted lint (six files)
  and git diff --check pass. No assertions or guards removed.
- CLI SHA-256: f345e16f2c7b50fb6f284281bd382b40845798f0edd2033c70b6937921bb17b4.
- Web archive SHA-256: 278a7e5f75c4dfb206fca03aa40288984b810de8e07fadda4c88d9e10d3e93b5.

Visible frames (tmux capture with row-number prefixes, all 40 rows, no ANSI):
[fullscreen idle](evidence/pi-1.0/footer-gap-fix/fullscreen-idle.txt),
[two-row wrap](evidence/pi-1.0/footer-gap-fix/fullscreen-wrapped-two.txt),
[three-row wrap](evidence/pi-1.0/footer-gap-fix/fullscreen-wrapped-three.txt),
[multiline](evidence/pi-1.0/footer-gap-fix/fullscreen-multiline.txt),
[native settings](evidence/pi-1.0/footer-gap-fix/fullscreen-native-settings.txt),
[restored](evidence/pi-1.0/footer-gap-fix/fullscreen-restored.txt),
[regular idle](evidence/pi-1.0/footer-gap-fix/regular-idle.txt),
[regular multiline](evidence/pi-1.0/footer-gap-fix/regular-multiline.txt),
[regular native settings](evidence/pi-1.0/footer-gap-fix/regular-native-settings.txt).
Logs: /tmp/bruv-footer-{build,focused,check,format,lint,red}.log.

## Limits and next steps

Linux/offline focused validation, not the full deterministic root suite, macOS
hardware, or live/paid provider behavior. The initial validation attempts exposed
fixture/tool setup issues (fish PATH export, missing pnpm wrapper, double Ctrl-C
exit timing, tmux send-keys stripping multiline newlines); these were corrected
without product workarounds or weakened spacing checks. The final fixture uses
real tmux bracketed raw paste and isolated extended-keys/csi-u settings.
The outer interactive shell emits a mise trust diagnostic before per-process
trust is configured; actual build/check/test logs are clean. No global trust changed.

Parent should review/cherry-pick this commit, include its separate transferred
untracked footer-gap audit/evidence as desired, and own push/PR/release decisions.

Values unchanged: 7/8/9/10 already require the smallest real fix, visible-frame
proof, preserving intentional fullscreen behavior, and a durable handoff.
