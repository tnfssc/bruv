# Copyable download installer — 2026-10-04

**Current source:** [shared GitHub installer and README](shared-installer-readme.md) supersedes the local-origin/static-copy paths below. Installer safety logic is unchanged; the new canonical URL needs publication on develop.


## Intent and placement

Add the promised copyable install command to both the actual Ghostty terminal cells and semantic HTML, backed by a downloadable static script. Preserve Vesper, big Bruv title, top HTML action, startup flash fix, looping demos, accessibility and concise accepted copy. Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_50347bb3; branch: feat/landing-install-script. No merge, release publication or deployment. Existing parent preview 45339 remains untouched.

## Release finding and decision

Read README.md, scripts/install-local.sh, src/update.ts and release packaging. README's source-only warning is stale: the GitHub latest API and the actual releases/latest redirect both resolve to **v0.16.2**, published 2026-10-04T09:23:17Z. Assets include both normal Bruv and bruv-claude-compat for linux-x64, linux-arm64, darwin-arm64 and android-arm64, each with its own SHA256 manifest, plus LICENSE, THIRD_PARTY_NOTICES.md, THIRD_PARTY_LICENSES.txt and SOURCE.txt. SOURCE identifies commit 49379a1958ef41127799a166de8df8190f26c0f3, tag v0.16.2 and paired targets. Raw names, sizes, URLs, downloaded source notice and x64 checksum manifests: [live evidence](validation/install/live-release.json).

Decision: expose the real download install path, not an executable placeholder or silent source build. The page says Install Bruv and retains Source guide. No verbose release caveat added to the page. This is asset readiness evidence, **not a claim that a real downloaded executable was run or successfully installed**. Live binaries were neither executed nor installed; platform/runtime/version checks occur in the installer before replacing files.

## Implementation and safeguards

site/install.sh adapts the README artifact naming/notices and verified updater's pinned-tag, strict checksum filename, paired version and macOS helper-probe logic. POSIX sh detects supported uname targets and Termux arm64. It resolves latest once via HTTPS redirect and pins all asset requests to the resulting stable tag. Both hashes are checked before either executable's --version probe, with isolated HOME/XDG paths. Missing pair, bad checksum, unsupported platform or mismatched version fails clearly with the source guide. Four notices download before replacement. No root/sudo, automatic build or profile changes. User bin directory override remains BRUV_INSTALL_DIR.

Private same-directory staging, a single installer lock, original-file backups and exit/signal rollback protect ordinary replacement failures. Non-file/symlink binary targets and symlink notice targets are refused. Notices stage on their destination filesystem. If rollback itself fails, recovery files are retained and the error names their directory. This is not a crash-atomic transaction across two binaries; SIGKILL/power loss or a separate concurrent updater cannot be made atomic by two renames. Stop Bruv/T3 sessions before replacing a pair. Release notices currently have no SHA256 assets, so those are trusted through HTTPS at the same pinned tag; executable checksums are mandatory, not signatures.

The static build copies install.sh. install-command.ts derives a shell-quoted curl -fsSL URL from BASE_URL, or actual browser location (origin plus subpath) for preview. No invented production domain. HTML's no-JS relative download link works; after download its static command is sh install.sh if no canonical URL was configured. JS updates the command and reveals a keyboard-native Copy button. Terminal Copy uses real clipboard with selection fallback, Enter/Space and brief Copied feedback; top Install Bruv scrolls to this section rather than sending visitors to the old source-only guide. Mobile wraps the URL and retains the control.

## Checks and limits

Focused fixture tests use temporary isolated homes and mocked curl/uname/releases/executables: successful matched replacement + all notices; all four supported artifact mappings; single tag resolution; missing connector/notices; invalid filename/checksum (including connector checksum before either probe); mismatched connector version; failure on second rename restores old binaries and notices; unsupported/root rejection; sh -n. No user's home installation.

Browser tests check BASE_URL subpath and static script byte equality; actual served preview subpath command in both views; clipboard click and keyboard feedback/reset; 320px wrapping; downloadable script and no-JS/source links. Startup, semantic animation/reduced motion/transcripts, scrolling/cell rendering regression tests are retained. Evidence screenshots under validation/install/ were opened and reviewed: header unchanged, command readable, controls visible, no extra caveat or overflow. Chromium emulation is not physical macOS/Termux or Safari/Firefox runtime coverage.

Values reviewed: existing values for honest surfaces/proof, essential data-loss protection, simple ownership and complete handoff cover this work. No new repeat lesson, so wisdom/values.md is unchanged.

Final checks: full site test command passed **30 tests**, plus real-browser cell/scroll/navigation validation (desktop 1,972 checked capture cells; mobile 390px 1,369; mobile 320px 1,044; touch/source/no-JS/startup pass; zero page errors). Final installer recheck passed after Android-x64 rejection was tightened. Focused TypeScript check uses ES2023 (existing demos use findLastIndex). sh -n, formatting and git diff --check pass.

Handoff preview: **http://127.0.0.1:43941/**; script **http://127.0.0.1:43941/install.sh** returned 200 and byte-matched the worktree source. Preview job task_3477fc23 remains running. Parent preview 45339 was not stopped/restarted. Preview is not a production deployment.

## Parent integration

Integrated 90141a5d as ce7ba43b in /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_0f2604c1, branch feat/landing-copy-loop-polish. Kept the full mobile BRUV glyphs and the user-corrected opinionated coding agent pitch. Current combined preview is http://127.0.0.1:45339/ (and text.html); installer is /install.sh. Superseded worker previews were cancelled, not restarted.

18 focused tests passed after integration: page layout, installer fixtures/copy UI and delayed/failed/no-JS startup. Inspected integrated 390px hero and install screenshots. No live binary install executed. Values unchanged; existing installer safety and truthful evidence guidance apply.
