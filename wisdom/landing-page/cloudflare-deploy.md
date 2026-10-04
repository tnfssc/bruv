# Cloudflare deployment

The 2026-10-04 Workers Builds logs showed three setup failures:

- Default Bun 1.2.15 could not parse `site/bun.lock` version 2. Set the build variable `BUN_VERSION=1.4.2`, matching CI.
- With no config, Wrangler inferred assets directory `.` and tried to upload `node_modules/workerd/bin/workerd` (128 MiB). Publish only `site/dist`.
- `--assets ./dist` fixed the directory but still needed a compatibility date.

`site/wrangler.jsonc` now sets name `bruv`, compatibility date `2026-10-01`, and assets directory `./dist`. Cloudflare root is `site`; build is `bun run build`; deploy is `npx wrangler deploy`. The site README records these settings.

Local frozen install and build passed with Bun 1.4.2. Wrangler 4.147.0 dry-run passed (job `task_5a2d3c1f`, exit 0). It read only the 25 files in `site/dist`, with no name/date warning. The shell printed mise trust warnings before the successful commands; no trust settings were changed. The user confirmed the Cloudflare deployment works after the command fixes, before these local files were pushed. This is user-reported success, not a browser check by the agent. The checked-in config was validated by the local dry-run. No dashboard change was made by the agent. The user then asked to record this and push to the default branch. `git ls-remote --symref origin HEAD` confirmed that branch is `develop`. Push the config, site guide and this note together. After deployment, check `/`, `/text.html` and `/ghostty-vt.wasm`. Set `BASE_URL` to the real public URL.

Values unchanged. This is a host setup recipe, covered by keeping code and handoff notes together.
