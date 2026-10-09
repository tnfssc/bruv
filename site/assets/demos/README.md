# README demos

These GIFs are product assets, not test evidence. The root README uses relative paths so GitHub displays the animations without a video player or outside host.

The first three reuse `site/demos.ts` and the colored cell renderer from the website. Live uses `site/scripts/readme-live.ts` and the real `compactLiveStatus` helper. All conversations are scripted UI examples, not recorded model replies. No microphone, credentials, or paid calls are used.

To rebuild all four, install ffmpeg and Playwright Chromium, then run:

```sh
cd site
bun install --frozen-lockfile
bunx playwright@1.63.0 install chromium
bun run gifs
```

`CHROMIUM_BIN` can point to an existing browser. Frames go to ignored `artifacts/readme-gifs/`. The GIFs use 840 × 534 pixels, five frames per second, and an infinite loop. The website timings include a final hold before each loop. Live holds the finished transcript too.

The renderer uses the website's prompt font and DejaVu Sans Mono. Install that font to keep exports consistent. The exporter clears its frame folders on each run.
