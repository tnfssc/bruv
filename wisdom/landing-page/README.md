# Landing page — one real terminal page

## Current contract

The visible main site is an actual Ghostty Web/WASM terminal, not terminal-themed HTML. The latest request is **one scrolling page**, with captures' **actual text and colors composed as terminal cells**. No multi-route app, section menu, gallery or raster screenshot plane.

Current work: [single-page cell captures](single-page-cells.md). Integration worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_323db3cf; branch feat/single-page-terminal-site. Preview: http://127.0.0.1:33779/. Follow that note for exact capture mechanism, checks and remaining limits. Parent must inspect the rendered desktop/mobile result; no merge/deployment is authorized here.

The hero keeps the Vesper palette and cell headline, with short factual copy, install/source links and a real local settings capture. Narrow screens use readable cells and a narrow source view, not a shrunken PNG. Controls, capture, text, hit testing and scroll use one grid. Semantic/no-JS HTML stays equivalent and accessible without adding visible app complexity.

## Keep these fixes

The baseline commit 29266c49 fixed [scroll responsiveness](scroll-responsiveness.md): measured wheel distance/remainders, one wheel owner, coalesced RAF, row-diff ANSI updates and same-frame full canvas paint. Keep these. With capture glyphs now in the grid, the raster synchronization/caching half of that note is obsolete.

Ghostty remains the renderer. The prior OpenTUI research already tested its published browser entry and native dependencies; no need to reopen that investigation for this page.

## Run

From site: bun install --frozen-lockfile, bun run build, bun run test. PORT=0 bun run preview selects a free loopback port. Set BASE_URL only to a real deployment URL for canonical/sitemap metadata. This host's installed Bun is /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun; use it instead of the untrusted mise shim. Do not change trust configuration just to run the build.

## Historical notes

- [vesper-hero.md](vesper-hero.md): previous hero research/writing/Vesper decisions remain useful; **multi-page and PNG compositor design is superseded**.
- [image-theme-research.md](image-theme-research.md): upstream Ghostty image limitations and official Vesper source. We now render capture cells, not image protocols.
- [terminal-research.md](terminal-research.md): original actual-terminal requirement and renderer selection.
- writing-sources/: saved user-requested anti-slop skill and source material. Keep prose specific and short.
- validation/single-page/: active focused screenshots/checks. Other validation folders are historical, not current acceptance screenshots.

Canvas reading/selecting/find relies on the semantic HTML representation. Physical phones and Safari/Firefox remain untested; automated checks are not a manual screen-reader audit. Values already cover this task; no forced values edit.
