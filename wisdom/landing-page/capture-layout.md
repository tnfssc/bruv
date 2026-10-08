# Historical capture layout

The real CLI settings transcript and its Ghostty-derived cells are historical evidence, not the current landing's terminal content. Current browser entries (terminal.ts, html-animation.ts and install-html.ts) render scripted demos; the old settings renderer survived only through tests and the asset-replay command. Keeping that pipeline beside current assets and landing assertions made the dependency easy to misread.

Keep the complete historical chain together in site/captures/settings/: source transcripts/screenshots, derived settings-cells.json, the reflow helper, fidelity tests and provenance. Keep replay/acquisition tooling together in site/scripts/captures/. The normal build does not need these captures; `bun run assets` regenerates the derived JSON only. The historical assertions run independently from current landing tests and retain source-hash, ANSI, style/glyph and reflow checks.

Checks run: `bun run assets`, `bun run build`, and `bun run test` from site/. The transcripts retain their recorded SHA-256 values: cli-settings.txt c0ffce1b2681a451bf29f071fe01fc1ea8a35d6c776256276b266c61f641301a; cli-help.txt ab8373fc52319b56d8d7102d34eee1cc89a03f008047875eb2e1709c341105c5. No capture was reacquired.
