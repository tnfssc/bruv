# bruv.sharath.page

Static page, no dependencies. Cloudflare builds it with `npm run build` and serves `dist/`.

- Preview: `python3 -m http.server 8791` in this folder, then open http://127.0.0.1:8791/.
- Social card: `og.html` rendered at 1200×630 into `assets/og.png`.
- The hero clip is a real bruv run, sped up:
  1. Record a run: save `tmux capture-pane -e -p` once a second into a folder of `<ms>.ans` files.
  2. Set the time ranges, speeds and captions in `scripts/plan.json` (timestamps are the frame file names).
  3. `FRAMES=<folder> npm run frames` builds `replay-frames.json` for `replay.html`.
  4. Serve the folder, set `CHROME` to a Chrome or chrome-headless-shell binary, then `npm run record` writes `assets/done.mp4` and `assets/done.gif`. `replay.html` replaces the page clock, so every recording is identical.
