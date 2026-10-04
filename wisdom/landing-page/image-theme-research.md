# Image and theme research

Bounded source research by a read-only worker. The integration and browser probes are recorded in [vesper-hero.md](vesper-hero.md).

## Ghostty Web 0.4.0

Inspected the existing installation at:

```text
/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_be951855/site/node_modules/ghostty-web
```

Its `package.json` confirms **0.4.0**; inspected `dist/index.d.ts`, `dist/ghostty-web.js`, and compiled WASM exports.

**Kitty/Sixel are not implemented through this browser rendering path:**
- Published JS contains **zero** `drawImage`, `image`, or `sixel` occurrences. Kitty references concern keyboard encoding.
- WASM exposes 77 exports, none image/graphics-related; renderer receives cells/graphemes.
- [Pinned WASM handler](https://github.com/coder/ghostty-web/blob/1858a5947767a3e1c9e98dbf53b2ff87fedb2aab/patches/ghostty-wasm-api.patch#L625-L646) explicitly ignores APC start/put/end and DCS hook/put/unhook—the transport paths needed by Kitty graphics and Sixel.

**This does not make browser inline images impossible.** An application-owned DOM `<img>` or separate canvas plane can align images with reserved terminal cells. It is browser composition, not terminal graphics-protocol support.

### Exact usable APIs

[Renderer source](https://github.com/coder/ghostty-web/blob/1858a5947767a3e1c9e98dbf53b2ff87fedb2aab/lib/renderer.ts#L900-L909), also confirmed in installed declarations:

```ts
terminal.renderer?: CanvasRenderer
renderer.getCanvas(): HTMLCanvasElement
renderer.getMetrics(): { width: number; height: number; baseline: number }
renderer.charWidth: number
renderer.charHeight: number
terminal.cols: number
terminal.rows: number
terminal.getViewportY(): number
terminal.getScrollbackLength(): number
terminal.onResize // { cols, rows }
terminal.onScroll // number
```

Actionable placement:
- Anchor a clipped image plane to `getCanvas().getBoundingClientRect()`.
- Zero-based cell rectangle: `left=x*charWidth`, `top=y*charHeight`, `width=w*charWidth`, `height=h*charHeight`.
- These metrics are **CSS pixels**; do not substitute canvas backing-store dimensions.
- [Actual viewport semantics](https://github.com/coder/ghostty-web/blob/1858a5947767a3e1c9e98dbf53b2ff87fedb2aab/lib/terminal.ts#L837-L845): `0` means bottom; increasing values mean further into history; smooth scrolling can be fractional.
- **Avoid `buffer.active.viewportY/baseY`: both return constant zero** in [this implementation](https://github.com/coder/ghostty-web/blob/1858a5947767a3e1c9e98dbf53b2ff87fedb2aab/lib/buffer.ts#L138-L147).
- **Do not rely on `onRender`:** it is declared, but neither installed JS nor pinned source fires its emitter. Update the plane from application render/resize/navigation, with `onScroll` where applicable.
- Do not draw once onto Ghostty’s canvas: its renderer continuously runs. Prefer a separate plane; reserve blank cells and preserve interaction/accessibility separately.

## Official Vesper

Pinned upstream revision: **`9043f3849b776949445f0cd4990365959cca35a3`**.

[Official theme source](https://github.com/raunofreiberg/vesper/blob/9043f3849b776949445f0cd4990365959cca35a3/themes/Vesper-dark-color-theme.json):

| Role | Exact value |
|---|---|
| Editor background | `#101010` |
| Editor foreground | `#FFF` |
| Editor selection | `#FFFFFF25` |
| Orange/accent | `#FFC799` |
| Peppermint/string/additions | `#99FFE4` |
| Error/deletions | `#FF8080` |
| Muted/inlay foreground | `#A0A0A0` |
| Line numbers | `#505050` |
| Link/button hover | `#FFCFA8` |

**No explicit terminal ANSI palette or cursor colors exist in that source.** Any such mapping is an adaptation, not an official Vesper specification.

[License](https://github.com/raunofreiberg/vesper/blob/9043f3849b776949445f0cd4990365959cca35a3/LICENSE.md): **MIT, Copyright © 2023 Rauno Freiberg**. Preserve its copyright and permission notice when distributing copied theme material.

## Reproduction and limits

Used bounded `tvly search` queries and primary-source extraction, including:

```sh
tvly search "site:github.com/coder/ghostty-web kitty sixel renderer image" --depth advanced --max-results 3 --json
tvly search "site:github.com/raunofreiberg/vesper colors license" --depth advanced --max-results 3 --json
tvly extract https://github.com/raunofreiberg/vesper/blob/9043f3849b776949445f0cd4990365959cca35a3/themes/Vesper-dark-color-theme.json https://github.com/raunofreiberg/vesper/blob/9043f3849b776949445f0cd4990365959cca35a3/LICENSE.md --extract-depth advanced --json
```

Raw source resolved extraction ambiguity. **This research worker ran no browser image-plane prototype or protocol conformance test**; findings establish the shipped API/path and a feasible integration approach, not verified visual behavior.
