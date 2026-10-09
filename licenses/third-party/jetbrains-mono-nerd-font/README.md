# Browser terminal font

JetBrainsMono Nerd Font Mono Regular, Nerd Fonts 3.5.1, JetBrains Mono 2.304.
Official artifact: https://github.com/ryanoasis/nerd-fonts/releases/download/v3.5.1/JetBrainsMono.tar.xz
Archive SHA-256: 04d5e8f903693f9dd13e16f867e994834e681eb3c72c0d337a770dcda09010cf
Regular TTF SHA-256: f2a5ea6cfab397445ffab00c0370927b66d61e560a05db5db271b42006381c1a
WOFF2 SHA-256: 2b777374f6ba42c46919fb5f8bb1f607ccff116bf54d44c7a453ebeb70b794a8
Shipped WOFF2: 1,083,072 bytes. One face; no other weights or styles.

The patched font is OFL-1.1. Copyright 2020 The JetBrains Mono Project
Authors; Nerd Fonts copyright 2014 Ryan L McIntyre. OFL.txt and
NERD-FONTS-LICENSE retain their terms. UPSTREAM-README.md identifies the
icon sources. GLYPH-NOTICES.txt retains their additional notices.
Font Logos 1.3.0 has an Unlicense file at its upstream tag, despite the
Nerd Fonts README calling it unlicensed. Font Awesome Extension is covered
by Nerd Fonts' root MIT terms for files without an explicit local license.
Brand icons do not grant trademark rights.

Only the container changed. All 12,226 mapped code points remain, including
text and private-use icons. All nonzero glyph advances are 600 font units;
the official Mono face has isFixedPitch=1. No subsetting or glyph edits.

## Reproduce during development

Extract the official archive. In a temporary Python venv install
fonttools[woff]==4.60.1 and brotli==1.1.0, then run:

    from fontTools.ttLib import TTFont
    font = TTFont("JetBrainsMonoNerdFontMono-Regular.ttf", recalcTimestamp=False)
    font.flavor = "woff2"
    font.save("JetBrainsMonoNerdFontMono-Regular.woff2")

Compare the hashes above. The committed WOFF2 lives in src/web/fonts/.
Builds only copy those local bytes. They never fetch or convert fonts.
Release THIRD_PARTY_LICENSES.txt reproduces these notes and license files.
