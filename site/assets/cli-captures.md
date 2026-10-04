# Real Bruv CLI captures

Captured 2026-10-04 on Linux, from current source, not an installed historical binary. These are browser screenshots of the actual Ghostty terminal emulator replaying CLI output. No application UI or model response was invented. Existing delegation/wisdom/social assets remain separate labeled illustrations (site/scripts/capture.ts, site/fixtures/captures.html, wisdom/landing-page/README.md); they were not replaced.

## Gallery captions

| Asset | Caption | Dimensions | Source |
| --- | --- | --- | --- |
| cli-settings.png | **Real CLI: local settings menu, no provider connected (terminal crop).** | 1140 × 370 | cli-settings.txt — unmodified PTY ANSI stream |
| cli-help.png | **Real CLI: command-line help (top of output).** | 1140 × 652 | cli-help.txt — complete unmodified stdout |

## Version and source

- Bruv reports 0.16.0 via --version.
- Source commit: 4b118e1c54d1005da1d0c7e1643dddd312173e5a; no root application edits.
- Built with Bun 1.4.2, scripts/prepare-assets.ts followed by scripts/build.ts. Existing installed root dependencies were temporarily linked; no download/install was performed. No optional native Live helper was included; neither screen exercises Live.
- Binary SHA256: a6a7a8f744eab36f7c62f66791bf357b829da8bd6ed22665989ffc237d27bb1a.
- Emulator: locally installed ghostty-web 0.4.0 (WASM terminal parser + canvas renderer).
- Screenshot browser: Chromium 153.0.8010.12, device scale 1; DejaVu Sans Mono 15px.
- Terminal: 110 columns × 36 rows, 20px screenshot padding, dark terminal palette.

## Commands

Run from the repository root with installed dependencies available. Set BUN to the direct Bun 1.4.2 executable, not an untrusted mise shim. The temporary dependency link is unnecessary when the checkout already has node_modules.

    "$BUN" scripts/prepare-assets.ts
    "$BUN" scripts/build.ts --outfile=/tmp/bruv-real-capture/bruv
    mkdir -p /tmp/bruv-real-capture/home /tmp/bruv-real-capture/workspace
    (
      cd /tmp/bruv-real-capture/workspace
      env -i HOME=/tmp/bruv-real-capture/home PATH=/usr/bin:/bin TERM=xterm-256color unshare --user --map-root-user --net /tmp/bruv-real-capture/bruv --version
      env -i HOME=/tmp/bruv-real-capture/home PATH=/usr/bin:/bin TERM=xterm-256color unshare --user --map-root-user --net /tmp/bruv-real-capture/bruv --help > /tmp/bruv-real-capture/help.txt
    )
    cp /tmp/bruv-real-capture/help.txt site/assets/cli-help.txt
    python3 site/scripts/capture-real-pty.py --binary=/tmp/bruv-real-capture/bruv --sandbox=/tmp/bruv-real-capture --output=site/assets/cli-settings.txt
    # Set package directories and browser to existing local installations.
    GHOSTTY_WEB_DIR="$GHOSTTY_WEB_DIR" PLAYWRIGHT_CORE_DIR="$PLAYWRIGHT_CORE_DIR" CHROMIUM_BIN="$CHROMIUM_BIN" "$BUN" site/scripts/capture-real.ts

The settings acquisition used an equivalent temporary Python PTY probe, now retained as site/scripts/capture-real-pty.py: launch CLI, wait 3 seconds, send the literal local command /settings + Enter, capture until 7 seconds, terminate idle process. It replies only to terminal cursor-position queries with ESC[1;1R. No chat/prompt was submitted and no settings were changed.

CLI ran with an empty environment except explicit terminal/home variables, inside a new **user + network namespace**, in a newly created empty workspace and synthetic HOME. No real HOME, provider credentials, projects, or user chats were read. Network namespace creation succeeded here; a host that denies unshare must not run this capture unsandboxed. Reuse only a disposable, empty sandbox: the script does not erase an existing directory.

The raw settings transcript retains only synthetic /tmp/bruv-real-capture/… paths in the startup warning. Neither screenshot contains a HOME path, personal path, credential or user data. Settings is an honest vertical crop: 282px removed from the top of the 1140 × 652 terminal screenshot (startup no-model warning and blank rows), leaving the local settings menu and status footer. It does **not** claim an authenticated/model-connected session.

Help stdout is replayed with LF converted to terminal CRLF (no content edits), then scrolled to the top of the 36-row viewport. The screenshot is an excerpt; full help remains in the text file. Long lines wrap at 110 columns as the terminal renders them.

Rendering serves only installed emulator files on loopback; browser requests to any other origin are blocked. No emulator dependency, runtime WASM, package change or capture fixture is deployed; only PNGs need be copied by the parent gallery renderer.

## Checks and limitations

- Both images visually inspected after emulator replay; PNG dimensions checked.
- CLI --version and --help exited successfully under network isolation.
- Settings is local-only: no model response, delegation, remote access or Live demonstrated.
- These are replay captures, not native desktop terminal photos; terminal palette/font/padding are presentation choices. Source ANSI and stdout are preserved, not restyled as hand-written HTML.
- Pixel output depends on fonts, Chromium and emulator versions. The CLI may use Nerd Font glyphs elsewhere; these crops do not depend on that optional font.
- Existing concept illustrations remain correctly labeled; real screenshots do not prove scenarios depicted in those illustrations.
- Wisdom/values read; no new general lesson or value change needed for this bounded capture task.

### Transcript SHA256

- cli-help.txt: ab8373fc52319b56d8a7102d34eee1cc89a03f008047875eb2e1709c341105c5
- cli-settings.txt: c0ffce1b2681a451bf29f071fe01fc1ea8a35d6c776256276b266c61f641301a

## Website integration

The completed site now uses its own pinned ghostty-web and playwright-core packages; capture-real.ts defaults to these scoped installations. PNGs, transcripts and this provenance file are copied into the static site assets. The separate website build also bundles its Ghostty runtime/WASM and licenses. The rejected concept illustrations have been removed.
