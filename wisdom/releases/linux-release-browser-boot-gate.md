# Final Linux release browser boot gate

Date: 2026-09-30
Branch: `die/gate-release-on-browser-boot-6a1d394b`

## Scope

Added `integrations/t3/gates/release-browser-boot.ts` and a mandatory
`linux-browser-boot` job in `.github/workflows/release.yml`. It downloads
`stable-release-assets` and launches exactly `dist/release/die-linux-x64`.
Fresh builds and reused dry-run assets both take this gate. Publish explicitly
requires success. Chromium/playwright-core 1.60.0 are installed in runner temp,
not in product dependencies. No product/build edits, release or version bump.

The binary gets private HOME, XDG cache/state/config/data, web/agent state,
and a temporary git workspace with no inherited provider credentials. Browser
listeners are attached before navigation. Page errors, console errors, failed
requests and HTTP errors fail the gate. Initial boot and reload each need real
setup/app UI, no splash and no load failure; readiness is rechecked after 1.5s.
Proof records binary SHA-256, both surfaces, errors, body text and backend output;
failed browser runs also save a screenshot. Cleanup stops the owned process group.

## Local proof and limits

A real compiled v0.15.9 artifact at `/home/tnfssc/Code/die/dist/die`
was tested with installed playwright-core 1.60.0 and Chromium 1228.
SHA-256: `92536d190ac9e76d11436e0bd137047d3ef13c9a4b8ef30195b9f2f947340c10`.
It failed clearly before accepting setup/app:

- Console: `T3 Code failed to start. TypeError: c is not a function`
  in the compiled Effect chunk.
- Visible browser text: `T3 Code could not load. / Reload`.
- No successful navigation recorded. This is failure detection proof, not a fixed
  release or reload success claim.

Proof in this worktree:
`artifacts/release/browser-boot-v0159.json` and
`artifacts/release/browser-boot-v0159.json.png`.
The existing root `dist/release/die-linux-x64` identifies as 0.1.0 and
rejects web options; its early failure is recorded separately in
`artifacts/release/browser-boot.json`. Root worker must validate the freshly
integrated final release artifact, including the successful reload path.

Local /tmp lacked extraction space, so the v0.15.9 rerun used a fresh short
filesystem TMPDIR, `/home/tnfssc/.cache/rboot`, removed afterward.
A long worktree TMPDIR made Chromium's singleton Unix socket exceed its path
limit; keep custom TMPDIR short. Neither environment failure was labeled a
product boot failure.

## Static checks

- actionlint 1.7.7 (shellcheck disabled): PASS for release.yml.
- git diff --check: PASS.

## Rerun

See `integrations/t3/gates/README.md` for the local command and overrides.
CI stores `release-linux-browser-boot-proof` even after a gate failure.

Values unchanged: existing “test built thing”, “say what proof shows”, and
“show what user actually sees” already cover this lesson. Source regression
checks and HTTP 200 alone cannot prove a packaged browser startup.
