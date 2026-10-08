# Shared GitHub installer and installation-first README

Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_201589fc
Branch: feat/shared-installer-readme
Base: accepted landing 641ae641. This changes install source/copy and README, not the terminal design.

## Source finding and publication prerequisite

Live GitHub API check on 2026-10-04: tnfssc/bruv's default branch is **develop**.
Its recursive tracked tree has only scripts/install-local.sh as an install shell script.
That raw file returns 200, but builds a local checkout; it is not a release-download installer.
Both scripts/install.sh and site/install.sh on public develop returned **404**.

Moved the existing safe paired-release installer from site/install.sh to
scripts/install.sh, keeping its bytes identical (SHA256
40b41dd9d45956257065fc8bce907b7c0562d52531831f877b396f86726e0917).
Made the canonical script executable (755); the old tracked site script was 644.
No second maintained copy or static-build script copy remains.

Canonical raw URL:
https://raw.githubusercontent.com/tnfssc/bruv/develop/scripts/install.sh

Inspection URL:
https://github.com/tnfssc/bruv/blob/develop/scripts/install.sh

**Publication prerequisite:** scripts/install.sh must land on GitHub's develop
branch before the website/README install command is published for use.
The new raw URL is not live yet; it returned 404 at this check. No push, merge,
deployment, downloaded command execution, or install into the user's home was
performed. A local commit/cherry-pick alone does not satisfy this prerequisite.

Separately, the latest-release API still reports **v0.16.2**, with the matched
bruv + bruv-claude-compat artifacts and SHA256 manifests for all four supported
platforms, plus LICENSE, THIRD_PARTY_NOTICES.md, THIRD_PARTY_LICENSES.txt and
SOURCE.txt. This corroborates prior live release-download evidence; asset listing
is not a fresh download/probe of each binary. Release readiness and script
publication are separate facts. The stale source-only-install warning was removed.

## Implementation and writing rationale

README and both landing views use the same exact curl command. Script opens the
GitHub source; fetch uses raw GitHub. install-command.ts supplies constants to
both website views. Tests compare the README command and source link, canonical
script location/mode, and absence of the old script/build copy. Removed origin,
subpath and BASE_URL installer metadata/fallback logic; BASE_URL still controls
SEO canonical/sitemap metadata. No-JS now shows a real fetch command and source
link even without BASE_URL. Clipboard/keyboard feedback remains unchanged.

Installer logic is unchanged: one pinned release tag, both mandatory executable
checksums before isolated-home probes, matched versions, notices, staging and
ordinary-failure rollback, no sudo or profile edits. Fixtures run in temporary
homes with mock releases/binaries, never live downloaded executables.

README starts with Bruv / “An opinionated coding agent.” / Pi, then installation,
platforms, install paths, provider configuration and updates. The behavior claims
link to actual src/prompts/system.md: act on clear requests, check rather than
guess, simple working changes, essential protections, fresh-start bias. Added
features support that category instead of turning the product into orchestration.
Applied the saved anti-slop skill/doctrine: removed product-label repetition,
generic feature-first opening, stale disclaimer and long duplicated shell block;
used concrete commands and mechanisms rather than prestige adjectives or slogans.
Kept source build/common commands, state paths, separate T3 installation and
exact accepted 2644 version, Live limitations and safety, release instructions,
licenses, and technical-doc links. All local README links were checked to exist.

## Validation and gaps

Bun 1.4.2 via an absolute path; did not trust/change this worktree's mise config.
Full site test command: 30 tests passed plus browser cell/scroll/navigation checks
with zero page errors (desktop 2,040 capture cells; mobile 390px 1,369 and 320px
1,044). Startup/no-flash, animated UI, touch/source, scrolling and no-JS remain
covered. Focused install tests: 9 passed; a final recheck also covers both no-JS
pages after removing the redundant JS command rewrite.

Browser copy proof uses an arbitrary loopback origin and /preview/bruv/ subpath:
both terminal and HTML clipboard values equal README's GitHub command; keyboard
copy/reset and 320px wrapping pass. GitHub source navigation is asserted in the
terminal hit action and HTML/no-JS link, not taken as live publication proof.
Updated historical install and regression browser evidence is recoverable at Git revision `baf2fcd5`. Opened mobile
terminal + HTML screenshots: wrapped command, source link and copy control
remain readable with no overflow.

sh -n, focused strict TypeScript (ES2023/DOM/Bun), Biome formatting and
git diff --check pass. Root CLI suite was not run: no CLI implementation changed.
Only Linux Chromium/touch emulation and mocked platform mappings were tested;
not native macOS/Termux installs, physical phones, Safari/Firefox or screen readers.
Test servers close themselves. No extra persistent preview was started; parent
preview 45339 was not stopped or restarted.

Values reviewed: current values already cover clear product purpose, a simple
single source, essential safety, truthful proof and complete handoff. No new
repeat lesson warrants a values.md edit.

## Parent integration

Integrated as 077a3c4f into /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_0f2604c1, branch feat/landing-copy-loop-polish. Preview remains http://127.0.0.1:45339/. Canonical raw URL was rechecked after integration: HTTP 404. It must be published on develop before this install command is released to users. No push, merge to the main checkout, or deployment was done.
