# Ghostty browser WASM notices

The root terminal embeds ghostty-web 0.4.0's ghostty-vt.wasm. Its npm package
contains Coder's MIT license, but not the Ghostty or Unicode notices below.
The release generator includes these inputs with the package's license.

Reviewed sources:

- Coder ghostty-web: 9e4e126d89ac3537d2b2ebec075849851566de9f (v0.4.0).
  CODER-LICENSE is the npm package's MIT text. Coder's WASM API patch uses
  the same grant. scripts/build-wasm.sh applies that patch to the Ghostty
  submodule and builds lib-vt, wasm32-freestanding, ReleaseSmall.
- Ghostty: 5714ed07a1012573261b7b7e3ed2add9c1504496. GHOSTTY-LICENSE is
  its root MIT license. src/build/GhosttyLibVt.zig and GhosttyZig.zig build
  the terminal C ABI and generated Unicode tables. Config.zig turns SIMD
  dependencies off for WASM; GhosttyZig.zig turns Oniguruma off for lib-vt.
  This is not the desktop app or its font/rendering libraries.
- uucode: 31655fba3c638229989cc524363ef5e3c7b580c1, pinned in Ghostty's
  build.zig.zon. UnicodeTables.zig and uucode_config.zig generate the width,
  grapheme and symbol tables. UUCODE-LICENSE.md preserves Jacob Sandlund's
  MIT text; UNICODE-LICENSE is that revision's Unicode License V3.
  The uucode directory also preserves its referenced decoder and width
  reference notices. They are upstream attribution, not a claim that each
  reference implementation is linked into this WASM.
- Zig 0.15.2: ZIG-LICENSE is the MIT text for the standard library/runtime.
  Coder's build script requires 0.15.2+. The published npm package does not
  record its exact compiler version; this review did not rebuild the WASM.

Source files were read from raw.githubusercontent.com at those revisions.
The original notice texts are unchanged. This review is attribution, not
legal advice or proof of a reproducible upstream build.

Pinned WASM: 423,045 bytes; SHA-256
d6f0326f1874ad2ce9f289e3a4a0c5f3507d4cb38d8747e4b287def470a0c60a.

Update these inputs and review the build graph when the package pin changes.
