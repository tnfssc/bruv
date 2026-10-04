## Finding

**Keep Ghostty Web. No verified browser/WASM renderer exists in the checked upstream OpenTUI release.** React/Solid bindings do not remove the native dependency. Research only; I made no repository edits or documentation changes.

### Versions and architecture

Checked npm **`@opentui/{core,react,solid}` 0.5.14** and upstream commit **`de8dc97080e4c404d9018d9e6a485036aeaef7d2`**.

- Core owns retained renderables, Yoga layout, cell buffers, native diffing and terminal-protocol output.
- Zig builds a **dynamic native library**; the installed Linux artifact is `libopentui.so`. Optional packages cover macOS/Linux/Windows, x64/arm64 and Linux musl.
- JS calls native functions through **`bun:ffi`** or **`node:ffi`**. Current requirements: Bun ≥1.3.0; Node ≥26.4.0 with `--experimental-ffi`.
- React uses `react-reconciler` against Core renderables; `createRoot()` requires `CliRenderer`.
- Solid uses a universal custom renderer against Core renderables; `render()` accepts/creates `CliRenderer`.
- Published Core exports select Bun/Node implementations—**no browser implementation**.
- Bundled `.wasm` files are Tree-sitter grammars, **not the renderer**.

Primary sources:

- https://opentui.com/docs/getting-started/runtime-support
- https://opentui.com/docs/core-concepts/rendering-pipeline
- https://opentui.com/docs/bindings/react
- https://opentui.com/docs/bindings/solid
- https://github.com/anomalyco/opentui/blob/de8dc97080e4c404d9018d9e6a485036aeaef7d2/packages/core/src/platform/ffi.ts
- https://github.com/anomalyco/opentui/blob/de8dc97080e4c404d9018d9e6a485036aeaef7d2/packages/native/build.zig
- Version endpoints: https://registry.npmjs.org/@opentui/core/latest — https://registry.npmjs.org/@opentui/react/latest — https://registry.npmjs.org/@opentui/solid/latest

### Browser claims versus proof

A Zig-to-WASM port is **speculative**, not a supported build switch demonstrated by upstream.

Two misleading search hits:
- https://opentui-browser.dev embeds a browser **inside a native OpenTUI application**, not OpenTUI inside a browser.
- https://opentui.vercel.app explicitly identifies itself as an **independent shadcn/React web experiment**, with Zig/WASM “parked future runtime research.”

OpenTUI does support custom terminal transports, but running its native producer behind a browser would require a backend—outside this landing page’s static/local-WASM contract.

### Commands and concrete results

Help inspected first:
```sh
tvly --help
tvly search --help
tvly extract --help
```

Research:
```sh
tvly search "site:github.com/anomalyco/opentui browser wasm" \
  --max-results 6 --json -o /tmp/opentui-tvly-browser.json

tvly search "OpenTUI WASM browser port renderer" \
  --max-results 8 --json -o /tmp/opentui-tvly-wasm-port.json

tvly extract \
  https://opentui.com/docs/getting-started/runtime-support \
  https://opentui.com/docs/core-concepts/rendering-pipeline \
  https://opentui.com/docs/components/scrollbox \
  --json -o /tmp/opentui-tvly-docs.json
```
All exited 0; extraction returned all three pages, no failed URLs.

Also ran a bounded direct-browser bundle probe in **`/tmp/opentui-browser-probe-FsROht`**, using installed Bun 1.4.2:
```sh
bun install                         # pinned @opentui/core@0.5.14
bun build probe.ts --target browser --outdir out
```
Entry imported/called `createCliRenderer()`. Install succeeded; **build exited 1**, rejecting browser polyfills for `node:url.fileURLToPath` and `node:os`’s default export. Published code also loads `node:ffi`. This proves the direct published entry failed to bundle—not that a future port is impossible. No successful browser runtime was claimed.

### Useful ideas for the current Ghostty implementation

From https://opentui.com/docs/core-concepts/renderer and https://opentui.com/docs/components/scrollbox:

1. **Demand-driven, coalesced paint:** combine wheel/touch/hover/resize invalidations into one scheduled frame; avoid a permanent animation loop.
2. **Fractional scroll accumulation:** OpenTUI retains sub-row remainder before integer movement. Applicable to the initially inspected sign-only wheel handler and row-threshold touch handling.
3. **Resize preserves state:** recompute geometry and clamp scrolling without recreating route/content state.
4. **One committed geometry:** drawing, image clipping and hit testing should share the same viewport/cell bounds. Preserve the existing compositor contract.
5. **Skip unchanged work:** viewport culling and dirty-state rendering are transferable ideas. Avoid resizing the image canvas backing store on every ordinary repaint; reserve that for actual size/DPR changes.

These fit the read wisdom constraints: real ANSI/WASM terminal content, raster-only inline images, static deployment and semantic HTML fallback—**no migration or DOM imitation**.