# Main-v2 real browser feature acceptance — 2026-10-02

**PASS bounded coverage. No remaining blocker for the tested paths.** Read-only probe; no production/test/source/dist/manifest edits, build, commit, paid provider or device calls. Read main-chunk-gate-review.md and existing candidate acceptance first.

## Exact candidate

Workspace: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_aceee262
Root HEAD: 5136f8948ccae0bd1e4369d95ca21d8a44ca6e39
Upstream source pin: 8bc40b4e07bb7b4b0f71876d59520360c9bf958c
Binary dist/bruv SHA-256: bba792d4633b6d2e96ee10329fe07bf7494ef076f626560c2e2ac388d458b5e1
Canonical bruv.patch SHA-256: c2aa1bac4b9b6d484d3532fba52c1a7dd16b1f79445087e0978afc449e2b989d
Build manifest SHA-256: 10bbc95f8c346fcbdc8ba97bd6bf40bab8bd57f031e0a3a3a362238bdf0bb6b6

Independently verified canonical production source before/after with existing verifyWebSource; binary/patch/root hashes unchanged. Existing build receipt: producer buildWeb, archive SHA-256 88158f9ce9df78b0fb2c1170a3951884d34269713c72e796034f9c708ecfecf8. All **277 fetched /assets/** paths were separately fetched from the actual packaged binary server and compared byte-for-byte with this exact immutable source/apps/web/dist, with per-asset hashes. No dev server or replacement bundle.

## Actual production UI paths

Chromium 149.0.7827.55 / Playwright, isolated real binary web server on loopback, disposable HOME/workspace and short disk-backed /home/tnfssc/.bf-0hoUu1 Chromium temp. Real composer file input → real draft attachment previews; never submitted a message. No codec/tokenizer mocks, retired custom adapter fixture, reimplemented grammar or regex highlighter. Telemetry wrappers only observe real Worker messages and main-thread WebAssembly instantiation.

- **HEIC PASS:** public libheif examples/example.heic (718114 bytes; SHA-256 7f8b363e4936c0666a25f64f3a92fda10bd8e5453be4592530b65a55dd98f3f2), pinned public commit 2f642b11f9e2d5df189cdba86208bde4bbe08618. Actual imageCompression.ts → official heic-to/csp bundled heicTo → real HEIC decoder worker. Asserts converted example.jpg is image/jpeg, JPEG FF D8 FF magic, 465789 bytes, actual expanded image **1280×854** (matches independent heif-info), canvas-rendered nonblank output: 54 distinct sampled opaque RGBA pixels. Screenshot shows decoded riverside buildings. Not just successful import or thumbnail load.
- **Shared highlighter PASS:** actual markdown attachment → AttachmentFilePreview → ChatMarkdown → getSyntaxHighlighterPromise/getSharedHighlighter with production shiki-wasm preference. Real cpp and elisp fenced code rendered with original marker text, respectively **18/17 styled token spans**, **7/7 distinct token styles**. Main-thread WebAssembly instantiated **466610 bytes**. Screenshot and rendered token HTML retained.
- **Pierre worker PASS:** actual cpp and .el draft previews → AttachmentFilePreview → ReadOnlySourcePreview → DiffWorkerPoolProvider → shipped worker-DOaduRmg.js. **Six real workers** initialize with preferredHighlighter=shiki-wasm; six success acknowledgments, zero worker errors. Both cpp and elisp grammars delivered through actual resolvedLanguages messages (no obsolete direct cpp module assumption); req_7/req_8 file tasks return success. Actual shadow-DOM output contains correct source text and respectively **27/19 styled token spans**, **8/7 distinct token styles**. No main-thread/plain-text fallback counted as worker success.
- **Feature diagnostics PASS:** zero page exceptions, console errors, asset request failures/HTTP errors or worker/module/init errors. HEIC and production worker modules returned HTTP 200.

## Observations and limits

Three unrelated **/api/observability/v1/traces net::ERR_ABORTED** requests occurred in final run, retained and explicitly excluded from module/asset checks; do not interpret this as all-network-error-free. No provider credentials: app displayed expected “Bruv has no usable models” warning; no model invocation required.

Exploratory harness failures were script escaping, an incorrect accessible close selector, and reading a transient plain worker render before its async colored render. Disposable probes corrected only; failure receipts retained. Final full assertion run exit 0, proof.passed=true. No production fixes.

Only primary/default HEIC decode on this sample, cpp/Elisp shared and worker file rendering in these actual preview surfaces. Not all HEIC variants/orientation/metadata, all languages, all themes, diff-task rendering, streaming, clipboard, platform support or general feature-preservation/release claim. No live provider/device acceptance.

Sample provenance/license evidence is in sample-provenance.md and samples/COPYING (adjacent MIT examples license); no independent media-specific license conclusion, no sample bytes committed. Owned launcher/server PIDs confirmed absent; loopback server no longer reachable after teardown.

## Durable evidence

/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_aceee262/.cache/main-v2/browser-features

Key files: acceptance.ts, acceptance.log, proof.json; server.ts/server.json/server.log; identity-before.log/identity-after.log; asset-identity.ts/asset-identity.json; manifest-sha256.log; sample-provenance.md/sample-info.log/samples/COPYING; heic-rendered.png, shared-cpp-elisp.png, worker-acceptance.cpp.png, worker-acceptance.el.png; harness-close-selector-failure.json and harness-worker-render-race.json; cleanup.json. All probe/evidence writes are disposable untracked cache files.

Reproduce in this candidate: source .cache/main-v2/env.sh in **bash**, launch bun .cache/main-v2/browser-features/server.ts, then bun .cache/main-v2/browser-features/acceptance.ts and bun .cache/main-v2/browser-features/asset-identity.ts; stop the owned server. No build step.
