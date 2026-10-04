# Bruv prompt glyph

bruv-prompt.woff2 contains only U+F460 (nf-oct-chevron_right), the exact idle prompt icon exported by src/ui/editor.ts. Subset from the installed MesloLGSNerdFontMono-Regular.ttf using FontTools pyftsubset --unicodes=U+F460 --flavor=woff2. Normal page text still uses the existing monospace stack.

The subset makes the private-use icon portable to browsers without Nerd Fonts. Nerd Fonts, Meslo and upstream Octicons license notices are shipped under ../licenses/. This is a glyph font, not a screenshot or image overlay.
