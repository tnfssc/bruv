# bruv.sharath.page

Static page, no dependencies. Cloudflare builds it with `npm run build` (or `bun run build`) and serves `dist/`.

- Preview: `python3 -m http.server 8791` in this folder, then open http://127.0.0.1:8791/.
- Social card: `og.html` rendered at 1200×630 into `assets/og.png`.
- Race clip: serve the folder as above, set `CHROME` to a Chrome or chrome-headless-shell binary, then `npm run record` writes `assets/race.mp4` and `assets/race.gif`. `clip.html` replaces the page clock so every recording is identical.
