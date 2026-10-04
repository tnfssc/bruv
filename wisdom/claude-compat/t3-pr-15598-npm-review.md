# T3 #15598: verify packaging before following path feedback

Evidence: [review trial](../experiments/t3/pr-15598-npm-review/README.md).

At c1310b242, the nested TypeScript adapter becomes dist/binCli-DZ5IwGw5.mjs in the default bundle. import.meta.url is the emitted chunk URL: ./claude-history-worker.mjs is its correct sibling. A synthetic relocated-source path probe would falsely suggest ascending directories. Verify the emitted source map matches the exact tracked head before reasoning about its runtime URL.

Current npm packaging is a launcher plus platform SEA package. Build the executable and run the repo archive/npm builders, then actually npm-install both local tarballs. A live strict UI trial through the installed launcher confirmed that the real fork executes the installed executable's __claude-history command, emits JSON sessionId and exits 0. This is stronger than a URL check alone. Source .ts and bundled .mjs paths remain distinct from SEA, not different copies of a nested adapter directory. Desktop was inspected statically, not tested.

Late review added a separate real issue: newly spawned history worker could hang indefinitely. Independent commit aeee9df0337bcfa35230e8cd69816815a54e648f adds one 30-second deadline outside the scoped operation. A regression uses a real stalled Node child with TestClock; it fails before the fix, passes after, and verifies actual child termination. Both original and updated Linux npm artifacts pass the original strict history-only workflow. No path change, broad abstraction or matrix.

Never stage shared dist assets by symlink. This trial copied all assets physically, built in an independent source clone and pinned artifact/tree hashes. Original dist still exactly matches its prior 6,730-entry inventory. Trace wrapper supervised only its owned process group; all traced launcher/server/fork worker PIDs disappeared after cleanup.

Scope matters: normal server args=[], HOME/PATH only, provider configuration only via UI; no credentials/synthetic connector events. Existing prebuilt web/resource assets reused physically. Results explicitly retain fullAcceptancePassed=false for history-only; no desktop, cross-platform, release, server-restart or full-CI claim. Parent reviews/cherry-picks source fix and posts replies; subagent did not push or mutate PR.
