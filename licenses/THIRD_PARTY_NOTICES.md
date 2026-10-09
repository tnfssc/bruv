# Third-party notices

Bruv is built on Pi and includes third-party dependencies and the Bun runtime.
Those components remain subject to their own licenses; the project's MIT license
does not replace them.

Every release includes THIRD_PARTY_LICENSES.txt, a bounded, generated attribution
bundle containing the complete LICENSE, COPYING, and NOTICE files found in the
installed production dependency graph. It also reproduces the pinned Pi 1.1.0
license and Bun 1.4.2's upstream runtime and linked-library licensing notice.
The generator fails on an unrecognized package with no notice file so omissions
must be reviewed rather than silently reduced to package names or links.

The executable embeds Pi runtime assets. Highlight.js and Marked retain their
license banners, while the generated attribution bundle includes their full
packaged licenses and the licenses for the Pi packages that supply themes,
templates, artwork, and application code. Do not remove those notices or banners.

The Bun runtime includes upstream components under additional terms, including
JavaScriptCore/WebKit under LGPL-2 as described in Bun's reproduced LICENSE.md.
The upstream notice identifies source and relinking information. This material is
provided for attribution and transparency, not as legal advice or a guarantee of
license compliance. Review applicable obligations before redistribution.

Both paired executables carry the same runtime/dependency attribution. T3 Code is
an independently installed, unmodified external application, not a bundled Bruv
release component. Its own distribution supplies its licenses.

The browser terminal embeds JetBrainsMono Nerd Font Mono Regular (Nerd Fonts
3.5.1, JetBrains Mono 2.304), licensed under OFL-1.1. Its source, conversion,
copyright and icon notices live in third-party/jetbrains-mono-nerd-font and
are reproduced in THIRD_PARTY_LICENSES.txt. Only its WOFF2 container changed.

Browser buttons and fields use the selective native DOM CSS from daisyUI 5.7.47
(MIT). Bun bundles only button.css and input.css, without Tailwind, React,
or the full daisyUI stylesheet. The production dependency graph includes its
complete MIT license in THIRD_PARTY_LICENSES.txt.
