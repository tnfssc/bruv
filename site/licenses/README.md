# Distributed notices

The build copies this directory into dist/licenses.

- bruv.txt: repository MIT notice (copied unchanged from root LICENSE).
- ghostty-web.txt: coder/ghostty-web MIT notice, fetched from https://raw.githubusercontent.com/coder/ghostty-web/v0.4.0/LICENSE on 2026-10-04. Runtime package pinned to 0.4.0 in site/package.json and site/bun.lock; the bundle includes its canvas renderer and Ghostty WASM loader.
- ghostty.txt: underlying Ghostty MIT notice, fetched from https://raw.githubusercontent.com/ghostty-org/ghostty/main/LICENSE on 2026-10-04. The shipped WASM is the unmodified ghostty-web 0.4.0 npm payload, not a local Ghostty build.

Bundled ghostty-vt.wasm SHA256: d6f0326f1874ad2ce9f289e3a4a0c5f3507d4cb38d8747e4b287def470a0c60a.

No fonts are redistributed; rendering uses installed system monospace fonts. Writing guidance sources have their own MIT provenance in wisdom/landing-page/writing-sources and are not copied to the static deployment.

Vesper theme colors: © 2023 Rauno Freiberg, MIT. `vesper.txt` contains the upstream notice. Source: https://github.com/raunofreiberg/vesper/blob/9043f3849b776949445f0cd4990365959cca35a3/themes/Vesper-dark-color-theme.json . Mapping colors to website roles is our adaptation, not an official ANSI palette.
