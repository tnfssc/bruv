# Landing page — one real terminal page

## Shared installer and README

See [shared GitHub installer and installation-first README](shared-installer-readme.md) for the current canonical scripts/install.sh source, verified develop default branch, and required GitHub publication before the raw URL works. This supersedes /install.sh preview-source instructions in earlier installer notes.


## Product positioning — user correction

Bruv is an opinionated coding agent with added features. Do not advertise it primarily as parallel agents, delegation, or a way to keep coding while agents work. The earlier feature-first pitch was wrong. Hero and metadata now state the product category directly; background jobs, subagents and project wisdom support that pitch. Do not invent what its opinions are without grounding them in actual guidance and user intent. This supersedes earlier product-story advice.

## Current contract

The visible main site is an actual Ghostty Web/WASM terminal, not terminal-themed HTML. The latest request is **one scrolling page**, with captures' **actual text and colors composed as terminal cells**. No multi-route app, section menu, gallery or raster screenshot plane.

Current work: [approved-layout copy and playback polish](polish-checkpoint.md), starting from accepted checkpoint 9d2a44b4. Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_0f2604c1; branch feat/landing-copy-loop-polish. New preview: http://127.0.0.1:45339/ and http://127.0.0.1:45339/text.html. No merge/deployment is authorized; prior preview URLs below are historical.

The approved Ghostty/Vesper design remains. One heading per feature and short factual copy replace repeated category/eyebrow/stage stacks. Three source-backed scripted demos loop with hover/focus/touch playback and reduced-motion opt-in. The explicit HTML view animates the same cell frames in semantic pre/spans and preserves complete no-JS transcripts. [Animated feature notes](animated-features.md) and [writing review](writing-sources/polish-review.md) document decisions and provenance.

[Single-page cell captures](single-page-cells.md) documents the retained renderer/capture machinery, not the current product copy. Its old preview is superseded; do not restart it.

## Page copy follow-up

User asked to remove demo caveats from the page. Removed the shared scripted-demo disclaimer and playback-instruction paragraph from both rendered views. Removed the fixed scroll-hint footer too; HTML access now sits in the header. The large heading is now Bruv in both views, with the product pitch below. Use the full 5×7 wordmark whenever its 23 cells fit; the former 3×5 mobile B/R looked distorted. A head bootstrap hides fallback content before first paint only on the terminal entry. Success reveals the ready terminal; module/WASM failure restores HTML. With no JavaScript, HTML is visible from the start. Controls retain accessible demo labels. Scripted content and source provenance remain in feature wisdom, not marketing copy. Values unchanged: separate user-facing content from acceptance notes.

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
- validation/polish/: current focused screenshots/checks. Other validation folders are historical.

Canvas reading/selecting/find relies on the semantic HTML representation. Physical phones and Safari/Firefox remain untested; automated checks are not a manual screen-reader audit. Values already cover this task; no forced values edit.

## Installer integration

[Copyable download installer](install-script.md) was developed in /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_50347bb3, branch feat/landing-install-script, commit 90141a5d. It is integrated into the current worktree alongside the later mobile wordmark and opinionated-agent positioning fixes. Preview 45339 is the integrated review target. No release or deployment authorized.
