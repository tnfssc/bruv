# Browser terminal website research

2026-10-04. Current intent: an actual browser terminal renders the website; navigation stays local to a static website. An equivalent semantic HTML text view uses the same content. Historical recommendations for a DOM-only grid or embedded replay in the existing landing notes do not govern this revision.

## Source and method

Used the installed tvly CLI for search and primary-source extraction, then checked raw implementation files. GitHub source paths are **lib/**, not src/ (the initial src/ extraction targets were incorrect). Pinned coder/ghostty-web revision: **1858a5947767a3e1c9e98dbf53b2ff87fedb2aab**; its package.json says **0.4.0**. This is inspected source, not proof that a particular npm tarball or deployed site works.

Sources below are commit-pinned:
- [Public exports and init](https://github.com/coder/ghostty-web/blob/1858a5947767a3e1c9e98dbf53b2ff87fedb2aab/lib/index.ts)
- [WASM loader](https://github.com/coder/ghostty-web/blob/1858a5947767a3e1c9e98dbf53b2ff87fedb2aab/lib/ghostty.ts)
- [Terminal implementation](https://github.com/coder/ghostty-web/blob/1858a5947767a3e1c9e98dbf53b2ff87fedb2aab/lib/terminal.ts)
- [Input handler](https://github.com/coder/ghostty-web/blob/1858a5947767a3e1c9e98dbf53b2ff87fedb2aab/lib/input-handler.ts)
- [Options](https://github.com/coder/ghostty-web/blob/1858a5947767a3e1c9e98dbf53b2ff87fedb2aab/lib/interfaces.ts), [FitAddon](https://github.com/coder/ghostty-web/blob/1858a5947767a3e1c9e98dbf53b2ff87fedb2aab/lib/addons/fit.ts)
- [Package metadata](https://github.com/coder/ghostty-web/blob/1858a5947767a3e1c9e98dbf53b2ff87fedb2aab/package.json), [MIT license](https://github.com/coder/ghostty-web/blob/1858a5947767a3e1c9e98dbf53b2ff87fedb2aab/LICENSE)
- [Canvas renderer](https://github.com/coder/ghostty-web/blob/1858a5947767a3e1c9e98dbf53b2ff87fedb2aab/lib/renderer.ts), [WASM API patch](https://github.com/coder/ghostty-web/blob/1858a5947767a3e1c9e98dbf53b2ff87fedb2aab/patches/ghostty-wasm-api.patch)

## Useful API findings (sent to renderer owner during research)

```ts
import { Ghostty, Terminal, FitAddon } from "ghostty-web";
const ghostty = await Ghostty.load(wasmUrl);
const terminal = new Terminal({ ghostty, cursorBlink: false });
terminal.open(container);
const fit = new FitAddon();
terminal.loadAddon(fit);
fit.fit();
terminal.write("Bruv website\r\n");
```


The public init() signature takes **no arguments**. For a deterministic static URL, use Ghostty.load(wasmUrl) and pass its result to Terminal's ghostty option. Do not invent init({ wasmUrl }).

Terminal supplies open(element), write(data, callback?), resize(cols, rows), cols/rows, onData, onKey, onResize, loadAddon, attachCustomKeyEventHandler, registerLinkProvider and dispose. FitAddon supplies fit(), proposeDimensions() and observeResize(). Fit to available space after fonts load and redraw the page when dimensions change. These are actual source APIs, not a claim of complete xterm.js compatibility.

## Static packaging

The package exports ghostty-web/ghostty-vt.wasm separately from its JS module. Its published-files list includes dist and the root WASM; build:wasm-copy also copies WASM into dist. Ghostty.load() defaults to a module-relative ../ghostty-vt.wasm, then relative/root guesses. Bundlers can change the module URL, so explicitly publish the selected package's WASM under the site's asset base and pass that URL to Ghostty.load().

The loader fetches an ArrayBuffer and instantiates it. No PTY, WebSocket, server shell, provider credential or agent process is needed to write fixed website content into a browser terminal. Compile TypeScript for the browser; copying upstream demo HTML with .ts imports is not a production build. Check the built asset URL on the actual deployment subpath and confirm it returns WASM, not an HTML fallback. Server-side execution and shared-memory cross-origin isolation are not prerequisites in this inspected loader.

## Mouse and keyboard

Enable ordinary press/release reporting plus SGR coordinates by writing ESC[?1000h ESC[?1006h. InputHandler pixelToCell converts pointer positions into **1-based** cells; encodeMouseSGR emits ESC[<button;col;rowM for press and lowercase m for release. Mode 1002 is button motion; 1003 is any motion. Click navigation only needs 1000+1006, not movement floods. The onData callback also receives keyboard and terminal response sequences: handle website navigation locally, never forward it to a PTY.

Important: disableStdin is checked in the shared input callback, so **disableStdin: true also drops mouse onData**. Keep input enabled if using mouse reporting and accept only the website controls you implement. Preserve browser Tab and other browser shortcuts; attachCustomKeyEventHandler can reject keys from terminal processing. Test real narrow-screen click coordinates and touch separately; source mouse support is not proof of a finished mobile flow.

OSC8 and regex links have built-in providers; custom registerLinkProvider is also available. Do not assume canvas links provide DOM keyboard or screen-reader semantics. The shared pages and links in site/content.ts must also become headings, paragraphs and anchors in initial/equivalent semantic HTML. The hidden terminal input textarea is not equivalent output accessibility.

## Images and licensing

No Kitty graphics, Sixel decoder, image-plane export or image-drawing path was found in the inspected browser renderer, types, loader or WASM API patch. The patch's Kitty references are keyboard/color operations, **not image support**. Native Ghostty image support does not establish browser ghostty-web support. Treat terminal inline images as unsupported for this implementation; use text gallery links that open a labeled HTML image viewer/original, with equivalent text-view links. This is source inspection, not a protocol conformance test.

Package and repository declare MIT, copyright 2025 Coder. Preserve the copyright and permission notice in distributed site artifacts. Review the actual shipped WASM and any bundled fonts/notices as part of packaging; the top-level license does not establish all third-party notices automatically. No payload-size, frame-rate or accessibility conformance claim is made here.

## CLI screenshots: safe options and existing provenance

Existing site/assets/delegation.png and wisdom.png are 1200×760 **concept illustrations**, generated from site/fixtures/captures.html with Playwright; social.png is a 1200×630 derived social asset. They use synthetic public text. site/README.md identifies Chromium 153.0.8010.12/Linux as their generation environment. The wisdom/landing-page/validation PNGs are screenshots of the old static website, not the CLI. Retain illustration labels; do not present these as current product screenshots.

Primary-source capture options checked through tvly:
- [VHS](https://github.com/charmbracelet/vhs): its tape command Screenshot path.png captures the current frame. It runs the tape's shell commands; use an isolated disposable directory/home, no credentials, no network or paid inference, and a simple approved command. A scripted take must be labeled; visually review the actual PNG.
- [termshot](https://github.com/homeport/termshot): prefixes a command, captures console ANSI output and renders a PNG. Documented example: termshot --filename capture.png -- "bruv --help". A help capture is a command-output rendering, **not evidence of the interactive TUI**. Do not use --edit to hide failures or private data after the fact; prevent them entering the take.
- [asciinema CLI](https://docs.asciinema.org/manual/cli/): records terminal output into asciicast data rather than a screenshot. It requires a separate renderer for PNG; there is no reason to upload a recording for this site.

Local command lookup found ffmpeg, but no vhs, termshot, asciinema or chromium executable on PATH. No capture tools were installed and no captures were made. A new live CLI take would require deliberate model/provider and privacy setup, so it was not a simple safe action for this content-only task. Historical wisdom/task-placement/fixed-ui-product-video.md documents approved isolated PTY-snapshot media, explicit binary hashes, fake inference and privacy audits; those old .die assets are not automatically current Bruv CLI screenshot provenance.

## Reproduce research

Commands used (all with --json and local output files, no generated answer used as authority):



```sh
tvly search "ghostty-web Terminal init wasm mouse image kitty sixel license" --depth advanced --max-results 5 --json
tvly search "site:github.com/coder/ghostty-web kitty image mouse wasmPath init" --depth advanced --max-results 5 --json
tvly extract https://github.com/coder/ghostty-web https://github.com/coder/ghostty-web/blob/main/lib/terminal.ts https://github.com/coder/ghostty-web/blob/main/lib/ghostty.ts https://github.com/coder/ghostty-web/blob/main/package.json --extract-depth advanced --json
tvly search "site:github.com/coder/ghostty-web kitty graphics sixel images support" --depth advanced --max-results 5 --json
tvly search "terminal screenshot CLI freeze capture VHS ttyd termshot asciinema screenshot" --depth advanced --max-results 4 --json
tvly extract https://github.com/charmbracelet/vhs https://github.com/homeport/termshot https://docs.asciinema.org/manual/cli/record/ --extract-depth advanced --json
```

GitHub tree/main verified actual lib/ paths. Full raw source files and the WASM patch were fetched at the pinned revision to check exact signatures and absence of image rendering. Search/extraction snippets alone were not used to invent APIs. Extracting GitHub blob URLs can include navigation chrome; raw source inspection supplied the decisive evidence.

## Scope and remaining checks

This task adds shared copy and research only. Renderer owner must check built WASM loading, terminal navigation, wrapping, resize redraw, mouse/touch, keyboard escape/Tab, equivalent HTML content and labeled gallery links. No browser runtime, deployed URL, screenshots, package or renderer changes were made here. Existing README/values and historical landing notes are unchanged; values 2 and 8 already cover honest source claims and human-facing acceptance.

## Integration follow-up

The parent implemented and browser-verified Ghostty Web 0.4.0 with explicit local Ghostty.load, copied WASM and real measured canvas hit testing (not onData mouse reporting). The separate capture worker obtained safe local settings/help captures from current source with an isolated HOME and network namespace; its recorded procedure supersedes the content worker's limited capture-tool lookup above. Real PNG/transcript provenance is in site/assets/cli-captures.md. The parent removed the old illustration assets and updated README/values; historical runtime evidence is recoverable at Git revision `baf2fcd5`.
