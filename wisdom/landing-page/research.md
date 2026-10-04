# Static Bruv landing/demo research

Researched 2026-10-04 with `~/.local/bin/tvly` search/extract; source inspection only, no site implementation or browser benchmark. Read [values](../values.md) and [README](../../README.md) first. Also read [clean product video](../task-placement/clean-product-video.md), [fixed UI video](../task-placement/fixed-ui-product-video.md), and [post-release correction](../task-placement/post-release-demo-correction.md).

## Recommendation

Ship semantic static HTML with a small, clearly labeled **scripted demo, not a live shell**. Make the whole pitch, install/docs links, and readable demo transcript available without JavaScript. Use ghostty-web only as an optional, user-started ANSI replay if terminal rendering adds value; do not make it the page or navigation. A short natural-work story should show a request, background work, an actionable question, and a result—not fixture diagnostics, raw tool JSON, or fabricated acceptance evidence. A scripted illustration must say it is scripted; a real capture must be frame-reviewed.

Keep the product claim aligned with README: **bruv CLI**, a Pi-based coding agent with background jobs, subagents, and project wisdom. External unmodified T3 is separately installed; `bruv web` gives setup guidance, not a bundled web app. Live audio is same-host opt-in, not browser microphone transport. Do not copy old `die` names/install snippets from historical demo wisdom.

## Actual ghostty-web: emulator ≠ shell

The relevant project is **[coder/ghostty-web](https://github.com/coder/ghostty-web)**, not native Ghostty, a browser inside Ghostty, or a similarly named sandbox. GitHub API reported main revision **1858a5947767a3e1c9e98dbf53b2ff87fedb2aab** during research; upstream links are mutable and a future build must pin its dependency.

- [README](https://github.com/coder/ghostty-web#usage): Ghostty's VT parser compiled to WebAssembly, a TypeScript API aiming for xterm.js compatibility, zero runtime dependencies, approximately **400 KB WASM**. That size is an upstream claim, **not** total transferred landing-page JS/fonts or measured load time. Do not claim compatibility with every xterm addon.
- [Architecture/feature notes](https://github.com/coder/ghostty-web/blob/main/AGENTS.md#wasm-integration-pattern): WASM owns ANSI/VT state, cells, cursor, scrollback, and key encoding. **TypeScript Canvas**, not native Ghostty's desktop renderer, paints the browser terminal. Notes list keyboard input, selection/clipboard, and FitAddon sizing. “60 FPS” is an upstream description, not our performance result; Unicode/font/mobile behavior still needs browser checks.
- A static host can deliver compiled JS + `ghostty-vt.wasm` and replay fixed data via `await init(); new Terminal(...); open(...); write(...)`. [Colors demo](https://github.com/coder/ghostty-web/blob/main/demo/colors-demo.html) is a browser-only example with FitAddon and no PTY requirement. Its source imports `.ts`: upstream uses Vite; copying that HTML onto a plain static server is **not** a production build.
- [WASM loader](https://github.com/coder/ghostty-web/blob/main/lib/ghostty.ts) resolves the WASM asset relative to its module and tries other paths; it fetches bytes before instantiation. Publish that asset at the resolved URL. Check deployed subpaths, asset response/CSP, initialization failure, and total payload; fixed replay needs no server process or SSR.
- The README wires `onData` to a WebSocket and incoming messages to `write`. **That transport and its PTY/shell are separate from the emulator.** WASM does not provide an OS shell, Bruv agent process, filesystem, model access, or provider credentials. Upstream `npx @ghostty-web/demo@next` starts a loopback HTTP server with a **real local shell** and token/origin protection; its hosted demo uses an ephemeral VM. Neither is evidence of a static live-shell service. Never expose that demo server as a public landing-page shortcut.
- [Terminal source](https://github.com/coder/ghostty-web/blob/main/lib/terminal.ts) adds textbox/input ARIA labels and a hidden textarea. This is input accessibility, not proof of an accessible terminal-output transcript. No screen-reader acceptance was performed; do **not** borrow native Ghostty accessibility claims or promise browser screen-reader parity. Keep an equivalent visible HTML transcript.
- [MIT license](https://github.com/coder/ghostty-web/blob/main/LICENSE): preserve copyright/license notice when distributing; review notices for the chosen package/WASM and fonts at build time.

### Compare the small demos

| Choice | Gives | Cost/limit | Best use |
| --- | --- | --- | --- |
| Semantic HTML `pre/code` or transcript list + ordinary buttons | Readable/selectable script, no-JS content, normal focus | Not a VT emulator; custom animation must remain optional | **Default landing hero** |
| Browser-only ghostty-web replay, like colors-demo | Actual ANSI/cursor/grid rendering; no backend needed | WASM/JS, canvas, asset loading, transcript equivalent and sizing work | Optional fidelity enhancement |
| ghostty-web + WebSocket + PTY | Real running shell/TUI | Backend hosting, authentication, isolation, process lifetime, quotas; public shell risk | Separate future service, **not static scope** |

## Static SEO and accessibility

- [Google JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics): Google can render JS, but not all bots can; server-side or pre-rendered HTML is still recommended. Put description, headings, transcript, title/meta description, and crawlable `a href` links in initial HTML. No bot-specific dynamic rendering needed. Recommendation: canonical URL, social preview, and sitemap once the public URL is known; never invent ratings or structured-data claims.
- [MDN canvas accessibility](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/canvas): canvas is a bitmap and drawn objects are not exposed like semantic HTML. Keep meaningful copy/transcript outside it; duplicate decorative replay may be hidden from assistive tech only when the HTML equivalent remains available. Do not announce every typed character through an ARIA live region.
- [WCAG keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html): Play/Pause/Replay/Copy must work with keyboard and visible focus; avoid grabbing focus or trapping Tab in a pretend shell. Use ordinary buttons and links. Prefer read-only replay to unsolicited terminal input.
- [Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html): automatically moving content lasting over five seconds alongside other content needs pause/stop/hide; auto-updating content has its own control requirement. Prefer click-to-play, no endless typing/cursor loop, and a final readable frame. Respect [prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion) with the static transcript.
- [Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html): ordinary text needs 4.5:1 (large text 3:1). Muted prompt/status colors still need contrast; never use color alone for working/waiting/failed. Keep mono text large enough and fit/wrap the HTML demo on narrow screens rather than shrink a fixed desktop grid.

## Visual references (two primary, one demo reference)

Official pages were extracted with tvly. The linked Charm share image, Warp code-panel image, and VHS artwork were also fetched and visually inspected; full rendered pages/animations were **not** browser-audited.

1. **[Charm](https://charm.sh/)** — terminal tools presented with personality and a clear product/link hierarchy. [Official share art](https://charm.sh/charm-share.6f7acd00931169c9.jpg) uses saturated violet/pink, a friendly star, and a cream wordmark. Borrow one lively accent and warm voice, not the mascot/assets or an all-monospace wall.
2. **[Warp](https://www.warp.dev/)** — current extracted page uses bracketed shortcut-like navigation, figure labels, and code examples. [Official API/CLI panel](https://www.warp.dev/img/factories-mono-explore/feature-03-api-cli-sdk-mcp.png) has a strong blue header, monospace code and quiet line numbers on a light surface. Borrow a framed, legible demo and clear section rhythm; not crowded operational metrics or product claims.
3. **[Charm VHS](https://github.com/charmbracelet/vhs)** — terminal GIFs defined as code; the repo provides demos and controls for dimensions, theme, font size, typing speed, and pauses. A reference for paced CLI demonstrations, not proof a scripted sequence ran successfully. Its inspected purple cassette artwork is branding, not a terminal screenshot. Prefer controlled video/replay with an HTML transcript over an unpausable GIF.

## Blockers and next checks

Research access worked. One exploratory extraction, `https://terminal.shop/`, failed to fetch; it is **not** used as evidence. No site/demo was built, deployed, or tested, and no bundle-size/mobile/clipboard/screen-reader guarantee is established. Static replay has no identified backend blocker. Real interactive Bruv needs a separately designed backend and must not ship credentials in browser assets. Before an optional ghostty-web enhancement: pin package/version, confirm deployed WASM URL, inspect narrow-screen frames, verify keyboard/no-JS/reduced-motion paths, and test the HTML equivalent with a screen reader. Before publishing install copy, recheck README/release status rather than imply the matched connector release is already available.

## Exact tvly commands run

Queries included broad discovery, then primary-source extraction. Native Ghostty accessibility hits from the first query were not applied to ghostty-web. No AI-generated search answer was used as evidence.

```sh
~/.local/bin/tvly search "ghostty-web browser terminal WebAssembly github API PTY accessibility" --depth advanced --max-results 7 --json
~/.local/bin/tvly search "site.developers.google.com search JavaScript SEO server rendered HTML canvas" --depth advanced --max-results 4 --json
~/.local/bin/tvly search "site.w3.org WAI pause stop hide animation keyboard canvas alternative content" --depth advanced --max-results 4 --json
~/.local/bin/tvly search "terminal inspired developer website Warp Charm VHS design" --depth advanced --max-results 5 --json
~/.local/bin/tvly search "site:github.com/coder/ghostty-web accessibility screenReaderMode limitations wasm init" --depth advanced --max-results 5 --json
~/.local/bin/tvly extract https://github.com/coder/ghostty-web https://github.com/coder/ghostty-web/blob/main/AGENTS.md https://charm.sh/ https://www.warp.dev/ https://terminal.shop/ --extract-depth advanced --format markdown --json
~/.local/bin/tvly extract https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html --extract-depth advanced --format markdown --json
~/.local/bin/tvly extract https://raw.githubusercontent.com/coder/ghostty-web/main/demo/colors-demo.html https://raw.githubusercontent.com/coder/ghostty-web/main/lib/ghostty.ts https://raw.githubusercontent.com/coder/ghostty-web/main/lib/terminal.ts https://raw.githubusercontent.com/coder/ghostty-web/main/LICENSE --extract-depth advanced --format markdown --json
~/.local/bin/tvly extract https://github.com/charmbracelet/vhs --extract-depth advanced --format markdown --json
~/.local/bin/tvly extract https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/canvas https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion --extract-depth advanced --format markdown --json
```

Supplemental read-only HTTP requests: GitHub `/repos/coder/ghostty-web/commits/main`, raw `lib/index.ts`, Charm/Warp page HTML, and the three official images inspected (including [VHS artwork](https://user-images.githubusercontent.com/42545625/198402537-12ca2f6c-0779-4eb8-a67c-8db9cb3df13c.png)). Wisdom added here only. Values unchanged: existing values 2 (honest proof) and 8 (real human/demo surfaces) already cover these findings.
