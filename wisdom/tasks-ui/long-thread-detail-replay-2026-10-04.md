# Saved detail replay after activity / upstream task-row integration

The isolated compiled normal CLI reproduced the full-CI failure on the merged connector checkout (base 08ad5558b28c689893b8f3831d5b6bd5ad73f563). It is not evidence of missing tool results or a regression in upstream SDK task ownership.

## What failed

Ctrl+O preserves the top visible component when groups expand. At 100×30, the collapsed viewport starts around saved turn 93. The failing frame contains the expanded group and real DETAIL_saved-93-* output, plus “Jump to latest message · End”; DETAIL_saved-99-9 is below the viewport. Waiting longer cannot bring it into view. This matches parent artifacts/ci/tests.log around 2622 and artifacts/external-pair-integrated-ci.log at 3022: both show turn 93 output and the End prompt, not absent evidence. The old SDK long-thread test predates grouping and also expected an individual success label while fullscreen groups were collapsed.

Keep the exact last-detail assertion, but use the current Pi keybindings: Ctrl+Home/Ctrl+End scroll the transcript viewport to its top/bottom; bare Home/End only move the editor cursor to the line start/end. With tmux 3.6a extended keys enabled and `extended-keys-format csi-u`, the existing test sent bare Home and never left the bottom viewport. Switching to Ctrl+Home/Ctrl+End makes the existing oldest-turn assertion pass; this was a fixture key choice, not missing session history or a production navigation regression. Wait for expansion, then Ctrl+End. Assert a standalone result row, not merely the same token in console.log source. Fullscreen collapse asserts the group header and absence of detail. The original individual label assertion now runs against the same journal through compiled --tui-mode regular, where per-tool collapsed labels still belong. Nothing is suppressed in production to satisfy the test.

The regression also reopens a fresh CLI process with tmux respawn-pane (avoiding the observed last-session / exit-empty server teardown race), opens both oldest and newest tool results, collapses again, retains editor drafts, resizes to 48 columns, and verifies all 2,101 saved messages / 1,000 original result bodies after replay. No sleeps or deadlines were increased.

## Separate concrete production problem

ActivityController still repeatedly searched arrays for group ownership and removed children. The new deterministic regression observed 501,500 indexed child reads to sync 1,000 tools. Rebuild a tool→group map and child membership Set each sync; reuse the previous map to preserve expansion by component identity; enumerate user fallback positions without indexOf. Child projection/mouse lookup is constant-time, removed tools are restored, and disposal clears the map.

The regression bounds sync child reads at 2N and group member reads during collapsed render at 8N. Upstream sdk-task-rows renderRows indexing and onOwnedTasks remain untouched. Its existing once-per-parent ownership/snapshot checks and late-task group protection still pass. This removes these quadratic activity lookups, not the separate linear cost of native whole-document layout or selected-branch loading; it does not claim virtualization or bounded-history materialization.

## Proof / handoff

See [retained evidence](evidence/long-thread-detail-2026-10-04/REPORT.md). Isolated artifacts remain in this worktree under artifacts/detail-*.log and artifacts/tui/bruv-long-thread-*.

Bun 1.4.2 (744846f84), TMPDIR=/var/tmp, local frozen-lockfile install, normal + connector build via bun run build. Replay uses dist/bruv, temporary HOME/journal, offline mode and typed-but-unsubmitted drafts: no paid calls. No global install, native connector changes, release, or version edits. Parent owns full CI and final candidate assets after integration.

Earlier wisdom/sdk ownership terminal proof was valid before grouping; don't transplant its viewport assumptions into alternate-screen activity. Keep ordinary-mode label checks and real result-row checks alongside grouped navigation. Existing values stay the same: preserve evidence and use observed frames/work counts, not longer sleeps or broad compatibility fallbacks.
