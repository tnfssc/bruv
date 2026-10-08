# v0.15.6

## Cleaner local builds

- Fix Effect compiler diagnostics in the embedded browser/server source, with numeric-boundary and error-reporting tests.
- Use modern pnpm deployment and a dependency set scoped to the embedded browser/server, eliminating its legacy-deploy, deprecated-package, and peer-conflict warnings. This does not repair or ship upstream Electron or mobile apps.
- Split large web code and load syntax grammars, Oniguruma, and HEIC codecs as assets/workers. Emitted JavaScript chunks stay below the existing 500 KB warning limit.
- Remove unreachable Node-only HEIC glue from the browser worker build, without fake Node shims or suppressed warnings.
- Typecheck both embedded application graphs before packaging, and keep canonical source verification intact.

## Platform boundary

Android native optional dependencies are retained during deployment. Workspace native search loads only on demand and reports unavailable on Android, where its dependency has no binary. Android device startup is not certified by the Linux tests. Hosted release gates validate supported Linux/macOS paths; no Windows support is claimed.

## Remaining diagnostics

Two Rolldown plugin-timing advisories remain visible. They report real compiler/worker build cost; they are not hidden or relabeled as eliminated. Repository-wide lint and test-only diagnostics are separate from installer output.

The remote workflow remains experimental, as in v0.15.5.
